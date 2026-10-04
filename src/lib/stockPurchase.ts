import type { Prisma } from '@prisma/client'
import { HttpError, todayDate } from '@/lib/api'
import { assertCaisseOpen } from '@/lib/phoneCredits'

type Tx = Prisma.TransactionClient

// Stock paid with the day's drawer (owner, 2026-10-04): typed on the phone or
// accessory itself, it leaves the caisse as a "marchandises" expense linked
// to the item — instead of a loose line in Dépenses. Analyse financière
// already treats "marchandises" as stock, not as a cost.
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
