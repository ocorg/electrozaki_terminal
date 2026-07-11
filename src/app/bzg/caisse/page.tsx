'use client'
import { useState, useEffect } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { PageHeader, SkeletonRow, EmptyState } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import {
  Vault, RefreshCw, CheckCircle, XCircle,
  Clock, AlertTriangle, ChevronDown, ChevronUp, Calendar
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
  status:            'open' | 'pending_eod' | 'closed'
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
  open:        { label: 'Ouverte',          labelAr: 'مفتوحة',              bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  pending_eod: { label: 'En attente',        labelAr: 'في انتظار الموافقة',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  closed:      { label: 'Clôturée',          labelAr: 'مغلقة',               bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200',   dot: 'bg-slate-400' },
}

export default function BZGCaissePage() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'
  const supabase     = createClient()

  const [records, setRecords]     = useState<CaisseRecord[]>([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
    const [stores, setStores] = useState(STORES_FALLBACK)
  useEffect(() => {
    (supabase as any).from('stores').select('store_id,name,theme_color').eq('is_active', true)
      .then(({ data }: any) => { if (data?.length) setStores(data.map((s: any) => ({ id: s.store_id, name: s.name, color: s.theme_color }))) })
  }, [])
  const [filterStore, setFilterStore] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedDate, setSelectedDate] = useState('')

  async function fetchRecords() {
    setLoading(true)
    try {
      let query = (supabase as any)
        .from('caisse')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)

      if (filterStore)  query = query.eq('store_id', filterStore)
      if (filterStatus) query = query.eq('status', filterStatus)
      if (selectedDate) query = query.eq('date', selectedDate)

      const { data, error } = await query
      if (error) throw error
      setRecords(data || [])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRecords() }, [filterStore, filterStatus, selectedDate])

  async function approve(caisseId: string) {
    setApproving(caisseId)
    try {
      const res  = await fetch('/api/caisse', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ caisse_id: caisseId }),
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
    const note = window.prompt(isAr ? 'سبب الرفض:' : 'Motif du rejet :')
    if (!note) return
    setApproving(caisseId)
    try {
      const { error } = await (supabase as any)
        .from('caisse')
        .update({ status: 'open', rejection_note: note })
        .eq('caisse_id', caisseId)
      if (error) throw error
      showSuccess(isAr ? 'تم الرفض' : 'Clôture rejetée')
      await fetchRecords()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setApproving(null)
    }
  }

  const pending = records.filter(r => r.status === 'pending_eod')

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'إدارة الكاسيير' : 'Gestion des caisses'}
          subtitle={pending.length > 0
            ? (isAr ? `${pending.length} في انتظار الموافقة` : `${pending.length} en attente d'approbation`)
            : (isAr ? 'كل الأيام متزامنة' : 'Tout est à jour')}
          actions={
            <button onClick={fetchRecords} disabled={loading}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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
          <select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">{isAr ? 'كل المتاجر' : 'Tous magasins'}</option>
            {stores.map((s: { id: string; name: string; color: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{isAr ? 'كل الحالات' : 'Tous statuts'}</option>
            <option value="open">{isAr ? 'مفتوحة' : 'Ouverte'}</option>
            <option value="pending_eod">{isAr ? 'في انتظار' : 'En attente'}</option>
            <option value="closed">{isAr ? 'مغلقة' : 'Clôturée'}</option>
          </select>

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
      <div className="flex-1 overflow-auto px-6 pb-6">
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
                      {rec.status === 'pending_eod' && (
                        <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => approve(rec.caisse_id)}
                            disabled={approving === rec.caisse_id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            {isAr ? 'موافقة' : 'Approuver'}
                          </button>
                          <button
                            onClick={() => reject(rec.caisse_id)}
                            disabled={approving === rec.caisse_id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            {isAr ? 'رفض' : 'Rejeter'}
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
                            { label: isAr ? 'الإصلاحات' : 'Réparations',        value: formatMAD(rec.total_reparations), negative: false },
                            ...(rec.total_cash_drops > 0 ? [{ label: isAr ? 'إيداعات نقدية' : 'Encaissements', value: formatMAD(rec.total_cash_drops), negative: false }] : []),
                            { label: isAr ? 'المصاريف' : 'Dépenses',            value: formatMAD(rec.total_depenses),     negative: true },
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
                            {isAr ? 'أرسل في' : 'Soumis le'}{' '}
                            {new Date(rec.eod_submitted_at).toLocaleString('fr-FR')}
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