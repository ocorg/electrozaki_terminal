'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser }          from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal }        from '@/lib/context/portal'
import { formatMAD }        from '@/lib/utils'
import { Modal, Btn, inputClass, selectClass } from '@/components/shared'
import { toast } from 'sonner'
import {
  Loader2, Plus, Package, Truck,
  List, LayoutGrid, Download, Printer,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────
interface DeliveryItem {
  device_type: string
  device_id:   string
  txn_id?:     string
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
}

// ─── Constants ────────────────────────────────────────────────
const COLUMNS = [
  { key: 'confirmation_encours', label: 'En confirmation', color: '#6B6860', terminal: false },
  { key: 'attente_avance',       label: "Att. avance",     color: '#F59E0B', terminal: false },
  { key: 'prepare',              label: 'Préparé',         color: '#3B82F6', terminal: false },
  { key: 'en_transit',           label: 'En transit',      color: '#8B5CF6', terminal: false },
  { key: 'livre',                label: 'Livré',           color: '#10B981', terminal: true  },
  { key: 'annule',               label: 'Annulé',          color: '#EF4444', terminal: true  },
  { key: 'retour',               label: 'Retour',          color: '#F97316', terminal: true  },
]

const SCENARIO_SHORT: Record<string, string> = {
  full_advance:    '100% avance',
  partial_advance: 'Avance partielle',
  on_delivery:     'À la livraison',
}

const EMPTY_FORM = {
  client_name:      '',
  client_phone:     '',
  client_address:   '',
  payment_scenario: 'on_delivery',
  montant_total:    '',
  montant_avance:   '0',
  payment_method:   'نقد',
  payment_ref:      '',
  notes:            '',
  device_type:      'هاتف',
  device_id:        '',
}

// ─── Delivery Label (40×30mm Phomemo) ────────────────────────
interface LabelProps {
  delivery:    Delivery
  device_name: string
  open:        boolean
  onClose:     () => void
}

function DeliveryLabel({ delivery, device_name, open, onClose }: LabelProps) {
  const labelRef          = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const W = 453; const H = 339; const W_MM = 40; const H_MM = 30

  async function capture(): Promise<Blob | null> {
    if (!labelRef.current) return null
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(labelRef.current, {
        scale:           1,
        useCORS:         true,
        backgroundColor: '#FFFFFF',
        width:           W,
        height:          H,
      })
      return await new Promise(res => canvas.toBlob(res, 'image/png'))
    } finally {
      setExporting(false)
    }
  }

  async function handlePDF() {
    const blob = await capture()
    if (!blob) return
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit:        'mm',
        format:      [W_MM, H_MM],
      })
      const imgData = await new Promise<string>(res => {
        const r = new FileReader()
        r.onload  = () => res(r.result as string)
        r.readAsDataURL(blob)
      })
      pdf.addImage(imgData, 'PNG', 0, 0, W_MM, H_MM)
      pdf.save(`delivery-${delivery.delivery_id}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  async function handlePrint() {
    const blob = await capture()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    win?.addEventListener('load', () => {
      win.print()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Étiquette de livraison" size="md">
      <div className="space-y-5">

        {/* Preview */}
        <div className="flex justify-center overflow-hidden w-full">
          <div style={{
            transform:       'scale(0.72)',
            transformOrigin: 'top center',
            marginBottom:    `-${Math.round(H * 0.28)}px`,
          }}>
            <div
              ref={labelRef}
              style={{
                width:           `${W}px`,
                height:          `${H}px`,
                backgroundColor: '#FFFFFF',
                border:          '1px solid #E8E5DE',
                borderRadius:    '6px',
                padding:         '14px',
                display:         'flex',
                flexDirection:   'column',
                justifyContent:  'space-between',
                fontFamily:      "'Barlow Condensed', Arial, sans-serif",
                overflow:        'hidden',
              }}
            >
              {/* Top row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#C9A440', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    LIVRAISON
                  </p>
                  <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#1A1A1A', lineHeight: 1.1 }}>
                    {delivery.delivery_id}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#EF4444', border: '1px solid #EF4444', padding: '2px 6px', borderRadius: '4px' }}>
                    ⚠ FRAGILE
                  </p>
                  <p style={{ fontSize: '7px', color: '#EF4444', marginTop: '2px' }}>
                    تعامل بحذر
                  </p>
                </div>
              </div>

              {/* Device */}
              <div>
                <p style={{ fontSize: '9px', color: '#6B6860', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Appareil
                </p>
                <p style={{ fontSize: '13px', fontWeight: 'bold', color: '#1A1A1A', lineHeight: 1.2 }}>
                  {device_name}
                </p>
              </div>

              {/* Client */}
              <div>
                <p style={{ fontSize: '9px', color: '#6B6860', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Destinataire / المستلم
                </p>
                <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#1A1A1A' }}>
                  {delivery.client_name}
                </p>
                <p style={{ fontSize: '10px', color: '#3A3835' }}>
                  {delivery.client_phone}
                </p>
                <p style={{ fontSize: '9px', color: '#6B6860', lineHeight: 1.3 }}>
                  {delivery.client_address}
                </p>
              </div>

              {/* Footer */}
              <p style={{ fontSize: '7px', color: '#B0ADA6' }}>
                Handle with Care / يُرجى التعامل بحذر — {new Date().toLocaleDateString('fr-FR')}
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-[#B0ADA6] text-center">
          Format: 40×30 mm — Compatible Phomemo
        </p>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handlePDF}
            disabled={exporting}
            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] text-sm text-[#6B6860] transition-all disabled:opacity-50"
          >
            {exporting
              ? <Loader2 className="w-4 h-4" style={{ animation: 'spin 1s linear infinite' }} />
              : <Download className="w-4 h-4" />
            }
            PDF
          </button>
          <button
            onClick={handlePrint}
            disabled={exporting}
            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] text-sm text-[#6B6860] transition-all disabled:opacity-50"
          >
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>

        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>Fermer</Btn>
        </div>

      </div>
    </Modal>
  )
}

// ─── Main Module ──────────────────────────────────────────────
interface DeliveriesModuleProps { storeId: string }

export default function DeliveriesModule({ storeId }: DeliveriesModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const primary      = portal.primaryColor

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading,    setLoading]    = useState(true)
  const [formOpen,   setFormOpen]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form,       setForm]       = useState({ ...EMPTY_FORM })
  const [viewMode,   setViewMode]   = useState<'kanban' | 'list'>('kanban')
  const [dragging,   setDragging]   = useState<string | null>(null)
  const [labelState, setLabelState] = useState<{
    delivery:    Delivery
    device_name: string
  } | null>(null)

  const fetchDeliveries = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/deliveries?store_id=${storeId}`)
      const json = await res.json()
      setDeliveries(json.data || [])
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])

  async function handleCreate() {
    if (
      !form.client_name   ||
      !form.client_phone  ||
      !form.client_address ||
      !form.montant_total ||
      !form.device_id
    ) {
      toast.error('Client, montant et appareil sont obligatoires')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/deliveries', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id:         storeId,
          client_name:      form.client_name,
          client_phone:     form.client_phone,
          client_address:   form.client_address,
          payment_scenario: form.payment_scenario,
          montant_total:    parseFloat(form.montant_total),
          montant_avance:   form.montant_avance ? parseFloat(form.montant_avance) : 0,
          payment_method:   form.payment_method,
          payment_ref:      form.payment_ref  || null,
          notes:            form.notes        || null,
          items: [{
            device_type: form.device_type,
            device_id:   form.device_id,
          }],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Livraison créée ✓')
      setFormOpen(false)
      setForm({ ...EMPTY_FORM })
      fetchDeliveries()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(delivery_id: string, newStatut: string) {
    try {
      const res = await fetch('/api/deliveries', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ delivery_id, statut: newStatut }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`→ ${COLUMNS.find(c => c.key === newStatut)?.label}`)
      fetchDeliveries()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  function onDragStart(delivery_id: string) {
    setDragging(delivery_id)
  }

  function onDrop(e: React.DragEvent, targetStatut: string) {
    e.preventDefault()
    if (!dragging) return

    const delivery = deliveries.find(d => d.delivery_id === dragging)
    if (!delivery) return

    const fromCol = COLUMNS.find(c => c.key === delivery.statut)
    const toCol   = COLUMNS.find(c => c.key === targetStatut)

    if (fromCol?.terminal || toCol?.terminal) {
      toast.error('Statut terminal — impossible de déplacer')
      setDragging(null)
      return
    }

    updateStatus(dragging, targetStatut)
    setDragging(null)
  }

  if (!['manager', 'owner'].includes(user?.role ?? '')) {
    return (
      <div className="p-6 text-sm text-[#6B6860]">
        Accès réservé aux managers et propriétaires.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 flex items-center justify-between border-b border-[#E8E5DE]">
        <div>
          <h1
            className="font-bold text-xl text-[#1A1A1A]"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.04em' }}
          >
            LIVRAISONS
          </h1>
          <p className="text-sm text-[#B0ADA6] mt-0.5">
            {deliveries.length} livraison{deliveries.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex border border-[#E8E5DE] rounded-xl overflow-hidden">
            {(['kanban', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all"
                style={{
                  backgroundColor: viewMode === v ? primary : 'white',
                  color:           viewMode === v ? 'white' : '#6B6860',
                }}
              >
                {v === 'kanban'
                  ? <LayoutGrid className="w-3.5 h-3.5" />
                  : <List      className="w-3.5 h-3.5" />
                }
                {v === 'kanban' ? 'Kanban' : 'Liste'}
              </button>
            ))}
          </div>
          <Btn
            variant="primary"
            onClick={() => setFormOpen(true)}
            style={{ backgroundColor: primary } as React.CSSProperties}
          >
            <Plus className="w-4 h-4" /> Nouvelle
          </Btn>
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2
            className="w-6 h-6 text-[#B0ADA6]"
            style={{ animation: 'spin 1s linear infinite' }}
          />
        </div>

      ) : viewMode === 'kanban' ? (
        /* ── Kanban ── */
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 p-6 h-full min-w-max">
            {COLUMNS.map(col => {
              const colItems = deliveries.filter(d => d.statut === col.key)
              return (
                <div
                  key={col.key}
                  className="flex flex-col w-64 flex-shrink-0 bg-[#F8F7F4] border border-[#E8E5DE] rounded-2xl overflow-hidden"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => onDrop(e, col.key)}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E5DE] flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: col.color }}
                      />
                      <p className="text-xs font-bold text-[#1A1A1A]">{col.label}</p>
                    </div>
                    <span className="text-xs text-[#B0ADA6] font-bold">
                      {colItems.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {colItems.length === 0 ? (
                      <div className="text-center py-8 text-[#B0ADA6]">
                        <Package className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        <p className="text-xs">Aucune</p>
                      </div>
                    ) : (
                      colItems.map(d => (
                        <div
                          key={d.delivery_id}
                          draggable={!col.terminal}
                          onDragStart={() => onDragStart(d.delivery_id)}
                          className={`bg-white border border-[#E8E5DE] rounded-xl p-3 space-y-2 shadow-sm ${
                            !col.terminal
                              ? 'cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow'
                              : ''
                          }`}
                        >
                          {/* Card header */}
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-[#1A1A1A]">
                                {d.delivery_id}
                              </p>
                              <p className="text-xs text-[#6B6860] truncate">
                                {d.client_name}
                              </p>
                              <p className="text-[10px] text-[#B0ADA6]">
                                {d.client_phone}
                              </p>
                            </div>
                            <span
                              className="text-[9px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ml-1"
                              style={{
                                color:           col.color,
                                borderColor:     col.color,
                                backgroundColor: `${col.color}10`,
                              }}
                            >
                              {d.delivery_items.length}×
                            </span>
                          </div>

                          {/* Amounts */}
                          <div className="flex items-center justify-between">
                            <span
                              className="text-xs font-bold"
                              style={{ color: primary }}
                            >
                              {formatMAD(d.montant_total)}
                            </span>
                            {d.montant_avance > 0 && (
                              <span className="text-[10px] text-amber-600">
                                +{formatMAD(d.montant_avance)}
                              </span>
                            )}
                          </div>

                          {/* Scenario badge */}
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F8F7F4] border border-[#E8E5DE] text-[#6B6860]">
                            {SCENARIO_SHORT[d.payment_scenario]}
                          </span>

                          {/* Label button */}
                          <button
                            onClick={() => setLabelState({
                              delivery:    d,
                              device_name: d.delivery_items[0]?.device_id ?? '—',
                            })}
                            className="w-full text-[10px] py-1 rounded-lg border border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4] transition-all flex items-center justify-center gap-1"
                          >
                            <Printer className="w-3 h-3" /> Étiquette
                          </button>

                          {/* Quick status actions */}
                          {!col.terminal && (
                            <div className="flex gap-1 flex-wrap">
                              {COLUMNS
                                .filter(c => c.key !== col.key && !c.terminal)
                                .map(nc => (
                                  <button
                                    key={nc.key}
                                    onClick={() => updateStatus(d.delivery_id, nc.key)}
                                    className="text-[9px] px-1.5 py-0.5 rounded-lg border border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4] transition-all whitespace-nowrap"
                                  >
                                    → {nc.label.split(' ')[0]}
                                  </button>
                                ))
                              }
                              <button
                                onClick={() => updateStatus(d.delivery_id, 'livre')}
                                className="text-[9px] px-1.5 py-0.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-all"
                              >
                                ✓ Livré
                              </button>
                              <button
                                onClick={() => updateStatus(d.delivery_id, 'annule')}
                                className="text-[9px] px-1.5 py-0.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-all"
                              >
                                ✗ Annuler
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      ) : (
        /* ── List view ── */
        <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            {/* Table header */}
            <div
              className="grid border-b border-[#F2F0EB] px-5 py-3 text-[10px] font-bold text-[#B0ADA6] uppercase tracking-widest"
              style={{ gridTemplateColumns: '1fr 1.5fr 0.5fr 1fr 1fr 1fr' }}
            >
              <span>ID</span>
              <span>Client</span>
              <span>Art.</span>
              <span>Scénario</span>
              <span>Statut</span>
              <span>Total</span>
            </div>

            {deliveries.length === 0 ? (
              <div className="text-center py-16 text-[#B0ADA6]">
                <Truck className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Aucune livraison enregistrée</p>
              </div>
            ) : (
              deliveries.map(d => {
                const col = COLUMNS.find(c => c.key === d.statut)
                return (
                  <div
                    key={d.delivery_id}
                    className="grid items-center px-5 py-3.5 border-b border-[#F2F0EB] last:border-0 hover:bg-[#F8F7F4] transition-all"
                    style={{ gridTemplateColumns: '1fr 1.5fr 0.5fr 1fr 1fr 1fr' }}
                  >
                    <p className="text-xs font-mono font-bold text-[#1A1A1A]">
                      {d.delivery_id}
                    </p>
                    <div>
                      <p className="text-xs font-bold text-[#1A1A1A]">{d.client_name}</p>
                      <p className="text-[10px] text-[#B0ADA6]">{d.client_phone}</p>
                    </div>
                    <p className="text-xs text-[#6B6860]">
                      {d.delivery_items.length}
                    </p>
                    <p className="text-[10px] text-[#6B6860]">
                      {SCENARIO_SHORT[d.payment_scenario]}
                    </p>
                    <span
                      className="inline-flex items-center text-[10px] font-bold px-2 py-1 rounded-full border w-fit"
                      style={{
                        color:           col?.color,
                        borderColor:     col?.color,
                        backgroundColor: `${col?.color}12`,
                      }}
                    >
                      {col?.label}
                    </span>
                    <p className="text-sm font-bold" style={{ color: primary }}>
                      {formatMAD(d.montant_total)}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── Create Modal ── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Nouvelle livraison"
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">

            <div className="col-span-2">
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Nom client *
              </label>
              <input
                className={inputClass}
                value={form.client_name}
                onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
                placeholder="Nom complet"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Téléphone *
              </label>
              <input
                className={inputClass}
                value={form.client_phone}
                onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))}
                placeholder="06XXXXXXXX"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Scénario paiement *
              </label>
              <select
                className={selectClass}
                value={form.payment_scenario}
                onChange={e => setForm(p => ({ ...p, payment_scenario: e.target.value }))}
              >
                <option value="full_advance">100% à la création</option>
                <option value="partial_advance">Avance + reste à la livraison</option>
                <option value="on_delivery">Paiement à la livraison</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Adresse de livraison *
              </label>
              <input
                className={inputClass}
                value={form.client_address}
                onChange={e => setForm(p => ({ ...p, client_address: e.target.value }))}
                placeholder="Rue, ville..."
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Montant total (MAD) *
              </label>
              <input
                type="number"
                className={inputClass}
                value={form.montant_total}
                onChange={e => setForm(p => ({ ...p, montant_total: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            {form.payment_scenario !== 'on_delivery' && (
              <div>
                <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                  Avance reçue (MAD)
                </label>
                <input
                  type="number"
                  className={inputClass}
                  value={form.montant_avance}
                  onChange={e => setForm(p => ({ ...p, montant_avance: e.target.value }))}
                />
              </div>
            )}

            <div className="col-span-2">
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Appareil *
              </label>
              <div className="flex gap-2">
                <select
                  className={selectClass}
                  style={{ width: '150px', flexShrink: 0 }}
                  value={form.device_type}
                  onChange={e => setForm(p => ({ ...p, device_type: e.target.value }))}
                >
                  <option value="هاتف">Téléphone</option>
                  <option value="لابتوب">Laptop</option>
                </select>
                <input
                  className={inputClass}
                  value={form.device_id}
                  onChange={e => setForm(p => ({ ...p, device_id: e.target.value }))}
                  placeholder="PHO-0001 ou LAP-0001"
                />
              </div>
            </div>

            <div className="col-span-2">
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Notes
              </label>
              <textarea
                className={`${inputClass} resize-none`}
                rows={2}
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Instructions, remarques..."
              />
            </div>

          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary" onClick={() => setFormOpen(false)}>
              Annuler
            </Btn>
            <Btn
              variant="primary"
              loading={submitting}
              onClick={handleCreate}
              style={{ backgroundColor: primary } as React.CSSProperties}
            >
              Créer la livraison
            </Btn>
          </div>
        </div>
      </Modal>

      {/* ── Delivery Label Modal ── */}
      {labelState && (
        <DeliveryLabel
          delivery={labelState.delivery}
          device_name={labelState.device_name}
          open={!!labelState}
          onClose={() => setLabelState(null)}
        />
      )}

    </div>
  )
}