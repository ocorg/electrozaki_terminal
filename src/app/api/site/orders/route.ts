import { NextRequest } from 'next/server'
import { json, handleError, requireUser, MANAGERS } from '@/lib/api'
import { site, orderRef } from '@/lib/storefront/access'
import { openFollowups, callReason } from '@/lib/storefront/followups'

const STATUSES = ['NEW', 'CONTACTED', 'CONFIRMED', 'CANCELLED'] as const

// GET ?status= — online orders, newest first (all staff).
export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const status = request.nextUrl.searchParams.get('status')
    const orders = await site().orderRequest.findMany({
      where:   status && (STATUSES as readonly string[]).includes(status) ? { status: status as (typeof STATUSES)[number] } : undefined,
      orderBy: { createdAt: 'desc' },
      take:    300,
      select: {
        id: true, customerName: true, customerPhone: true, status: true, totalEstimate: true,
        discountAmount: true, requiresAdvance: true, advancePaymentStatus: true, whatsappOpenedAt: true, createdAt: true,
        deliveryCity: true, deliveryFee: true, deliveryEstimate: true, deliveryUnavailable: true,
        erpDeliveryId: true, shippingStatus: true, trackingNumber: true,
        landingPage: { select: { title: true } },
        items: { select: { productNameSnapshot: true, quantity: true, isGift: true } },
      },
    })
    // When to call the customer back, and why today (lib/storefront/followups)
    const followups = await openFollowups(orders.map(o => o.id))
    return json({ data: orders.map(o => ({ ...o, ref: orderRef(o.id), followup: followups.get(o.id) ?? null, callReason: callReason(o, followups.get(o.id)) })) })
  } catch (err) {
    return handleError(err, 'GET /api/site/orders')
  }
}
