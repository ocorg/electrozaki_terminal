import { NextRequest } from 'next/server'
import { json, handleError, requireUser } from '@/lib/api'
import { site, orderRef } from '@/lib/storefront/access'

const STATUSES = ['NEW', 'CONTACTED', 'CONFIRMED', 'CANCELLED'] as const

// GET ?status= — online orders, newest first (all staff).
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const status = request.nextUrl.searchParams.get('status')
    const orders = await site().orderRequest.findMany({
      where:   status && (STATUSES as readonly string[]).includes(status) ? { status: status as (typeof STATUSES)[number] } : undefined,
      orderBy: { createdAt: 'desc' },
      take:    300,
      select: {
        id: true, customerName: true, customerPhone: true, status: true, totalEstimate: true,
        discountAmount: true, requiresAdvance: true, advancePaymentStatus: true, whatsappOpenedAt: true, createdAt: true,
        items: { select: { productNameSnapshot: true, quantity: true, isGift: true } },
      },
    })
    return json({ data: orders.map(o => ({ ...o, ref: orderRef(o.id) })) })
  } catch (err) {
    return handleError(err, 'GET /api/site/orders')
  }
}
