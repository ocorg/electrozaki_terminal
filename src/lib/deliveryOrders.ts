// Sales to deliver (owner, 2026-10-18). The shop sells online and ships with
// a delivery company:
//   1. the order is taken at the POS ("À livrer"): the items are set aside
//      (phone "en livraison", accessories out of stock) on a delivery card
//      with their prices. A parcel with a phone needs an advance (300 DH at
//      least) paid by bank transfer before it ships; accessories alone don't.
//   2. the delivery agent collects the rest in cash; the company pays it into
//      the shop's account the next night (the card is then marked "versé").
//   3. delivered → the sale is recorded that day, paid by bank (advance +
//      company), so the drawer never counts it; refused or cancelled → the
//      items go back to stock and there was never a sale. The advance of a
//      refused parcel is refunded or kept, case by case.
// Delivery costs are paid by the customer (collected with the rest) or by the
// shop (an expense, taken from what the company pays).
import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

type Tx = Prisma.TransactionClient

export const AVANCE_MIN = 300
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => (v == null ? 0 : Number(v))

export interface OrderItem { device_type: 'telephone' | 'accessoire'; device_id: string; qty: number; prix_vente: number; override_by?: string | null; override_reason?: string | null }

/** What the delivery agent collects, and what the company pays the shop. */
export function orderMoney(d: { montant_total: unknown; montant_avance: unknown; frais_livraison: unknown; frais_charge: string }) {
  const reste  = round2(Math.max(num(d.montant_total) - num(d.montant_avance), 0))
  const frais  = num(d.frais_livraison)
  const client = d.frais_charge === 'client'
  return {
    reste,                                          // what is still owed on the goods
    aEncaisser: round2(reste + (client ? frais : 0)), // what the agent collects at the door
    verse:      round2(reste - (client ? 0 : frais)), // what the company pays the shop (it keeps its fee)
    fraisBoutique: client ? 0 : frais,
  }
}

/** Checks the items and sets them aside for the order. */
export async function reserveItems(tx: Tx, items: OrderItem[], userId: string) {
  if (!items.length) throw new HttpError(400, 'Commande vide')
  for (const i of items) {
    if (i.device_type !== 'telephone' && i.device_type !== 'accessoire') throw new HttpError(400, 'Livraison : téléphones et accessoires seulement')
    if (!(i.prix_vente >= 0)) throw new HttpError(400, 'Prix invalide')
    if (i.device_type === 'telephone') {
      // only an available phone, and only once (two orders can't take it)
      const { count } = await tx.phones.updateMany({
        where: { phone_id: i.device_id, status: 'disponible', is_deleted: false },
        data:  { status: 'en_livraison', updated_by: userId },
      })
      if (!count) throw new HttpError(409, `Le téléphone ${i.device_id} n'est plus disponible`)
    } else {
      if (!(Number.isInteger(i.qty) && i.qty >= 1)) throw new HttpError(400, 'Quantité invalide')
      const { count } = await tx.accessories.updateMany({
        where: { acc_id: i.device_id, quantite: { gte: i.qty }, is_deleted: false },
        data:  { quantite: { decrement: i.qty }, updated_by: userId },
      })
      if (!count) throw new HttpError(409, `Stock insuffisant pour ${i.device_id}`)
    }
  }
}

/** A refused or cancelled order: its items go back to stock. */
export async function releaseItems(tx: Tx, items: { device_type: string; device_id: string; qty: number; txn_id: string | null }[], userId: string) {
  for (const i of items) {
    if (i.txn_id) continue   // already sold (never happens for an order that is not delivered)
    if (i.device_type === 'telephone') {
      await tx.phones.updateMany({ where: { phone_id: i.device_id, status: { in: ['en_livraison', 'reserve'] } }, data: { status: 'disponible', updated_by: userId } })
    } else if (i.device_type === 'accessoire') {
      await tx.accessories.update({ where: { acc_id: i.device_id }, data: { quantite: { increment: i.qty }, updated_by: userId } })
    }
  }
}

/** Delivered: each item becomes a sale of that day, paid by bank. */
export async function recordSales(tx: Tx, d: {
  delivery_id: string; store_id: string | null; client_id: string | null; transporteur: string | null
  delivery_items: { item_id: string; device_type: string; device_id: string; qty: number; prix_vente: Prisma.Decimal | null; override_by: string | null; override_reason: string | null }[]
}, day: Date, userId: string) {
  const txnIds: string[] = []
  for (const i of d.delivery_items) {
    let months = 6
    if (i.device_type === 'telephone') {
      const p = await tx.phones.findUnique({ where: { phone_id: i.device_id }, select: { warranty_months: true } })
      if (p?.warranty_months) months = p.warranty_months
    }
    const expiry = new Date(day); expiry.setUTCMonth(expiry.getUTCMonth() + months)
    const txn = await tx.transactions.create({
      data: {
        device_type: i.device_type as 'telephone' | 'accessoire', device_id: i.device_id, client_id: d.client_id,
        type_operation: 'vente', qty: i.qty, prix_vente: num(i.prix_vente), date_vente: day,
        // advance by bank transfer + the rest paid in by the delivery company: never the drawer
        payment_method: 'virement', payment_ref: d.delivery_id,
        warranty_start: day, warranty_expiry: expiry,
        override_required: i.override_by ? true : null, override_by: i.override_by, override_reason: i.override_reason,
        notes: `Livraison ${d.delivery_id}${d.transporteur ? ` — ${d.transporteur}` : ''}`,
        store_id: d.store_id, created_by: userId, updated_by: userId,
      },
      select: { txn_id: true },
    })
    await tx.delivery_items.update({ where: { item_id: i.item_id }, data: { txn_id: txn.txn_id } })
    if (i.device_type === 'telephone') await tx.phones.update({ where: { phone_id: i.device_id }, data: { status: 'vendu', updated_by: userId } })
    txnIds.push(txn.txn_id)
  }
  return txnIds
}
