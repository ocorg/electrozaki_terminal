import Pusher from 'pusher'
import { waitUntil } from '@vercel/functions'
import { REALTIME_CHANNEL, REALTIME_EVENT, entitiesForWrite, prefixesFor, type ChangeEvent, type Entity } from '@/lib/data/entities'
import { syncStorefrontQuietly } from '@/lib/storefront/sync'

const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID!,
  key:     process.env.PUSHER_KEY!,
  secret:  process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS:  true,
})

// Tells every open screen what just changed so the affected ones refresh in the
// background. Carries no data, so a public channel is fine. Call after every write.
export async function notifyChange(storeId: string | null | undefined, entities: Entity[]) {
  try {
    const event: ChangeEvent = { store_id: storeId ?? null, entities }
    await pusher.trigger(REALTIME_CHANNEL, REALTIME_EVENT, event)
  } catch (err) {
    console.error('[notifyChange] failed silently:', err)
  }
}

/**
 * Wraps a write handler (POST/PATCH/PUT/DELETE): when it succeeds, every open
 * screen on every device is told what changed (derived from the route path).
 */
export function withNotify<R extends Request, A extends unknown[]>(
  handler: (request: R, ...rest: A) => Promise<Response>,
) {
  return async (request: R, ...rest: A): Promise<Response> => {
    const res = await handler(request, ...rest)
    if (res.ok) {
      const entities = entitiesForWrite(new URL(request.url).pathname)
      if (entities.length) await notifyChange(null, entities)
      // Anything that can change sellable stock or prices → update the
      // website, after the response (the till never waits for it).
      const prefixes = prefixesFor(entities)
      if (prefixes.includes('/api/phones') || prefixes.includes('/api/accessories') || prefixes.includes('/api/categories')) {
        waitUntil(syncStorefrontQuietly(entities.join(',')))
      }
    }
    return res
  }
}
