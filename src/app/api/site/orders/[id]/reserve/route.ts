import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { site, orderRef, phonesForRef } from '@/lib/storefront/access'
import { refOf } from '@/lib/storefront/listing'

type Ctx = { params: { id: string } }

// POST — "Confirmer & réserver": after calling the customer, staff confirm
// the order; every phone in it is set to `reserve` in the ERP (so it leaves
// the website and the POS won't sell it) — all of them or none.
async function POST_(_request: NextRequest, { params }: Ctx) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const order = await site().orderRequest.findUnique({
      where:   { id: params.id },
      include: { items: { include: { product: { select: { isPhone: true } } } } },
    })
    if (!order) throw new HttpError(404, 'Commande introuvable')
    if (order.status === 'CANCELLED') throw new HttpError(409, 'Commande annulée')
    // CONFIRMED is only ever set here, after the reservation succeeded.
    if (order.status === 'CONFIRMED') return json({ ok: true, reserved: 0 })

    const lines = order.items.filter(i => i.product.isPhone && !i.isGift && i.unitRef)
    const plan: { itemId: string; name: string; phoneIds: string[] }[] = []
    for (const line of lines) {
      const candidates = await phonesForRef(line.unitRef!)
      const statuses = await prisma.phones.findMany({ where: { phone_id: { in: candidates } }, select: { phone_id: true, status: true } })
      const free = statuses.filter(p => p.status === 'disponible').map(p => p.phone_id)
      if (free.length < line.quantity) {
        throw new HttpError(409, `« ${line.productNameSnapshot} » n'est plus disponible en stock (vendu ou réservé entre-temps).`)
      }
      plan.push({ itemId: line.id, name: line.productNameSnapshot, phoneIds: free.slice(0, line.quantity) })
    }

    const ref = orderRef(order.id)
    await prisma.$transaction(async tx => {
      for (const step of plan) {
        for (const phoneId of step.phoneIds) {
          const done = await tx.phones.updateMany({
            where: { phone_id: phoneId, status: 'disponible' },
            data:  { status: 'reserve', updated_by: user.id, updated_at: new Date() },
          })
          if (done.count !== 1) throw new HttpError(409, `« ${step.name} » vient d'être vendu ou réservé.`)
        }
      }
    })

    // Remember exactly which units were reserved (opaque references only).
    for (const step of plan) {
      await site().orderRequestItem.update({
        where: { id: step.itemId },
        data:  { unitRef: step.phoneIds.map(id => refOf('tel-unit', id)).join(',') },
      })
    }
    await site().orderRequest.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } })

    for (const step of plan) {
      for (const phoneId of step.phoneIds) {
        await logActivity({
          store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
          action_type: 'modification', module: 'telephones', record_id: phoneId,
          before_state: { status: 'disponible' }, after_state: { status: 'reserve' },
          notes: `Réservé pour la commande web ${ref}`,
        })
      }
    }
    return json({ ok: true, reserved: plan.reduce((n, s) => n + s.phoneIds.length, 0) })
  } catch (err) {
    return handleError(err, 'POST /api/site/orders/[id]/reserve')
  }
}

export const POST = withNotify(POST_)
