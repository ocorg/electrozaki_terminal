import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError, MANAGERS } from '@/lib/api'
import { codeLabel } from '@/lib/codes'

// GET /api/accessories/[id]/history — everything that happened to one
// accessory, in plain sentences, newest first (owner, 2026-11-06; managers
// only, like the phones' history: it shows purchase prices). Built from what
// the ERP already records: the activity log (creation, edits, stock and price
// changes, "Payé de la caisse"), sales with their colour, returns, deliveries
// and stock movements.

type Kind = 'stock' | 'edit' | 'sale' | 'return' | 'credit' | 'supplier' | 'inventory' | 'chain' | 'delete'
interface Event { at: string; kind: Kind; title: string; detail?: string; by?: string | null }

const FIELD: Record<string, string> = {
  nom: 'Nom', categorie: 'Catégorie', marque: 'Marque', compatible_with: 'Compatible avec', barcode: 'Code-barres',
  prix_achat: 'Prix d’achat', prix_vente_recommande: 'Prix de vente', prix_vente_minimum: 'Prix minimum',
  quantite: 'Quantité', seuil_alerte: 'Seuil d’alerte', fournisseur_id: 'Fournisseur', location: 'Emplacement',
  couleur: 'Couleur', groupe_couleur: 'Modèle (autres couleurs)', promo_type: 'Promo', promo_montant: 'Montant promo',
}
const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'image_url', 'is_deleted', 'store_id', 'acc_id'])
const dh = (v: unknown) => `${Number(v).toLocaleString('fr-MA')} DH`

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(MANAGERS)
    const id = params.id
    const acc = await prisma.accessories.findUnique({ where: { acc_id: id } })
    if (!acc) throw new HttpError(404, 'Accessoire introuvable')

    const [suppliers, users, logs, txns, deliveryItems, moves] = await Promise.all([
      prisma.suppliers.findMany({ select: { supplier_id: true, nom: true } }),
      prisma.user_profiles.findMany({ select: { id: true, display_name: true } }),
      prisma.activity_log.findMany({ where: { record_id: id }, orderBy: { created_at: 'asc' } }),
      prisma.transactions.findMany({ where: { device_type: 'accessoire', device_id: id }, orderBy: { created_at: 'asc' } }),
      prisma.delivery_items.findMany({ where: { device_type: 'accessoire', device_id: id }, include: { deliveries: { select: { delivery_id: true, statut: true, client_name: true, ville: true } } } }),
      prisma.stock_movements.findMany({ where: { device_type: 'accessoire', device_id: id }, orderBy: { moved_at: 'asc' } }),
    ])
    const supName = (v: unknown) => (v ? suppliers.find(s => s.supplier_id === v)?.nom ?? String(v) : 'aucun')
    const userName = (u: string | null | undefined) => (u ? users.find(x => x.id === u)?.display_name ?? null : null)
    const fmt = (k: string, v: unknown): string => {
      if (v === null || v === undefined || v === '') return '—'
      if (k === 'fournisseur_id') return supName(v)
      if (k === 'location') return codeLabel('location_type', v as never, 'fr')
      if (/prix|montant/.test(k)) return dh(v)
      if (k === 'promo_type') return v === 'pourcentage' ? 'en %' : 'en DH'
      return String(v)
    }
    const events: Event[] = []
    const add = (e: Event) => events.push(e)

    // ── Its own log: creation, edits, deletion ────────────────────────
    let sawCreation = false
    for (const l of logs) {
      const at = l.created_at.toISOString()
      const before = (l.before_state ?? {}) as Record<string, unknown>
      const after  = (l.after_state ?? {}) as Record<string, unknown>
      if (l.action_type === 'creation') {
        sawCreation = true
        add({ at, kind: 'stock', title: 'Ajouté au stock', by: l.user_name, detail: [
          after.quantite != null ? `${after.quantite} pièce(s)` : null, after.couleur ? `couleur ${after.couleur}` : null,
          after.prix_achat != null ? `achat ${dh(after.prix_achat)}` : null, after.fournisseur_id ? `fournisseur ${supName(after.fournisseur_id)}` : null,
        ].filter(Boolean).join(' · ') || undefined })
      } else if (l.action_type === 'suppression') {
        add({ at, kind: 'delete', title: 'Supprimé', by: l.user_name })
      } else {
        const changes = Object.keys(after)
          .filter(k => !SKIP.has(k) && k in before && fmt(k, before[k]) !== fmt(k, after[k]))
          .map(k => `${FIELD[k] ?? k} : ${fmt(k, before[k])} → ${fmt(k, after[k])}`)
        const stockOnly = changes.length === 1 && changes[0].startsWith('Quantité')
        if (changes.length) add({ at, kind: stockOnly ? 'stock' : 'edit', title: stockOnly ? 'Stock corrigé' : 'Fiche modifiée', detail: changes.join('\n'), by: l.user_name })
        else if (l.notes) add({ at, kind: 'edit', title: l.notes, by: l.user_name })
      }
    }
    if (!sawCreation && acc.created_at) add({ at: acc.created_at.toISOString(), kind: 'stock', title: 'Ajouté au stock', by: userName(acc.created_by) })

    // ── Sales (with the colour picked at the till) and returns ────────
    const retours = txns.length ? await prisma.retours.findMany({ where: { txn_id: { in: txns.map(t => t.txn_id) } } }) : []
    for (const t of txns) {
      const op = codeLabel('operation_type', t.type_operation, 'fr')
      add({
        at: (t.created_at ?? new Date()).toISOString(), kind: 'sale',
        title: `${op === 'Vente' ? 'Vendu' : op} × ${t.qty} — ${t.txn_id}`,
        detail: [[t.design, t.couleur].filter(Boolean).join(' · ') || null, dh(t.prix_vente), codeLabel('payment_method', t.payment_method as never, 'fr'),
          t.override_reason ? `sous le minimum : ${t.override_reason}` : null].filter(Boolean).join(' · '),
        by: userName(t.created_by),
      })
      if (t.voided) add({ at: (t.voided_at ?? t.updated_at ?? new Date()).toISOString(), kind: 'return', title: `Vente annulée — ${t.txn_id}`, detail: t.voided_reason ?? undefined, by: userName(t.voided_by) })
    }
    for (const r of retours) {
      add({ at: (r.created_at ?? new Date()).toISOString(), kind: 'return', title: `${r.type === 'retour' ? 'Retour' : 'Échange'} — ${r.retour_id}`,
        detail: [dh(r.montant), r.mode === 'avoir' ? 'avoir' : r.mode === 'hors_caisse' ? 'remboursé hors caisse' : 'remboursé', r.motif].filter(Boolean).join(' · '), by: userName(r.created_by) })
    }

    // ── Deliveries ("Vente à livrer", web orders) ─────────────────────
    for (const d of deliveryItems) {
      add({ at: (d.created_at ?? new Date()).toISOString(), kind: 'credit', title: `Livraison ${d.deliveries?.delivery_id ?? ''} × ${d.qty}`,
        detail: [[d.design, d.couleur].filter(Boolean).join(' · ') || null, d.deliveries?.client_name, d.deliveries?.ville,
          d.deliveries?.statut ? codeLabel('delivery_status', d.deliveries.statut as never, 'fr') : null].filter(Boolean).join(' · ') })
    }

    // ── Stock movements (transfers, sent out…) ────────────────────────
    for (const m of moves) {
      add({ at: m.moved_at.toISOString(), kind: 'chain', title: `Mouvement de stock × ${m.quantity}`,
        detail: [`${codeLabel('location_type', m.from_location as never, 'fr')} → ${codeLabel('location_type', m.to_location as never, 'fr')}`, m.external_name, m.notes].filter(Boolean).join(' · '),
        by: userName(m.moved_by ?? m.created_by) })
    }

    events.sort((a, b) => b.at.localeCompare(a.at))
    return json({ data: { acc_id: id, events, stays: [] } })
  } catch (err) {
    return handleError(err, 'GET /api/accessories/[id]/history')
  }
}
