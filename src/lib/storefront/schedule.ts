import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { storefrontConfigured } from './db'
import { syncStorefront } from './sync'
import { revalidateStorefront } from './revalidate'

// Website updates after ERP writes, grouped (owner, 2026-11-05). A full
// website sync + a whole-site refresh after every single write (each sale,
// each photo colour…) used up the hosting's monthly processor time and paused
// both sites. Now each write leaves a note in `settings`; after a few seconds
// of calm, ONE update runs for everything noted: a sync if stock or prices may
// have changed, then a refresh of only the website pages concerned.
// The daily cron (/api/cron/site-sync) still re-checks and refreshes everything.

const KEY = 'site_update_pending'
const STORE = 'EZ-001'
const CALM_MS = 8_000

type Pending = { token?: string; sync?: boolean; all?: boolean; ids?: string[] }

export type SiteUpdate = { sync?: boolean; all?: boolean; productIds?: string[] }

/** Note an update and run it once the writes have calmed down (call inside waitUntil). */
export async function scheduleSiteUpdate(req: SiteUpdate): Promise<void> {
  if (!storefrontConfigured()) return
  const token = randomUUID()
  const ids = JSON.stringify(req.productIds ?? [])
  try {
    await prisma.$executeRaw`
      INSERT INTO settings (key, store_id, value, notes, updated_at)
      VALUES (${KEY}, ${STORE}, ${JSON.stringify({ token, sync: !!req.sync, all: !!req.all, ids: req.productIds ?? [] })},
              'Mise à jour du site en attente (regroupée, voir lib/storefront/schedule)', now())
      ON CONFLICT (key, store_id) DO UPDATE SET updated_at = now(), value = (
        SELECT jsonb_build_object(
          'token', ${token}::text,
          'sync',  coalesce((old.v->>'sync')::boolean, false) OR ${!!req.sync},
          'all',   coalesce((old.v->>'all')::boolean, false) OR ${!!req.all},
          'ids',   (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb)
                    FROM jsonb_array_elements_text(coalesce(old.v->'ids', '[]'::jsonb) || ${ids}::jsonb) x)
        )::text
        FROM (SELECT coalesce(nullif(settings.value, ''), '{}')::jsonb AS v) old
      )`
    await new Promise(r => setTimeout(r, CALM_MS))
    // Only the latest note runs, and takes everything noted before it.
    const claimed = await prisma.$queryRaw<{ value: string }[]>`
      UPDATE settings s SET value = '{}', updated_at = now()
      FROM (SELECT id, value FROM settings WHERE key = ${KEY} AND store_id = ${STORE} FOR UPDATE) old
      WHERE s.id = old.id AND (coalesce(nullif(old.value, ''), '{}')::jsonb ->> 'token') = ${token}
      RETURNING old.value`
    if (!claimed.length) return
    const p = JSON.parse(claimed[0].value) as Pending
    if (p.sync) {
      const r = await syncStorefront({ alsoRefresh: p.ids ?? [], refreshAll: !!p.all })
      console.log('[site-update] sync', { created: r.created, updated: r.updated, removed: r.removed, details: r.details, refreshed: r.refreshed })
    } else {
      await revalidateStorefront(p.all ? { all: true } : { productIds: p.ids ?? [] })
      console.log('[site-update] refresh', p.all ? 'all' : `${p.ids?.length ?? 0} products`)
    }
  } catch (err) {
    console.error('[site-update] failed silently (the daily check catches up):', err)
  }
}
