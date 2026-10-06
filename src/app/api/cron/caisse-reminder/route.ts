import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { json } from '@/lib/api'
import { telegram } from '@/lib/siteNotify'
import { STORE_TIME_ZONE } from '@/lib/time'

// Nightly reminder (owner, 2026-10-06): at 00:30 (vercel.json → crons), any
// caisse still open is announced in the store's Telegram group, so a day is
// not left unclosed. Public path in middleware — Vercel Cron sends
// `Authorization: Bearer $CRON_SECRET`, and nothing runs without it.
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  const given  = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!secret || !given) return false
  const a = createHash('sha256').update(secret).digest()
  const b = createHash('sha256').update(given).digest()
  return timingSafeEqual(a, b)
}

const day = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit' })
const time = (d: Date) => d.toLocaleTimeString('fr-FR', { timeZone: STORE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: 'Non autorisé' }, { status: 401 })
  try {
    const open = await prisma.caisse.findMany({
      where:   { status: 'ouverte', stores: { is_active: true } },
      orderBy: { date: 'asc' },
      select:  { date: true, ouverture: true, created_at: true, created_by: true, store_id: true },
    })
    if (!open.length) return json({ open: 0 })
    const users = await prisma.user_profiles.findMany({
      where: { id: { in: open.map(c => c.created_by).filter((v): v is string => !!v) } }, select: { id: true, display_name: true },
    })
    const who = new Map(users.map(u => [u.id, u.display_name]))
    const lines = open.map(c => {
      const by = c.created_by ? who.get(c.created_by) : null
      return `• ${day(c.date)} — ouverte${c.created_at ? ` à ${time(c.created_at)}` : ''}${by ? ` par ${by}` : ''}, fond ${Number(c.ouverture)} DH`
    })
    const sent = await telegram(
      `⚠️ Caisse non clôturée\n${lines.join('\n')}\n\nComptez le tiroir et clôturez-la : Caisse du jour → Clôturer la caisse.`,
    )
    return json({ open: open.length, telegram: sent })
  } catch (err) {
    console.error('[cron caisse-reminder] failed:', err)
    return json({ error: 'Rappel impossible' }, { status: 500 })
  }
}
