'use client'
import { useState, useEffect } from 'react'
import { useApi } from '@/lib/data/api'
import { useUser }          from '@/lib/hooks/useUser'
import { usePortal }        from '@/lib/context/portal'
import { formatMAD, getBusinessDate } from '@/lib/utils'
import { Modal, Btn, Field, inputClass } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import {
  Loader2, Plus, Package, Truck,
  List, LayoutGrid, Printer,
} from 'lucide-react'
import DeliveryLabel from '@/components/print/DeliveryLabel'

// ─── Types ────────────────────────────────────────────────────
interface DeliveryItem {
  device_type: string
  device_id:   string
  txn_id?:     string
  qty:         number
  label?:      string
}

interface Delivery {
  delivery_id:          string
  client_name:          string
  client_phone:         string
  client_address:       string
  montant_total:        number
  montant_avance:       number
  montant_restant:      number
  payment_scenario:     string
  statut:               string
  notes?:               string
  delivery_items:       DeliveryItem[]
  created_at:           string
  caisse_entry_created: boolean
  // Orders taken at the POS (migration 19)
  commande:             boolean
  ville?:               string | null
  transporteur?:        string | null
  frais_livraison?:     number
  frais_charge?:        string
  avance_ref?:          string | null
  date_livraison?:      string | null
  versement_recu_at?:   string | null
  avance_decision?:     string | null
  motif_retour?:        string | null
  lead_id?:             string | null
  money?:               { reste: number; aEncaisser: number; verse: number; fraisBoutique: number }
}

// ─── Constants ────────────────────────────────────────────────
const COLUMNS = [
  { key: 'confirmation_en_cours', label: 'En confirmation', color: '#6B6860', terminal: false },
  { key: 'attente_avance',       label: "Att. avance",     color: '#F59E0B', terminal: false },
  { key: 'prepare',              label: 'Préparé',         color: '#3B82F6', terminal: false },
  { key: 'en_transit',           label: 'En transit',      color: '#8B5CF6', terminal: false },
  { key: 'livre',                label: 'Livré',           color: '#10B981', terminal: true  },
  { key: 'annule',               label: 'Annulé',          color: '#EF4444', terminal: true  },
  { key: 'retour',               label: 'Retour',          color: '#F97316', terminal: true  },
]

const SCENARIO_SHORT: Record<string, string> = {
  avance_totale:    '100% avance',
  avance_partielle: 'Avance partielle',
  paiement_livraison:     'À la livraison',
}

// ─── Main Module ──────────────────────────────────────────────
// Orders to deliver are taken at the POS ("Vente à livrer", owner 2026-10-18);
// here they are followed to the end: advance, on the way, delivered (the sale
// is recorded), refused (back to stock), and the company's payment.
interface DeliveriesModuleProps { storeId: string }

type Step =
  | { kind: 'avance';    d: Delivery }
  | { kind: 'livre';     d: Delivery }
  | { kind: 'retour';    d: Delivery; statut: 'retour' | 'annule' }
  | { kind: 'modifier';  d: Delivery }

const today = () => getBusinessDate()

export default function DeliveriesModule({ storeId }: DeliveriesModuleProps) {
  const { user }     = useUser()
  const portal       = usePortal()
  const primary      = portal.primaryColor

  const deliveriesQ = useApi<Delivery[]>(`/api/deliveries?store_id=${storeId}`)
  const deliveries  = deliveriesQ.data ?? []
  const loading     = deliveriesQ.isLoading
  useEffect(() => { if (deliveriesQ.error) showError(deliveriesQ.error.message) }, [deliveriesQ.error])
  const [viewMode,   setViewMode]   = useState<'kanban' | 'list'>('kanban')
  const [dragging,   setDragging]   = useState<string | null>(null)
  const [step,       setStep]       = useState<Step | null>(null)
  const [busy,       setBusy]       = useState(false)
  const [labelOf,    setLabelOf]    = useState<Delivery | null>(null)

  // Step form (one at a time)
  const [f, setF] = useState<Record<string, string>>({})
  const setField = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  function open(s: Step) {
    const d = s.d
    setF(s.kind === 'avance' ? { montant: String(d.montant_avance > 0 ? d.montant_avance : 300), ref: d.avance_ref ?? '', date: today() }
      : s.kind === 'livre' ? { date: today() }
      : s.kind === 'retour' ? { motif: '', decision: '' }
      : { adresse: d.client_address, ville: d.ville ?? '', transporteur: d.transporteur ?? '', frais: String(d.frais_livraison ?? 0), charge: d.frais_charge ?? 'client', notes: d.notes ?? '' })
    setStep(s)
  }

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true)
    try {
      const res  = await fetch('/api/deliveries', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(done)
      setStep(null)
      await deliveriesQ.refresh()
    } catch (e: unknown) {
      showError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const updateStatus = (delivery_id: string, statut: string) => send({ delivery_id, statut }, `→ ${COLUMNS.find(c => c.key === statut)?.label}`)

  function onDrop(e: React.DragEvent, targetStatut: string) {
    e.preventDefault()
    const d = deliveries.find(x => x.delivery_id === dragging)
    setDragging(null)
    if (!d || d.statut === targetStatut) return
    const fromCol = COLUMNS.find(c => c.key === d.statut)
    const toCol   = COLUMNS.find(c => c.key === targetStatut)
    if (fromCol?.terminal) { showError('Statut terminal — impossible de déplacer'); return }
    // Ending an order asks for its details (date, reason, advance)
    if (d.commande && targetStatut === 'livre') return open({ kind: 'livre', d })
    if (d.commande && (targetStatut === 'retour' || targetStatut === 'annule')) return open({ kind: 'retour', d, statut: targetStatut })
    if (toCol?.terminal && !d.commande) { showError('Statut terminal — utilisez les boutons de la carte'); return }
    void updateStatus(d.delivery_id, targetStatut)
  }

  if (!['gerant', 'proprietaire'].includes(user?.role ?? '')) {
    return <div className="p-6 text-sm text-ez-subtle">Accès réservé aux managers et propriétaires.</div>
  }

  // Money still to come
  const orders   = deliveries.filter(d => d.commande)
  const onWay    = orders.filter(d => ['attente_avance', 'prepare', 'en_transit', 'confirmation_en_cours'].includes(d.statut))
  const toCollect = onWay.reduce((s, d) => s + (d.money?.aEncaisser ?? 0), 0)
  const unpaid   = orders.filter(d => d.statut === 'livre' && !d.versement_recu_at)
  const owed     = unpaid.reduce((s, d) => s + (d.money?.verse ?? 0), 0)

  const Actions = ({ d }: { d: Delivery }) => {
    const col = COLUMNS.find(c => c.key === d.statut)
    if (!d.commande) {
      // Old cards (before orders were taken at the POS)
      return col?.terminal ? null : (
        <div className="flex gap-1 flex-wrap">
          {COLUMNS.filter(c => c.key !== d.statut).map(nc => (
            <button key={nc.key} onClick={() => updateStatus(d.delivery_id, nc.key)}
              className="text-[10px] px-1.5 py-0.5 rounded-lg border border-ez-border text-ez-subtle hover:bg-ez-bg whitespace-nowrap">→ {nc.label}</button>
          ))}
        </div>
      )
    }
    const btn = 'text-[11px] font-bold px-2 py-1 rounded-lg border transition-all whitespace-nowrap'
    if (d.statut === 'livre') {
      return d.versement_recu_at
        ? <button onClick={() => send({ delivery_id: d.delivery_id, action: 'versement', recu: false }, 'Versement annulé')} className={`${btn} border-emerald-200 text-emerald-700`}>✓ Versé par le transporteur</button>
        : <button onClick={() => send({ delivery_id: d.delivery_id, action: 'versement', recu: true }, 'Versement reçu ✓')} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}>Versement reçu ({formatMAD(d.money?.verse ?? 0)})</button>
    }
    if (col?.terminal) return null
    const withPhone = d.delivery_items.some(i => i.device_type === 'telephone')
    return (
      <div className="flex gap-1 flex-wrap">
        {(d.statut === 'attente_avance' || d.statut === 'confirmation_en_cours' || (withPhone && d.montant_avance < 300)) && (
          <button onClick={() => open({ kind: 'avance', d })} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}>Avance reçue</button>
        )}
        {d.statut === 'prepare' && (
          <button onClick={() => updateStatus(d.delivery_id, 'en_transit')} className={`${btn} border-violet-200 text-violet-700 hover:bg-violet-50`}>→ En route</button>
        )}
        {(d.statut === 'prepare' || d.statut === 'en_transit') && (
          <button onClick={() => open({ kind: 'livre', d })} className={`${btn} border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>✓ Livré</button>
        )}
        {d.statut === 'en_transit'
          ? <button onClick={() => open({ kind: 'retour', d, statut: 'retour' })} className={`${btn} border-orange-200 text-orange-600 hover:bg-orange-50`}>↩ Refusé</button>
          : <button onClick={() => open({ kind: 'retour', d, statut: 'annule' })} className={`${btn} border-red-200 text-red-600 hover:bg-red-50`}>✗ Annuler</button>}
        <button onClick={() => open({ kind: 'modifier', d })} className={`${btn} border-ez-border text-ez-subtle hover:bg-ez-bg`}>Modifier</button>
      </div>
    )
  }

  const Card = ({ d }: { d: Delivery }) => {
    const col = COLUMNS.find(c => c.key === d.statut)
    return (
      <div draggable={!col?.terminal} onDragStart={() => setDragging(d.delivery_id)}
        className={`bg-white border border-ez-border rounded-xl p-3 space-y-2 shadow-sm ${!col?.terminal ? 'cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-ez-text">{d.delivery_id}{d.lead_id && <span className="ml-1 text-[10px] font-bold text-violet-600">· {d.lead_id}</span>}</p>
            <p className="text-xs text-ez-subtle truncate">{d.client_name}{d.ville ? ` · ${d.ville}` : ''}</p>
            <a href={`tel:${d.client_phone}`} className="text-xs text-ez-faint">{d.client_phone}</a>
          </div>
          <span className="text-xs font-bold flex-shrink-0" style={{ color: primary }}>{formatMAD(d.montant_total)}</span>
        </div>
        <ul className="text-[11px] text-ez-text space-y-0.5">
          {d.delivery_items.map(i => <li key={i.device_id} className="truncate">• {i.label ?? i.device_id}{i.qty > 1 ? ` ×${i.qty}` : ''}</li>)}
        </ul>
        {d.commande && d.money ? (
          <div className="text-[11px] text-ez-subtle space-y-0.5 tabular-nums">
            <p>Avance {d.montant_avance > 0 ? <b className="text-emerald-700">{formatMAD(d.montant_avance)} ✓</b> : <b className="text-amber-600">pas encore</b>}</p>
            {d.statut === 'livre'
              ? <p>Livrée le {fr(d.date_livraison)} · versement {formatMAD(d.money.verse)}</p>
              : <p>Livreur encaisse <b className="text-ez-text">{formatMAD(d.money.aEncaisser)}</b>{d.transporteur ? ` · ${d.transporteur}` : ''}</p>}
            {Number(d.frais_livraison) > 0 && <p>Frais {formatMAD(Number(d.frais_livraison))} ({d.frais_charge === 'boutique' ? 'boutique' : 'client'})</p>}
            {(d.statut === 'retour' || d.statut === 'annule') && <p className="text-red-600">{d.motif_retour}{d.avance_decision ? ` · avance ${d.avance_decision === 'gardee' ? 'gardée' : 'remboursée'}` : ''}</p>}
          </div>
        ) : (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-ez-bg border border-ez-border text-ez-subtle">{SCENARIO_SHORT[d.payment_scenario]}</span>
        )}
        <button onClick={() => setLabelOf(d)}
          className="w-full text-xs py-1 rounded-lg border border-ez-border text-ez-subtle hover:bg-ez-bg transition-all flex items-center justify-center gap-1">
          <Printer className="w-3 h-3" /> Étiquette
        </button>
        <Actions d={d} />
      </div>
    )
  }

  const s = step
  const money = s?.d.money
  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-ez-border space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-bold text-xl text-ez-text" style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.04em' }}>LIVRAISONS</h1>
            <p className="text-sm text-ez-faint mt-0.5">Les commandes se créent au POS : « Vente à livrer »</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border border-ez-border rounded-xl overflow-hidden">
              {(['kanban', 'list'] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all"
                  style={{ backgroundColor: viewMode === v ? primary : 'white', color: viewMode === v ? 'white' : '#6B6860' }}>
                  {v === 'kanban' ? <LayoutGrid className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
                  {v === 'kanban' ? 'Kanban' : 'Liste'}
                </button>
              ))}
            </div>
            <a href="/ez/pos" className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white" style={{ backgroundColor: primary }}>
              <Plus className="w-4 h-4" /> Nouvelle commande
            </a>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="rounded-xl border border-ez-border bg-white px-3 py-2">
            <p className="text-[11px] text-ez-faint">En cours</p>
            <p className="text-sm font-bold text-ez-text">{onWay.length} commande{onWay.length > 1 ? 's' : ''} · livreurs encaissent {formatMAD(toCollect)}</p>
          </div>
          <div className={`rounded-xl border px-3 py-2 ${owed > 0 ? 'border-amber-300 bg-amber-50' : 'border-ez-border bg-white'}`}>
            <p className="text-[11px] text-ez-faint">À recevoir du transporteur</p>
            <p className="text-sm font-bold text-ez-text">{formatMAD(owed)} · {unpaid.length} livrée{unpaid.length > 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-xl border border-ez-border bg-white px-3 py-2 col-span-2 sm:col-span-1">
            <p className="text-[11px] text-ez-faint">Attendent leur avance</p>
            <p className="text-sm font-bold text-ez-text">{orders.filter(d => d.statut === 'attente_avance').length}</p>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 text-ez-faint animate-spin" /></div>
      ) : viewMode === 'kanban' ? (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 p-6 h-full min-w-max">
            {COLUMNS.map(col => {
              const colItems = deliveries.filter(d => d.statut === col.key)
              return (
                <div key={col.key} className="flex flex-col w-72 flex-shrink-0 bg-ez-bg border border-ez-border rounded-2xl overflow-hidden"
                  onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, col.key)}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-ez-border flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                      <p className="text-xs font-bold text-ez-text">{col.label}</p>
                    </div>
                    <span className="text-xs text-ez-faint font-bold">{colItems.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {colItems.length === 0
                      ? <div className="text-center py-8 text-ez-faint"><Package className="w-6 h-6 mx-auto mb-2 opacity-30" /><p className="text-xs">Aucune</p></div>
                      : colItems.map(d => <Card key={d.delivery_id} d={d} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-4 sm:px-6 pb-6 pt-4">
          {deliveries.length === 0
            ? <div className="text-center py-16 text-ez-faint"><Truck className="w-8 h-8 mx-auto mb-3 opacity-40" /><p className="text-sm">Aucune livraison enregistrée</p></div>
            : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {deliveries.map(d => {
                  const col = COLUMNS.find(c => c.key === d.statut)
                  return (
                    <div key={d.delivery_id} className="space-y-1">
                      <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ color: col?.color, borderColor: col?.color, backgroundColor: `${col?.color}12` }}>{col?.label}</span>
                      <Card d={d} />
                    </div>
                  )
                })}
              </div>}
        </div>
      )}

      {/* ── Steps ── */}
      <Modal open={!!s} onClose={() => setStep(null)} size="sm"
        title={!s ? '' : s.kind === 'avance' ? `Avance reçue — ${s.d.delivery_id}` : s.kind === 'livre' ? `Livrée — ${s.d.delivery_id}` : s.kind === 'retour' ? `${s.statut === 'retour' ? 'Refusée / retour' : 'Annuler'} — ${s.d.delivery_id}` : `Modifier — ${s.d.delivery_id}`}>
        {s && (
          <div className="space-y-4">
            {s.kind === 'avance' && (<>
              <p className="text-sm text-ez-subtle">L’avance arrive par virement. Avec un téléphone, le colis peut partir à partir de 300 DH.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Montant (MAD)" required><input type="number" min={0} className={inputClass} value={f.montant ?? ''} onChange={e => setField('montant', e.target.value)} /></Field>
                <Field label="Reçue le"><input type="date" className={inputClass} value={f.date ?? ''} max={today()} onChange={e => setField('date', e.target.value)} /></Field>
              </div>
              <Field label="Référence du virement"><input className={inputClass} value={f.ref ?? ''} onChange={e => setField('ref', e.target.value)} /></Field>
              <Btn variant="primary" className="w-full" loading={busy} disabled={!(Number(f.montant) >= 0)}
                onClick={() => send({ delivery_id: s.d.delivery_id, action: 'avance', montant: Number(f.montant), ref: f.ref, date: f.date }, 'Avance enregistrée ✓')}>Enregistrer</Btn>
            </>)}

            {s.kind === 'livre' && money && (<>
              <div className="rounded-xl bg-ez-bg px-4 py-3 text-sm space-y-1 tabular-nums">
                <p className="flex justify-between"><span className="text-ez-subtle">Vente</span><b>{formatMAD(s.d.montant_total)}</b></p>
                <p className="flex justify-between"><span className="text-ez-subtle">Avance reçue (virement)</span><span>{formatMAD(s.d.montant_avance)}</span></p>
                <p className="flex justify-between"><span className="text-ez-subtle">Encaissé par le livreur</span><span>{formatMAD(money.aEncaisser)}</span></p>
                <p className="flex justify-between border-t border-ez-border pt-1"><span className="text-ez-subtle">Le transporteur vous versera</span><b>{formatMAD(money.verse)}</b></p>
              </div>
              <Field label="Livrée le"><input type="date" className={inputClass} value={f.date ?? ''} max={today()} onChange={e => setField('date', e.target.value)} /></Field>
              <p className="text-xs text-ez-faint">La vente est enregistrée à cette date (payée par virement : elle ne touche pas la caisse){s.d.lead_id ? ` et le lead ${s.d.lead_id} passe en gagné` : ''}.</p>
              <Btn variant="primary" className="w-full" loading={busy}
                onClick={() => send({ delivery_id: s.d.delivery_id, statut: 'livre', date: f.date === today() ? undefined : f.date }, 'Livrée — vente enregistrée ✓')}>Confirmer la livraison</Btn>
            </>)}

            {s.kind === 'retour' && (<>
              <p className="text-sm text-ez-subtle">Les articles reviennent en stock ; il n’y a pas de vente.{s.d.lead_id && s.statut === 'retour' ? ` Le lead ${s.d.lead_id} passe en perdu (refus à la livraison).` : ''}</p>
              <Field label="Motif" required><input className={inputClass} placeholder={s.statut === 'retour' ? 'Ex. : client injoignable, a refusé le colis' : 'Ex. : le client a annulé'} value={f.motif ?? ''} onChange={e => setField('motif', e.target.value)} /></Field>
              {s.d.montant_avance > 0 && (
                <Field label={`L’avance de ${formatMAD(s.d.montant_avance)}`} required>
                  <div className="grid grid-cols-2 gap-2">
                    {([['remboursee', 'Remboursée'], ['gardee', 'Gardée']] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setField('decision', v)} className="py-2 rounded-xl text-xs font-bold border"
                        style={{ backgroundColor: f.decision === v ? primary : 'white', borderColor: f.decision === v ? primary : '#E8E5DE', color: f.decision === v ? 'white' : '#6B6860' }}>{l}</button>
                    ))}
                  </div>
                </Field>
              )}
              <Btn variant="danger" className="w-full" loading={busy} disabled={(f.motif ?? '').trim().length < 3 || (s.d.montant_avance > 0 && !f.decision)}
                onClick={() => send({ delivery_id: s.d.delivery_id, statut: s.statut, motif: f.motif, avance_decision: f.decision || undefined }, 'Commande clôturée — articles remis en stock')}>Confirmer</Btn>
            </>)}

            {s.kind === 'modifier' && (<>
              <Field label="Adresse"><input className={inputClass} value={f.adresse ?? ''} onChange={e => setField('adresse', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ville"><input className={inputClass} value={f.ville ?? ''} onChange={e => setField('ville', e.target.value)} /></Field>
                <Field label="Transporteur"><input className={inputClass} value={f.transporteur ?? ''} onChange={e => setField('transporteur', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2 items-end">
                <Field label="Frais de livraison"><input type="number" min={0} className={inputClass} value={f.frais ?? ''} onChange={e => setField('frais', e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-1 pb-0.5">
                  {([['client', 'Client'], ['boutique', 'Boutique']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setField('charge', v)} className="py-2 rounded-lg text-[11px] font-bold border"
                      style={{ backgroundColor: f.charge === v ? primary : 'white', borderColor: f.charge === v ? primary : '#E8E5DE', color: f.charge === v ? 'white' : '#6B6860' }}>{l}</button>
                  ))}
                </div>
              </div>
              <Field label="Notes"><input className={inputClass} value={f.notes ?? ''} onChange={e => setField('notes', e.target.value)} /></Field>
              <Btn variant="primary" className="w-full" loading={busy}
                onClick={() => send({ delivery_id: s.d.delivery_id, action: 'modifier', adresse: f.adresse, ville: f.ville, transporteur: f.transporteur, frais_livraison: Number(f.frais) || 0, frais_charge: f.charge, notes: f.notes }, 'Commande modifiée ✓')}>Enregistrer</Btn>
            </>)}
          </div>
        )}
      </Modal>

      {/* ── Delivery Label Modal ── */}
      {labelOf && (
        <DeliveryLabel open onClose={() => setLabelOf(null)} parcel={{
          delivery_id: labelOf.delivery_id, client_name: labelOf.client_name, client_phone: labelOf.client_phone,
          client_address: labelOf.client_address, ville: labelOf.ville,
          // what the agent collects: the order's rest + a fee paid by the client; old cards: their rest
          aEncaisser: labelOf.money ? labelOf.money.aEncaisser : Number(labelOf.montant_restant ?? 0),
          contenu: labelOf.delivery_items.map(i => `${i.label ?? i.device_id}${i.qty > 1 ? ` ×${i.qty}` : ''}`),
        }} />
      )}
    </div>
  )
}

const fr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
