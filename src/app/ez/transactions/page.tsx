'use client'
import { useState, useEffect, useCallback } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { PageHeader, SkeletonRow, EmptyState, StatusBadge } from '@/components/shared'
import {
  ShoppingCart, RefreshCw, Calendar, X,
  ChevronDown, ChevronUp
} from 'lucide-react'

const STORE_ID = 'EZ-001'

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
  created_at:      string
}

const OP_LABELS_FR: Record<string, string> = {
  'بيع': 'Vente', 'إستبدال': 'Échange', 'تسبيق': 'Avance', 'Retour': 'Retour',
}
const PAY_LABELS_FR: Record<string, string> = {
  'نقد': 'Espèces', 'تحويل': 'Virement', 'تسبيق': 'Avance',
  'إستبدال': 'Échange', 'مختلط': 'Mixte',
}

export default function EZTransactionsPage() {
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'

  const today      = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState<string | null>(null)
  const [filterOp,  setFilterOp]        = useState('')
  const [dateFrom,  setDateFrom]        = useState(monthStart)
  const [dateTo,    setDateTo]          = useState(today)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: STORE_ID, limit: '300' })
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      let data: Transaction[] = json.data || []

      if (dateFrom) data = data.filter(t => t.date_vente >= dateFrom)
      if (dateTo)   data = data.filter(t => t.date_vente <= dateTo)
      if (filterOp) data = data.filter(t => t.type_operation === filterOp)

      setTransactions(data)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, filterOp])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const totalCA     = transactions.reduce((s, t) => s + (t.prix_vente ?? 0), 0)
  const totalVentes = transactions.filter(t => t.type_operation === 'بيع').length
  const totalCredit = transactions.filter(t => (t.fariq ?? 0) > 0).length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header + filters */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'المعاملات' : 'Transactions — Electro Zaki'}
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
            { label: isAr ? 'إجمالي المبيعات' : 'Total CA',      value: formatMAD(totalCA),     color: '#C9A440' },
            { label: isAr ? 'عدد المبيعات'    : 'Nb ventes',      value: String(totalVentes),    color: '#10B981' },
            { label: isAr ? 'تسبيقات مفتوحة'  : 'Avances ouvertes',value: String(totalCredit),   color: '#F59E0B' },
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

          <select
            value={filterOp}
            onChange={e => setFilterOp(e.target.value)}
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860] focus:outline-none focus:border-[#C9A440] transition-all"
          >
            <option value="">{isAr ? 'كل الأنواع' : 'Tous types'}</option>
            <option value="بيع">{isAr ? 'بيع' : 'Vente'}</option>
            <option value="إستبدال">{isAr ? 'استبدال' : 'Échange'}</option>
            <option value="تسبيق">{isAr ? 'تسبيق' : 'Avance'}</option>
            <option value="Retour">{isAr ? 'إرجاع' : 'Retour'}</option>
          </select>

          {filterOp && (
            <button
              onClick={() => setFilterOp('')}
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
              title={isAr ? 'لا توجد معاملات' : 'Aucune transaction'}
              description={isAr ? 'حاول تعديل الفلاتر' : 'Essayez de modifier les filtres'}
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {transactions.map(txn => {
                const isExp = expanded === txn.txn_id
                const fariq = (txn.prix_vente ?? 0) - (txn.avance ?? 0) - (txn.valeur_echange ?? 0)

                return (
                  <div key={txn.txn_id} className="hover:bg-[#F8F7F4] transition-all">
                    <div
                      className="flex items-center gap-4 px-5 py-3.5 cursor-pointer"
                      onClick={() => setExpanded(isExp ? null : txn.txn_id)}
                    >
                      {/* Gold accent */}
                      <div className="w-2 h-2 rounded-full flex-shrink-0 bg-[#C9A440]" />

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
                            <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'سعر البيع' : 'Prix vente'}</p>
                            <p className="font-bold text-[#C9A440]">{formatMAD(txn.prix_vente)}</p>
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
                            <p className="text-[#B0ADA6] mb-0.5">{isAr ? 'المتبقي' : 'Reste à payer'}</p>
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
    </div>
  )
}