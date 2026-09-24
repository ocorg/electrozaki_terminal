import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { site, orderRef, phonesForRef } from '@/lib/storefront/access'

type Ctx = { params: { id: string } }

// POST — "Passer en caisse": the customer is here (or the courier is
// leaving), so the order's reserved phones are made sellable at the POS
// again. They stay off the website: the sync hides every unit of a
// CONFIRMED web order.
async function POST_(_request: NextRequest, { params }: Ctx) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const order = await site().orderRequest.findUnique({
      where:   { id: params.id },
      include: { items: { include: { product: { select: { isPhone: true } } } } },
    })
    if (!order) throw new HttpError(404, 'Commande introuvable')
    if (order.status !== 'CONFIRMED') throw new HttpError(409, "Confirmez et réservez d'abord la commande")

    const phoneIds = (await Promise.all(
      order.items.filter(i => i.product.isPhone && !i.isGift && i.unitRef).map(i => phonesForRef(i.unitRef!)),
    )).flat()

    const ref = orderRef(order.id)
    const ready: string[] = []
    for (const phoneId of phoneIds) {
      const done = await prisma.phones.updateMany({
        where: { phone_id: phoneId, status: 'reserve' },
        data:  { status: 'disponible', updated_by: user.id, updated_at: new Date() },
      })
      if (done.count === 1) {
        ready.push(phoneId)
        await logActivity({
          store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
          action_type: 'modification', module: 'telephones', record_id: phoneId,
          before_state: { status: 'reserve' }, after_state: { status: 'disponible' },
          notes: `Remis en caisse pour la commande web ${ref}`,
        })
      }
    }
    return json({ ok: true, phones: ready })
  } catch (err) {
    return handleError(err, 'POST /api/site/orders/[id]/checkout')
  }
}

export const POST = withNotify(POST_)
