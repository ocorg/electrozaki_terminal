import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { site, orderRef, phonesForRef } from '@/lib/storefront/access'

type Ctx = { params: { id: string } }

// POST — cancel a web order: the phones it reserved go back on sale (and back
// on the website). A phone that was reserved for something else in the
// meantime (e.g. a credit sale) is left alone.
async function POST_(_request: NextRequest, { params }: Ctx) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const order = await site().orderRequest.findUnique({
      where:   { id: params.id },
      include: { items: { include: { product: { select: { isPhone: true } } } } },
    })
    if (!order) throw new HttpError(404, 'Commande introuvable')
    if (order.status === 'CANCELLED') return json({ ok: true, released: 0 })

    // Only a CONFIRMED order reserved phones (see ../reserve) — an order that
    // never was must not free a unit another order or sale is holding.
    const phoneIds = order.status !== 'CONFIRMED' ? [] : (await Promise.all(
      order.items.filter(i => i.product.isPhone && !i.isGift && i.unitRef).map(i => phonesForRef(i.unitRef!)),
    )).flat()

    const credits = await prisma.phone_credit_sales.findMany({
      where:  { phone_id: { in: phoneIds }, is_deleted: false, statut: 'en_cours' },
      select: { phone_id: true },
    })
    const onCredit = new Set(credits.map(c => c.phone_id))
    const released: string[] = []
    for (const phoneId of phoneIds) {
      if (onCredit.has(phoneId)) continue
      const done = await prisma.phones.updateMany({
        where: { phone_id: phoneId, status: 'reserve' },
        data:  { status: 'disponible', updated_by: user.id, updated_at: new Date() },
      })
      if (done.count === 1) released.push(phoneId)
    }

    await site().orderRequest.update({ where: { id: order.id }, data: { status: 'CANCELLED' } })

    const ref = orderRef(order.id)
    for (const phoneId of released) {
      await logActivity({
        store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
        action_type: 'modification', module: 'telephones', record_id: phoneId,
        before_state: { status: 'reserve' }, after_state: { status: 'disponible' },
        notes: `Libéré — commande web ${ref} annulée`,
      })
    }
    await logActivity({
      store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
      action_type: 'annulation', module: 'site_web', record_id: ref,
      notes: `Commande web ${ref} annulée (${released.length} téléphone(s) remis en vente)`,
    })
    return json({ ok: true, released: released.length })
  } catch (err) {
    return handleError(err, 'POST /api/site/orders/[id]/release')
  }
}

export const POST = withNotify(POST_)
