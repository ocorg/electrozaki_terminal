import type { Prisma, retour_destination } from '@prisma/client'
import { HttpError } from '@/lib/api'
import { assertNoLiveTwin } from '@/lib/phoneExit'
import { recomputeCredit } from '@/lib/phoneCredits'
import { assertDrawerOpen, lockSale, unpaidSale } from '@/lib/retours'

type Tx = Prisma.TransactionClient

// Exchanging the phone of a sale (SAV, owner 2026-10-30): a client brings back
// the phone we sold and leaves with another one. The SALE stays (its date, its
// payments, its trade-in, its payment-plan file); only its phone changes:
//   - the sale and its file now point to the new phone (figures, supplier
//     debts and warranty follow it), which leaves the stock (sold / reserved);
//   - the returned phone goes back: for sale, to repair, or faulty;
//   - a price difference is settled today, never by rewriting a closed day:
//       more expensive → paid now (a "Complément d'échange" sale line of today)
//                        or added to the payment plan;
//       cheaper        → paid back today like a refund (retours row, 0 unit)
//                        or taken off the payment plan.

export const SWAP_PAY_MORE = ['especes', 'virement', 'dossier'] as const
export const SWAP_PAY_BACK = ['especes', 'virement', 'avoir', 'hors_caisse', 'dossier'] as const
export type SwapSettlement = (typeof SWAP_PAY_BACK)[number] | (typeof SWAP_PAY_MORE)[number]

const num   = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v))
const round = (n: number) => Math.round(n * 100) / 100

export interface SwapInput {
  txnId:       string
  newPhoneId:  string
  newPrice:    number
  settlement:  SwapSettlement | null      // how the difference is settled (null = no difference)
  paymentRef:  string | null
  destination: retour_destination
  motif:       string
  date:        Date                       // today, or the forgotten day being caught up on
  late:        boolean
  userId:      string
}

/** The payment-plan file of a sale, if any (not cancelled). */
export function saleFile(tx: Tx, txnId: string) {
  return tx.phone_credit_sales.findFirst({ where: { txn_id: txnId, is_deleted: false, statut: { not: 'annule' } } })
}

export async function swapPhone(tx: Tx, input: SwapInput) {
  await lockSale(tx, input.txnId)
  const sale = await tx.transactions.findUnique({ where: { txn_id: input.txnId } })
  if (!sale || sale.voided || sale.type_operation === 'retour') throw new HttpError(404, 'Vente introuvable')
  if (sale.device_type !== 'telephone') throw new HttpError(400, "L'échange concerne la vente d'un téléphone")
  if (sale.device_id === input.newPhoneId) throw new HttpError(400, 'Choisissez un autre téléphone que celui vendu')

  // The sold phone must still be this sale's (not returned, not sold again since)
  const oldPhone = await tx.phones.findUnique({ where: { phone_id: sale.device_id } })
  if (!oldPhone || !['vendu', 'reserve'].includes(oldPhone.status)) {
    throw new HttpError(409, 'Le téléphone de cette vente est déjà revenu en stock : un échange n\'est plus possible')
  }
  const latest = await tx.transactions.findFirst({
    where: { device_id: sale.device_id, device_type: 'telephone', voided: false, NOT: { type_operation: 'retour' } },
    orderBy: { created_at: 'desc' }, select: { txn_id: true },
  })
  if (latest && latest.txn_id !== sale.txn_id) throw new HttpError(409, `Ce téléphone a été revendu depuis (${latest.txn_id})`)
  const returned = await tx.retours.aggregate({ where: { txn_id: sale.txn_id, type: 'retour' }, _sum: { qty: true } })
  if ((returned._sum.qty ?? 0) >= sale.qty) throw new HttpError(409, 'Cette vente a déjà été retournée')

  // The new phone: in the shop, for sale
  const newPhone = await tx.phones.findUnique({ where: { phone_id: input.newPhoneId } })
  if (!newPhone || newPhone.is_deleted) throw new HttpError(404, 'Nouveau téléphone introuvable')
  if (newPhone.status !== 'disponible') throw new HttpError(409, `Le nouveau téléphone n'est pas disponible (${newPhone.status})`)
  if (sale.store_id && newPhone.store_id && newPhone.store_id !== sale.store_id) throw new HttpError(400, 'Le nouveau téléphone est dans un autre magasin')
  const otherFile = await tx.phone_credit_sales.findFirst({ where: { phone_id: newPhone.phone_id, is_deleted: false, statut: 'en_cours' }, select: { credit_id: true } })
  if (otherFile) throw new HttpError(409, `Le nouveau téléphone a déjà un dossier (${otherFile.credit_id})`)

  // ── The price difference ──────────────────────────────────────────────
  const oldPrice = num(sale.prix_vente)
  const newPrice = round(input.newPrice)
  if (!Number.isFinite(newPrice) || newPrice <= 0) throw new HttpError(400, 'Prix du nouveau téléphone invalide')
  const diff = round(newPrice - oldPrice)
  const file = await saleFile(tx, sale.txn_id)
  let settledHow: string | null = null

  if (Math.abs(diff) >= 0.01) {
    const s = input.settlement
    if (diff > 0 && !SWAP_PAY_MORE.includes(s as never)) throw new HttpError(400, 'Choisissez comment le client paie la différence')
    if (diff < 0 && !SWAP_PAY_BACK.includes(s as never)) throw new HttpError(400, 'Choisissez comment la différence est rendue')
    if (s === 'virement' && !input.paymentRef?.trim() && diff > 0) throw new HttpError(400, 'Référence du virement obligatoire')

    if (s === 'dossier') {
      // On the payment plan: its total (and the sale's price, as when a file is edited) change
      if (!file) throw new HttpError(400, "Cette vente n'a pas de paiement en plusieurs fois")
      if (file.discharged_at) throw new HttpError(400, 'Dossier déjà déchargé : réglez la différence en espèces ou par virement')
      const total = round(num(file.montant_total) + diff)
      if (total - num(file.reprise_valeur) < num(file.montant_paye) - 0.01) {
        throw new HttpError(400, `Déjà versé ${num(file.montant_paye)} DH : la différence ne peut pas venir en déduction du dossier, rendez-la en espèces ou en avoir`)
      }
      await tx.phone_credit_sales.update({ where: { credit_id: file.credit_id }, data: { montant_total: total } })
      await tx.transactions.update({ where: { txn_id: sale.txn_id }, data: { prix_vente: total, updated_by: input.userId } })
      settledHow = diff > 0 ? `+${diff} DH ajoutés au dossier ${file.credit_id}` : `${diff} DH déduits du dossier ${file.credit_id}`
    } else if (diff > 0) {
      // Paid now: a sale line of today, so the caisse, the reports and the analysis see it
      if (s === 'especes' && !input.late) await assertDrawerOpen(tx, sale.store_id)
      const service = await tx.accessories.findFirst({ where: { categorie: 'service', is_deleted: false, nom: 'Service divers' }, select: { acc_id: true } })
      if (!service) throw new HttpError(500, 'Article « Service divers » introuvable')
      const line = await tx.transactions.create({
        data: {
          device_type: 'accessoire', device_id: service.acc_id, client_id: sale.client_id, type_operation: 'vente', qty: 1,
          prix_vente: diff, date_vente: input.date, payment_method: s as 'especes' | 'virement', payment_ref: input.paymentRef?.trim() || null,
          notes: `Complément d'échange ${sale.txn_id} : ${oldPhone.phone_id} → ${newPhone.phone_id}`,
          store_id: sale.store_id, created_by: input.userId, updated_by: input.userId,
        },
      })
      settledHow = `+${diff} DH payés (${s === 'especes' ? 'espèces' : 'virement'}) — ${line.txn_id}`
    } else {
      // Paid back today, like a refund (0 unit returned: the sale keeps its phone)
      if (file && file.statut === 'en_cours') throw new HttpError(400, 'Le dossier n\'est pas soldé : déduisez la différence du dossier')
      if (!file && unpaidSale(sale)) throw new HttpError(400, 'Vente pas entièrement payée : la différence ne peut pas être rendue')
      if (s === 'especes' && !input.late) await assertDrawerOpen(tx, sale.store_id)
      const refund = await tx.retours.create({
        data: {
          type: 'retour', txn_id: sale.txn_id, store_id: sale.store_id, date: input.date, qty: 0, montant: -diff,
          mode: s as 'especes' | 'virement' | 'avoir' | 'hors_caisse', destination: null,
          motif: `Échange ${oldPhone.phone_id} → ${newPhone.phone_id} : différence rendue`.slice(0, 500),
          avoir_solde: s === 'avoir' ? -diff : 0, created_by: input.userId,
        },
      })
      settledHow = `${-diff} DH rendus (${s}) — ${refund.retour_id}`
    }
  }

  // ── The phones ────────────────────────────────────────────────────────
  // the old phone may have come back since under a new record (second life)
  await assertNoLiveTwin(tx, oldPhone)
  const note = `Échange SAV ${sale.txn_id} : ${input.motif}`.slice(0, 500)
  await tx.phones.update({
    where: { phone_id: oldPhone.phone_id },
    data:  input.destination === 'reparation' ? { status: 'en_reparation', updated_by: input.userId }
      : input.destination === 'defectueux' ? { status: 'disponible', is_damaged: true, damage_notes: note, updated_by: input.userId }
      : { status: 'disponible', updated_by: input.userId },
  })
  // the new phone leaves as the old one did: sold, or reserved while the client hasn't taken it
  await tx.phones.update({ where: { phone_id: newPhone.phone_id }, data: { status: oldPhone.status === 'reserve' ? 'reserve' : 'vendu', updated_by: input.userId } })
  await tx.transactions.update({ where: { txn_id: sale.txn_id }, data: { device_id: newPhone.phone_id, updated_by: input.userId } })
  if (file) {
    await tx.phone_credit_sales.update({ where: { credit_id: file.credit_id }, data: { phone_id: newPhone.phone_id } })
    await recomputeCredit(tx, file.credit_id)
  }

  return { sale, oldPhone, newPhone, oldPrice, newPrice, diff, settledHow, file }
}
