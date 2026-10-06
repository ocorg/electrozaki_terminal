import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError, MANAGERS } from '@/lib/api'
import { deviceLabels } from '@/lib/device-labels'
import { codeLabel } from '@/lib/codes'

// GET /api/clients/[id]/account — what a client's account balance is made of
// (owner, 2026-10-04): each debt and each payment, same rules as the
// client_summary view (migrations 10 + 11) so the lines add up to the balance:
//   • a POS credit checkout with its "POS — …" line counts once (line − trade-in)
//   • other credit sales count for what was left at the sale
//   • sales followed by a credit file (dossier) are not here — see the file
//   • manual imports count for what is left on them
type Line = { at: string; kind: 'vente' | 'import' | 'paiement'; label: string; detail?: string; du: number; paye: number; ref?: string }

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(MANAGERS)
    const client = await prisma.clients.findUnique({ where: { client_id: params.id }, select: { client_id: true, nom: true, telephone: true } })
    if (!client) throw new HttpError(404, 'Client introuvable')

    const [txns, imports, payments, dossiers, [summary]] = await Promise.all([
      prisma.transactions.findMany({ where: { client_id: params.id, voided: false }, orderBy: { created_at: 'asc' } }),
      prisma.credit_imports.findMany({ where: { client_id: params.id }, orderBy: { created_at: 'asc' } }),
      prisma.credit_payments.findMany({ where: { client_id: params.id }, orderBy: { created_at: 'asc' } }),
      prisma.phone_credit_sales.findMany({ where: { client_id: params.id, is_deleted: false }, select: { credit_id: true, txn_id: true, statut: true, montant_total: true, montant_paye: true, reprise_valeur: true } }),
      prisma.$queryRaw<{ solde_impaye: unknown }[]>`SELECT solde_impaye FROM client_summary WHERE client_id = ${params.id}`,
    ])
    const withFile = new Set(dossiers.map(d => d.txn_id).filter(Boolean))
    const sales = txns.filter(t => !withFile.has(t.txn_id))
    const labels = await deviceLabels(sales)
    const name = (t: typeof sales[number]) => labels.get(t.device_id) ?? `${codeLabel('device_type', t.device_type, 'fr')} ${t.device_id}`

    const lines: Line[] = []
    const posLines = imports.filter(i => i.notes?.startsWith('POS —') && i.statut !== 'annule')
    const covered = new Set<string>()
    for (const pl of posLines) {
      const at = pl.created_at!.getTime()
      // the checkout = this client's sales saved in the 5 minutes before the line, not taken by an earlier line
      const group = sales.filter(t => !covered.has(t.txn_id) && t.created_at.getTime() <= at && t.created_at.getTime() >= at - 5 * 60_000)
      if (!group.length) continue
      group.forEach(t => covered.add(t.txn_id))
      const echs = group.map(t => Number(t.valeur_echange ?? 0)).filter(v => v > 0)
      const echange = new Set(echs).size <= 1 ? (echs[0] ?? 0) : echs.reduce((s, v) => s + v, 0)
      const du = Math.max(Number(pl.montant_du) - echange, 0) - Number(pl.montant_paye)
      const total = group.reduce((s, t) => s + Number(t.prix_vente), 0)
      lines.push({
        at: pl.created_at!.toISOString(), kind: 'vente', ref: group.map(t => t.txn_id).join(', '),
        label: group.map(name).join(' + '),
        detail: [`total ${total} DH`, total - Number(pl.montant_du) > 0 ? `avance ${total - Number(pl.montant_du)} DH` : null, echange > 0 ? `reprise ${echange} DH` : null].filter(Boolean).join(' · '),
        du, paye: 0,
      })
    }
    for (const t of sales.filter(t => !covered.has(t.txn_id))) {
      const pv = Number(t.prix_vente), av = Number(t.avance ?? 0), ech = Number(t.valeur_echange ?? 0), ao = Number(t.avoir_montant ?? 0)
      // a store credit (avoir) spent on the sale is paid, like the down payment
      const du = t.payment_method === 'echange' ? 0 : t.payment_method === 'credit' ? Math.max(pv - ech - ao, 0) : av > 0 ? Math.max(pv - av - ech - ao, 0) : 0
      if (du <= 0) continue
      lines.push({
        at: t.created_at.toISOString(), kind: 'vente', ref: t.txn_id, label: name(t),
        detail: [`total ${pv} DH`, av > 0 ? `avance ${av} DH` : null, ech > 0 ? `reprise ${ech} DH` : null, ao > 0 ? `avoir ${ao} DH` : null].filter(Boolean).join(' · '),
        du, paye: 0,
      })
    }
    for (const i of imports.filter(i => !i.notes?.startsWith('POS —') && i.statut !== 'annule')) {
      const du = Number(i.montant_du) - Number(i.montant_paye)
      if (du <= 0) continue
      lines.push({ at: i.created_at!.toISOString(), kind: 'import', ref: i.import_id, label: i.description || 'Ancienne dette (import)', detail: i.notes ?? undefined, du, paye: 0 })
    }
    for (const p of payments) {
      lines.push({ at: p.created_at!.toISOString(), kind: 'paiement', ref: p.payment_id, label: `Paiement — ${codeLabel('payment_method', p.payment_method, 'fr')}`, detail: p.notes ?? undefined, du: 0, paye: Number(p.montant) })
    }
    lines.sort((a, b) => a.at.localeCompare(b.at))
    let solde = 0
    const ledger = lines.map(l => { solde = Math.round((solde + l.du - l.paye) * 100) / 100; return { ...l, solde } })

    return json({
      data: {
        client,
        solde: Number(summary?.solde_impaye ?? 0),
        ledger,
        dossiers: dossiers.filter(d => d.statut === 'en_cours').map(d => ({
          credit_id: d.credit_id, reste: Number(d.montant_total) - Number(d.reprise_valeur ?? 0) - Number(d.montant_paye),
        })),
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/clients/[id]/account')
  }
}
