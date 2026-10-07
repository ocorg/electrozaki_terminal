import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError, MANAGERS } from '@/lib/api'
import { codeLabel } from '@/lib/codes'

// GET /api/phones/[id]/history — everything that happened to one phone, in
// plain sentences, newest first (owner, 2026-10-02; managers only: it shows
// purchase prices and suppliers). Built from what the ERP already records:
// the activity log, sales and returns, credit files and their payments,
// supplier payments, inventory scans and the trade-in chain.

type Kind = 'stock' | 'edit' | 'sale' | 'return' | 'credit' | 'supplier' | 'inventory' | 'chain' | 'delete'
interface Event { at: string; kind: Kind; title: string; detail?: string; by?: string | null; stay?: number }

const FIELD: Record<string, string> = {
  status: 'Statut', prix_achat: 'Prix d’achat', prix_vente_recommande: 'Prix de vente', prix_vente_minimum: 'Prix minimum',
  fournisseur_id: 'Fournisseur', condition: 'État', location: 'Emplacement', couleur: 'Couleur', stockage: 'Stockage',
  battery_level: 'Batterie', imei: 'IMEI', marque: 'Marque', model: 'Modèle', serie: 'Série', ram: 'RAM',
  promo_type: 'Promo', promo_montant: 'Montant promo', is_damaged: 'Endommagé', damage_notes: 'Note dommage',
  replaced_components: 'Pièces changées', warranty_months: 'Garantie (mois)', description: 'Description',
  icloud_compte: 'Compte iCloud', void_motif: 'Motif', source: 'Source', du_fournisseur: 'Dû au fournisseur', settled_at: 'Réglé au fournisseur',
}
// Noise in diffs (audit fields) and secrets
const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'icloud_mdp', 'image_url', 'txn_ref_id', 'settled_by', 'is_deleted', 'date_entree', 'store_id', 'type', 'origine_phone_id', 'void_at', 'void_by'])
const dh = (v: unknown) => `${Number(v).toLocaleString('fr-MA')} DH`

// Everything that happened to ONE record (one life of the phone in the shop)
async function lifeEvents(id: string) {
  {
    const phone = await prisma.phones.findUnique({ where: { phone_id: id } })
    if (!phone) throw new HttpError(404, 'Téléphone introuvable')

    const [suppliers, users, logs, txns, credits, supplierPays, scans, tradeIns] = await Promise.all([
      prisma.suppliers.findMany({ select: { supplier_id: true, nom: true } }),
      prisma.user_profiles.findMany({ select: { id: true, display_name: true } }),
      prisma.activity_log.findMany({ where: { record_id: id }, orderBy: { created_at: 'asc' } }),
      prisma.transactions.findMany({ where: { device_id: id }, orderBy: { created_at: 'asc' } }),
      prisma.phone_credit_sales.findMany({ where: { phone_id: id }, include: { phone_credit_payments: true } }),
      prisma.supplier_payments.findMany({ where: { phone_ids: { has: id }, is_deleted: false } }),
      prisma.inventory_session_items.findMany({ where: { phone_id: id, scanned_at: { not: null } } }),
      prisma.phones.findMany({ where: { origine_phone_id: id }, select: { phone_id: true, marque: true, model: true, created_at: true, du_fournisseur: true } }),
    ])
    const supName = (v: unknown) => (v ? suppliers.find(s => s.supplier_id === v)?.nom ?? String(v) : 'aucun')
    const userName = (u: string | null | undefined) => (u ? users.find(x => x.id === u)?.display_name ?? null : null)
    const fmt = (k: string, v: unknown): string => {
      if (v === null || v === undefined || v === '') return '—'
      if (k === 'fournisseur_id') return supName(v)
      if (k === 'status') return codeLabel('device_status', v as never, 'fr')
      if (k === 'condition') return codeLabel('device_condition', v as never, 'fr')
      if (k === 'location') return codeLabel('location_type', v as never, 'fr')
      if (k === 'battery_level') return `${v} %`
      if (k === 'is_damaged') return v ? 'oui' : 'non'
      if (k === 'replaced_components') return Array.isArray(v) && v.length ? v.map((c: { name?: string }) => c.name).join(', ') : 'aucune'
      if (/prix|montant|du_fournisseur/.test(k)) return dh(v)
      if (k === 'settled_at') return 'oui'
      if (k === 'promo_type') return v === 'pourcentage' ? 'en %' : 'en DH'
      return String(v)
    }

    const events: Event[] = []
    const add = (e: Event) => events.push(e)

    // ── Activity log of the phone itself ─────────────────────────────
    let sawCreation = false
    for (const l of logs) {
      const at = l.created_at.toISOString()
      const before = (l.before_state ?? {}) as Record<string, unknown>
      const after  = (l.after_state ?? {}) as Record<string, unknown>
      if (l.action_type === 'creation') {
        sawCreation = true
        add({ at, kind: 'stock', title: 'Ajouté au stock', detail: [after.source === 'echange' ? 'repris en échange' : after.source === 'reprise' ? 'reprise' : null, after.fournisseur_id ? `fournisseur ${supName(after.fournisseur_id)}` : null, after.prix_achat != null ? `achat ${dh(after.prix_achat)}` : null].filter(Boolean).join(' · ') || undefined, by: l.user_name })
        if (l.notes?.startsWith('Reprise rattachée')) add({ at, kind: 'chain', title: l.notes, by: l.user_name })
      } else if (l.action_type === 'suppression') {
        add({ at, kind: 'delete', title: 'Supprimé', by: l.user_name })
      } else {
        // only real changes ("" and empty count as the same)
        const changes = Object.keys(after)
          .filter(k => !SKIP.has(k) && k in before && fmt(k, before[k]) !== fmt(k, after[k]))
          .map(k => `${FIELD[k] ?? k} : ${fmt(k, before[k])} → ${fmt(k, after[k])}`)
        if (changes.length) add({ at, kind: 'edit', title: 'Fiche modifiée', detail: changes.join('\n'), by: l.user_name })
      }
    }
    if (!sawCreation && phone.created_at) {
      add({ at: phone.created_at.toISOString(), kind: 'stock', title: 'Ajouté au stock', detail: phone.prix_achat != null ? `achat ${dh(phone.prix_achat)}` : undefined, by: userName(phone.created_by) })
    }

    // ── Sales and returns ─────────────────────────────────────────────
    const retours = txns.length ? await prisma.retours.findMany({ where: { txn_id: { in: txns.map(t => t.txn_id) }, type: 'retour' } }) : []
    for (const t of txns) {
      const op = codeLabel('operation_type', t.type_operation, 'fr')
      add({
        at: (t.created_at ?? new Date()).toISOString(), kind: 'sale',
        title: `${t.type_operation === 'echange' ? 'Vendu avec échange' : op === 'Vente' ? 'Vendu' : op} — ${t.txn_id}`,
        detail: [dh(t.prix_vente), codeLabel('payment_method', t.payment_method as never, 'fr'),
          Number(t.valeur_echange) > 0 ? `reprise ${dh(t.valeur_echange)}${t.model_echange ? ` (${t.model_echange})` : ''}` : null,
          t.override_reason ? `sous le minimum : ${t.override_reason}` : null].filter(Boolean).join(' · '),
        by: userName(t.created_by),
      })
      if (t.voided) add({ at: (t.voided_at ?? t.updated_at ?? new Date()).toISOString(), kind: 'return', title: `Vente annulée — ${t.txn_id}`, detail: t.voided_reason ?? undefined, by: userName(t.voided_by) })
    }
    for (const r of retours) {
      add({ at: (r.created_at ?? new Date()).toISOString(), kind: 'return', title: `Retour — ${r.retour_id}`, detail: [dh(r.montant), r.mode === 'avoir' ? 'avoir' : r.mode === 'hors_caisse' ? 'remboursé hors caisse' : 'remboursé', r.motif].filter(Boolean).join(' · '), by: userName(r.created_by) })
    }

    // ── Credit / down-payment files ───────────────────────────────────
    for (const c of credits) {
      add({ at: c.created_at.toISOString(), kind: 'credit', title: `Vente à crédit / avance — ${c.credit_id}`, detail: `${c.client_name} · total ${dh(c.montant_total)}${c.has_reprise ? ` · reprise ${dh(c.reprise_valeur ?? 0)}` : ''}${c.phone_remis ? ' · téléphone remis' : ' · réservé'}`, by: userName(c.created_by) })
      for (const p of c.phone_credit_payments) {
        add({ at: p.created_at.toISOString(), kind: 'credit', title: `Versement crédit ${dh(p.montant)}`, detail: `${codeLabel('payment_method', p.payment_method as never, 'fr')} · daté du ${p.date_paiement.toISOString().slice(0, 10)}${p.notes ? ` · ${p.notes}` : ''}`, by: userName(p.created_by) })
      }
      if (c.discharged_at) add({ at: c.discharged_at.toISOString(), kind: 'credit', title: `Dossier ${c.credit_id} déchargé`, by: userName(c.discharged_by) })
      if (c.statut === 'annule') add({ at: (c.discharged_at ?? c.created_at).toISOString(), kind: 'credit', title: `Dossier ${c.credit_id} annulé`, detail: c.notes ?? undefined })
    }
    const creditLogs = credits.length ? await prisma.activity_log.findMany({ where: { record_id: { in: credits.map(c => c.credit_id) }, notes: { not: null } } }) : []
    for (const l of creditLogs) if (l.notes && !/^Vente|^Versement/.test(l.notes)) add({ at: l.created_at.toISOString(), kind: 'credit', title: l.notes, by: l.user_name })

    // ── Supplier ──────────────────────────────────────────────────────
    for (const sp of supplierPays) {
      add({ at: sp.created_at.toISOString(), kind: 'supplier', title: `Payé au fournisseur ${supName(sp.supplier_id)} — ${sp.payment_id}`, detail: `règlement de ${sp.phone_ids.length} téléphone(s), ${dh(sp.montant)} au total`, by: userName(sp.created_by) })
    }
    if (phone.settled_at && !supplierPays.length) add({ at: phone.settled_at.toISOString(), kind: 'supplier', title: 'Marqué réglé au fournisseur', by: userName(phone.settled_by) })

    // ── Inventory ─────────────────────────────────────────────────────
    for (const s of scans) add({ at: s.scanned_at!.toISOString(), kind: 'inventory', title: `Inventaire : ${codeLabel('inventory_result', s.resultat as never, 'fr')}` })

    // ── Trade-in chain ────────────────────────────────────────────────
    if (phone.origine_phone_id) add({ at: phone.created_at!.toISOString(), kind: 'chain', title: `Repris en échange de ${phone.origine_phone_id}`, detail: `rattaché à ${supName(phone.fournisseur_id)} · dû ${dh(phone.du_fournisseur ?? 0)} à sa vente` })
    for (const t of tradeIns) add({ at: t.created_at!.toISOString(), kind: 'chain', title: `A reçu en reprise ${t.phone_id} (${[t.marque, t.model].filter(Boolean).join(' ')})`, detail: `${dh(t.du_fournisseur ?? 0)} reportés sur ce téléphone repris` })

    return { phone, events }
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(MANAGERS)
    const id = params.id
    const lives = [await lifeEvents(id)]
    // A phone that came back (sold, then taken back) has one record per life:
    // its history is the whole story, earlier and later lives included.
    for (let prev = lives[0].phone.vie_precedente_id; prev && lives.length < 6;) {
      const life = await lifeEvents(prev).catch(() => null)
      if (!life) break
      lives.unshift(life); prev = life.phone.vie_precedente_id
    }
    for (let last = lives[lives.length - 1].phone.phone_id; lives.length < 6;) {
      const next = await prisma.phones.findFirst({ where: { vie_precedente_id: last }, select: { phone_id: true }, orderBy: { created_at: 'asc' } })
      if (!next) break
      lives.push(await lifeEvents(next.phone_id)); last = next.phone_id
    }
    // Each stay in the shop is its own block, newest first
    const events: Event[] = lives.flatMap((life, i) => [
      ...life.events.map(e => ({ ...e, stay: i + 1 })),
      ...(i > 0 ? [{ at: life.phone.created_at!.toISOString(), kind: 'chain' as Kind, title: 'Revenu au magasin', detail: 'Déjà vendu par le magasin, repris : nouvelle période', stay: i + 1 }] : []),
    ])
    events.sort((a, b) => (b.stay ?? 1) - (a.stay ?? 1) || b.at.localeCompare(a.at))
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
    const stays = lives.map((life, i) => ({ n: i + 1, from: day(life.phone.date_entree ?? life.phone.created_at), current: i === lives.length - 1 }))
    return json({ data: { phone_id: id, events, lives: lives.length, stays } })
  } catch (err) {
    return handleError(err, 'GET /api/phones/[id]/history')
  }
}
