import { json, handleError, requireUser } from '@/lib/api'
import { storefrontConfigured } from '@/lib/storefront/db'
import { site } from '@/lib/storefront/access'
import { pullQuoteDecisions } from '@/lib/storefront/tracking'
import { notifyChange } from '@/lib/realtime'

// GET — what's waiting on the website side, for the sidebar badges:
// web orders nobody has handled yet and new repair requests.
export async function GET() {
  try {
    await requireUser()
    if (!storefrontConfigured()) return json({ data: { orders: 0, repairs: 0 } })
    // Open ERP screens poll this every minute: a good moment to apply the
    // quote answers customers gave online (see lib/storefront/tracking.ts).
    try {
      if (process.env.STOREFRONT_REVALIDATE_SECRET && (await pullQuoteDecisions()) > 0) {
        await notifyChange(null, ['repairs'])
      }
    } catch (err) {
      console.error('[counts] quote answers:', err)
    }
    const [orders, repairs] = await Promise.all([
      site().orderRequest.count({ where: { status: 'NEW' } }),
      site().repairRequest.count({ where: { status: 'NEW' } }),
    ])
    return json({ data: { orders, repairs } })
  } catch (err) {
    return handleError(err, 'GET /api/site/counts')
  }
}
