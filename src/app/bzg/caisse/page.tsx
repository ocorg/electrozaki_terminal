'use client'
import { useState, useEffect, useMemo } from 'react'
import { useApi } from '@/lib/data/api'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { formatMAD, formatDate } from '@/lib/utils'
import { PageHeader, SkeletonRow, EmptyState, Select } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import {
  Vault, RefreshCw, CheckCircle, XCircle,
  Clock, AlertTriangle, ChevronDown, ChevronUp, Calendar
} from 'lucide-react'
import { STORE_TIME_ZONE } from '@/lib/time'

interface CaisseRecord {
  caisse_id:         string
  store_id:          string
  date:              string
  ouverture:         number
  total_ventes:      number
  total_reparations: number
  total_depenses:    number
  total_cash_drops:  number
  solde_theorique:   number
  solde_reel?:       number | null
  ecart?:            number | null
  status:            'ouverte' | 'en_attente_cloture' | 'cloturee'
  eod_submitted_at?: string | null
  approved_by?:      string | null
  approved_at?:      string | null
  rejection_note?:   string | null
  notes?:            string | null
}

// STORES is now fetched dynamically — see useEffect below.
// Keep this as a fallback only:
const STORES_FALLBACK = [
  { id: 'EZ-001', name: 'Electro Zaki', color: '#C9A440' },
]

const STATUS_STYLES = {
  ouverte:            { label: 'Ouverte',          labelAr: 'مفتوحة',              bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  en_attente_cloture: { label: 'En attente',        labelAr: 'في انتظار الموافقة',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  cloturee:           { label: 'Clôturée',          labelAr: 'مغلقة',               bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200',   dot: 'bg-slate-400' },
}

export default function BZGCaissePage() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const storesQ = useApi<{ store_id: string; name: string; theme_color: string; is_active: boolean }[]>('/api/stores')
  const stores  = useMemo(() => {
    const active = (storesQ.data ?? []).filter(s => s.is_active)
    return active.length ? active.map(s => ({ id: s.store_id, name: s.name, color: s.theme_color })) : STORES_FALLBACK
  }, [storesQ.data])
  const [filterStore, setFilterStore] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedDate, setSelectedDate] = useState('')

  // Cached per filter combination; refreshed in the background when any caisse changes
  const params = new URLSearchParams()
  if (filterStore)  params.set('store_id', filterStore)
  if (filterStatus) params.set('status', filterStatus)
  if (selectedDate) params.set('date', selectedDate)
  const recordsQ = useApi<CaisseRecord[]>(`/api/bzg/caisse?${params}`)
  const records  = recordsQ.data ?? []
  const loading  = recordsQ.isLoading
  const [manualRefresh, setManualRefresh] = useState(false)
  useEffect(() => { if (recordsQ.error) showError(recordsQ.error.message) }, [recordsQ.error])

  async function fetchRecords() {
    setManualRefresh(true)
    try { await recordsQ.refresh() } finally { setManualRefresh(false) }
  }

  // Both approve and reject go through /api/bzg/caisse/eod — the only EOD-approval
  // path that role-checks (manager/owner) AND writes an activity_log entry. This used to
  // call /api/caisse PUT (approve-only) and a raw client-side update (reject, unlogged,
  // no server-side role check) — two paths that could silently drift from each other.
  async function approve(caisseId: string) {
    setApproving(caisseId)
    try {
      const res  = await fetch('/api/bzg/caisse/eod', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ caisse_id: caisseId, action: 'approve' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تمت الموافقة ✓' : 'Clôture approuvée ✓')
      await fetchRecords()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setApproving(null)
    }
  }

  async function reject(caisseId: string) {
    const note = window.prompt(t(isAr, 'common.rejectionReason'))
    if (!note || note.trim().length < 3) {
      if (note != null) showError(isAr ? 'السبب يجب أن يحتوي على 3 أحرف على الأقل' : 'Motif requis (3 caractères minimum)')
      return
    }
    setApproving(caisseId)
    try {
      const res  = await fetch('/api/bzg/caisse/eod', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ caisse_id: caisseId, action: 'reject', rejection_note: note.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الرفض' : 'Clôture rejetée')
      await fetchRecords()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setApproving(null)
    }
  }

  const pending = records.filter(r => r.status === 'en_attente_cloture')

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'إدارة الكاسيير' : 'Gestion des caisses'}
          subtitle={pending.length > 0
            ? (isAr ? `${pending.length} في انتظار الموافقة` : `${pending.length} en attente d'approbation`)
            : (isAr ? 'كل الأيام متزامنة' : 'Tout est à jour')}
          actions={
            <button onClick={fetchRecords} disabled={manualRefresh}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
              <RefreshCw className={`w-4 h-4 ${manualRefresh ? 'animate-spin' : ''}`} />
            </button>
          }
        />

        {/* Pending banner */}
        {pending.length > 0 && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-medium text-amber-800">
              {isAr
                ? `${pending.length} كاسيير في انتظار موافقتك للإغلاق`
                : `${pending.length} caisse${pending.length > 1 ? 's' : ''} en attente de votre validation`}
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">{t(isAr, 'common.allStores')}</option>
            {stores.map((s: { id: string; name: string; color: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>

          <Select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{t(isAr, 'common.allStatuses')}</option>
            <option value="ouverte">{t(isAr, 'common.openStatus')}</option>
            <option value="en_attente_cloture">{isAr ? 'في انتظار' : 'En attente'}</option>
            <option value="cloturee">{t(isAr, 'common.closedStatus')}</option>
          </Select>

          <div className="flex items-center gap-2 bg-white border border-[#E8E5DE] rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-[#B0ADA6]" />
            <input type="date" value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="text-sm text-[#1A1A1A] focus:outline-none bg-transparent" />
            {selectedDate && (
              <button onClick={() => setSelectedDate('')}
                className="text-[#B0ADA6] hover:text-[#1A1A1A] transition-colors">
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : records.length === 0 ? (
            <EmptyState
              icon={<Vault className="w-7 h-7" />}
              title={isAr ? 'لا توجد سجلات' : 'Aucun enregistrement'}
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {records.map(rec => {
                const store   = stores.find((s: { id: string; name: string; color: string }) => s.id === rec.store_id)
                const style   = STATUS_STYLES[rec.status]
                const isExp   = expanded === rec.caisse_id
                const hasEcart = rec.ecart != null && rec.ecart !== 0

                return (
                  <div key={rec.caisse_id} className="hover:bg-[#F8F7F4] transition-all">
                    <div className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                         onClick={() => setExpanded(isExp ? null : rec.caisse_id)}>
                      {/* Status dot */}
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-[#1A1A1A]">
                            {formatDate(rec.date)}
                          </p>
                          {store && (
                            <span className="text-xs font-medium" style={{ color: store.color }}>
                              {store.name}
                            </span>
                          )}
                          <span className={`inline-flex items-center border rounded-lg px-2 py-0.5 text-[10px] font-bold ${style.bg} ${style.text} ${style.border}`}>
                            {isAr ? style.labelAr : style.label}
                          </span>
                          {hasEcart && (
                            <span className={`text-xs font-bold ${(rec.ecart ?? 0) > 0 ? 'text-blue-500' : 'text-red-500'}`}>
                              {(rec.ecart ?? 0) > 0 ? '+' : ''}{formatMAD(rec.ecart ?? 0)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#B0ADA6] mt-0.5">
                          {isAr ? 'الرصيد النظري' : 'Solde théorique'}: {formatMAD(rec.solde_theorique)}
                          {rec.solde_reel != null && (
                            <> · {isAr ? 'الفعلي' : 'Réel'}: {formatMAD(rec.solde_reel)}</>
                          )}
                        </p>
                      </div>

                      {/* Approve/reject buttons for pending */}
                      {rec.status === 'en_attente_cloture' && (
                        <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => approve(rec.caisse_id)}
                            disabled={approving === rec.caisse_id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            {t(isAr, 'common.approve')}
                          </button>
                          <button
                            onClick={() => reject(rec.caisse_id)}
                            disabled={approving === rec.caisse_id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            {t(isAr, 'common.reject')}
                          </button>
                        </div>
                      )}

                      {isExp
                        ? <ChevronUp className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                      }
                    </div>

                    {/* Expanded detail */}
                    {isExp && (
                      <div className="px-5 pb-5 animate-fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F8F7F4] rounded-xl">
                          {[
                            { label: isAr ? 'الافتتاح' : 'Ouverture',    value: formatMAD(rec.ouverture),           negative: false },
                            { label: isAr ? 'المبيعات' : 'Ventes',              value: formatMAD(rec.total_ventes),      negative: false },
                            { label: t(isAr, 'common.repairs'),        value: formatMAD(rec.total_reparations), negative: false },
                            ...(rec.total_cash_drops > 0 ? [{ label: isAr ? 'إيداعات نقدية' : 'Encaissements', value: formatMAD(rec.total_cash_drops), negative: false }] : []),
                            { label: t(isAr, 'common.expenses'),            value: formatMAD(rec.total_depenses),     negative: true },
                          ].map(item => (
                            <div key={item.label} className="text-center">
                              <p className="text-xs text-[#B0ADA6] mb-1">{item.label}</p>
                              <p className={`font-bold text-sm ${item.negative ? 'text-red-500' : 'text-[#1A1A1A]'}`}>
                                {item.negative ? '- ' : ''}{item.value}
                              </p>
                            </div>
                          ))}
                        </div>

                        {rec.rejection_note && (
                          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                            <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-bold text-red-700">
                                {isAr ? 'سبب الرفض السابق' : 'Motif de rejet précédent'}
                              </p>
                              <p className="text-xs text-red-600 mt-0.5">{rec.rejection_note}</p>
                            </div>
                          </div>
                        )}

                        {rec.notes && (
                          <div className="mt-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                            <p className="text-xs text-amber-700">{rec.notes}</p>
                          </div>
                        )}

                        {rec.eod_submitted_at && (
                          <p className="text-xs text-[#B0ADA6] mt-2 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {t(isAr, 'common.submittedAt')}{' '}
                            {new Date(rec.eod_submitted_at).toLocaleString('fr-FR', { timeZone: STORE_TIME_ZONE })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}