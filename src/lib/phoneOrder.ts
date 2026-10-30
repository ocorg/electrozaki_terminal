import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

type Tx = Prisma.TransactionClient | typeof import('@/lib/db').prisma

// A phone ordered for a client (owner, 2026-10-30): the client pays an advance
// for a phone we bring on request. At the POS the phone is created "en
// commande" (no IMEI) and sold "Plusieurs fois", kept at the shop: the advance
// is the down payment, the usual Crédit / Avance file follows the payments.
// When it arrives, its IMEI is typed in Téléphones: that validates it.
// Until then it is no stock: not on sale, not on the website, not expected at
// an inventory, not handed over, not discharged.

export const ORDER_NOT_ARRIVED = 'Le téléphone commandé n’est pas encore arrivé : saisissez son IMEI dans Téléphones à son arrivée'

/** Refuses an operation that needs the phone in hand while it is still ordered. */
export async function assertArrived(tx: Tx, phoneId: string) {
  const p = await tx.phones.findUnique({ where: { phone_id: phoneId }, select: { en_commande: true } })
  if (p?.en_commande) throw new HttpError(400, ORDER_NOT_ARRIVED)
}

/** Money of a cancelled order (chosen by a manager each time). */
export const ORDER_MONEY = ['rembourser_especes', 'rembourser_virement', 'avoir', 'garder'] as const
export type OrderMoney = (typeof ORDER_MONEY)[number]
