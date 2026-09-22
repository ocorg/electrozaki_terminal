import { NextRequest } from 'next/server'
import type { payment_method } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, todayDate, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { notifyCaisseChange } from '@/lib/realtime'

// POST /api/phone-credits/[id]/payments
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user     = await requireActiveUser()
    const creditId = params.id
    const body     = await req.json() as Record<string, unknown>
    const montant  = Number(body.montant)
    const method   = body.payment_method as payment_method
    const storeId  = user.store_id ?? (body.store_id as string) ?? 'EZ-001'

    if (!(montant > 0)) throw new HttpError(400, 'Montant invalide')
    if (method !== 'especes' && method !== 'virement') throw new HttpError(400, 'Mode de paiement invalide (espèces ou virement)')

    const { payment, newMontantPaye, isFullyPaid } = await prisma.$transaction(async (tx) => {
      // Lock the credit row: two simultaneous payments can't both pass the balance check
      const [locked] = await tx.$queryRaw<{ credit_id: string }[]>`
        SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${creditId} AND is_deleted = false FOR UPDATE`
      if (!locked) throw new HttpError(404, 'Crédit introuvable')
      const credit = await tx.phone_credit_sales.findUniqueOrThrow({ where: { credit_id: creditId } })
      if (credit.statut !== 'en_cours') throw new HttpError(400, 'Ce crédit n\'est plus en cours')

      // Cash obligation excludes the trade-in value credited at creation (same formula as
      // POST /api/phone-credits), or a credit with a reprise could never reach "solde".
      const cashObligation = Number(credit.montant_total) - (credit.has_reprise ? Number(credit.reprise_valeur ?? 0) : 0)
      const montantRestant = cashObligation - Number(credit.montant_paye)
      if (montant > montantRestant + 0.01) throw new HttpError(400, `Versement trop élevé — reste dû : ${montantRestant.toFixed(2)} DH`)

      const payment = await tx.phone_credit_payments.create({
        data: {
          credit_id:     creditId,
          montant,
          payment_method: method,
          date_paiement: dateOnly(body.date_paiement) ?? todayDate(),
          notes:         (body.notes as string | undefined) ?? null,
          store_id:      storeId,
          created_by:    user.id,
        },
      })
      const newMontantPaye = Number(credit.montant_paye) + montant
      const isFullyPaid    = newMontantPaye >= cashObligation - 0.01
      await tx.phone_credit_sales.update({
        where: { credit_id: creditId },
        data:  { montant_paye: newMontantPaye, ...(isFullyPaid && { statut: 'solde' }) },
      })
      return { payment, newMontantPaye, isFullyPaid }
    })

    await logActivity({
      user_id:     user.id,
      store_id:    storeId,
      user_name:   user.display_name,
      module:      'telephones',
      action_type: 'modification',
      record_id:   creditId,
      ip_address:  getIpFromRequest(req),
      after_state: {
        credit_id: creditId, payment_id: payment.payment_id, montant, payment_method: method,
        new_montant_paye: newMontantPaye, is_fully_paid: isFullyPaid,
      },
    })
    await notifyCaisseChange(storeId)

    return json({
      data: {
        payment,
        credit_updated: { montant_paye: newMontantPaye, statut: isFullyPaid ? 'solde' : 'en_cours', is_fully_paid: isFullyPaid },
      },
    }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phone-credits/[id]/payments')
  }
}
