import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { json } from '@/lib/api'
import { telegram } from '@/lib/siteNotify'
import { morningBrief, weeklyReport } from '@/lib/reports'
import { businessDate } from '@/lib/time'
import { GET as siteSync } from '../site-sync/route'

export const maxDuration = 60

// Every morning (vercel.json → crons), in the store's Telegram group: what
// needs doing today — nothing to say, no message — and on Monday last week's
// summary. Then the daily website re-check (site-sync), so the free plan's
// daily jobs stay at two. Public path in middleware — Vercel Cron sends
// `Authorization: Bearer $CRON_SECRET`, and nothing runs without it.
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  const given  = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!secret || !given) return false
  const a = createHash('sha256').update(secret).digest()
  const b = createHash('sha256').update(given).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: 'Non autorisé' }, { status: 401 })
  const done: Record<string, unknown> = {}
  const stores = await prisma.stores.findMany({ where: { is_active: true }, select: { store_id: true } })
  const monday = new Date(`${businessDate()}T12:00:00Z`).getUTCDay() === 1
  for (const { store_id } of stores) {
    try {
      const brief = await morningBrief(store_id)
      done[`brief ${store_id}`] = brief ? await telegram(brief) : 'rien à signaler'
      if (monday) done[`semaine ${store_id}`] = await telegram(await weeklyReport(store_id))
    } catch (err) {
      console.error('[cron morning]', store_id, err)
      done[`erreur ${store_id}`] = true
    }
  }
  // The website re-check runs last: a slow sync never delays the messages
  try { done.site = (await siteSync(request)).status } catch (err) { console.error('[cron morning] site-sync', err); done.site = 'erreur' }
  return json(done)
}
