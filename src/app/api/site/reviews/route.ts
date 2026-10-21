import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, orderRef, refreshSite } from '@/lib/storefront/access'

// Customer reviews left on the website (from the order tracking page, once an
// order is delivered). They are published at once; staff can hide one
// (insult, phone number, off-topic…) and show it again.

export async function GET() {
  try {
    await requireUser(MANAGERS)
    const reviews = await site().productReview.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { orderItem: { select: { orderRequest: { select: { id: true, customerName: true, customerPhone: true } } } } },
    })
    return json({
      data: reviews.map(({ orderItem, ...r }) => ({
        ...r,
        orderRef: orderRef(orderItem.orderRequest.id),
        customerName: orderItem.orderRequest.customerName,
        customerPhone: orderItem.orderRequest.customerPhone,
      })),
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/reviews')
  }
}

// PATCH { id, hidden } — hide a review from the site, or show it again.
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { id, hidden } = await request.json()
    if (typeof hidden !== 'boolean') throw new HttpError(400, 'Valeur invalide')
    const before = await site().productReview.findUnique({ where: { id: String(id) }, select: { id: true, authorName: true, productName: true, rating: true } })
    if (!before) throw new HttpError(404, 'Avis introuvable')
    await site().productReview.update({ where: { id: before.id }, data: { hidden } })
    await logSite(user, 'modification',
      `Avis de ${before.authorName} (${before.rating}★, ${before.productName}) ${hidden ? 'masqué' : 'de nouveau affiché'}`,
      { record_id: before.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/reviews')
  }
}

export const PATCH = withNotify(PATCH_)
