import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

type Tx = Prisma.TransactionClient

/** Paid = sum of its payments; "soldé" when nothing is left (a trade-in
 *  counts), back to "en cours" otherwise. Cancelled credits are left alone. */
export async function recomputeCredit(tx: Tx, creditId: string) {
  const credit = await tx.phone_credit_sales.findUniqueOrThrow({ where: { credit_id: creditId } })
  const agg = await tx.phone_credit_payments.aggregate({ where: { credit_id: creditId }, _sum: { montant: true } })
  // the down payment taken on the sale itself + the payments made since
  const paid = Number(credit.avance_vente ?? 0) + Number(agg._sum.montant ?? 0)
  const owed = Number(credit.montant_total) - Number(credit.reprise_valeur ?? 0)
  return tx.phone_credit_sales.update({
    where: { credit_id: creditId },
    data: {
      montant_paye: paid,
      ...(credit.statut !== 'annule' && { statut: paid >= owed - 0.01 ? 'solde' : 'en_cours' }),
    },
  })
}

/** A payment dated on a closed caisse day can't be changed — that day's
 *  figures were counted and approved (same rule as POS returns). */
export async function assertCaisseOpen(tx: Tx, storeId: string | null, date: Date) {
  if (!storeId) return
  const caisse = await tx.caisse.findFirst({ where: { store_id: storeId, date }, select: { status: true } })
  if (caisse && caisse.status !== 'ouverte') {
    throw new HttpError(409, `La caisse du ${date.toISOString().slice(0, 10)} est clôturée : ce versement ne peut plus être modifié. Enregistrez plutôt un versement correctif.`)
  }
}

export function requireMotif(value: unknown): string {
  const motif = String(value ?? '').trim()
  if (motif.length < 3) throw new HttpError(400, 'Indiquez le motif de la modification')
  return motif
}
