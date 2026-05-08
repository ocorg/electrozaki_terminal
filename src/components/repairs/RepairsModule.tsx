'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, EmptyState } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Reparation, RepairStatus } from '@/types/database'
import {
  Wrench, Plus, Clock, User, Phone,
  Calendar, ChevronRight, Loader2, Package,
  CheckCircle, RefreshCw, Search, X,
  MessageCircle, AlertTriangle, DollarSign
} from 'lucide-react'

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
    status:  'معلق',
    labelFr: 'En attente',
    labelAr: 'معلق',
    color:   'text-amber-700',
    bg:      'bg-amber-50',
    border:  'border-amber-200',
    dot:     'bg-amber-500',
    icon:    Clock,
  },
  {
    status:  'قيد الإصلاح',
    labelFr: 'En cours',
    labelAr: 'قيد الإصلاح',
    color:   'text-blue-700',
    bg:      'bg-blue-50',
    border:  'border-blue-200',
    dot:     'bg-blue-500',
    icon:    Wrench,
  },
  {
    status:  'جاهز',
    labelFr: 'Prêt',
    labelAr: 'جاهز',
    color:   'text-emerald-700',
    bg:      'bg-emerald-50',
    border:  'border-emerald-200',
    dot:     'bg-emerald-500',
    icon:    CheckCircle,
  },
  {
    status:  'تم الاستلام',
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
  clients?: { nom: string; telephone: string } | null
  reparations_parts?: { part_id: string; description: string; cout: number }[]
  fariq_rep?: number
  parts_cost?: number
}

const EMPTY_FORM = {
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
          {open ? (isAr ? 'إلغاء' : 'Annuler') : (isAr ? '+ إضافة' : '+ Ajouter')}
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
              placeholder={isAr ? 'المورد' : 'Fournisseur'}
              value={fournisseur} onChange={e => setFournisseur(e.target.value)} />
          </div>
          <button onClick={handleAdd} disabled={adding || !desc || !cout}
            className="w-full py-2 rounded-xl bg-[#C9A440] text-white text-sm font-bold disabled:opacity-50">
            {adding ? '...' : (isAr ? 'إضافة' : 'Ajouter')}
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

  const [staffList, setStaffList] = useState<{ id: string; display_name: string }[]>([])

  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(j => setStaffList((j.data || []).filter((u: { is_active: boolean }) => u.is_active)))
      .catch(() => {})
  }, [])

  const [repairs, setRepairs]       = useState<RepairWithExtras[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [formOpen, setFormOpen]     = useState(false)
  const [detailRep, setDetailRep]   = useState<RepairWithExtras | null>(null)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [statusLoading, setStatusLoading] = useState<string | null>(null)

  const fetchRepairs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (search.length >= 2) params.set('search', search)
      const res  = await fetch(`/api/repairs?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRepairs(json.data || [])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, search])

  useEffect(() => {
    const t = setTimeout(() => fetchRepairs(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchRepairs, search])

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  // ── Status progression ────────────────────────────────────
  function getNextStatus(current: RepairStatus): RepairStatus | null {
    const order: RepairStatus[] = ['معلق', 'قيد الإصلاح', 'جاهز', 'تم الاستلام']
    const idx = order.indexOf(current)
    return idx < order.length - 1 ? order[idx + 1] : null
  }

  async function advanceStatus(rep: RepairWithExtras) {
    const next = getNextStatus(rep.statut)
    if (!next) return
    setStatusLoading(rep.rep_id)
    try {
      const updates: Record<string, unknown> = { rep_id: rep.rep_id, statut: next }
      if (next === 'تم الاستلام') {
        updates.date_livraison = new Date().toISOString().split('T')[0]
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

  // ── Create repair ─────────────────────────────────────────
  async function handleSubmit() {
    if (!form.model || !form.probleme) {
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
          model:             form.model,
          probleme:          form.probleme,
          diagnostic:        form.diagnostic        || null,
          cout_reparation:   form.cout_reparation   ? Number(form.cout_reparation)  : 0,
          avance_rep:        form.avance_rep        ? Number(form.avance_rep)        : 0,
          technicien:        form.technicien        || null,
          technicien_id:     form.technicien_id     || null,
          date_prevue:       form.date_prevue       || null,
          statut:            'معلق',
          date_depot:        new Date().toISOString().split('T')[0],
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

  const activeCount = repairs.filter(r => r.statut !== 'تم الاستلام').length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-[#1A1A1A] tracking-wide">
              {isAr ? 'الإصلاحات' : 'Réparations'}
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
              disabled={loading}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Btn
              variant="primary"
              onClick={() => setFormOpen(true)}
              style={{ backgroundColor: primary } as React.CSSProperties}
            >
              <Plus className="w-4 h-4" />
              {isAr ? 'إصلاح جديد' : 'Nouvelle réparation'}
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

      {/* ── Kanban board ────────────────────────────────── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6">
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
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map(col => {
              const items   = byStatus[col.status] || []
              const ColIcon = col.icon
              return (
                <div
                  key={col.status}
                  className={`w-72 flex-shrink-0 flex flex-col rounded-2xl border ${col.bg} ${col.border} overflow-hidden`}
                >
                  {/* Column header */}
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${col.border}`}>
                    <div className="flex items-center gap-2">
                      <ColIcon className={`w-4 h-4 ${col.color}`} />
                      <span className={`font-display font-bold text-sm tracking-wide ${col.color}`}>
                        {isAr ? col.labelAr : col.labelFr}
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
                          && rep.statut !== 'تم الاستلام'

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

                              {/* Problem */}
                              <p className="text-xs text-[#6B6860] line-clamp-2">{rep.probleme}</p>

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
                                      {isAr ? 'متبقي' : 'Reste'}: {formatMAD(rep.fariq_rep ?? 0)}
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
                                {isAr
                                  ? `→ ${COLUMNS.find(c => c.status === nextStatus)?.[isAr ? 'labelAr' : 'labelFr'] ?? nextStatus}`
                                  : `→ ${COLUMNS.find(c => c.status === nextStatus)?.labelFr ?? nextStatus}`}
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
                    {isAr ? col.labelAr : col.labelFr}
                  </span>
                )
              })()}
              <span className="text-xs text-[#B0ADA6]">{formatDate(detailRep.date_depot)}</span>
            </div>

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
                    label={isAr ? 'العميل' : 'Client'}
                    value={detailRep.clients.nom} />
                  <InfoRow icon={<Phone className="w-4 h-4" />}
                    label={isAr ? 'الهاتف' : 'Téléphone'}
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
                {(detailRep.fariq_rep ?? 0) !== 0 && (
                  <div className="flex justify-between text-sm pt-2 border-t border-[#E8E5DE]">
                    <span className="font-bold text-[#1A1A1A]">{isAr ? 'المتبقي' : 'Reste à payer'}</span>
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
                  {isAr ? 'ملاحظات' : 'Notes'}
                </p>
                <p className="text-sm text-amber-800">{detailRep.notes}</p>
              </div>
            )}

            {/* WhatsApp notification hint */}
            {detailRep.statut === 'جاهز' && detailRep.clients && (() => {
              const phone = detailRep.clients!.telephone.replace(/^0/, '')
              const name  = detailRep.clients!.nom
              const device = `${detailRep.marque ?? ''} ${detailRep.model}`.trim()
              const repId = detailRep.rep_id
              const msg   = isAr
                ? `مرحباً ${name}، جهازك ${device} جاهز للاستلام. شكراً لثقتك.`
                : `Bonjour ${name}, votre appareil ${device} est prêt. Merci de votre confiance.`
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
                {isAr
                  ? `تقدم إلى: ${COLUMNS.find(c => c.status === getNextStatus(detailRep.statut))?.labelAr}`
                  : `Passer à: ${COLUMNS.find(c => c.status === getNextStatus(detailRep.statut))?.labelFr}`}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* ── Add repair modal ─────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }) }}
        title={isAr ? 'إصلاح جديد' : 'Nouvelle réparation'}
        size="lg"
      >
        <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>

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
          <div className="grid grid-cols-3 gap-4">
            <Field label={isAr ? 'نوع الجهاز' : 'Type appareil'}>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'هاتف، لابتوب...' : 'Téléphone, laptop...'}
                value={form.device_type_libre} onChange={e => setF('device_type_libre', e.target.value)} />
            </Field>
            <Field label={isAr ? 'الماركة' : 'Marque'}>
              <input type="text" className={inputClass}
                placeholder="Apple, Samsung..."
                value={form.marque} onChange={e => setF('marque', e.target.value)} />
            </Field>
            <Field label={isAr ? 'الموديل' : 'Modèle'} required>
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

          <Field label={isAr ? 'المشكلة' : 'Problème décrit'} required>
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
            <Field label={isAr ? 'التقني المكلف' : 'Technicien assigné'}>
              <select className={selectClass}
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
              </select>
            </Field>
            <Field label={isAr ? 'تاريخ التسليم المتوقع' : 'Date prévue de livraison'}>
              <input type="date" className={inputClass}
                value={form.date_prevue} onChange={e => setF('date_prevue', e.target.value)} />
            </Field>
          </div>

          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={form.notes} onChange={e => setF('notes', e.target.value)}
              placeholder={isAr ? 'ملاحظة للتقني أو العميل...' : 'Note interne...'} />
          </Field>

          <div className="flex gap-3 justify-end pt-2 border-t border-[#E8E5DE]">
            <Btn variant="secondary" onClick={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
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