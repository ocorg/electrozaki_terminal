import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { notifyCaisseChange } from '@/lib/realtime'

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id  = searchParams.get('store_id')
    const client_id = searchParams.get('client_id')

    const data = await prisma.credit_payments.findMany({
      where:   { ...(store_id && { store_id }), ...(client_id && { client_id }) },
      include: { clients: { select: { nom: true, telephone: true } } },
      orderBy: { created_at: 'desc' },
      take:    200,
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/credits')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { client_id, montant, payment_method, store_id, txn_id, payment_ref, notes } = await request.json()
    if (!client_id) throw new HttpError(400, 'client_id requis')
    if (!(Number(montant) > 0)) throw new HttpError(400, 'Montant invalide')
    if (!payment_method) throw new HttpError(400, 'Méthode de paiement requise')

    const data = await prisma.credit_payments.create({
      data: {
        client_id,
        store_id:     store_id ?? user.store_id ?? null,
        txn_id:       txn_id ?? null,
        montant:      Number(montant),
        payment_method,
        payment_ref:  payment_ref ?? null,
        notes:        notes ?? null,
        collected_by: user.id,
        created_by:   user.id,
      },
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'credits',
      record_id:   data.payment_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `Paiement crédit ${montant} MAD — client ${client_id}`,
    })
    await notifyCaisseChange(data.store_id)

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/credits')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const payment_id = new URL(request.url).searchParams.get('payment_id')
    if (!payment_id) throw new HttpError(400, 'payment_id requis')

    const before = await prisma.credit_payments.findUnique({ where: { payment_id } })
    if (!before) throw new HttpError(404, 'Paiement introuvable')
    await prisma.credit_payments.delete({ where: { payment_id } })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'credits',
      record_id:    payment_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })
    await notifyCaisseChange(before.store_id)

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/credits')
  }
}
