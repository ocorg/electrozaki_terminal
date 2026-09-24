import { createHash, timingSafeEqual } from 'node:crypto'
import { json } from '@/lib/api'
import { syncStorefront } from '@/lib/storefront/sync'
import { storefrontConfigured, storefrontDb } from '@/lib/storefront/db'
import { repairTrackingQuietly } from '@/lib/storefront/tracking'

export const maxDuration = 60

// Daily safety net (vercel.json → crons): re-checks the whole website
// catalogue against ERP stock, catching anything a live sync missed.
// Public path in middleware — Vercel Cron sends `Authorization: Bearer
// $CRON_SECRET`, and nothing runs without it.
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
  if (!storefrontConfigured()) return json({ skipped: 'site web non configuré' })
  try {
    const stock = await syncStorefront()
    await repairTrackingQuietly('cron')
    // Site statistics are kept 13 months (free database plan).
    const cutoff = new Date(Date.now() - 400 * 86_400_000)
    const db = storefrontDb()
    await db.analyticsEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
    await db.botHit.deleteMany({ where: { day: { lt: cutoff } } })
    return json({ ok: true, ...stock })
  } catch (err) {
    console.error('[cron site-sync]', err)
    return json({ error: 'Synchronisation échouée' }, { status: 500 })
  }
}
