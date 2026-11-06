import { prisma } from '@/lib/db'
import { deviceLabels } from '@/lib/device-labels'

// What a sale line says in the Transactions lists (BZG and EZ; owner,
// 2026-11-06): the list showed only an id, the price, and a "reste à payer"
// equal to the whole price even for sales paid in full. Each row now says what
// was sold, to whom, by whom, how it was paid, what is really left to pay
// (from its payment plan or client-account payments), and whether it was
// returned or cancelled.

type Row = {
  txn_id: string; device_type: string; device_id: string; qty: number; prix_vente: unknown; avance: unknown
  valeur_echange: unknown; payment_method: string; created_by: string | null; voided: boolean
  couleur?: string | null; design?: string | null
}

export type SaleState = 'payee' | 'reste' | 'retour_partiel' | 'retournee' | 'annulee'

const n = (v: unknown) => Number(v ?? 0)

export async function transactionDetails<T extends Row>(rows: T[]) {
  const ids = rows.map(r => r.txn_id)
  const [labels, users, plans, accountPays, retours] = await Promise.all([
    deviceLabels(rows),
    prisma.user_profiles.findMany({ where: { id: { in: [...new Set(rows.map(r => r.created_by).filter((x): x is string => !!x))] } }, select: { id: true, display_name: true } }),
    prisma.phone_credit_sales.findMany({ where: { txn_id: { in: ids }, is_deleted: false }, select: { credit_id: true, txn_id: true, montant_total: true, montant_paye: true, statut: true, phone_remis: true } }),
    prisma.credit_payments.groupBy({ by: ['txn_id'], where: { txn_id: { in: ids } }, _sum: { montant: true } }),
    prisma.retours.findMany({ where: { txn_id: { in: ids } }, select: { retour_id: true, txn_id: true, type: true, date: true, qty: true, montant: true, mode: true, motif: true }, orderBy: { date: 'asc' } }),
  ])
  const seller = new Map(users.map(u => [u.id, u.display_name]))
  return rows.map(t => {
    const plan = plans.find(p => p.txn_id === t.txn_id) ?? null
    const paidLater = n(accountPays.find(p => p.txn_id === t.txn_id)?._sum.montant)
    const ret = retours.filter(r => r.txn_id === t.txn_id)
    // What is really left to pay: the payment plan's own balance, or (accessories
    // on a client account) price − advance − trade-in − payments since.
    const onCredit = t.payment_method === 'credit' || n(t.avance) > 0
    const reste = t.voided ? 0
      : plan ? (plan.statut === 'annule' ? 0 : Math.max(0, n(plan.montant_total) - n(plan.montant_paye)))
      : onCredit && t.payment_method !== 'echange' ? Math.max(0, n(t.prix_vente) - n(t.avance) - n(t.valeur_echange) - paidLater)
      : 0
    const returnedQty = ret.filter(r => r.type === 'retour').reduce((s, r) => s + r.qty, 0)
    const state: SaleState = t.voided ? 'annulee'
      : returnedQty >= (t.qty || 1) ? 'retournee'
      : returnedQty > 0 ? 'retour_partiel'
      : reste > 0 ? 'reste' : 'payee'
    return {
      ...t,
      device_label: [labels.get(t.device_id) ?? t.device_id, t.design, t.couleur].filter(Boolean).join(' · '),
      seller: t.created_by ? seller.get(t.created_by) ?? null : null,
      reste,
      paid_later: paidLater,
      plan: plan && { credit_id: plan.credit_id, total: n(plan.montant_total), paye: n(plan.montant_paye), statut: plan.statut, remis: plan.phone_remis },
      retours: ret.map(r => ({ ...r, montant: n(r.montant) })),
      state,
    }
  })
}
