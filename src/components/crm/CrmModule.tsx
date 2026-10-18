'use client'
// CRM (owner, 2026-10-18): the shop's social-media conversations, typed by
// hand by a manager and followed to their outcome, with the numbers.
// Replaces Prospects: a lead "en attente de stock" is someone to contact
// when what they want comes in. Rules: lib/leads.ts, api/leads.
import { useEffect, useMemo, useState } from 'react'
import { useApi } from '@/lib/data/api'
import { usePortal } from '@/lib/context/portal'
import { usePhoneCatalog } from '@/lib/hooks/usePhoneCatalog'
import { formatMAD, computePromoPrice, getBusinessDate } from '@/lib/utils'
import { Modal, Field, Btn, StatusBadge, PageHeader, EmptyState, inputClass, selectClass, Select } from '@/components/shared'
import { confirmDialog } from '@/components/shared/ConfirmHost'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { codeLabel } from '@/lib/codes'
import { CANAUX, ETAPES, MOTIFS, OPEN, contactUrl, wantsPhone } from '@/lib/leads'
import { prospectMatches, phoneIssues } from '@/lib/prospects'
import type { Phone } from '@/types/database'
import {
  Plus, Search, MessagesSquare, MessageCircle, Camera, ThumbsUp, Phone as PhoneIcon, Globe, Store, AtSign,
  ExternalLink, Trash2, Pencil, ShoppingCart, Truck, CalendarClock, BarChart3, Hourglass, Send,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────
export interface Lead {
  lead_id: string; canal: string; nom: string | null; pseudo: string | null; telephone: string | null
  type_demande: string; etape: string; motif_perte: string | null
  cherche: string | null; marque: string | null; model: string | null; stockage: string | null
  budget_min: number | null; budget_max: number | null; accessoire: string | null
  leur_marque: string | null; leur_model: string | null; leur_stockage: string | null; leur_batterie: number | null
  leur_etat: string | null; leur_pieces: string | null; prix_demande: number | null; prix_propose: number | null
  details: string | null; relance_le: string | null
  txn_id: string | null; delivery_id: string | null; phone_id: string | null; montant: number | null
  created_at: string; updated_at: string; closed_at: string | null; nb_notes?: number
}
interface LeadDetail extends Lead {
  created_by_name: string | null
  lead_notes: { note_id: string; texte: string; created_at: string; by: string | null }[]
  delivery: { delivery_id: string; statut: string; montant_total: number; ville: string | null } | null
}

const CANAL_ICON: Record<string, typeof MessageCircle> = {
  instagram: Camera, whatsapp: MessageCircle, tiktok: AtSign, facebook: ThumbsUp, appel: PhoneIcon, site: Globe, magasin: Store, autre: MessagesSquare,
}
const STORAGES = ['64GB', '128GB', '256GB', '512GB', '1TB']
const ETATS: [string, string][] = [['bon', 'Bon'], ['moyen', 'Moyen'], ['mauvais', 'Mauvais']]
const today = () => getBusinessDate()
const narrowInput = inputClass.replace('w-full ', '')   // a field with its own width
const frDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const who = (l: Pick<Lead, 'nom' | 'pseudo' | 'telephone' | 'lead_id'>) => l.nom || (l.pseudo ? `@${l.pseudo}` : l.telephone) || l.lead_id
const priceOf = (ph: Phone) => {
  const listed = Number(ph.prix_vente_recommande ?? 0)
  return computePromoPrice(listed, ph.promo_type, ph.promo_montant) ?? listed
}
const phoneName = (ph: Phone) => {
  const m = ph.model.replace(/\s*\d+\s*(GB|TB)\s*$/i, '').trim()
  return [m.toLowerCase().startsWith(ph.marque.toLowerCase()) ? m : `${ph.marque} ${m}`, ph.stockage].filter(Boolean).join(' ')
}

/** One line saying what the lead is about. */
export function leadSummary(l: Lead) {
  const want = l.cherche === 'accessoire'
    ? l.accessoire && `Accessoire : ${l.accessoire}`
    : [l.marque, l.model, l.stockage && `${l.stockage}+`].filter(Boolean).join(' ')
      + (l.budget_max != null || l.budget_min != null ? ` · ${l.budget_min != null ? `${l.budget_min}–` : '≤ '}${l.budget_max ?? '…'} DH` : '')
  const theirs = [l.leur_marque, l.leur_model, l.leur_stockage].filter(Boolean).join(' ')
  switch (l.type_demande) {
    case 'vente':   return `Vend : ${theirs || '—'}${l.prix_demande != null ? ` · demande ${l.prix_demande} DH` : ''}`
    case 'reprise': return `Échange ${theirs || '?'} → ${want || '?'}`
    case 'autre':   return l.details ?? 'Autre demande'
    default:        return want || l.details || 'Achat'
  }
}

// ─── Module ───────────────────────────────────────────────────
export default function CrmModule({ storeId }: { storeId: string }) {
  const primary = usePortal().primaryColor
  const [tab, setTab]       = useState<'leads' | 'attente' | 'chiffres'>('leads')
  const [etape, setEtape]   = useState('ouverts')
  const [canal, setCanal]   = useState('')
  const [q, setQ]           = useState('')
  const [formLead, setFormLead] = useState<Lead | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const leadsQ = useApi<Lead[]>(`/api/leads?store_id=${storeId}`)
  const phones = useApi<Phone[]>(`/api/phones?status=disponible&store_id=${storeId}&limit=500`).data ?? []
  const all    = leadsQ.data ?? []

  const matchesOf = useMemo(() => {
    const m = new Map<string, Phone[]>()
    for (const l of all) if (wantsPhone(l)) m.set(l.lead_id, prospectMatches(l, phones))
    return m
  }, [all, phones])

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visible = all.filter(l =>
    (etape === 'tous' || (etape === 'ouverts' ? OPEN.includes(l.etape as never) : l.etape === etape)) &&
    (!canal || l.canal === canal) &&
    words.every(w => [l.lead_id, l.nom, l.pseudo, l.telephone, l.marque, l.model, l.accessoire, l.leur_model, l.details]
      .some(v => (v ?? '').toLowerCase().includes(w.replace(/^@/, '')))),
  )
  const due     = visible.filter(l => OPEN.includes(l.etape as never) && l.relance_le && l.relance_le.slice(0, 10) <= today())
  const rest    = visible.filter(l => !due.includes(l))
  const waiting = all.filter(l => l.etape === 'attente_stock')
    .sort((a, b) => (matchesOf.get(b.lead_id)?.length ?? 0) - (matchesOf.get(a.lead_id)?.length ?? 0))

  const Row = ({ l }: { l: Lead }) => {
    const Icon = CANAL_ICON[l.canal] ?? MessagesSquare
    const n = matchesOf.get(l.lead_id)?.length ?? 0
    const late = OPEN.includes(l.etape as never) && l.relance_le && l.relance_le.slice(0, 10) <= today()
    return (
      <button type="button" onClick={() => setOpenId(l.lead_id)}
        className="w-full text-left px-4 py-3 hover:bg-ez-bg transition-all flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `${primary}15` }}>
          <Icon className="w-4 h-4" style={{ color: primary }} />
        </span>
        <span className="flex-1 min-w-0 space-y-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ez-text truncate">{who(l)}</span>
            {l.pseudo && l.nom && <span className="text-xs text-ez-faint">@{l.pseudo}</span>}
            <StatusBadge domain="lead_etape" code={l.etape} />
            {l.etape === 'perdu' && l.motif_perte && <span className="text-xs text-ez-faint">{codeLabel('lead_motif', l.motif_perte as never, 'fr')}</span>}
          </span>
          <span className="block text-xs text-ez-subtle truncate">
            <b className="text-ez-text">{codeLabel('lead_type', l.type_demande as never, 'fr')}</b> · {leadSummary(l)}
          </span>
          <span className="flex items-center gap-2 flex-wrap text-[11px] text-ez-faint">
            <span>{codeLabel('lead_canal', l.canal as never, 'fr')}</span>
            <span>· {frDate(l.updated_at)}</span>
            {l.relance_le && OPEN.includes(l.etape as never) && (
              <span className={`inline-flex items-center gap-1 font-bold ${late ? 'text-red-600' : 'text-ez-subtle'}`}><CalendarClock className="w-3 h-3" />Relancer le {frDate(l.relance_le)}</span>
            )}
            {n > 0 && <span className="font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{n} en stock</span>}
            {l.delivery_id && <span className="inline-flex items-center gap-1 font-bold text-blue-700"><Truck className="w-3 h-3" />{l.delivery_id}</span>}
            {l.etape === 'gagne' && l.montant != null && <span className="font-bold text-emerald-700">{formatMAD(l.montant)}</span>}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto animate-fade-in">
      <PageHeader title="CRM" subtitle="Conversations des réseaux sociaux, jusqu’à leur résultat"
        actions={<Btn variant="primary" onClick={() => setFormLead('new')}><Plus className="w-4 h-4" /> Nouvelle conversation</Btn>} />

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {([
          ['leads', 'Conversations', MessagesSquare, all.filter(l => OPEN.includes(l.etape as never)).length],
          ['attente', 'En attente de stock', Hourglass, waiting.length],
          ['chiffres', 'Chiffres', BarChart3, null],
        ] as const).map(([k, label, Icon, n]) => (
          <button key={k} onClick={() => setTab(k)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border whitespace-nowrap"
            style={{ backgroundColor: tab === k ? primary : 'white', borderColor: tab === k ? primary : '#E8E5DE', color: tab === k ? 'white' : '#6B6860' }}>
            <Icon className="w-4 h-4" />{label}{n != null && <span className="opacity-80">({n})</span>}
          </button>
        ))}
      </div>

      {tab === 'leads' && (<>
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ez-faint" />
            <input className={`${inputClass} pl-9`} placeholder="Nom, @, numéro, modèle…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select className={`${selectClass} w-44`} value={etape} onChange={e => setEtape(e.target.value)}>
            <option value="ouverts">En cours</option>
            {ETAPES.map(e => <option key={e} value={e}>{codeLabel('lead_etape', e, 'fr')}</option>)}
            <option value="tous">Tout</option>
          </Select>
          <Select className={`${selectClass} w-44`} value={canal} onChange={e => setCanal(e.target.value)}>
            <option value="">Tous les canaux</option>
            {CANAUX.map(c => <option key={c} value={c}>{codeLabel('lead_canal', c, 'fr')}</option>)}
          </Select>
        </div>
        {leadsQ.isLoading ? <p className="text-sm text-ez-faint py-10 text-center">Chargement…</p>
          : !visible.length ? <EmptyState icon={<MessagesSquare className="w-6 h-6" />} title="Aucune conversation" description="Ajoutez chaque conversation qui commence sur un réseau social." />
          : (
            <div className="space-y-3">
              {due.length > 0 && (
                <div className="bg-white border border-red-200 rounded-2xl overflow-hidden">
                  <p className="px-4 py-2 text-xs font-bold text-red-700 bg-red-50 uppercase tracking-wide">À relancer aujourd’hui ({due.length})</p>
                  <div className="divide-y divide-ez-muted">{due.map(l => <Row key={l.lead_id} l={l} />)}</div>
                </div>
              )}
              {rest.length > 0 && <div className="bg-white border border-ez-border rounded-2xl overflow-hidden divide-y divide-ez-muted">{rest.map(l => <Row key={l.lead_id} l={l} />)}</div>}
            </div>
          )}
      </>)}

      {tab === 'attente' && (
        !waiting.length
          ? <EmptyState icon={<Hourglass className="w-6 h-6" />} title="Personne n’attend" description="Mettez une conversation « En attente de stock » quand le client veut ce que vous n’avez pas." />
          : <div className="bg-white border border-ez-border rounded-2xl overflow-hidden divide-y divide-ez-muted">{waiting.map(l => <Row key={l.lead_id} l={l} />)}</div>
      )}

      {tab === 'chiffres' && <Stats storeId={storeId} />}

      {formLead && <LeadForm storeId={storeId} lead={formLead === 'new' ? null : formLead} onClose={() => setFormLead(null)}
        onSaved={l => { setFormLead(null); setOpenId(l.lead_id); void leadsQ.refresh() }} onOpen={id => { setFormLead(null); setOpenId(id) }} />}
      {openId && <LeadPanel id={openId} phones={phones} onClose={() => setOpenId(null)} onEdit={l => { setOpenId(null); setFormLead(l) }} onChanged={() => void leadsQ.refresh()} />}
    </div>
  )
}

// ─── Form (new / edit) ────────────────────────────────────────
type Form = Record<string, string>
const toForm = (l: Lead | null): Form => ({
  canal: l?.canal ?? 'instagram', nom: l?.nom ?? '', pseudo: l?.pseudo ?? '', telephone: l?.telephone ?? '',
  type_demande: l?.type_demande ?? 'achat', cherche: l?.cherche ?? 'telephone',
  marque: l?.marque ?? '', model: l?.model ?? '', stockage: l?.stockage ?? '',
  budget_min: l?.budget_min?.toString() ?? '', budget_max: l?.budget_max?.toString() ?? '', accessoire: l?.accessoire ?? '',
  leur_marque: l?.leur_marque ?? '', leur_model: l?.leur_model ?? '', leur_stockage: l?.leur_stockage ?? '',
  leur_batterie: l?.leur_batterie?.toString() ?? '', leur_etat: l?.leur_etat ?? '', leur_pieces: l?.leur_pieces ?? '',
  prix_demande: l?.prix_demande?.toString() ?? '', prix_propose: l?.prix_propose?.toString() ?? '',
  details: l?.details ?? '', relance_le: l?.relance_le?.slice(0, 10) ?? '', etape: 'nouveau', note: '',
})

function LeadForm({ storeId, lead, onClose, onSaved, onOpen }: {
  storeId: string; lead: Lead | null; onClose: () => void; onSaved: (l: Lead) => void; onOpen: (id: string) => void
}) {
  const primary = usePortal().primaryColor
  const { brands, modelsFor } = usePhoneCatalog()
  const [f, setF] = useState<Form>(() => toForm(lead))
  const [saving, setSaving] = useState(false)
  const [twins, setTwins] = useState<Lead[]>([])
  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  const social = ['instagram', 'tiktok', 'facebook'].includes(f.canal)
  const wants  = f.type_demande === 'achat' || f.type_demande === 'reprise'
  const theirs = f.type_demande === 'vente' || f.type_demande === 'reprise'

  // Has this person written before (any channel)? Shown while typing
  const contact = f.telephone.replace(/\D/g, '').length >= 9 ? f.telephone : f.pseudo.trim().length >= 2 ? f.pseudo : ''
  useEffect(() => {
    if (!contact) { setTwins([]); return }
    const t = setTimeout(() => {
      fetch(`/api/leads?store_id=${storeId}&contact=${encodeURIComponent(contact)}`).then(r => r.json())
        .then(j => setTwins((j.data ?? []).filter((x: Lead) => x.lead_id !== lead?.lead_id))).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [contact, storeId, lead?.lead_id])

  const chips = (k: string, options: [string, string][]) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => set(k, v)} className="px-3 py-1.5 rounded-lg text-xs font-bold border"
          style={{ backgroundColor: f[k] === v ? primary : 'white', borderColor: f[k] === v ? primary : '#E8E5DE', color: f[k] === v ? 'white' : '#6B6860' }}>{l}</button>
      ))}
    </div>
  )
  const n = (v: string) => (v.trim() === '' ? null : Number(v))

  async function save() {
    if (!f.nom.trim() && !f.pseudo.trim() && !f.telephone.trim()) { showError('Nom, @ ou numéro : au moins un des trois'); return }
    setSaving(true)
    try {
      const body = {
        store_id: storeId, canal: f.canal, nom: f.nom.trim() || null, pseudo: f.pseudo.trim() || null, telephone: f.telephone.trim() || null,
        type_demande: f.type_demande,
        cherche: wants ? f.cherche : null,
        marque: wants && f.cherche === 'telephone' ? f.marque.trim() || null : null,
        model: wants && f.cherche === 'telephone' ? f.model.trim() || null : null,
        stockage: wants && f.cherche === 'telephone' ? f.stockage || null : null,
        budget_min: wants && f.cherche === 'telephone' ? n(f.budget_min) : null,
        budget_max: wants && f.cherche === 'telephone' ? n(f.budget_max) : null,
        accessoire: wants && f.cherche === 'accessoire' ? f.accessoire.trim() || null : null,
        leur_marque: theirs ? f.leur_marque.trim() || null : null, leur_model: theirs ? f.leur_model.trim() || null : null,
        leur_stockage: theirs ? f.leur_stockage || null : null, leur_batterie: theirs ? n(f.leur_batterie) : null,
        leur_etat: theirs ? f.leur_etat || null : null, leur_pieces: theirs ? f.leur_pieces.trim() || null : null,
        prix_demande: theirs ? n(f.prix_demande) : null, prix_propose: theirs ? n(f.prix_propose) : null,
        details: f.details.trim() || null, relance_le: f.relance_le || null,
        ...(!lead && { etape: f.etape, note: f.note.trim() || undefined }),
      }
      const res  = await fetch(lead ? `/api/leads/${lead.lead_id}` : '/api/leads', { method: lead ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(lead ? 'Conversation modifiée ✓' : `Conversation ${json.data.lead_id} ajoutée ✓`)
      onSaved(json.data)
    } catch (e: unknown) { showError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={lead ? `Modifier ${lead.lead_id}` : 'Nouvelle conversation'} size="lg">
      <div className="space-y-4">
        <Field label="Canal" required>{chips('canal', CANAUX.map(c => [c, codeLabel('lead_canal', c, 'fr')]))}</Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Nom"><input className={inputClass} value={f.nom} onChange={e => set('nom', e.target.value)} /></Field>
          <Field label={social ? '@ (profil)' : '@ (si connu)'}><input className={inputClass} placeholder="@karim.phones" value={f.pseudo} onChange={e => set('pseudo', e.target.value)} /></Field>
          <Field label="Numéro"><input className={inputClass} type="tel" placeholder="06…" value={f.telephone} onChange={e => set('telephone', e.target.value)} /></Field>
        </div>
        {twins.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
            <p className="font-bold">Cette personne a déjà écrit :</p>
            {twins.slice(0, 4).map(t => (
              <button key={t.lead_id} type="button" onClick={() => onOpen(t.lead_id)} className="block underline text-left">
                {t.lead_id} · {codeLabel('lead_canal', t.canal as never, 'fr')} · {codeLabel('lead_etape', t.etape as never, 'fr')} · {leadSummary(t)}
              </button>
            ))}
          </div>
        )}

        <Field label="Demande" required>{chips('type_demande', [['achat', 'Achat'], ['reprise', 'Reprise / échange'], ['vente', 'Nous vendre son téléphone'], ['autre', 'Autre']])}</Field>

        {wants && (
          <div className="rounded-2xl border border-ez-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest">{f.type_demande === 'reprise' ? 'Ce qu’il veut' : 'Il cherche'}</p>
              {chips('cherche', [['telephone', 'Téléphone'], ['accessoire', 'Accessoire']])}
            </div>
            {f.cherche === 'accessoire'
              ? <input className={inputClass} placeholder="Ex. : chargeur rapide iPhone, pochette S24…" value={f.accessoire} onChange={e => set('accessoire', e.target.value)} />
              : (<>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input className={inputClass} list="crm-brands" placeholder="Marque(s) : Apple, Samsung" value={f.marque} onChange={e => set('marque', e.target.value)} />
                  <input className={inputClass} list="crm-models" placeholder="Série / modèle : 13, 15 Pro" value={f.model} onChange={e => set('model', e.target.value)} />
                  <Select className={selectClass} value={f.stockage} onChange={e => set('stockage', e.target.value)}>
                    <option value="">Stockage : peu importe</option>
                    {STORAGES.map(s => <option key={s} value={s}>{s} ou plus</option>)}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min={0} className={inputClass} placeholder="Budget min (DH)" value={f.budget_min} onChange={e => set('budget_min', e.target.value)} />
                  <input type="number" min={0} className={inputClass} placeholder="Budget max (DH)" value={f.budget_max} onChange={e => set('budget_max', e.target.value)} />
                </div>
              </>)}
          </div>
        )}

        {theirs && (
          <div className="rounded-2xl border border-ez-border p-3 space-y-3">
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest">Son téléphone</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input className={inputClass} list="crm-brands" placeholder="Marque" value={f.leur_marque} onChange={e => set('leur_marque', e.target.value)} />
              <input className={inputClass} list="crm-their-models" placeholder="Modèle" value={f.leur_model} onChange={e => set('leur_model', e.target.value)} />
              <Select className={selectClass} value={f.leur_stockage} onChange={e => set('leur_stockage', e.target.value)}>
                <option value="">Stockage</option>
                {STORAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <input type="number" min={0} max={100} className={inputClass} placeholder="Batterie %" value={f.leur_batterie} onChange={e => set('leur_batterie', e.target.value)} />
              <Select className={selectClass} value={f.leur_etat} onChange={e => set('leur_etat', e.target.value)}>
                <option value="">État</option>
                {ETATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <input className={`${inputClass} col-span-2 sm:col-span-1`} placeholder="Pièces changées" value={f.leur_pieces} onChange={e => set('leur_pieces', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min={0} className={inputClass} placeholder="Prix qu’il demande (DH)" value={f.prix_demande} onChange={e => set('prix_demande', e.target.value)} />
              <input type="number" min={0} className={inputClass} placeholder={f.type_demande === 'reprise' ? 'Valeur de reprise proposée (DH)' : 'Prix qu’on propose (DH)'} value={f.prix_propose} onChange={e => set('prix_propose', e.target.value)} />
            </div>
          </div>
        )}

        <Field label="Détails"><textarea className={`${inputClass} resize-none`} rows={2} value={f.details} onChange={e => set('details', e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!lead && <Field label="Étape">{chips('etape', [['nouveau', 'Nouveau'], ['en_discussion', 'En discussion'], ['attente_stock', 'Attente stock']])}</Field>}
          <Field label="Relancer le"><input type="date" className={inputClass} min={today()} value={f.relance_le} onChange={e => set('relance_le', e.target.value)} /></Field>
        </div>
        {!lead && <Field label="Note"><input className={inputClass} placeholder="Ce qui a été dit" value={f.note} onChange={e => set('note', e.target.value)} /></Field>}

        <datalist id="crm-brands">{brands.map(b => <option key={b} value={b} />)}</datalist>
        <datalist id="crm-models">{modelsFor(f.marque.split(',')[0]?.trim() ?? '').map(m => <option key={m} value={m} />)}</datalist>
        <datalist id="crm-their-models">{modelsFor(f.leur_marque.trim()).map(m => <option key={m} value={m} />)}</datalist>

        <div className="flex gap-2">
          <Btn variant="secondary" className="flex-1" onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" className="flex-1" loading={saving} onClick={save}>Enregistrer</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Panel (one lead) ─────────────────────────────────────────
function LeadPanel({ id, phones, onClose, onEdit, onChanged }: {
  id: string; phones: Phone[]; onClose: () => void; onEdit: (l: Lead) => void; onChanged: () => void
}) {
  const primary = usePortal().primaryColor
  const q = useApi<LeadDetail>(`/api/leads/${id}`)
  const l = q.data
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [closing, setClosing] = useState<'perdu' | 'txn' | 'phone' | null>(null)
  const [motif, setMotif]     = useState('')
  const [ref, setRef]         = useState('')

  async function patch(body: Record<string, unknown>, done?: string) {
    setBusy(true)
    try {
      const res  = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (done) showSuccess(done)
      setClosing(null); setNote(''); setRef(''); setMotif('')
      await q.refresh(); onChanged()
    } catch (e: unknown) { showError((e as Error).message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!(await confirmDialog('Supprimer cette conversation ? Elle disparaît du CRM et des chiffres.', { danger: true }))) return
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { showError(json.error); return }
    showSuccess('Conversation supprimée'); onChanged(); onClose()
  }

  if (!l) return <Modal open onClose={onClose} title={id}><p className="text-sm text-ez-faint py-8 text-center">Chargement…</p></Modal>

  const isOpen  = OPEN.includes(l.etape as never)
  const url     = contactUrl(l)
  const matches = wantsPhone(l) ? prospectMatches(l, phones) : []
  const digits  = (l.telephone ?? '').replace(/\D/g, '').slice(-9)
  const share = (ph: Phone) => {
    const text = `Bonjour${l.nom ? ` ${l.nom}` : ''}, nous avons ${phoneName(ph)}${ph.battery_level != null ? ` (batterie ${ph.battery_level}%)` : ''} à ${priceOf(ph)} DH. Il vous intéresse ?`
    if (digits.length === 9) window.open(`https://wa.me/212${digits}?text=${encodeURIComponent(text)}`, '_blank')
    else { void navigator.clipboard?.writeText(text); showSuccess('Message copié : collez-le dans la conversation') }
  }
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-ez-border text-ez-text hover:bg-ez-bg transition-all inline-flex items-center gap-1.5'

  return (
    <Modal open onClose={onClose} title={`${who(l)} · ${l.lead_id}`} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge domain="lead_etape" code={l.etape} size="md" />
          <span className="text-sm text-ez-subtle">{codeLabel('lead_canal', l.canal as never, 'fr')}{l.pseudo ? ` · @${l.pseudo}` : ''}{l.telephone ? ` · ${l.telephone}` : ''}</span>
          {url && <a href={url} target="_blank" rel="noreferrer" className={`${btn} ml-auto`} style={{ borderColor: primary, color: primary }}><ExternalLink className="w-3.5 h-3.5" />Ouvrir la conversation</a>}
        </div>

        <div className="rounded-2xl bg-ez-bg px-4 py-3 text-sm space-y-1">
          <p><b>{codeLabel('lead_type', l.type_demande as never, 'fr')}</b> — {leadSummary(l)}</p>
          {(l.type_demande === 'vente' || l.type_demande === 'reprise') && (
            <p className="text-xs text-ez-subtle">
              Son téléphone : {[l.leur_marque, l.leur_model, l.leur_stockage].filter(Boolean).join(' ') || '—'}
              {l.leur_batterie != null && ` · batterie ${l.leur_batterie}%`}{l.leur_etat && ` · état ${l.leur_etat}`}{l.leur_pieces && ` · pièces : ${l.leur_pieces}`}
              {l.prix_demande != null && ` · demande ${formatMAD(l.prix_demande)}`}{l.prix_propose != null && ` · proposé ${formatMAD(l.prix_propose)}`}
            </p>
          )}
          {l.details && <p className="text-xs text-ez-subtle">{l.details}</p>}
          {l.etape === 'perdu' && l.motif_perte && <p className="text-xs font-bold text-ez-subtle">Perdu : {codeLabel('lead_motif', l.motif_perte as never, 'fr')}</p>}
          {l.etape === 'gagne' && (
            <p className="text-xs font-bold text-emerald-700">
              Gagné{l.montant != null && ` — ${formatMAD(l.montant)}`}{l.txn_id && ` · vente ${l.txn_id}`}{l.phone_id && ` · téléphone acheté ${l.phone_id}`}
            </p>
          )}
          {l.delivery && <p className="text-xs font-bold text-blue-700 flex items-center gap-1"><Truck className="w-3.5 h-3.5" />Livraison {l.delivery.delivery_id} · {codeLabel('delivery_status', l.delivery.statut as never, 'fr')}{l.delivery.ville ? ` · ${l.delivery.ville}` : ''}</p>}
        </div>

        {wantsPhone(l) && (
          <div>
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest mb-2">En stock pour cette demande ({matches.length})</p>
            {!matches.length ? <p className="text-xs text-ez-faint">Rien en stock pour l’instant{l.etape !== 'attente_stock' ? ' : mettez-la « En attente de stock » pour être prévenu' : ' : vous serez prévenu à l’arrivée'}.</p> : (
              <ul className="border border-ez-border rounded-xl divide-y divide-ez-muted max-h-60 overflow-y-auto">
                {matches.slice(0, 12).map(ph => {
                  const listed = Number(ph.prix_vente_recommande ?? 0), price = priceOf(ph), issue = phoneIssues(ph)
                  return (
                    <li key={ph.phone_id} className="px-3 py-2 flex items-center gap-3">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-ez-text truncate">{phoneName(ph)}{ph.couleur ? ` · ${ph.couleur}` : ''}</span>
                        <span className="block text-[11px] text-ez-faint">
                          {ph.phone_id}{ph.battery_level != null && ` · ${ph.battery_level}%`}{issue.damaged && ' · endommagé'}{issue.replaced > 0 && ' · pièces changées'}
                          {l.type_demande === 'reprise' && l.prix_propose != null && ` · reste à payer ${formatMAD(Math.max(price - l.prix_propose, 0))}`}
                        </span>
                      </span>
                      <span className="text-right flex-shrink-0 tabular-nums">
                        {price < listed && <span className="block text-[11px] text-ez-faint line-through">{formatMAD(listed)}</span>}
                        <span className="block text-xs font-bold" style={{ color: price < listed ? '#C9A440' : undefined }}>{formatMAD(price)}</span>
                      </span>
                      {isOpen && <button type="button" title="Proposer ce téléphone" onClick={() => share(ph)} className="p-1.5 rounded-lg border border-ez-border hover:bg-ez-bg"><Send className="w-3.5 h-3.5" /></button>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {isOpen && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest">Avancer</p>
            <div className="flex flex-wrap gap-1.5">
              {(['nouveau', 'en_discussion', 'proposition', 'attente_stock'] as const).filter(e => e !== l.etape).map(e => (
                <button key={e} className={btn} disabled={busy} onClick={() => patch({ etape: e }, codeLabel('lead_etape', e, 'fr'))}>→ {codeLabel('lead_etape', e, 'fr')}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ez-subtle inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />Relancer le</span>
              <input type="date" className={`${narrowInput} w-44 py-1.5`} min={today()} value={l.relance_le?.slice(0, 10) ?? ''}
                onChange={e => patch({ relance_le: e.target.value || null }, e.target.value ? `Relance le ${frDate(e.target.value)}` : 'Relance retirée')} />
            </div>
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest pt-2">Résultat</p>
            <div className="flex flex-wrap gap-1.5">
              {l.type_demande !== 'vente' && !l.delivery_id && (<>
                <a className={btn} href={`/ez/pos?lead=${l.lead_id}`}><ShoppingCart className="w-3.5 h-3.5" />Vendre en boutique</a>
                <a className={btn} href={`/ez/pos?lead=${l.lead_id}&livrer=1`}><Truck className="w-3.5 h-3.5" />Vendre et livrer</a>
                <button className={btn} onClick={() => setClosing('txn')}>Vente déjà faite</button>
              </>)}
              {l.type_demande === 'vente' && <button className={btn} onClick={() => setClosing('phone')}>Téléphone acheté</button>}
              <button className={`${btn} text-red-600 border-red-200`} onClick={() => setClosing('perdu')}>Perdu</button>
            </div>
            {closing === 'perdu' && (
              <div className="flex gap-2">
                <Select className={selectClass} value={motif} onChange={e => setMotif(e.target.value)}>
                  <option value="">Pourquoi ?</option>
                  {MOTIFS.filter(m => m !== 'refus_livraison').map(m => <option key={m} value={m}>{codeLabel('lead_motif', m, 'fr')}</option>)}
                </Select>
                <Btn variant="danger" loading={busy} disabled={!motif} onClick={() => patch({ etape: 'perdu', motif_perte: motif }, 'Marqué perdu')}>Perdu</Btn>
              </div>
            )}
            {(closing === 'txn' || closing === 'phone') && (
              <div className="flex gap-2">
                <input className={inputClass} placeholder={closing === 'txn' ? 'N° de vente : TXN-2140' : 'N° du téléphone : PHO-0612'} value={ref} onChange={e => setRef(e.target.value)} />
                <Btn variant="primary" loading={busy} disabled={ref.trim().length < 5}
                  onClick={() => patch({ etape: 'gagne', ...(closing === 'txn' ? { txn_id: ref.trim() } : { phone_id: ref.trim() }) }, 'Gagné ✓')}>Gagné</Btn>
              </div>
            )}
            {l.delivery_id && <p className="text-xs text-ez-faint">Commande {l.delivery_id} en cours : le lead passe en gagné à la livraison (Livraisons).</p>}
          </div>
        )}
        {!isOpen && !(l.etape === 'gagne' && l.delivery_id) && (
          <button className={btn} disabled={busy} onClick={() => patch({ etape: 'en_discussion' }, 'Conversation rouverte')}>Rouvrir</button>
        )}

        <div className="space-y-2">
          <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest">Journal</p>
          <div className="flex gap-2">
            <input className={inputClass} placeholder="Ce qui a été dit, ce qu’on a proposé…" value={note} onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && note.trim()) void patch({ note }) }} />
            <Btn variant="secondary" loading={busy} disabled={!note.trim()} onClick={() => patch({ note })}>Noter</Btn>
          </div>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {l.lead_notes.map(n => (
              <li key={n.note_id} className="text-sm"><span className="text-[11px] text-ez-faint">{frDate(n.created_at)} · {n.by ?? '—'} — </span>{n.texte}</li>
            ))}
            <li className="text-[11px] text-ez-faint">{frDate(l.created_at)} · conversation ajoutée par {l.created_by_name ?? '—'}</li>
          </ul>
        </div>

        <div className="flex justify-between pt-2 border-t border-ez-border">
          <button className={`${btn} text-red-600 border-red-200`} onClick={remove}><Trash2 className="w-3.5 h-3.5" />Supprimer</button>
          <button className={btn} onClick={() => onEdit(l)}><Pencil className="w-3.5 h-3.5" />Modifier</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Numbers ──────────────────────────────────────────────────
interface StatRow { key: string; label: string; total: number; gagne: number; perdu: number; ouverts: number; montant: number; taux: number | null }
interface StatsData {
  from: string; to: string; open_now: number; to_follow: number
  totals: StatRow & { delai_moyen: number | null }
  canaux: StatRow[]; types: StatRow[]; managers: StatRow[]
  motifs: { key: string; n: number }[]; demandes: { label: string; n: number; gagne: number }[]
}

function Stats({ storeId }: { storeId: string }) {
  const primary = usePortal().primaryColor
  const t = today()
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  const presets: [string, string, string][] = [
    ['7 jours', addDays(t, -6), t],
    ['30 jours', addDays(t, -29), t],
    ['Ce mois', `${t.slice(0, 7)}-01`, t],
    ['Mois dernier', `${addDays(`${t.slice(0, 7)}-01`, -1).slice(0, 7)}-01`, addDays(`${t.slice(0, 7)}-01`, -1)],
  ]
  const [range, setRange] = useState<[string, string]>([presets[1][1], presets[1][2]])
  const s = useApi<StatsData>(`/api/leads/stats?store_id=${storeId}&from=${range[0]}&to=${range[1]}`).data

  const Table = ({ title, rows, money = true }: { title: string; rows: StatRow[]; money?: boolean }) => (
    <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
      <p className="px-4 py-2 text-xs font-bold text-ez-subtle uppercase tracking-wide border-b border-ez-muted">{title}</p>
      {!rows.length ? <p className="px-4 py-3 text-xs text-ez-faint">—</p> : (
        <table className="w-full text-sm tabular-nums">
          <thead><tr className="text-[11px] text-ez-faint">
            <th className="text-left font-medium px-4 py-1.5"></th><th className="font-medium px-2">Total</th><th className="font-medium px-2">Gagnés</th>
            <th className="font-medium px-2">Perdus</th><th className="font-medium px-2">En cours</th><th className="font-medium px-2">Taux</th>{money && <th className="font-medium px-4 text-right">Ventes</th>}
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key} className="border-t border-ez-muted">
              <td className="px-4 py-2 font-medium">{r.label}</td><td className="text-center">{r.total}</td>
              <td className="text-center text-emerald-700 font-bold">{r.gagne}</td><td className="text-center text-ez-subtle">{r.perdu}</td>
              <td className="text-center">{r.ouverts}</td><td className="text-center font-bold">{r.taux == null ? '—' : `${r.taux}%`}</td>
              {money && <td className="px-4 text-right">{formatMAD(r.montant)}</td>}
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map(([label, from, to]) => (
          <button key={label} onClick={() => setRange([from, to])} className="px-3 py-1.5 rounded-lg text-xs font-bold border"
            style={{ backgroundColor: range[0] === from && range[1] === to ? primary : 'white', borderColor: range[0] === from && range[1] === to ? primary : '#E8E5DE', color: range[0] === from && range[1] === to ? 'white' : '#6B6860' }}>{label}</button>
        ))}
        <input type="date" className={`${narrowInput} w-40 py-1.5`} value={range[0]} max={range[1]} onChange={e => setRange([e.target.value, range[1]])} />
        <input type="date" className={`${narrowInput} w-40 py-1.5`} value={range[1]} min={range[0]} max={t} onChange={e => setRange([range[0], e.target.value])} />
      </div>
      {!s ? <p className="text-sm text-ez-faint py-10 text-center">Chargement…</p> : (<>
        <p className="text-xs text-ez-faint">Conversations commencées entre le {frDate(s.from)} et le {frDate(s.to)}. Le taux = gagnés ÷ (gagnés + perdus).</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {([
            ['Conversations', String(s.totals.total)],
            ['Gagnées', String(s.totals.gagne)],
            ['Perdues', String(s.totals.perdu)],
            ['Taux de réussite', s.totals.taux == null ? '—' : `${s.totals.taux}%`],
            ['Ventes gagnées', formatMAD(s.totals.montant)],
            ['Délai moyen', s.totals.delai_moyen == null ? '—' : `${s.totals.delai_moyen} j`],
          ] as const).map(([label, v]) => (
            <div key={label} className="bg-white border border-ez-border rounded-xl px-3 py-2">
              <p className="text-[11px] text-ez-faint">{label}</p>
              <p className="text-lg font-bold text-ez-text tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-ez-subtle">Aujourd’hui : <b>{s.open_now}</b> conversations en cours, dont <b className={s.to_follow ? 'text-red-600' : ''}>{s.to_follow}</b> à relancer.</p>
        <Table title="Par canal" rows={s.canaux.map(r => ({ ...r, label: codeLabel('lead_canal', r.key as never, 'fr') }))} />
        <Table title="Par type de demande" rows={s.types.map(r => ({ ...r, label: codeLabel('lead_type', r.key as never, 'fr') }))} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
            <p className="px-4 py-2 text-xs font-bold text-ez-subtle uppercase tracking-wide border-b border-ez-muted">Pourquoi on perd</p>
            {!s.motifs.length ? <p className="px-4 py-3 text-xs text-ez-faint">—</p> : s.motifs.map(m => (
              <p key={m.key} className="px-4 py-2 border-t border-ez-muted first:border-0 text-sm flex justify-between"><span>{codeLabel('lead_motif', m.key as never, 'fr')}</span><b>{m.n}</b></p>
            ))}
          </div>
          <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
            <p className="px-4 py-2 text-xs font-bold text-ez-subtle uppercase tracking-wide border-b border-ez-muted">Les plus demandés</p>
            {!s.demandes.length ? <p className="px-4 py-3 text-xs text-ez-faint">—</p> : s.demandes.map(d => (
              <p key={d.label} className="px-4 py-2 border-t border-ez-muted first:border-0 text-sm flex justify-between gap-2"><span className="truncate">{d.label}</span><span><b>{d.n}</b>{d.gagne > 0 && <span className="text-emerald-700 text-xs"> · {d.gagne} gagné{d.gagne > 1 ? 's' : ''}</span>}</span></p>
            ))}
          </div>
        </div>
        <Table title="Par manager" rows={s.managers} />
      </>)}
    </div>
  )
}
