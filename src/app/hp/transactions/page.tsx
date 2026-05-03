'use client'
import { useState, useEffect, useCallback } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { useUser } from '@/lib/hooks/useUser'
import { formatMAD, formatDate } from '@/lib/utils'
import { PageHeader, SkeletonRow, EmptyState, StatusBadge } from '@/components/shared'
import { toast } from 'sonner'
import {
  ShoppingCart, RefreshCw, X,
  ChevronDown, ChevronUp, Ban, AlertTriangle
} from 'lucide-react'

const STORE_ID = 'HP-001'

interface Transaction {
  txn_id:          string
  device_type:     string
  device_id:       string
  type_operation:  string
  prix_vente:      number
  date_vente:      string
  payment_method:  string
  avance?:         number
  valeur_echange?: number
  fariq?:          number
  statut_paiement?: string
  clients?:        { nom: string; telephone: string } | null
  voided?:         boolean
  voided_reason?:  string | null
  notes?:          string | null
  created_at:      string
}

const OP_LABELS_FR: Record<string, string> = {
  'بيع': 'Vente', 'إستبدال': 'Échange', 'تسبيق': 'Avance', 'Retour': 'Retour',
}

export default function HPTransactionsPage() {
  const { language } = useLanguageStore()
  const { user }     = useUser()
  const isAr         = language === 'ar'
  const canVoid      = user?.role === 'manager' || user?.role === 'owner'

  const today      = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState<string | null>(null)
  const [filterOp, setFilterOp]         = useState('')
  const [dateFrom, setDateFrom]         = useState(monthStart)
  const [dateTo, setDateTo]             = useState(today)
  const [voidTxnId, setVoidTxnId]       = useState<string | null>(null)
  const [voidReason, setVoidReason]     = useState('')
  const [voiding, setVoiding]           = useState(false)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: STORE_ID, limit: '500' })
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo)   params.set('date_to',   dateTo)
      if (filterOp) params.set('type_operation', filterOp)
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      setTransactions(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, filterOp])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  async function handleVoid() {
    if (!voidTxnId || voidReason.trim().length < 10) return
    setVoiding(true)
    try {
      const res  = await fetch('/api/transactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txn_id: voidTxnId, voided_reason: voidReason.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Transaction annulée ✓')
      setVoidTxnId(null); setVoidReason('')
      fetchTransactions()
    } catch (err: unknown) { toast.error((err as Error).message) }
    finally { setVoiding(false) }
  }

  const totalCA    = transactions.reduce((s, t) => s + (t.prix_vente ?? 0), 0)
  const totalVentes = transactions.filter(t => t.type_operation === 'بيع').length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'المعاملات' : 'Transactions'}
          subtitle={`${transactions.length} transaction(s) — ${formatMAD(totalCA)}`}
          actions={<button onClick={fetchTransactions} disabled={loading}
            className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>}
        />

        <div className="flex flex-wrap gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#6B6860]" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#6B6860]" />
          <select value={filterOp} onChange={e => setFilterOp(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#6B6860]">
            <option value="">Toutes opérations</option>
            {Object.entries(OP_LABELS_FR).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {filterOp && <button onClick={() => setFilterOp('')} className="p-2 text-[#B0ADA6] hover:text-[#1A1A1A]"><X className="w-4 h-4" /></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2">
        {loading ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />) :
         transactions.length === 0 ? <EmptyState icon={<ShoppingCart className="w-8 h-8" />} title="Aucune transaction" /> :
         transactions.map(t => (
          <div key={t.txn_id} className={`bg-white border rounded-xl overflow-hidden ${t.voided ? 'opacity-60 border-red-200' : 'border-[#E8E5DE]'}`}>
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#F8F7F4] transition-all"
              onClick={() => setExpanded(expanded === t.txn_id ? null : t.txn_id)}>
              {t.voided && <span className="text-[10px] font-bold bg-red-50 border border-red-200 text-red-600 px-2 py-0.5 rounded font-mono">ANNULÉE</span>}
              <span className="text-xs font-mono text-[#B0ADA6]">{t.txn_id}</span>
              <span className="text-sm font-medium text-[#1A1A1A] flex-1">{t.clients?.nom || '—'}</span>
              <span className="text-xs text-[#6B6860]">{OP_LABELS_FR[t.type_operation] || t.type_operation}</span>
              <span className="font-bold text-sm text-[#0EA5E9]">{formatMAD(t.prix_vente)}</span>
              <span className="text-xs text-[#B0ADA6]">{t.date_vente}</span>
              {expanded === t.txn_id ? <ChevronUp className="w-4 h-4 text-[#B0ADA6]" /> : <ChevronDown className="w-4 h-4 text-[#B0ADA6]" />}
            </div>

            {expanded === t.txn_id && (
              <div className="px-4 pb-4 space-y-3 border-t border-[#F2F0EB] pt-3">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><p className="text-[10px] text-[#B0ADA6] uppercase font-mono mb-0.5">Appareil</p><p className="font-medium">{t.device_id}</p></div>
                  <div><p className="text-[10px] text-[#B0ADA6] uppercase font-mono mb-0.5">Paiement</p><p>{t.payment_method}</p></div>
                  {(t.fariq ?? 0) !== 0 && <div><p className="text-[10px] text-[#B0ADA6] uppercase font-mono mb-0.5">Reste</p><StatusBadge status={t.statut_paiement ?? ''} /></div>}
                </div>
                {t.notes && <p className="text-xs text-[#6B6860] bg-[#F8F7F4] rounded-lg px-3 py-2">{t.notes}</p>}
                {t.voided && t.voided_reason && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Annulée: {t.voided_reason}</p>}
                {canVoid && !t.voided && (
                  <button onClick={e => { e.stopPropagation(); setVoidTxnId(t.txn_id); setVoidReason('') }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-all">
                    <Ban className="w-3.5 h-3.5" /> Annuler la transaction
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Void modal */}
      {voidTxnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="font-bold text-red-800 text-sm">Annuler {voidTxnId} ?</p>
            </div>
            <textarea className="w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none" rows={3}
              placeholder="Motif (min 10 caractères)..." value={voidReason} onChange={e => setVoidReason(e.target.value)} autoFocus />
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setVoidTxnId(null); setVoidReason('') }}
                className="px-4 py-2 rounded-xl border border-[#E8E5DE] text-sm">Annuler</button>
              <button onClick={handleVoid} disabled={voiding || voidReason.trim().length < 10}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50">
                {voiding ? '...' : "Confirmer l'annulation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}