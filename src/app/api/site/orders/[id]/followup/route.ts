import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, orderRef } from '@/lib/storefront/access'

type Ctx = { params: { id: string } }

// Calling a website customer back (lib/storefront/followups), managers:
//   PUT    { relance_le, note } — when to call, and why
//   DELETE                      — the call was made
async function PUT_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json() as { relance_le?: string; note?: string }
    const day  = dateOnly(body.relance_le)
    if (!day) throw new HttpError(400, 'Date de rappel obligatoire')
    if (day < todayDate()) throw new HttpError(400, 'La date de rappel est passée')
    const order = await site().orderRequest.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!order) throw new HttpError(404, 'Commande introuvable')
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null
    const data = await prisma.web_order_followups.upsert({
      where:  { order_id: order.id },
      create: { order_id: order.id, relance_le: day, note, created_by: user.id, updated_by: user.id },
      update: { relance_le: day, note, done_at: null, updated_by: user.id, updated_at: new Date() },
    })
    await logSite(user, 'modification', `Commande web #${orderRef(order.id)} : client à rappeler le ${day.toISOString().slice(0, 10).split('-').reverse().join('/')}${note ? ` — ${note}` : ''}`)
    return json({ data })
  } catch (err) {
    return handleError(err, 'PUT /api/site/orders/[id]/followup')
  }
}

async function DELETE_(_request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { count } = await prisma.web_order_followups.updateMany({
      where: { order_id: params.id, done_at: null },
      data:  { done_at: new Date(), updated_by: user.id, updated_at: new Date() },
    })
    if (count) await logSite(user, 'modification', `Commande web #${orderRef(params.id)} : client rappelé`)
    return json({ done: count > 0 })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/orders/[id]/followup')
  }
}

export const PUT    = withNotify(PUT_)
export const DELETE = withNotify(DELETE_)
