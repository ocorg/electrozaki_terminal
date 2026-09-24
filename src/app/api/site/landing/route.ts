import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { parseLanding, landingStatus } from '@/lib/storefront/landing'

// GET — promo pages with their results: visits, orders and sales from them.
export async function GET() {
  try {
    await requireUser(MANAGERS)
    const db = site()
    const pages = await db.landingPage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true } },
        promoCode: { select: { code: true } },
        products: { select: { productId: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    const orders = await db.orderRequest.groupBy({
      by: ['landingPageId'],
      where: { landingPageId: { in: pages.map(p => p.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { totalEstimate: true },
    })
    const stats = new Map(orders.map(o => [o.landingPageId, o]))
    return json({
      data: pages.map(({ products, ...p }) => ({
        ...p,
        productIds: products.map(x => x.productId),
        status: landingStatus(p),
        orders: stats.get(p.id)?._count._all ?? 0,
        revenue: Number(stats.get(p.id)?._sum.totalEstimate ?? 0),
      })),
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/landing')
  }
}

// POST — create a page (managers).
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { data, productIds } = await parseLanding(await request.json())
    const created = await site().landingPage.create({
      data: { ...data, products: { create: productIds.map((productId, sortOrder) => ({ productId, sortOrder })) } },
    })
    await logSite(user, 'creation', `Page promo « ${created.title} » créée (/offres/${created.slug})`, { record_id: created.id })
    refreshSite()
    return json({ ok: true, data: created }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/landing')
  }
}

export const POST = withNotify(POST_)
