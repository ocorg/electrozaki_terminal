import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { json } from '@/lib/api'
import { telegram } from '@/lib/siteNotify'
import { deliveriesToPrepare, webOrdersToCall } from '@/lib/reports'

// Every day at 11:00 (owner, 2026-10-18), in the store's Telegram group: the
// parcels to get ready before the delivery company collects them, and the
// website customers to call back — nothing to say, no message. Called by the GitHub scheduler
// (.github/workflows/deliveries-reminder.yml: the free Vercel plan has no
// room for a third daily job). ?dry=1 returns the text without sending it.
// Public path in middleware: nothing runs without `Authorization: Bearer $CRON_SECRET`.
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
  const dry  = new URL(request.url).searchParams.get('dry') === '1'
  const done: Record<string, unknown> = {}
  const stores = await prisma.stores.findMany({ where: { is_active: true }, select: { store_id: true }, orderBy: { store_id: 'asc' } })
  // The website is one shop: its customers to call back go with the first store's parcels
  let web: string | null = null
  try { web = await webOrdersToCall() } catch (err) { console.error('[cron deliveries] web orders', err) }
  for (const [n, { store_id }] of stores.entries()) {
    try {
      const text = [await deliveriesToPrepare(store_id), n === 0 ? web : null].filter(Boolean).join('\n\n') || null
      done[store_id] = !text ? 'rien à préparer' : dry ? text : await telegram(text)
    } catch (err) {
      console.error('[cron deliveries]', store_id, err)
      done[`erreur ${store_id}`] = true
    }
  }
  return json(done)
}
