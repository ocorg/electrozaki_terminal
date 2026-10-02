import { NextRequest } from 'next/server'
import type { payment_method } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { recomputeCredit, assertCaisseOpen, requireMotif } from '@/lib/phoneCredits'

type Ctx = { params: { id: string; paymentId: string } }

// Correct or delete a payment typed wrong (owner's request, 2026-10-02).
// Managers, with a reason; never on a closed caisse day (old or new date),
// never once the credit is discharged or cancelled.
async function load(creditId: string, paymentId: string, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  await tx.$queryRaw`SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${creditId} FOR UPDATE`
  const credit = await tx.phone_credit_sales.findFirst({ where: { credit_id: creditId, is_deleted: false } })
  if (!credit) throw new HttpError(404, 'Crédit introuvable')
  if (credit.statut === 'annule') throw new HttpError(400, 'Ce dossier est annulé')
  if (credit.discharged_at) throw new HttpError(400, 'Dossier déjà déchargé (facture émise) : les versements ne peuvent plus changer')
  const payment = await tx.phone_credit_payments.findFirst({ where: { payment_id: paymentId, credit_id: creditId } })
  if (!payment) throw new HttpError(404, 'Versement introuvable')
  await assertCaisseOpen(tx, payment.store_id, payment.date_paiement)
  return { credit, payment }
}

async function PATCH_(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await req.json() as Record<string, unknown>
    const motif = requireMotif(body.motif)

    const result = await prisma.$transaction(async (tx) => {
      const { credit, payment } = await load(params.id, params.paymentId, tx)
      const montant = 'montant' in body ? Number(body.montant) : Number(payment.montant)
      const method  = ('payment_method' in body ? body.payment_method : payment.payment_method) as payment_method
      const date    = 'date_paiement' in body ? dateOnly(body.date_paiement) : payment.date_paiement
      if (!(montant > 0)) throw new HttpError(400, 'Montant invalide')
      if (method !== 'especes' && method !== 'virement') throw new HttpError(400, 'Mode de paiement invalide (espèces ou virement)')
      if (!date) throw new HttpError(400, 'Date invalide')
      if (date.getTime() !== payment.date_paiement.getTime()) await assertCaisseOpen(tx, payment.store_id, date)

      const owed = Number(credit.montant_total) - Number(credit.reprise_valeur ?? 0)
      const paidElsewhere = Number(credit.montant_paye) - Number(payment.montant)
      if (paidElsewhere + montant > owed + 0.01) {
        throw new HttpError(400, `Trop élevé : il ne restait que ${(owed - paidElsewhere).toFixed(2)} DH à payer`)
      }
      const note = `Corrigé (était ${Number(payment.montant)} DH) : ${motif}`
      const after = await tx.phone_credit_payments.update({
        where: { payment_id: payment.payment_id },
        data:  { montant, payment_method: method, date_paiement: date, notes: payment.notes ? `${payment.notes} · ${note}` : note },
      })
      const creditAfter = await recomputeCredit(tx, params.id)
      return { before: payment, after, creditAfter }
    })

    await logActivity({
      store_id: result.after.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'modification', module: 'telephones', record_id: params.paymentId,
      before_state: result.before, after_state: result.after, notes: `Versement ${params.id} corrigé : ${motif}`,
      ip_address: getIpFromRequest(req),
    })
    return json({ data: { payment: result.after, credit: result.creditAfter } })
  } catch (err) {
    return handleError(err, 'PATCH /api/phone-credits/[id]/payments/[paymentId]')
  }
}

async function DELETE_(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const motif = requireMotif(new URL(req.url).searchParams.get('motif'))

    const result = await prisma.$transaction(async (tx) => {
      const { payment } = await load(params.id, params.paymentId, tx)
      await tx.phone_credit_payments.delete({ where: { payment_id: payment.payment_id } })
      const creditAfter = await recomputeCredit(tx, params.id)
      return { payment, creditAfter }
    })

    await logActivity({
      store_id: result.payment.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'suppression', module: 'telephones', record_id: params.paymentId,
      before_state: result.payment, notes: `Versement ${params.id} supprimé : ${motif}`,
      ip_address: getIpFromRequest(req),
    })
    return json({ data: { credit: result.creditAfter } })
  } catch (err) {
    return handleError(err, 'DELETE /api/phone-credits/[id]/payments/[paymentId]')
  }
}

export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
