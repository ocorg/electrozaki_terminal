import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { syncStorefront } from '@/lib/storefront/sync'
import { storefrontConfigured } from '@/lib/storefront/db'
import { logActivity } from '@/lib/utils/logger'

export const maxDuration = 60

// POST — "Synchroniser maintenant" button (managers).
export async function POST() {
  try {
    const user = await requireActiveUser(MANAGERS)
    if (!storefrontConfigured()) throw new HttpError(503, 'Site web non configuré')
    const result = await syncStorefront()
    await logActivity({
      store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
      action_type: 'modification', module: 'site_web',
      notes: `Synchronisation du site : ${result.created} ajout(s), ${result.updated} mise(s) à jour, ${result.removed} retrait(s)`,
    })
    return json({ ok: true, ...result })
  } catch (err) {
    return handleError(err, 'POST /api/site/sync')
  }
}
