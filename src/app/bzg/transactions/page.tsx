'use client'
import { useState, useEffect, useCallback } from 'react'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { PageHeader, SkeletonRow, EmptyState, StatusBadge } from '@/components/shared'
import { useUser } from '@/lib/hooks/useUser'
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

const STORES = [
  { id: 'EZ-001', name: 'Electro Zaki', color: '#C9A440' },
]
// Void modal state — lifted to page level

const OP_LABELS_FR: Record<string, string> = {
  'بيع': 'Vente', 'إستبدال': 'Échange', 'تسبيق': 'Avance', 'Retour': 'Retour',
}
// Inside the transaction row JSX, add a voided indicator next to txn_id.
// Also update the Transaction interface to include voided:
// voided?: boolean
// voided_reason?: string | null
const PAY_LABELS_FR: Record<string, string> = {
  'نقد': 'Espèces', 'تحويل': 'Virement', 'تسبيق': 'Avance',
  'إستبدال': 'Échange', 'مختلط': 'Mixte',
}

export default function BZGTransactionsPage() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState<string | null>(null)

  const today      = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  const [filterStore,  setFilterStore]  = useState('')
  const [filterOp,     setFilterOp]     = useState('')
  const [dateFrom,     setDateFrom]     = useState(monthStart)
  const [dateTo,       setDateTo]       = useState(today)

    const { user }                    = useUser()
  const [voidTxnId, setVoidTxnId]   = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding]       = useState(false)

  const canVoid = user?.role === 'manager' || user?.role === 'owner'

  async function handleVoid() {
    if (!voidTxnId || voidReason.trim().length < 10) {
      showError('Motif requis (10 caractères minimum)')
      return
    }
    setVoiding(true)
    try {
      const res  = await fetch('/api/transactions', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txn_id: voidTxnId, voided_reason: voidReason.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess('Transaction annulée ✓')
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
      const params = new URLSearchParams({ limit: '200' })
      if (filterStore) params.set('store_id', filterStore)
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      let data: Transaction[] = json.data || []

      // Client-side filter by date + op type
      if (dateFrom) data = data.filter(t => t.date_vente >= dateFrom)
      if (dateTo)   data = data.filter(t => t.date_vente <= dateTo)
      if (filterOp) data = data.filter(t => t.type_operation === filterOp)

      setTransactions(data)
    } finally {
      setLoading(false)
    }
  }, [filterStore, filterOp, dateFrom, dateTo])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  // Totals
  const totalCA      = transactions.reduce((s, t) => s + (t.prix_vente ?? 0), 0)
  const totalVentes  = transactions.filter(t => t.type_operation === 'بيع').length
  const totalEchanges = transactions.filter(t => t.type_operation === 'إستبدال').length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'المعاملات' : 'Transactions'}
          subtitle={isAr
            ? `${transactions.length} معاملة — ${formatMAD(totalCA)}`
            : `${transactions.length} transaction(s) — ${formatMAD(totalCA)}`}
          actions={
            <button onClick={fetchTransactions} disabled={loading}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          }
        />

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: isAr ? 'إجمالي الإيرادات' : 'Total CA',      value: formatMAD(totalCA),      color: '#6366F1' },
            { label: isAr ? 'مبيعات'           : 'Ventes',         value: String(totalVentes),     color: '#10B981' },
            { label: isAr ? 'استبدالات'        : 'Échanges',       value: String(totalEchanges),   color: '#F59E0B' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
                 style={{ borderLeftColor: s.color, borderLeftWidth: '3px' }}>
              <p className="text-xs text-[#6B6860]">{s.label}</p>
              <p className="font-display font-bold text-lg text-[#1A1A1A]">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 p-4 bg-white border border-[#E8E5DE] rounded-2xl">
          {/* Date range */}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#B0ADA6]" />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white focus:outline-none" />
            <span className="text-[#B0ADA6] text-sm">→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white focus:outline-none" />
          </div>

          {/* Store */}
          <select className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860] focus:outline-none"
            value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">{isAr ? 'كل المتاجر' : 'Tous magasins'}</option>
            {STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Op type */}
          <select className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860] focus:outline-none"
            value={filterOp} onChange={e => setFilterOp(e.target.value)}>
            <option value="">{isAr ? 'كل الأنواع' : 'Tous types'}</option>
            <option value="بيع">{isAr ? 'بيع' : 'Vente'}</option>
            <option value="إستبدال">{isAr ? 'استبدال' : 'Échange'}</option>
            <option value="Retour">{isAr ? 'إرجاع' : 'Retour'}</option>
          </select>

          {(filterStore || filterOp) && (
            <button onClick={() => { setFilterStore(''); setFilterOp('') }}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
              <X className="w-3 h-3" />
              {isAr ? 'مسح' : 'Effacer'}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState icon={<ShoppingCart className="w-7 h-7" />}
              title={isAr ? 'لا توجد معاملات' : 'Aucune transaction'}
              description={isAr ? 'لا توجد نتائج لهذه الفلاتر' : 'Aucun résultat'} />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {transactions.map(txn => {
                const store   = STORES.find(s => s.id === txn.store_id)
                const isExp   = expanded === txn.txn_id
                const fariq   = (txn.prix_vente ?? 0) - (txn.avance ?? 0) - (txn.valeur_echange ?? 0)
                return (
                  <div key={txn.txn_id} className="hover:bg-[#F8F7F4] transition-all">
                    <div
                      className="flex items-center gap-4 px-5 py-3.5 cursor-pointer"
                      onClick={() => setExpanded(isExp ? null : txn.txn_id)}
                    >
                      {/* Store dot */}
                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                           style={{ backgroundColor: store?.color ?? '#B0ADA6' }} />

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
                          <span>·</span>
                          <span style={{ color: store?.color }}>{store?.name}</span>
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

                    {/* Expanded */}
                    {isExp && (
                      <div className="px-5 pb-4 animate-fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F8F7F4] rounded-xl text-xs">
                          <div>
                            <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'معرف المعاملة' : 'ID'}</p>
                            <p className="font-mono font-bold text-[#1A1A1A]">{txn.txn_id}</p>
                          </div>
                          <div>
                            <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'سعر البيع' : 'Prix vente'}</p>
                            <p className="font-bold text-[#1A1A1A]">{formatMAD(txn.prix_vente)}</p>
                          </div>
                          {(txn.avance ?? 0) > 0 && (
                            <div>
                              <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'التسبيق' : 'Avance'}</p>
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
                            <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'المتبقي' : 'Reste'}</p>
                            <p className={`font-bold ${fariq === 0 ? 'text-emerald-600' : fariq > 0 ? 'text-amber-600' : 'text-blue-500'}`}>
                              {formatMAD(fariq)}
                            </p>
                          </div>
                          {txn.warranty_expiry && (
                            <div>
                              <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'انتهاء الضمان' : 'Garantie expire'}</p>
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
                            Annuler la transaction
                          </button>
                        )}
                        {txn.voided && (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold">
                            <Ban className="w-3.5 h-3.5" /> ANNULÉE
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
      {voidTxnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-800 text-sm">Annuler la transaction {voidTxnId}?</p>
                <p className="text-red-600 text-xs mt-1">Cette action est irréversible.</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                Motif d'annulation *
              </label>
              <textarea
                className="w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none"
                rows={3}
                placeholder="Minimum 10 caractères..."
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                autoFocus
              />
              <p className="text-[10px] text-[#B0ADA6] mt-1">{voidReason.length}/10 min</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setVoidTxnId(null); setVoidReason('') }}
                className="px-4 py-2 rounded-xl border border-[#E8E5DE] text-[#6B6860] text-sm hover:bg-[#F8F7F4] transition-all">
                Annuler
              </button>
              <button onClick={handleVoid} disabled={voiding || voidReason.trim().length < 10}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-all disabled:opacity-50">
                {voiding ? 'Annulation...' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}