import type { Prisma } from '@prisma/client'
import { HttpError, todayDate } from '@/lib/api'
import { assertCaisseOpen } from '@/lib/phoneCredits'

type Tx = Prisma.TransactionClient

// Stock paid with the day's drawer (owner, 2026-10-04): typed on the phone or
// accessory itself, it leaves the caisse as a "marchandises" expense linked
// to the item — instead of a loose line in Dépenses. Analyse financière
// already treats "marchandises" as stock, not as a cost.
// What leaves the drawer (owner, 2026-10-26): "payé de la caisse" is a tick,
// the amount is the purchase price already typed × the units bought — the
// same price is never typed twice. A screen opened before that change still
// sends the typed amount: it is taken as is.
export function drawerAmount(paid: unknown, prixAchat: unknown, units: number, noUnits: string): number {
  if (paid !== true) return Number(paid) || 0
  const price = Number(prixAchat)
  if (!(price > 0)) throw new HttpError(400, 'Payé de la caisse : tapez le prix d’achat')
  if (!(units > 0)) throw new HttpError(400, noUnits)
  return Math.round(price * units * 100) / 100
}

export async function payFromDrawer(tx: Tx, opts: { amount: unknown; label: string; storeId: string | null; userId: string }) {
  const montant = Math.round(Number(opts.amount) * 100) / 100
  if (!Number.isFinite(montant) || montant <= 0) return null
  if (montant > 1_000_000) throw new HttpError(400, 'Montant payé de la caisse invalide')
  const date = todayDate()
  await assertCaisseOpen(tx, opts.storeId, date)
  return tx.expenses.create({
    data: { categorie: 'marchandises', montant, date, notes: opts.label.slice(0, 200), store_id: opts.storeId, created_by: opts.userId, updated_by: opts.userId },
  })
}
