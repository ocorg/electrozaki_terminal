import { NextRequest } from 'next/server'
import type { supplier_payment_type } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

const PAYMENT_TYPES: supplier_payment_type[] = ['reglement_a', 'avance_a', 'paiement_b']

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const supplier_id = searchParams.get('supplier_id')
    const store_id    = searchParams.get('store_id')

    // Sold phones not yet settled, for the "Fournisseur A" flow (phones_unsettled_a is a view)
    if (searchParams.get('mode') === 'unsettled_phones' && supplier_id) {
      const data = await prisma.$queryRaw`
        SELECT phone_id, fournisseur_id, marque, model, imei, couleur, stockage, prix_achat, cash_recu, fac_ref, sold_at
        FROM phones_unsettled_a WHERE fournisseur_id = ${supplier_id} ORDER BY sold_at DESC`
      return json({ data })
    }

    const data = await prisma.supplier_payments.findMany({
      where:   { is_deleted: false, ...(supplier_id && { supplier_id }), ...(store_id && { store_id }) },
      orderBy: { date_paiement: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/supplier-payments')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const store_id = body.store_id ?? user.store_id ?? null

    if (!body.supplier_id) throw new HttpError(400, 'supplier_id requis')
    if (!(Number(body.montant) > 0)) throw new HttpError(400, 'Montant invalide')
    if (!PAYMENT_TYPES.includes(body.payment_type)) throw new HttpError(400, 'payment_type invalide')
    const phoneIds: string[] = Array.isArray(body.phone_ids) ? body.phone_ids : []

    // Payment and (for reglement_a) settling the phones commit together
    const data = await prisma.$transaction(async (tx) => {
      const payment = await tx.supplier_payments.create({
        data: {
          supplier_id:   body.supplier_id,
          payment_type:  body.payment_type,
          montant:       Number(body.montant),
          phone_ids:     phoneIds,
          date_paiement: dateOnly(body.date_paiement) ?? todayDate(),
          notes:         body.notes ?? null,
          store_id,
          created_by:    user.id,
        },
      })
      if (body.payment_type === 'reglement_a' && phoneIds.length) {
        await tx.phones.updateMany({
          where: { phone_id: { in: phoneIds } },
          data:  { settled_at: new Date(), settled_by: user.id },
        })
      }
      return payment
    })

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'paiements_fournisseurs',
      record_id:   data.payment_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/supplier-payments')
  }
}

export const POST = withNotify(POST_)
