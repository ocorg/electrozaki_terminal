'use client'
import { useState, useEffect, useCallback } from 'react'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { t } from '@/lib/i18n/t'
import { PageHeader, SkeletonRow, EmptyState, StatusBadge, Modal, Field, Btn } from '@/components/shared'
import { useUser } from '@/lib/hooks/useUser'
import { createClient } from '@/lib/supabase/client'
import {
  ShoppingCart, RefreshCw, Calendar, X,
  ChevronDown, ChevronUp, Ban, AlertTriangle
} from 'lucide-react'

interface Transaction {
  txn_id:          string
  device_type:     string
  device_id:       string
  store_id:        string
  type_operation:  string
  prix_vente:      number
  date_vente:      string
  payment_method:  string
  avance?:         number
  valeur_echange?: number
  fariq?:          number
  statut_paiement?:string
  clients?:        { nom: string; telephone: string } | null
  override_required?: boolean
  warranty_expiry?:string | null
  notes?:          string | null
  voided?:         boolean
  voided_reason?:  string | null
  created_at:      string
}

const OP_LABELS_FR: Record<string, string> = {
  'بيع': 'Vente', 'إستبدال': 'Échange', 'تسبيق': 'Avance', 'Retour': 'Retour',
}
const PAY_LABELS_FR: Record<string, string> = {
  'نقد': 'Espèces', 'تحويل': 'Virement', 'تسبيق': 'Avance',
  'إستبدال': 'Échange', 'مختلط': 'Mixte',
}

interface StoreRef { id: string; name: string; color: string }

interface TransactionsListPageProps {
  // 'store'  — single store, e.g. EZ's own transactions view (no store filter/dot, server-scoped)
  // 'all'    — cross-store view, e.g. BZG (store filter dropdown + colored dot per row)
  scope:       'store' | 'all'
  storeId?:    string   // required when scope === 'store'
  title:       { ar: string; fr: string }
}

export default function TransactionsListPage({ scope, storeId, title }: TransactionsListPageProps) {
  const { language } = useLanguageStore()
  const isAr          = language === 'ar'
  const { user }       = useUser()

  const today      = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState<string | null>(null)
  const [filterOp, setFilterOp]         = useState('')
  const [filterStore, setFilterStore]   = useState('')
  const [dateFrom, setDateFrom]         = useState(monthStart)
  const [dateTo, setDateTo]             = useState(today)
  const [stores, setStores]             = useState<StoreRef[]>([])

  const [voidTxnId, setVoidTxnId]   = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding]       = useState(false)

  const canVoid = user?.role === 'gerant' || user?.role === 'proprietaire'

  // Store list is only needed for the cross-store dot/filter — fetched live so a newly
  // added store shows up automatically (a hardcoded list here previously required a code change).
  useEffect(() => {
    if (scope !== 'all') return
    const supabase = createClient()
    ;(supabase as any).from('stores').select('store_id,name,theme_color').eq('is_active', true) // eslint-disable-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: { store_id: string; name: string; theme_color: string }[] | null }) => {
        if (data?.length) setStores(data.map(s => ({ id: s.store_id, name: s.name, color: s.theme_color })))
      })
  }, [scope])

  async function handleVoid() {
    if (!voidTxnId || voidReason.trim().length < 10) {
      showError(isAr ? 'السبب مطلوب (10 أحرف على الأقل)' : 'Motif requis (10 caractères minimum)')
      return
    }
    setVoiding(true)
    try {
      // Both scopes go through the same PATCH endpoint — this used to also be hit via a
      // DELETE call from the BZG page, but /api/transactions never had a DELETE handler,
      // so voiding from BZG silently 405'd every time. This was the only working path.
      const res  = await fetch('/api/transactions/void', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txn_id: voidTxnId, voided_reason: voidReason.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم إلغاء المعاملة ✓' : 'Transaction annulée ✓')
      setVoidTxnId(null)
      setVoidReason('')
      fetchTransactions()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setVoiding(false)
    }
  }

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: scope === 'store' ? '500' : '200' })
      const effectiveStoreId = scope === 'store' ? storeId : filterStore
      if (effectiveStoreId) params.set('store_id', effectiveStoreId)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo)   params.set('date_to',   dateTo)
      if (filterOp) params.set('type_operation', filterOp)
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      setTransactions(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [scope, storeId, filterStore, dateFrom, dateTo, filterOp])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const totalCA     = transactions.reduce((s, t) => s + (t.prix_vente ?? 0), 0)
  const totalVentes = transactions.filter(t => t.type_operation === 'بيع').length
  // Third KPI differs by scope: EZ tracks open avances, BZG tracks échanges — matches
  // what each page showed before consolidation.
  const totalTertiary = scope === 'store'
    ? transactions.filter(t => (t.fariq ?? 0) > 0).length
    : transactions.filter(t => t.type_operation === 'إستبدال').length
  const tertiaryLabel = scope === 'store'
    ? (isAr ? 'تسبيقات مفتوحة' : 'Avances ouvertes')
    : (isAr ? 'استبدالات' : 'Échanges')

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header + filters */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? title.ar : title.fr}
          subtitle={isAr
            ? `${transactions.length} معاملة · ${formatMAD(totalCA)}`
            : `${transactions.length} transaction(s) · ${formatMAD(totalCA)}`}
          actions={
            <button
              onClick={fetchTransactions}
              disabled={loading}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#FAF5E8] transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          }
        />

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: isAr ? 'إجمالي المبيعات' : 'Total CA', value: formatMAD(totalCA),  color: '#C9A440' },
            { label: isAr ? 'عدد المبيعات'    : 'Nb ventes', value: String(totalVentes), color: '#10B981' },
            { label: tertiaryLabel,                          value: String(totalTertiary), color: '#F59E0B' },
          ].map(s => (
            <div
              key={s.label}
              className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
              style={{ borderLeftColor: s.color, borderLeftWidth: '3px' }}
            >
              <p className="text-xs text-[#6B6860]">{s.label}</p>
              <p className="font-display font-bold text-lg text-[#1A1A1A]">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-4 bg-white border border-[#E8E5DE] rounded-2xl">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#B0ADA6]" />
            <input
              type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-[#C9A440] transition-all"
            />
            <span className="text-[#B0ADA6] text-sm">→</span>
            <input
              type="date" value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-[#C9A440] transition-all"
            />
          </div>

          {scope === 'all' && (
            <select
              value={filterStore}
              onChange={e => setFilterStore(e.target.value)}
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860] focus:outline-none"
            >
              <option value="">{t(isAr, 'common.allStores')}</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}

          <select
            value={filterOp}
            onChange={e => setFilterOp(e.target.value)}
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860] focus:outline-none focus:border-[#C9A440] transition-all"
          >
            <option value="">{t(isAr, 'common.allTypes')}</option>
            <option value="بيع">{t(isAr, 'common.sale')}</option>
            <option value="إستبدال">{isAr ? 'استبدال' : 'Échange'}</option>
            <option value="Retour">{t(isAr, 'common.returnNoun')}</option>
          </select>

          {(filterOp || filterStore) && (
            <button
              onClick={() => { setFilterOp(''); setFilterStore('') }}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              <X className="w-3 h-3" />
              {isAr ? 'مسح' : 'Effacer'}
            </button>
          )}
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="w-7 h-7" />}
              title={t(isAr, 'common.noTransactions')}
              description={isAr ? 'حاول تعديل الفلاتر' : 'Essayez de modifier les filtres'}
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {transactions.map(txn => {
                const store = stores.find(s => s.id === txn.store_id)
                const isExp = expanded === txn.txn_id
                const fariq = (txn.prix_vente ?? 0) - (txn.avance ?? 0) - (txn.valeur_echange ?? 0)

                return (
                  <div key={txn.txn_id} className="hover:bg-[#F8F7F4] transition-all">
                    <div
                      className="flex items-center gap-4 px-5 py-3.5 cursor-pointer"
                      onClick={() => setExpanded(isExp ? null : txn.txn_id)}
                    >
                      {/* Accent dot — store color in cross-store view, fixed gold otherwise */}
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: scope === 'all' ? (store?.color ?? '#B0ADA6') : '#C9A440' }}
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-[#1A1A1A]">
                            {txn.clients?.nom || (isAr ? 'عميل غير معروف' : 'Client anonyme')}
                          </p>
                          <span className="text-xs font-mono text-[#B0ADA6]">{txn.device_id}</span>
                          {txn.override_required && (
                            <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-lg font-bold">
                              OVERRIDE
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-[#B0ADA6]">
                          <span>{formatDate(txn.date_vente)}</span>
                          {scope === 'all' && store && (
                            <>
                              <span>·</span>
                              <span style={{ color: store.color }}>{store.name}</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{isAr ? txn.type_operation : (OP_LABELS_FR[txn.type_operation] ?? txn.type_operation)}</span>
                          <span>·</span>
                          <span>{isAr ? txn.payment_method : (PAY_LABELS_FR[txn.payment_method] ?? txn.payment_method)}</span>
                        </div>
                      </div>

                      {/* Amount + status */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-[#1A1A1A]">{formatMAD(txn.prix_vente)}</p>
                        {txn.statut_paiement && (
                          <StatusBadge status={txn.statut_paiement} size="sm" />
                        )}
                      </div>

                      {isExp
                        ? <ChevronUp className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                      }
                    </div>

                    {/* Expanded detail */}
                    {isExp && (
                      <div className="px-5 pb-4 animate-fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F8F7F4] rounded-xl text-xs">
                          <div>
                            <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'معرف المعاملة' : 'ID'}</p>
                            <p className="font-mono font-bold text-[#1A1A1A]">{txn.txn_id}</p>
                          </div>
                          <div>
                            <p className="text-[#B0ADA6] mb-0.5">{t(isAr, 'common.salePrice')}</p>
                            <p className="font-bold text-[#C9A440]">{formatMAD(txn.prix_vente)}</p>
                          </div>
                          {(txn.avance ?? 0) > 0 && (
                            <div>
                              <p className="text-[#B0ADA6] mb-0.5">{t(isAr, 'common.avance')}</p>
                              <p className="font-bold text-[#1A1A1A]">{formatMAD(txn.avance ?? 0)}</p>
                            </div>
                          )}
                          {(txn.valeur_echange ?? 0) > 0 && (
                            <div>
                              <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'قيمة الاستبدال' : 'Val. échange'}</p>
                              <p className="font-bold text-[#1A1A1A]">{formatMAD(txn.valeur_echange ?? 0)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-[#B0ADA6] mb-0.5">{t(isAr, 'common.remainingToPay')}</p>
                            <p className={`font-bold ${fariq === 0 ? 'text-emerald-600' : fariq > 0 ? 'text-amber-600' : 'text-blue-500'}`}>
                              {formatMAD(fariq)}
                            </p>
                          </div>
                          {txn.warranty_expiry && (
                            <div>
                              <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'انتهاء الضمان' : 'Garantie'}</p>
                              <p className="font-bold text-[#1A1A1A]">{formatDate(txn.warranty_expiry)}</p>
                            </div>
                          )}
                          {txn.clients?.telephone && (
                            <div>
                              <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'هاتف العميل' : 'Tél. client'}</p>
                              <p className="font-bold text-[#1A1A1A]">{txn.clients.telephone}</p>
                            </div>
                          )}
                        </div>
                        {canVoid && !txn.voided && (
                          <button
                            onClick={e => { e.stopPropagation(); setVoidTxnId(txn.txn_id); setVoidReason('') }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-all"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            {isAr ? 'إلغاء المعاملة' : 'Annuler la transaction'}
                          </button>
                        )}
                        {txn.voided && (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold">
                            <Ban className="w-3.5 h-3.5" /> {isAr ? 'ملغاة' : 'ANNULÉE'}
                          </span>
                        )}
                        {txn.notes && (
                          <p className="text-xs text-[#6B6860] mt-2 px-1">{txn.notes}</p>
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

      {/* Void confirmation modal */}
      <Modal
        open={voidTxnId != null}
        onClose={() => { setVoidTxnId(null); setVoidReason('') }}
        title={isAr ? 'تأكيد إلغاء المعاملة' : 'Confirmer l\'annulation'}
        size="sm"
        closeLabel={t(isAr, 'common.close')}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-800 text-sm">
                {isAr ? `إلغاء المعاملة ${voidTxnId}؟` : `Annuler la transaction ${voidTxnId}?`}
              </p>
              <p className="text-red-600 text-xs mt-1">
                {t(isAr, 'common.irreversible')}
              </p>
            </div>
          </div>
          <Field label={isAr ? 'سبب الإلغاء *' : 'Motif d\'annulation *'} hint={`${voidReason.length}/10 min`}>
            <textarea
              className="w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none"
              rows={3}
              placeholder={isAr ? '10 أحرف على الأقل...' : 'Minimum 10 caractères...'}
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex gap-3 justify-end">
            <Btn variant="secondary" onClick={() => { setVoidTxnId(null); setVoidReason('') }}>
              {t(isAr, 'common.cancel')}
            </Btn>
            <Btn variant="danger" disabled={voidReason.trim().length < 10} loading={voiding} onClick={handleVoid}>
              {isAr ? 'تأكيد الإلغاء' : 'Confirmer l\'annulation'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
