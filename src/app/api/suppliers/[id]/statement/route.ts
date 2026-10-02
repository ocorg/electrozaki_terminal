import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { codeLabel } from '@/lib/codes'
import { describePhone, type PhoneRow } from '@/lib/phoneDescribe'

// GET /api/suppliers/[id]/statement?from=&to= — how we got to what a supplier
// is owed (owner, 2026-10-02): the one-line calculation, a bank-style ledger
// (each sale with its trade-in carried over, each payment, running balance)
// and the trade-in chains. Every phone is described in full (IMEI, storage,
// battery/RAM, defects, notes) so everyone knows which phone it is.
// Managers only. No sale prices or margins: only what concerns the supplier.

const r2 = (n: number) => Math.round(n * 100) / 100
const PAY_LABEL: Record<string, string> = { reglement_a: 'Règlement', avance_a: 'Avance', paiement_b: 'Paiement (ancien système)' }

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(MANAGERS)
    const { searchParams } = new URL(req.url)
    const from = dateOnly(searchParams.get('from'))
    const to   = dateOnly(searchParams.get('to'))
    const supplier = await prisma.suppliers.findUnique({ where: { supplier_id: params.id } })
    if (!supplier) throw new HttpError(404, 'Fournisseur introuvable')

    const [phones, payments, unsettled, [summary]] = await Promise.all([
      prisma.phones.findMany({ where: { fournisseur_id: params.id, is_deleted: false } }) as Promise<PhoneRow[]>,
      prisma.supplier_payments.findMany({ where: { supplier_id: params.id, is_deleted: false }, orderBy: { created_at: 'asc' } }),
      prisma.$queryRaw<{ phone_id: string; cash_recu: unknown }[]>`SELECT phone_id, cash_recu FROM phones_unsettled_a WHERE fournisseur_id = ${params.id}`,
      prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM suppliers_summary WHERE supplier_id = ${params.id}`,
    ])
    const byId = new Map(phones.map(p => [p.phone_id, p]))
    const children = new Map<string, PhoneRow[]>()
    for (const p of phones) if (p.origine_phone_id) children.set(p.origine_phone_id, [...(children.get(p.origine_phone_id) ?? []), p])

    // What a phone carried for the supplier = what is owed on it + what it
    // passed on to its trade-ins (recursively)
    const carried = (p: PhoneRow): number => r2(Number(p.du_fournisseur ?? p.prix_achat ?? 0) + (children.get(p.phone_id) ?? []).reduce((s, c) => s + carried(c), 0))
    const owedOnSale = (p: PhoneRow) => r2(Number(p.du_fournisseur ?? p.prix_achat ?? 0))
    const owedNow = new Map(unsettled.map(u => [u.phone_id, Number(u.cash_recu)]))

    // Sale date: its last non-voided sale (else when it was marked sold)
    const sold = phones.filter(p => p.status === 'vendu')
    const sales = sold.length ? await prisma.transactions.findMany({
      where: { device_id: { in: sold.map(p => p.phone_id) }, voided: false, NOT: { type_operation: 'retour' } },
      orderBy: { created_at: 'desc' }, select: { device_id: true, created_at: true, txn_id: true },
    }) : []
    const saleOf = new Map<string, { at: Date; txn: string }>()
    for (const s of sales) if (!saleOf.has(s.device_id) && s.created_at) saleOf.set(s.device_id, { at: s.created_at, txn: s.txn_id })
    const paidBy = new Map<string, string>()
    for (const pm of payments) for (const id of pm.phone_ids) paidBy.set(id, pm.payment_id)

    // ── Ledger ────────────────────────────────────────────────────────
    type Line = { at: string; kind: 'vente' | 'paiement'; label: string; phone?: ReturnType<typeof describePhone>; detail?: string; du: number; paye: number }
    const lines: Line[] = []
    for (const p of sold) {
      const kids = children.get(p.phone_id) ?? []
      const moved = r2(kids.reduce((s, c) => s + carried(c), 0))
      const base = p.origine_phone_id ? carried(p) : Number(p.prix_achat ?? 0)
      const amount = owedNow.get(p.phone_id) ?? owedOnSale(p)
      const sale = saleOf.get(p.phone_id)
      lines.push({
        at: (sale?.at ?? p.updated_at ?? new Date()).toISOString(), kind: 'vente',
        label: `Vente ${p.phone_id}${sale ? ` (${sale.txn})` : ''}`,
        phone: describePhone(p),
        detail: [
          p.origine_phone_id ? `repris en échange de ${p.origine_phone_id} : ${base} DH reportés sur lui` : `prix d'achat ${base} DH`,
          ...kids.map(c => `− reprise ${carried(c)} DH reportée sur ${c.phone_id}`),
          moved > 0 ? `= ${amount} DH dus à cette vente` : null,
        ].filter(Boolean).join('\n'),
        du: amount, paye: 0,
      })
    }
    for (const pm of payments) {
      lines.push({
        at: pm.created_at.toISOString(), kind: 'paiement',
        label: `${PAY_LABEL[pm.payment_type] ?? 'Paiement'} ${pm.payment_id}`,
        detail: [pm.phone_ids.length ? `${pm.phone_ids.length} téléphone(s) réglé(s)` : null, pm.notes].filter(Boolean).join(' · ') || undefined,
        du: 0, paye: Number(pm.montant),
      })
    }
    lines.sort((a, b) => a.at.localeCompare(b.at))
    let solde = 0
    const withBalance = lines.map(l => { solde = r2(solde + l.du - l.paye); return { ...l, solde } })
    const inRange = (at: string) => (!from || at.slice(0, 10) >= from.toISOString().slice(0, 10)) && (!to || at.slice(0, 10) <= to.toISOString().slice(0, 10))
    const shown = withBalance.filter(l => inRange(l.at))
    const opening = from ? (withBalance.filter(l => l.at.slice(0, 10) < from.toISOString().slice(0, 10)).at(-1)?.solde ?? 0) : 0

    // ── Trade-in chains (roots: his phones that passed a trade-in on) ──
    type Node = { phone: ReturnType<typeof describePhone>; carried: number; owed_on_sale: number; state: 'regle' | 'a_regler' | 'en_stock' | 'autre'; status: string; payment?: string | null; children: Node[] }
    const node = (p: PhoneRow): Node => ({
      phone: describePhone(p), carried: carried(p), owed_on_sale: owedOnSale(p), status: codeLabel('device_status', p.status as never, 'fr'),
      state: p.status === 'vendu' ? (p.settled_at ? 'regle' : 'a_regler') : p.status === 'disponible' ? 'en_stock' : 'autre',
      payment: paidBy.get(p.phone_id) ?? null,
      children: (children.get(p.phone_id) ?? []).map(node),
    })
    const chains = phones.filter(p => !p.origine_phone_id && children.has(p.phone_id)).map(node)
    // A chain whose root belongs to another supplier can't happen (trade-ins
    // join the supplier of the phone sold), but orphans are shown as roots
    for (const p of phones) if (p.origine_phone_id && !byId.has(p.origine_phone_id)) chains.push(node(p))

    const waitingTradeIns = phones.filter(p => p.origine_phone_id && p.status !== 'vendu')
    return json({
      data: {
        supplier: { supplier_id: supplier.supplier_id, nom: supplier.nom, telephone: supplier.telephone, categorie: supplier.type_fournisseur },
        summary: {
          vendus_a_regler: Number(summary?.montant_vendu_non_regle ?? 0),
          nb_a_regler:     Number(summary?.nb_a_regler ?? 0),
          credit:          Number(summary?.credit_total ?? 0),
          a_payer:         Number(summary?.solde_du ?? 0),
          total_paye:      Number(summary?.total_paye ?? 0),
          en_stock:        Number(summary?.a_montant_en_stock ?? 0),
          nb_en_stock:     Number(summary?.nb_en_stock ?? 0),
          reprises_en_attente: r2(waitingTradeIns.reduce((s, p) => s + owedOnSale(p), 0)),
          nb_reprises_en_attente: waitingTradeIns.length,
        },
        period: { from: from?.toISOString().slice(0, 10) ?? null, to: to?.toISOString().slice(0, 10) ?? null, opening },
        ledger: shown,
        closing: shown.at(-1)?.solde ?? opening,
        chains,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/suppliers/[id]/statement')
  }
}
