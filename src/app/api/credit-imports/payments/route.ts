import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, todayDate, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json() as Record<string, unknown>
    const import_id = body.import_id as string | undefined
    const montant   = Number(body.montant)
    if (!import_id) throw new HttpError(400, 'import_id requis')
    if (!(montant > 0)) throw new HttpError(400, 'Montant invalide')
    const store_id = (body.store_id as string | null) ?? user.store_id ?? null

    const { payment, updated } = await prisma.$transaction(async (tx) => {
      // Lock the credit row: two simultaneous payments can't both pass the balance check
      const [imp] = await tx.$queryRaw<{ montant_du: number; montant_paye: number | null; statut: string }[]>`
        SELECT montant_du::float8 AS montant_du, montant_paye::float8 AS montant_paye, statut::text AS statut
        FROM credit_imports WHERE import_id = ${import_id} FOR UPDATE`
      if (!imp) throw new HttpError(404, 'Import introuvable')
      if (imp.statut === 'solde') throw new HttpError(400, 'Ce crédit est déjà soldé')
      const remaining = imp.montant_du - (imp.montant_paye ?? 0)
      if (montant > remaining + 0.01) throw new HttpError(400, `Montant dépasse le restant dû (${remaining.toFixed(2)} MAD)`)

      const payment = await tx.credit_import_payments.create({
        data: {
          import_id,
          store_id,
          montant,
          payment_method: (body.payment_method as 'especes' | 'virement' | undefined) ?? 'especes',
          payment_ref:    (body.payment_ref as string | undefined) ?? null,
          notes:          (body.notes as string | undefined) ?? null,
          date_paiement:  todayDate(),
          created_by:     user.id,
        },
      })
      // The sync_credit_import_balance trigger updates montant_paye + statut
      const updated = await tx.credit_imports.findUniqueOrThrow({
        where: { import_id }, select: { montant_du: true, montant_paye: true, statut: true },
      })
      return { payment, updated }
    })

    await logActivity({
      user_id:     user.id,
      store_id,
      user_name:   user.display_name,
      module:      'credits_importes',
      action_type: 'modification',
      record_id:   import_id,
      after_state: { import_id, ...updated },
      ip_address:  getIpFromRequest(request),
      notes:       `Paiement de ${montant.toFixed(2)} MAD`,
    })

    return json({ data: payment }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/credit-imports/payments')
  }
}

export const POST = withNotify(POST_)
