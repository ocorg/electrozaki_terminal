'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '@/lib/data/api'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, EmptyState, Select } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Reparation, RepairStatus } from '@/types/database'
import {
  Wrench, Plus, Clock, User, Phone,
  Calendar, ChevronRight, Loader2, Package,
  CheckCircle, RefreshCw, Search, X,
  MessageCircle, AlertTriangle, DollarSign,
  FileText, Ban, Camera, ThumbsUp, ThumbsDown, Monitor, Headphones,
} from 'lucide-react'
import { codeLabel } from '@/lib/codes'
import { PROBLEMS_BY_KIND, REPAIR_KINDS, CONSULTATION_STATUS_LABEL, type RepairKind, type RepairProblem } from '@/lib/repairs'
import { uploadFile } from '@/lib/upload'
import { storeDate } from '@/lib/time'

const TRACK_URL = `${process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'https://electrozaki-storefront.vercel.app'}/reparation/suivi`
const KIND_ICON: Record<RepairKind, React.ComponentType<{ className?: string }>> = {
  materiel: Wrench, logiciel: Monitor, consultation: Headphones,
}

// ─── Column definitions ───────────────────────────────────────
const COLUMNS: {
  status:   RepairStatus
  labelFr:  string
  labelAr:  string
  color:    string
  bg:       string
  border:   string
  dot:      string
  icon:     React.ComponentType<{ className?: string }>
}[] = [
  {
    status:  'en_attente',
    labelFr: 'En attente',
    labelAr: 'معلق',
    color:   'text-amber-700',
    bg:      'bg-amber-50',
    border:  'border-amber-200',
    dot:     'bg-amber-500',
    icon:    Clock,
  },
  {
    status:  'devis_envoye',
    labelFr: 'Devis envoyé',
    labelAr: 'تم إرسال السعر',
    color:   'text-violet-700',
    bg:      'bg-violet-50',
    border:  'border-violet-200',
    dot:     'bg-violet-500',
    icon:    FileText,
  },
  {
    status:  'en_cours',
    labelFr: 'En cours',
    labelAr: 'قيد الإصلاح',
    color:   'text-blue-700',
    bg:      'bg-blue-50',
    border:  'border-blue-200',
    dot:     'bg-blue-500',
    icon:    Wrench,
  },
  {
    status:  'pret',
    labelFr: 'Prêt',
    labelAr: 'جاهز',
    color:   'text-emerald-700',
    bg:      'bg-emerald-50',
    border:  'border-emerald-200',
    dot:     'bg-emerald-500',
    icon:    CheckCircle,
  },
  {
    status:  'recupere',
    labelFr: 'Récupéré',
    labelAr: 'تم الاستلام',
    color:   'text-slate-500',
    bg:      'bg-slate-50',
    border:  'border-slate-200',
    dot:     'bg-slate-400',
    icon:    Package,
  },
]

// ─── Types ────────────────────────────────────────────────────
interface RepairWithExtras extends Reparation {
  type_reparation:   RepairKind
  problemes:         RepairProblem[]
  mode_paiement?:    'especes' | 'virement' | null
  photos_depot:      string[]
  devis_envoye_le?:  string | null
  devis_accepte_le?: string | null
  devis_refuse_le?:  string | null
  clients?: { nom: string; telephone: string } | null
  reparations_parts?: { part_id: string; description: string; cout: number }[]
  fariq_rep?: number
  parts_cost?: number
}

const EMPTY_FORM = {
  type_reparation:  'materiel' as RepairKind,
  problemes:        [] as RepairProblem[],
  mode_paiement:    'especes' as 'especes' | 'virement',
  photos_depot:     [] as string[],
  client_nom:       '',
  client_tel:       '',
  device_type_libre: '',
  device_serial:    '',
  marque:           '',
  model:            '',
  probleme:         '',
  diagnostic:       '',
  cout_reparation:  '',
  avance_rep:       '',
  technicien:       '',
  technicien_id:    '',
  date_prevue:      '',
  notes:            '',
}

interface RepairsModuleProps {
  storeId: string
}

function AddPartForm({ repId, isAr, onAdded }: { repId: string; isAr: boolean; onAdded: () => void }) {
  const [desc, setDesc]       = useState('')
  const [cout, setCout]       = useState('')
  const [fournisseur, setFournisseur] = useState('')
  const [adding, setAdding]   = useState(false)
  const [open, setOpen]       = useState(false)

  async function handleAdd() {
    if (!desc || !cout) return
    setAdding(true)
    try {
      const res  = await fetch('/api/repairs/parts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rep_id: repId, description: desc, cout: Number(cout), fournisseur: fournisseur || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم إضافة القطعة ✓' : 'Pièce ajoutée ✓')
      setDesc(''); setCout(''); setFournisseur(''); setOpen(false)
      onAdded()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="border-t border-[#E8E5DE] pt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest">
          {isAr ? 'إضافة قطعة' : 'Ajouter une pièce'}
        </p>
        <button onClick={() => setOpen(!open)}
          className="text-xs text-[#C9A440] font-medium hover:underline">
          {open ? (t(isAr, 'common.cancel')) : (isAr ? '+ إضافة' : '+ Ajouter')}
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          <input className="w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm"
            placeholder={isAr ? 'وصف القطعة *' : 'Description *'}
            value={desc} onChange={e => setDesc(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" className="border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm"
              placeholder={isAr ? 'التكلفة (درهم) *' : 'Coût (MAD) *'}
              value={cout} onChange={e => setCout(e.target.value)} />
            <input className="border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm"
              placeholder={t(isAr, 'common.supplier')}
              value={fournisseur} onChange={e => setFournisseur(e.target.value)} />
          </div>
          <button onClick={handleAdd} disabled={adding || !desc || !cout}
            className="w-full py-2 rounded-xl bg-[#C9A440] text-white text-sm font-bold disabled:opacity-50">
            {adding ? '...' : (t(isAr, 'common.add'))}
          </button>
        </div>
      )}
    </div>
  )
}

export default function RepairsModule({ storeId }: RepairsModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canEdit      = user?.role !== undefined

  const usersQ    = useApi<{ id: string; display_name: string; is_active: boolean }[]>('/api/users?mode=names')
  const staffList = useMemo(() => (usersQ.data ?? []).filter(u => u.is_active), [usersQ.data])

  const [search, setSearch]         = useState('')
  // All the store's repairs are cached; search applies instantly here
  const repairsQ = useApi<RepairWithExtras[]>(`/api/repairs?store_id=${storeId}`)
  const loading  = repairsQ.isLoading
  const [manualRefresh, setManualRefresh] = useState(false)
  useEffect(() => { if (repairsQ.error) showError(repairsQ.error.message) }, [repairsQ.error])
  const repairs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return repairsQ.data ?? []
    return (repairsQ.data ?? []).filter(r => {
      const x = r as unknown as Record<string, string | null | undefined>
      return [x.model, x.marque, x.device_serial].some(v => v?.toLowerCase().includes(q))
    })
  }, [repairsQ.data, search])
  const [formOpen, setFormOpen]     = useState(false)
  const [detailRep, setDetailRep]   = useState<RepairWithExtras | null>(null)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [statusLoading, setStatusLoading] = useState<string | null>(null)

  const fetchRepairs = useCallback(async () => {
    setManualRefresh(true)
    try { await repairsQ.refresh() } finally { setManualRefresh(false) }
  }, [repairsQ])

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  /** Column label, worded for an online consultation when relevant. */
  function statusLabel(status: string, kind?: RepairKind) {
    if (kind === 'consultation' && CONSULTATION_STATUS_LABEL[status]) {
      return isAr ? CONSULTATION_STATUS_LABEL[status].ar : CONSULTATION_STATUS_LABEL[status].fr
    }
    const col = COLUMNS.find(c => c.status === status)
    return col ? (isAr ? col.labelAr : col.labelFr) : status
  }

  const isManager = user?.role === 'gerant' || user?.role === 'proprietaire'
  const [photoUploading, setPhotoUploading] = useState(false)
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    const room = 3 - form.photos_depot.length
    if (room <= 0) { showError(isAr ? '3 صور كحد أقصى' : '3 photos maximum'); return }
    setPhotoUploading(true)
    try {
      const urls: string[] = []
      for (const f of Array.from(files).slice(0, room)) urls.push(await uploadFile(f, 'repairs'))
      setForm(prev => ({ ...prev, photos_depot: [...prev.photos_depot, ...urls] }))
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setPhotoUploading(false)
    }
  }

  // ── Status progression ────────────────────────────────────
  function getNextStatus(current: RepairStatus): RepairStatus | null {
    // A sent quote waits for the customer's answer (accepté / refusé).
    if (current === 'devis_envoye') return null
    const order: RepairStatus[] = ['en_attente', 'en_cours', 'pret', 'recupere']
    const idx = order.indexOf(current)
    return idx < order.length - 1 ? order[idx + 1] : null
  }

  async function advanceStatus(rep: RepairWithExtras) {
    const next = getNextStatus(rep.statut)
    if (!next) return
    setStatusLoading(rep.rep_id)
    try {
      const updates: Record<string, unknown> = { rep_id: rep.rep_id, statut: next }
      if (next === 'recupere') {
        updates.date_livraison = storeDate()
      }
      const res  = await fetch('/api/repairs', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(updates),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم التحديث ✓' : 'Statut mis à jour ✓')
      await fetchRepairs()
      // Update detail view if open
      if (detailRep?.rep_id === rep.rep_id) {
        setDetailRep(prev => prev ? { ...prev, statut: next } : null)
      }
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setStatusLoading(null)
    }
  }

  async function patchRepair(rep: RepairWithExtras, body: Record<string, unknown>) {
    try {
      const res  = await fetch('/api/repairs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ rep_id: rep.rep_id, ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setDetailRep(prev => prev && prev.rep_id === rep.rep_id ? { ...prev, ...body } as RepairWithExtras : prev)
      await fetchRepairs()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  async function answerQuote(rep: RepairWithExtras, decision: 'accepte' | 'refuse') {
    try {
      const res  = await fetch('/api/repairs/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ rep_id: rep.rep_id, decision }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(decision === 'accepte'
        ? (isAr ? 'تم قبول السعر — قيد الإصلاح' : 'Devis accepté — réparation en cours')
        : (isAr ? 'تم رفض السعر — الجهاز للإرجاع' : 'Devis refusé — appareil à restituer'))
      setDetailRep(null)
      await fetchRepairs()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  const [cancelRep, setCancelRep]       = useState<RepairWithExtras | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling]     = useState(false)
  async function confirmCancel() {
    if (!cancelRep) return
    setCancelling(true)
    try {
      const res  = await fetch('/api/repairs/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ rep_id: cancelRep.rep_id, motif: cancelReason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم إلغاء التذكرة' : 'Ticket annulé')
      setCancelRep(null); setCancelReason(''); setDetailRep(null)
      await fetchRepairs()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  // ── Create repair ─────────────────────────────────────────
  async function handleSubmit() {
    const isConsult = form.type_reparation === 'consultation'
    if ((!form.model && !isConsult) || (!form.probleme && form.problemes.length === 0)) {
      showError(isAr ? 'الموديل والمشكلة مطلوبان' : 'Modèle et problème obligatoires')
      return
    }
    setSubmitting(true)
    try {
      // Find/create client if phone provided
      let clientId: string | undefined
      if (form.client_tel) {
        const cRes  = await fetch('/api/clients', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            nom:       form.client_nom || form.client_tel,
            telephone: form.client_tel,
            store_id:  storeId,
          }),
        })
        const cJson = await cRes.json()
        clientId    = cJson.data?.client_id
      }

      const res  = await fetch('/api/repairs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          store_id:          storeId,
          client_id:         clientId,
          device_type_libre: form.device_type_libre || null,
          device_serial:     form.device_serial     || null,
          marque:            form.marque            || null,
          model:             form.model || 'Consultation',
          type_reparation:   form.type_reparation,
          problemes:         form.problemes,
          mode_paiement:     form.mode_paiement,
          photos_depot:      form.photos_depot,
          probleme:          [form.problemes.map(p => codeLabel('repair_problem', p, 'fr')).join(', '), form.probleme.trim()]
                               .filter(Boolean).join(' — '),
          diagnostic:        form.diagnostic        || null,
          cout_reparation:   form.cout_reparation   ? Number(form.cout_reparation)  : 0,
          avance_rep:        form.avance_rep        ? Number(form.avance_rep)        : 0,
          technicien:        form.technicien        || null,
          technicien_id:     form.technicien_id     || null,
          date_prevue:       form.date_prevue       || null,
          statut:            'en_attente',
          date_depot:        storeDate(),
          notes:             form.notes             || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل الإصلاح ✓' : 'Réparation enregistrée ✓')
      setFormOpen(false)
      setForm({ ...EMPTY_FORM })
      await fetchRepairs()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Group by status ───────────────────────────────────────
  const byStatus = COLUMNS.reduce((acc, col) => {
    acc[col.status] = repairs.filter(r => r.statut === col.status)
    return acc
  }, {} as Record<RepairStatus, RepairWithExtras[]>)

  const activeCount = repairs.filter(r => r.statut !== 'recupere').length

  // Phone: one column at a time, chosen from tabs (the board scrolls sideways otherwise)
  const [mobileCol, setMobileCol] = useState<RepairStatus>(COLUMNS[0].status)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A1A1A] tracking-wide">
              {t(isAr, 'common.repairs')}
            </h1>
            <p className="text-[#6B6860] text-sm mt-0.5">
              {isAr
                ? `${activeCount} إصلاح نشط`
                : `${activeCount} réparation${activeCount !== 1 ? 's' : ''} active${activeCount !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchRepairs}
              disabled={manualRefresh}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${manualRefresh ? 'animate-spin' : ''}`} />
            </button>
            <Btn
              variant="primary"
              onClick={() => setFormOpen(true)}
              style={{ backgroundColor: primary } as React.CSSProperties}
            >
              <Plus className="w-4 h-4" />
              {t(isAr, 'common.newRepair')}
            </Btn>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
          <input
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
            placeholder={isAr ? 'بحث بالموديل، الماركة، الرقم...' : 'Rechercher modèle, marque, série...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
            onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Phone: status tabs ──────────────────────────── */}
      {!loading && (
        <div className="lg:hidden flex-shrink-0 px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {COLUMNS.map(col => {
              const on = mobileCol === col.status
              const n  = (byStatus[col.status] || []).length
              return (
                <button key={col.status} type="button" onClick={() => setMobileCol(col.status)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap transition-all ${on ? `${col.bg} ${col.border} ${col.color}` : 'bg-white border-[#E8E5DE] text-[#6B6860]'}`}>
                  {statusLabel(col.status)}
                  <span className={`text-xs font-bold px-1.5 rounded-full ${on ? 'bg-white/70' : 'bg-[#F2F0EB]'}`}>{n}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Kanban board ────────────────────────────────── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 sm:px-6 pb-6">
        {loading ? (
          <div className="flex gap-4 h-full">
            {COLUMNS.map(col => (
              <div key={col.status} className="w-72 flex-shrink-0 bg-white border border-[#E8E5DE] rounded-2xl p-4 space-y-3">
                <div className="h-5 bg-[#F2F0EB] rounded animate-pulse w-1/2" />
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-28 bg-[#F8F7F4] rounded-xl animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 h-full lg:min-w-max">
            {COLUMNS.map(col => {
              const items   = byStatus[col.status] || []
              const ColIcon = col.icon
              return (
                <div
                  key={col.status}
                  className={`w-full lg:w-72 flex-shrink-0 flex-col rounded-2xl border ${col.bg} ${col.border} overflow-hidden ${mobileCol === col.status ? 'flex' : 'hidden lg:flex'}`}
                >
                  {/* Column header */}
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${col.border}`}>
                    <div className="flex items-center gap-2">
                      <ColIcon className={`w-4 h-4 ${col.color}`} />
                      <span className={`font-display font-bold text-sm tracking-wide ${col.color}`}>
                        {statusLabel(col.status)}
                      </span>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.color} bg-white/60`}>
                      {items.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {items.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-center">
                        <p className={`text-xs ${col.color} opacity-50`}>
                          {isAr ? 'لا يوجد' : 'Aucun'}
                        </p>
                      </div>
                    ) : (
                      items.map(rep => {
                        const nextStatus = getNextStatus(rep.statut)
                        const isOverdue  = rep.date_prevue && rep.date_prevue < new Date().toISOString().split('T')[0]
                          && rep.statut !== 'recupere'

                        return (
                          <div
                            key={rep.rep_id}
                            className="bg-white rounded-xl border border-white shadow-sm hover:shadow-md transition-all cursor-pointer"
                            onClick={() => setDetailRep(rep)}
                          >
                            <div className="p-3 space-y-2">
                              {/* Device */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-[#1A1A1A] truncate">
                                    {rep.marque ? `${rep.marque} ` : ''}{rep.model}
                                  </p>
                                  {rep.device_serial && (
                                    <p className="text-xs text-[#B0ADA6] font-mono truncate">
                                      {rep.device_serial}
                                    </p>
                                  )}
                                </div>
                                {isOverdue && (
                                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                )}
                              </div>

                              {/* Kind + problem */}
                              {rep.type_reparation !== 'materiel' && (() => {
                                const KindIcon = KIND_ICON[rep.type_reparation]
                                return (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F2F0EB] text-[#6B6860]">
                                    <KindIcon className="w-3 h-3" />{codeLabel('repair_kind', rep.type_reparation, isAr ? 'ar' : 'fr')}
                                  </span>
                                )
                              })()}
                              <p className="text-xs text-[#6B6860] line-clamp-2">{rep.probleme}</p>
                              {rep.statut === 'devis_envoye' && (
                                <p className="text-[11px] font-medium text-violet-700">
                                  {isAr ? 'في انتظار رد العميل' : 'En attente de la réponse du client'}
                                </p>
                              )}
                              {rep.devis_refuse_le && rep.statut !== 'recupere' && (
                                <p className="text-[11px] font-medium text-red-600">{isAr ? 'رفض العميل السعر — للإرجاع' : 'Devis refusé — à restituer'}</p>
                              )}

                              {/* Client */}
                              {rep.clients && (
                                <div className="flex items-center gap-1.5 text-xs text-[#B0ADA6]">
                                  <User className="w-3 h-3 flex-shrink-0" />
                                  <span className="truncate">{rep.clients.nom}</span>
                                </div>
                              )}

                              {/* Dates */}
                              <div className="flex items-center gap-1.5 text-xs text-[#B0ADA6]">
                                <Calendar className="w-3 h-3 flex-shrink-0" />
                                <span>{formatDate(rep.date_depot)}</span>
                                {rep.date_prevue && (
                                  <>
                                    <ChevronRight className="w-3 h-3" />
                                    <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
                                      {formatDate(rep.date_prevue)}
                                    </span>
                                  </>
                                )}
                              </div>

                              {/* Cost */}
                              {(rep.cout_reparation ?? 0) > 0 && (
                                <div className="flex items-center justify-between pt-1 border-t border-[#F2F0EB]">
                                  <div className="flex items-center gap-1 text-xs text-[#6B6860]">
                                    <DollarSign className="w-3 h-3" />
                                    {formatMAD(rep.cout_reparation ?? 0)}
                                  </div>
                                  {(rep.fariq_rep ?? 0) > 0 && (
                                    <span className="text-xs text-amber-600 font-medium">
                                      {t(isAr, 'common.remaining')}: {formatMAD(rep.fariq_rep ?? 0)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Advance button */}
                            {nextStatus && canEdit && (
                              <button
                                onClick={e => { e.stopPropagation(); advanceStatus(rep) }}
                                disabled={statusLoading === rep.rep_id}
                                className={`w-full flex items-center justify-center gap-2 py-2 text-xs font-bold border-t transition-all rounded-b-xl ${col.border} ${col.color} hover:bg-white/80`}
                              >
                                {statusLoading === rep.rep_id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <ChevronRight className="w-3 h-3" />
                                }
                                {`→ ${statusLabel(nextStatus, rep.type_reparation)}`}
                              </button>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Detail modal ────────────────────────────────── */}
      {detailRep && (
        <Modal
          open={!!detailRep}
          onClose={() => setDetailRep(null)}
          title={`${detailRep.marque ?? ''} ${detailRep.model} — ${detailRep.rep_id}`}
          size="md"
        >
          <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>
            {/* Status */}
            <div className="flex items-center gap-3">
              {COLUMNS.find(c => c.status === detailRep.statut) && (() => {
                const col = COLUMNS.find(c => c.status === detailRep.statut)!
                return (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border ${col.bg} ${col.border} ${col.color}`}>
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    {statusLabel(detailRep.statut, detailRep.type_reparation)}
                  </span>
                )
              })()}
              <span className="text-xs text-[#B0ADA6]">{formatDate(detailRep.date_depot)}</span>
              <span className="ms-auto text-xs font-medium text-[#6B6860]">
                {codeLabel('repair_kind', detailRep.type_reparation, isAr ? 'ar' : 'fr')}
              </span>
            </div>
            {detailRep.problemes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detailRep.problemes.map(p => (
                  <span key={p} className="px-2 py-0.5 rounded-full text-xs bg-[#F2F0EB] text-[#1A1A1A]">
                    {codeLabel('repair_problem', p, isAr ? 'ar' : 'fr')}
                  </span>
                ))}
              </div>
            )}
            {detailRep.photos_depot.length > 0 && (
              <div className="flex gap-2">
                {detailRep.photos_depot.map(url => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                     className="w-20 h-20 rounded-lg overflow-hidden border border-[#E8E5DE] bg-[#F8F7F4]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={isAr ? 'صورة الإيداع' : 'Photo au dépôt'} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            )}

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={<Wrench className="w-4 h-4" />}
                label={isAr ? 'المشكلة' : 'Problème'}
                value={detailRep.probleme} />
              {detailRep.diagnostic && (
                <InfoRow icon={<Wrench className="w-4 h-4" />}
                  label={isAr ? 'التشخيص' : 'Diagnostic'}
                  value={detailRep.diagnostic} />
              )}
              {detailRep.clients && (
                <>
                  <InfoRow icon={<User className="w-4 h-4" />}
                    label={t(isAr, 'common.client')}
                    value={detailRep.clients.nom} />
                  <InfoRow icon={<Phone className="w-4 h-4" />}
                    label={t(isAr, 'common.phoneField')}
                    value={detailRep.clients.telephone} />
                </>
              )}
              {detailRep.technicien && (
                <InfoRow icon={<User className="w-4 h-4" />}
                  label={isAr ? 'التقني' : 'Technicien'}
                  value={detailRep.technicien} />
              )}
              {detailRep.date_prevue && (
                <InfoRow icon={<Calendar className="w-4 h-4" />}
                  label={isAr ? 'التسليم المتوقع' : 'Date prévue'}
                  value={formatDate(detailRep.date_prevue)} />
              )}
            </div>

            {/* Financial summary */}
            {(detailRep.cout_reparation ?? 0) > 0 && (
              <div className="bg-[#F8F7F4] rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3">
                  {isAr ? 'المالية' : 'Financier'}
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B6860]">{isAr ? 'تكلفة الإصلاح' : 'Coût réparation'}</span>
                  <span className="font-bold">{formatMAD(detailRep.cout_reparation ?? 0)}</span>
                </div>
                {(detailRep.avance_rep ?? 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B6860]">{isAr ? 'التسبيق' : 'Avance reçue'}</span>
                    <span className="font-bold text-emerald-600">- {formatMAD(detailRep.avance_rep ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[#6B6860]">{isAr ? 'طريقة الأداء' : 'Payé par'}</span>
                  <Select
                    className="bg-white border border-[#E8E5DE] rounded-lg px-2 py-1 text-sm"
                    value={detailRep.mode_paiement ?? 'especes'}
                    onChange={e => patchRepair(detailRep, { mode_paiement: e.target.value })}
                  >
                    <option value="especes">{isAr ? 'نقداً' : 'Espèces'}</option>
                    <option value="virement">{isAr ? 'تحويل بنكي' : 'Virement'}</option>
                  </Select>
                </div>
                {(detailRep.fariq_rep ?? 0) !== 0 && (
                  <div className="flex justify-between text-sm pt-2 border-t border-[#E8E5DE]">
                    <span className="font-bold text-[#1A1A1A]">{t(isAr, 'common.remainingToPay')}</span>
                    <span className={`font-bold ${(detailRep.fariq_rep ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {formatMAD(detailRep.fariq_rep ?? 0)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Parts */}
            {detailRep.reparations_parts && detailRep.reparations_parts.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3">
                  {isAr ? 'القطع المستخدمة' : 'Pièces utilisées'}
                </p>
                <div className="space-y-2">
                  {detailRep.reparations_parts.map(part => (
                    <div key={part.part_id} className="flex justify-between items-center py-2 border-b border-[#F2F0EB] text-sm last:border-0">
                      <span className="text-[#1A1A1A]">{part.description}</span>
                      <span className="font-bold text-[#6B6860]">{formatMAD(part.cout)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Add part inline form ── */}
            <AddPartForm
              repId={detailRep.rep_id}
              isAr={isAr}
              onAdded={() => fetchRepairs()}
            />

            {/* Notes */}
            {detailRep.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-bold text-amber-700 mb-1">
                  {t(isAr, 'common.notes')}
                </p>
                <p className="text-sm text-amber-800">{detailRep.notes}</p>
              </div>
            )}

            {/* WhatsApp notification hint */}
            {detailRep.statut === 'pret' && detailRep.clients && (() => {
              const phone = detailRep.clients!.telephone.replace(/\D/g, '').slice(-9)
              const name  = detailRep.clients!.nom
              const device = `${detailRep.marque ?? ''} ${detailRep.model}`.trim()
              const repId = detailRep.rep_id
              const track = `${TRACK_URL}?ref=${repId}`
              const msg   = detailRep.type_reparation === 'consultation'
                ? `Bonjour ${name}, votre consultation Electro Zaki (${repId}) est terminée. Suivi : ${track}`
                : isAr
                ? `مرحباً ${name}، جهازك ${device} جاهز للاستلام (${repId}). التتبع : ${track}`
                : `Bonjour ${name}, votre appareil ${device} est prêt à être récupéré chez Electro Zaki (réf. ${repId}). Suivi : ${track}`
              const waUrl = `https://wa.me/212${phone}?text=${encodeURIComponent(msg)}`
              async function markNotified() {
                await fetch('/api/repairs', {
                  method:  'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify({ rep_id: repId, whatsapp_notified: true }),
                })
                fetchRepairs()
              }
              return (
                <div className="space-y-2">
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={markNotified}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-all"
                  >
                    <MessageCircle className="w-4 h-4" />
                    {isAr ? 'إشعار العميل عبر واتساب' : 'Notifier le client via WhatsApp'}
                  </a>
                  {detailRep.whatsapp_notified && (
                    <p className="text-center text-xs text-emerald-600 font-medium">
                      ✓ {isAr ? 'تم الإشعار' : 'Client notifié'}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Quote */}
            {detailRep.statut === 'en_attente' && canEdit && (
              <QuoteSender rep={detailRep} isAr={isAr} onSent={async () => { await fetchRepairs(); setDetailRep(null) }} />
            )}
            {detailRep.statut === 'devis_envoye' && canEdit && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
                <p className="text-sm text-violet-800">
                  {isAr ? 'تم إرسال السعر' : 'Devis envoyé'} : <b>{formatMAD(detailRep.cout_reparation ?? 0)}</b>
                  {detailRep.devis_envoye_le && ` — ${formatDate(detailRep.devis_envoye_le)}`}.{' '}
                  {isAr ? 'يمكن للعميل الرد عبر الموقع أيضاً.' : 'Le client peut aussi répondre en ligne (page de suivi).'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Btn variant="secondary" onClick={() => answerQuote(detailRep, 'accepte')}>
                    <ThumbsUp className="w-4 h-4" />{isAr ? 'قبل العميل' : 'Devis accepté'}
                  </Btn>
                  <Btn variant="danger" onClick={() => answerQuote(detailRep, 'refuse')}>
                    <ThumbsDown className="w-4 h-4" />{isAr ? 'رفض العميل' : 'Devis refusé'}
                  </Btn>
                </div>
              </div>
            )}

            {/* Advance status */}
            {getNextStatus(detailRep.statut) && canEdit && (
              <button
                onClick={() => { advanceStatus(detailRep); setDetailRep(null) }}
                disabled={statusLoading === detailRep.rep_id}
                className="w-full py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
                style={{ backgroundColor: primary }}
              >
                {statusLoading === detailRep.rep_id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ChevronRight className="w-4 h-4" />
                }
                {`${isAr ? 'تقدم إلى' : 'Passer à'}: ${statusLabel(getNextStatus(detailRep.statut)!, detailRep.type_reparation)}`}
              </button>
            )}

            {/* Cancel (managers) */}
            {isManager && (
              <button
                onClick={() => setCancelRep(detailRep)}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl transition-all"
              >
                <Ban className="w-3.5 h-3.5" />{isAr ? 'إلغاء التذكرة' : 'Annuler le ticket'}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* ── Cancel ticket modal ──────────────────────────── */}
      <Modal
        open={!!cancelRep}
        onClose={() => { setCancelRep(null); setCancelReason('') }}
        title={isAr ? 'إلغاء التذكرة' : `Annuler ${cancelRep?.rep_id ?? ''}`}
        size="sm"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <p className="text-sm text-[#6B6860]">
            {isAr
              ? 'ستختفي التذكرة من القوائم ومن الصندوق، مع الاحتفاظ بها في السجل.'
              : "Le ticket disparaît des listes et de la caisse, mais reste dans l'historique avec le motif."}
          </p>
          <Field label={isAr ? 'سبب الإلغاء' : "Motif de l'annulation"} required>
            <textarea className={`${inputClass} resize-none`} rows={3} maxLength={500}
              value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              placeholder={isAr ? 'مثال: خطأ في الإدخال، العميل تراجع…' : 'Ex. : erreur de saisie, client a renoncé…'} />
          </Field>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" onClick={() => { setCancelRep(null); setCancelReason('') }}>{t(isAr, 'common.cancel')}</Btn>
            <Btn variant="danger" loading={cancelling} disabled={cancelReason.trim().length < 5} onClick={confirmCancel}>
              <Ban className="w-4 h-4" />{isAr ? 'تأكيد الإلغاء' : "Confirmer l'annulation"}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* ── Add repair modal ─────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }) }}
        title={t(isAr, 'common.newRepair')}
        size="lg"
      >
        <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>

          {/* Kind */}
          <div className="grid grid-cols-3 gap-2">
            {REPAIR_KINDS.map(k => {
              const KindIcon = KIND_ICON[k]
              const on = form.type_reparation === k
              return (
                <button key={k} type="button"
                  onClick={() => setForm(prev => ({ ...prev, type_reparation: k, problemes: [] }))}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    on ? 'border-[#C9A440] bg-[#FAF5E8] text-[#1A1A1A]' : 'border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4]'}`}>
                  <KindIcon className="w-4 h-4" />{codeLabel('repair_kind', k, isAr ? 'ar' : 'fr')}
                </button>
              )
            })}
          </div>

          {/* Problems of that kind */}
          {form.type_reparation !== 'consultation' && (
            <div className="flex flex-wrap gap-2">
              {PROBLEMS_BY_KIND[form.type_reparation].map(p => {
                const on = form.problemes.includes(p)
                return (
                  <button key={p} type="button"
                    onClick={() => setForm(prev => ({ ...prev, problemes: on ? prev.problemes.filter(x => x !== p) : [...prev.problemes, p] }))}
                    className={`px-3 py-1.5 rounded-full border text-xs transition-all ${
                      on ? 'border-[#C9A440] bg-[#C9A440] text-white' : 'border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4]'}`}>
                    {codeLabel('repair_problem', p, isAr ? 'ar' : 'fr')}
                  </button>
                )
              })}
            </div>
          )}

          {/* Client */}
          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'اسم العميل' : 'Nom client'}>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'محمد...' : 'Prénom Nom...'}
                value={form.client_nom} onChange={e => setF('client_nom', e.target.value)} />
            </Field>
            <Field label={isAr ? 'هاتف العميل' : 'Téléphone client'}>
              <input type="tel" className={inputClass}
                placeholder="06XXXXXXXX"
                value={form.client_tel} onChange={e => setF('client_tel', e.target.value)} />
            </Field>
          </div>

          {/* Device */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label={isAr ? 'نوع الجهاز' : 'Type appareil'}>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'هاتف، لابتوب...' : 'Téléphone, laptop...'}
                value={form.device_type_libre} onChange={e => setF('device_type_libre', e.target.value)} />
            </Field>
            <Field label={t(isAr, 'common.brand')}>
              <input type="text" className={inputClass}
                placeholder="Apple, Samsung..."
                value={form.marque} onChange={e => setF('marque', e.target.value)} />
            </Field>
            <Field label={t(isAr, 'common.model')} required={form.type_reparation !== 'consultation'}>
              <input type="text" className={inputClass}
                placeholder="iPhone 13, Galaxy A54..."
                value={form.model} onChange={e => setF('model', e.target.value)} />
            </Field>
          </div>

          <Field label={isAr ? 'الرقم التسلسلي / IMEI' : 'Numéro de série / IMEI'}>
            <input type="text" className={inputClass}
              placeholder="IMEI ou S/N..."
              value={form.device_serial} onChange={e => setF('device_serial', e.target.value)} />
          </Field>

          <Field label={isAr ? 'المشكلة' : 'Problème décrit'} required={form.problemes.length === 0}>
            <textarea className={`${inputClass} resize-none`} rows={2}
              placeholder={isAr ? 'وصف المشكلة...' : 'Décrivez le problème...'}
              value={form.probleme} onChange={e => setF('probleme', e.target.value)} />
          </Field>

          <Field label={isAr ? 'التشخيص الأولي' : 'Diagnostic initial'}>
            <textarea className={`${inputClass} resize-none`} rows={2}
              placeholder={isAr ? 'التشخيص...' : 'Diagnostic...'}
              value={form.diagnostic} onChange={e => setF('diagnostic', e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'تكلفة الإصلاح (درهم)' : 'Coût réparation (MAD)'}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00"
                value={form.cout_reparation} onChange={e => setF('cout_reparation', e.target.value)} />
            </Field>
            <Field label={isAr ? 'التسبيق المدفوع (درهم)' : 'Avance reçue (MAD)'}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00"
                value={form.avance_rep} onChange={e => setF('avance_rep', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'طريقة الأداء' : 'Payé par'}>
              <Select className={selectClass} value={form.mode_paiement}
                onChange={e => setForm(prev => ({ ...prev, mode_paiement: e.target.value as 'especes' | 'virement' }))}>
                <option value="especes">{isAr ? 'نقداً' : 'Espèces'}</option>
                <option value="virement">{isAr ? 'تحويل بنكي' : 'Virement'}</option>
              </Select>
            </Field>
            {form.type_reparation !== 'consultation' && (
              <Field label={isAr ? 'صور الإيداع (3 كحد أقصى)' : 'Photos au dépôt (3 max.)'}>
                <div className="flex items-center gap-2">
                  {form.photos_depot.map(url => (
                    <button key={url} type="button" title={isAr ? 'حذف' : 'Retirer'}
                      onClick={() => setForm(prev => ({ ...prev, photos_depot: prev.photos_depot.filter(u => u !== url) }))}
                      className="w-11 h-11 rounded-lg overflow-hidden border border-[#E8E5DE]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                  {form.photos_depot.length < 3 && (
                    <label className="w-11 h-11 rounded-lg border-2 border-dashed border-[#E8E5DE] flex items-center justify-center text-[#B0ADA6] cursor-pointer hover:border-[#C9A440]">
                      {photoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                        onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
                    </label>
                  )}
                </div>
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'التقني المكلف' : 'Technicien assigné'}>
              <Select className={selectClass}
                value={form.technicien_id}
                onChange={e => {
                  const staff = staffList.find(s => s.id === e.target.value)
                  setF('technicien_id', e.target.value)
                  setF('technicien', staff?.display_name || '')
                }}
              >
                <option value="">{isAr ? '— بدون تعيين —' : '— Non assigné —'}</option>
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>{s.display_name}</option>
                ))}
              </Select>
            </Field>
            <Field label={isAr ? 'تاريخ التسليم المتوقع' : 'Date prévue de livraison'}>
              <input type="date" className={inputClass}
                value={form.date_prevue} onChange={e => setF('date_prevue', e.target.value)} />
            </Field>
          </div>

          <Field label={t(isAr, 'common.notes')}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={form.notes} onChange={e => setF('notes', e.target.value)}
              placeholder={isAr ? 'ملاحظة للتقني أو العميل...' : 'Note interne...'} />
          </Field>

          <div className="flex gap-3 justify-end pt-2 border-t border-[#E8E5DE]">
            <Btn variant="secondary" onClick={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }) }}>
              {t(isAr, 'common.cancel')}
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSubmit}
              loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}
            >
              {isAr ? 'تسجيل الإصلاح' : 'Enregistrer'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Quote sender ─────────────────────────────────────────────
// Sets the price, moves the ticket to "Devis envoyé" and opens WhatsApp with
// the quote and the tracking link (where the customer can accept online).
function QuoteSender({ rep, isAr, onSent }: { rep: RepairWithExtras; isAr: boolean; onSent: () => void }) {
  const [price, setPrice]     = useState(rep.cout_reparation ? String(rep.cout_reparation) : '')
  const [sending, setSending] = useState(false)
  const phone = rep.clients?.telephone?.replace(/\D/g, '').slice(-9)

  async function send() {
    const amount = Number(price)
    if (!(amount > 0)) { showError(isAr ? 'أدخل السعر' : 'Indiquez le prix'); return }
    setSending(true)
    try {
      const res  = await fetch('/api/repairs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ rep_id: rep.rep_id, statut: 'devis_envoye', cout_reparation: amount }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (phone) {
        const msg = `Bonjour ${rep.clients?.nom ?? ''}, devis Electro Zaki pour ${`${rep.marque ?? ''} ${rep.model}`.trim()} (réf. ${rep.rep_id}) : ${amount} DH. ` +
          `Répondez OUI ou NON ici, ou acceptez en ligne : ${TRACK_URL}?ref=${rep.rep_id}`
        window.open(`https://wa.me/212${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
      }
      showSuccess(isAr ? 'تم إرسال السعر' : 'Devis envoyé')
      onSent()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-xl border border-[#E8E5DE] p-4 space-y-2">
      <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest">{isAr ? 'إرسال سعر للموافقة' : 'Envoyer un devis à valider'}</p>
      <div className="flex gap-2">
        <input type="number" min={0} className={inputClass} placeholder={isAr ? 'السعر (درهم)' : 'Prix (DH)'}
          value={price} onChange={e => setPrice(e.target.value)} />
        <Btn variant="secondary" loading={sending} onClick={send}>
          <FileText className="w-4 h-4" />{isAr ? 'إرسال' : 'Envoyer'}
        </Btn>
      </div>
      <p className="text-[11px] text-[#B0ADA6]">
        {isAr ? 'يفتح واتساب برسالة جاهزة ورابط التتبع.' : 'Ouvre WhatsApp avec le message et le lien de suivi (le client peut accepter en ligne).'}
      </p>
    </div>
  )
}

// ─── Sub-component ────────────────────────────────────────────
function InfoRow({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[#B0ADA6] mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-[#B0ADA6]">{label}</p>
        <p className="text-sm font-medium text-[#1A1A1A] break-words">{value}</p>
      </div>
    </div>
  )
}