import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

// Trade-ins follow the supplier of the phone they paid for (owner's rule,
// 2026-10-02 — migration 9_tradein_chain).
//
// Each phone carries what its supplier is owed when it sells (du_fournisseur,
// NULL = its purchase price). When a supplier's phone is sold with a trade-in
// worth V, the part min(V, owed) moves from the sold phone to the trade-in,
// which joins the same supplier. Selling that trade-in with another trade-in
// moves it again — until a phone is sold for cash only. In total the supplier
// gets his purchase price, as the cash really comes in.
//
// Several phones sold with one trade-in: it follows the one owed the most.
// A sold phone already settled with its supplier is left alone (he was paid).
export async function attachTradeIn(tx: Tx, opts: { tradeInId: string; soldPhoneIds: string[]; value: number; userId: string }) {
  const value = Math.round(Number(opts.value) * 100) / 100
  if (!(value > 0) || !opts.soldPhoneIds.length) return null

  const tradeIn = await tx.phones.findUnique({ where: { phone_id: opts.tradeInId }, select: { origine_phone_id: true } })
  if (!tradeIn || tradeIn.origine_phone_id) return null   // already linked

  const sold = await tx.phones.findMany({
    where:  { phone_id: { in: opts.soldPhoneIds }, fournisseur_id: { not: null }, settled_at: null, is_deleted: false },
    select: { phone_id: true, fournisseur_id: true, du_fournisseur: true, prix_achat: true },
  })
  // A sold phone hands its trade-in over once (no double count if the
  // trade-in is recorded twice)
  const linked = new Set((await tx.phones.findMany({
    where: { origine_phone_id: { in: sold.map(p => p.phone_id) } }, select: { origine_phone_id: true },
  })).map(p => p.origine_phone_id))
  const owed = (p: typeof sold[number]) => Number(p.du_fournisseur ?? p.prix_achat ?? 0)
  const from = sold.filter(p => owed(p) > 0 && !linked.has(p.phone_id)).sort((a, b) => owed(b) - owed(a))[0]
  if (!from) return null

  const moved = Math.min(value, owed(from))
  await tx.phones.update({
    where: { phone_id: from.phone_id },
    data:  { du_fournisseur: Math.round((owed(from) - moved) * 100) / 100, updated_by: opts.userId },
  })
  await tx.phones.update({
    where: { phone_id: opts.tradeInId },
    data:  { fournisseur_id: from.fournisseur_id, du_fournisseur: moved, origine_phone_id: from.phone_id, updated_by: opts.userId },
  })
  return { from: from.phone_id, supplier: from.fournisseur_id, moved }
}

/** The phones a trade-in paid for, and its value: the POS sends the phones
 *  of the checkout (`soldIds`; one transaction per item); otherwise only the
 *  referenced transaction counts. Only real exchange sales are taken. */
export async function phonesSoldWithTradeIn(tx: Tx, txnId: string, soldIds?: string[]) {
  const rows = await tx.transactions.findMany({
    where: {
      voided: false, device_type: 'telephone', valeur_echange: { gt: 0 },
      ...(soldIds?.length
        ? { device_id: { in: soldIds }, created_at: { gte: new Date(Date.now() - 86_400_000) } }
        : { txn_id: txnId }),
    },
    orderBy: { created_at: 'desc' },
    select: { device_id: true, valeur_echange: true },
  })
  const latest = new Map<string, number>()            // one sale per phone (its last one)
  for (const r of rows) if (!latest.has(r.device_id)) latest.set(r.device_id, Number(r.valeur_echange ?? 0))
  return { phoneIds: [...latest.keys()], value: [...latest.values()].reduce((s, v) => s + v, 0) }
}
