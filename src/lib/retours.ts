import type { Prisma } from '@prisma/client'
import { HttpError, todayDate } from '@/lib/api'

// Returns (Retour de vente) — shared rules for the API routes.
//
// A return never touches the original sale: it is a refund dated the day it
// happens (table `retours`), so a closed caisse is never rewritten and the
// cash leaves the drawer of the day it is paid back.

type Tx = Prisma.TransactionClient

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v))

/** What a sale still has to give back: units and money not yet returned. */
export async function saleBalance(tx: Tx, txn_id: string) {
  const agg = await tx.retours.aggregate({
    where: { txn_id, type: 'retour' },
    _sum:  { qty: true, montant: true },
  })
  return { returnedQty: agg._sum.qty ?? 0, refunded: num(agg._sum.montant) }
}

/**
 * Sales not fully paid (credit, partial advance) are followed in Crédits:
 * refunding them here would pay back money never received.
 */
export function unpaidSale(sale: { payment_method: string; prix_vente: Prisma.Decimal; avance: Prisma.Decimal | null; valeur_echange: Prisma.Decimal | null }) {
  const pv = num(sale.prix_vente), av = num(sale.avance), ve = num(sale.valeur_echange)
  return sale.payment_method === 'credit' || (av > 0 && pv - av - ve > 0)
}

/**
 * Cash paid back comes out of today's drawer: refused once today's caisse
 * has been submitted (its figures are frozen), like any other cash movement.
 */
export async function assertDrawerOpen(tx: Tx, store_id: string | null) {
  if (!store_id) return
  const caisse = await tx.caisse.findFirst({ where: { store_id, date: todayDate() }, select: { status: true } })
  if (caisse && caisse.status !== 'ouverte') {
    throw new HttpError(409, 'La caisse du jour est déjà clôturée : remboursement en espèces impossible aujourd\'hui.')
  }
}

/** One return at a time per sale (two cashiers can't return the same unit). */
export async function lockSale(tx: Tx, txn_id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retour:${txn_id}`}))`
}
