'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '@/lib/data/api'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate, getBusinessDate } from '@/lib/utils'
import { t } from '@/lib/i18n/t'
import { PageHeader, SkeletonRow, EmptyState, StatusBadge, Modal, Field, Btn, Select } from '@/components/shared'
import { useUser } from '@/lib/hooks/useUser'
import { codeLabel } from '@/lib/codes'
import { STORE_TIME_ZONE } from '@/lib/time'
import type { OperationType, PaymentMethod } from '@/types/database'
import {
  ShoppingCart, RefreshCw, Calendar, X,
  ChevronDown, ChevronUp, Ban, AlertTriangle, Search
} from 'lucide-react'

// One sale line with its whole story (api/transactions?details=1 → lib/transactionDetails, 2026-11-06)
interface Transaction {
  txn_id:          string
  device_type:     string
  device_id:       string
  device_label:    string
  qty:             number
  store_id:        string
  type_operation:  string
  prix_vente:      number
  date_vente:      string
  payment_method:  string
  montant_especes?: number | null
  montant_carte?:  number | null
  montant_rendu?:  number | null
  payment_ref?:    string | null
  avoir_montant?:  number | null
  avance?:         number
  valeur_echange?: number
  marque_echange?: string | null
  model_echange?:  string | null
  stockage_echange?: string | null
  imei_echange?:   string | null
  clients?:        { nom: string; telephone: string } | null
  override_required?: boolean
  override_reason?: string | null
  warranty_expiry?:string | null
  notes?:          string | null
  voided?:         boolean
  voided_reason?:  string | null
  voided_at?:      string | null
  created_at:      string
  seller:          string | null
  reste:           number
  paid_later:      number
  plan:            { credit_id: string; total: number; paye: number; statut: string; remis: boolean } | null
  retours:         { retour_id: string; date: string; qty: number; montant: number; mode: string; motif: string; type: string }[]
  state:           'payee' | 'reste' | 'retour_partiel' | 'retournee' | 'annulee'
}

const STATE_STYLE: Record<Transaction['state'], string> = {
  payee:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  reste:          'bg-amber-50 text-amber-700 border-amber-200',
  retour_partiel: 'bg-blue-50 text-blue-700 border-blue-200',
  retournee:      'bg-blue-50 text-blue-700 border-blue-200',
  annulee:        'bg-red-50 text-red-600 border-red-200',
}
const hour = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: STORE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })


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

  const today      = getBusinessDate()
  const monthStart = today.slice(0, 7) + '-01'

  const [expanded, setExpanded]         = useState<string | null>(null)
  const [filterOp, setFilterOp]         = useState('')
  const [filterStore, setFilterStore]   = useState('')
  const [dateFrom, setDateFrom]         = useState(monthStart)
  const [dateTo, setDateTo]             = useState(today)
  const [query, setQuery]               = useState('')
  const [withVoided, setWithVoided]     = useState(false)

  const [voidTxnId, setVoidTxnId]   = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding]       = useState(false)

  const canVoid = user?.role === 'gerant' || user?.role === 'proprietaire'

  // Store list is only needed for the cross-store dot/filter — fetched live so a newly
  // added store shows up automatically (a hardcoded list here previously required a code change).
  const storesQ = useApi<{ store_id: string; name: string; theme_color: string; is_active: boolean }[]>(scope === 'all' ? '/api/stores' : null)
  const stores: StoreRef[] = useMemo(() => (storesQ.data ?? [])
    .filter(s => s.is_active)
    .map(s => ({ id: s.store_id, name: s.name, color: s.theme_color })), [storesQ.data])

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

  // Cached per store and period; the operation-type filter applies instantly here
  const params = new URLSearchParams({ limit: '1000', details: '1' })
  if (withVoided) params.set('include_voided', 'true')
  const effectiveStoreId = scope === 'store' ? storeId : filterStore
  if (effectiveStoreId) params.set('store_id', effectiveStoreId)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo)   params.set('date_to',   dateTo)
  const txnsQ   = useApi<Transaction[]>(`/api/transactions?${params}`)
  const loading = txnsQ.isLoading
  const [manualRefresh, setManualRefresh] = useState(false)
  // search: client, phone number, article, colour, sale / article id, trade-in IMEI, seller
  const transactions = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (txnsQ.data ?? []).filter(t => {
      if (filterOp && t.type_operation !== filterOp) return false
      if (!words.length) return true
      const text = [t.clients?.nom, t.clients?.telephone, t.device_label, t.device_id, t.txn_id, t.imei_echange, t.model_echange, t.seller].filter(Boolean).join(' ').toLowerCase()
      return words.every(w => text.includes(w))
    })
  }, [txnsQ.data, filterOp, query])

  const fetchTransactions = useCallback(async () => {
    setManualRefresh(true)
    try { await txnsQ.refresh() } finally { setManualRefresh(false) }
  }, [txnsQ])

  const live        = transactions.filter(t => !t.voided)
  const totalCA     = live.reduce((s, t) => s + Number(t.prix_vente ?? 0), 0)
  const totalVentes = live.length
  // what clients still owe on these sales (payment plans, client accounts)
  const totalReste  = live.reduce((s, t) => s + (t.reste ?? 0), 0)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header + filters */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? title.ar : title.fr}
          subtitle={isAr
            ? `${transactions.length} معاملة · ${formatMAD(totalCA)}`
            : `${transactions.length} transaction(s) · ${formatMAD(totalCA)}`}
          actions={
            <button
              onClick={fetchTransactions}
              disabled={manualRefresh}
              className="p-2 rounded-xl border border-ez-border bg-white text-ez-subtle hover:bg-gold-50 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${manualRefresh ? 'animate-spin' : ''}`} />
            </button>
          }
        />

        {/* Summary strip — on a phone: 2 tiles side by side, the amount full width */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: isAr ? 'إجمالي المبيعات' : 'Total CA', value: formatMAD(totalCA),  color: '#C9A440', money: true },
            { label: isAr ? 'عدد المبيعات'    : 'Nb ventes', value: String(totalVentes), color: '#10B981' },
            { label: isAr ? 'باقي للتحصيل' : 'Reste à encaisser', value: formatMAD(totalReste), color: '#F59E0B' },
          ].map(s => (
            <div
              key={s.label}
              className={`bg-white border border-ez-border rounded-xl px-4 py-3 ${'money' in s && s.money ? 'col-span-2 sm:col-span-1 order-last sm:order-none' : ''}`}
              style={{ borderLeftColor: s.color, borderLeftWidth: '3px' }}
            >
              <p className="text-xs text-ez-subtle">{s.label}</p>
              <p className="font-display font-bold text-lg text-ez-text">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4 bg-white border border-ez-border rounded-2xl">
          {/* Full width on a phone: both dates share the row instead of overflowing it */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Calendar className="w-4 h-4 text-ez-faint flex-shrink-0" />
            <input
              type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="flex-1 min-w-0 sm:flex-none text-sm border border-ez-border rounded-xl px-2 sm:px-3 py-2 bg-white focus:outline-none focus:border-gold transition-all"
            />
            <span className="text-ez-faint text-sm">→</span>
            <input
              type="date" value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="flex-1 min-w-0 sm:flex-none text-sm border border-ez-border rounded-xl px-2 sm:px-3 py-2 bg-white focus:outline-none focus:border-gold transition-all"
            />
          </div>

          {scope === 'all' && (
            <Select
              value={filterStore}
              onChange={e => setFilterStore(e.target.value)}
              className="text-sm border border-ez-border rounded-xl px-3 py-2 bg-white text-ez-subtle focus:outline-none"
            >
              <option value="">{t(isAr, 'common.allStores')}</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}

          <Select
            value={filterOp}
            onChange={e => setFilterOp(e.target.value)}
            className="text-sm border border-ez-border rounded-xl px-3 py-2 bg-white text-ez-subtle focus:outline-none focus:border-gold transition-all"
          >
            <option value="">{t(isAr, 'common.allTypes')}</option>
            <option value="vente">{t(isAr, 'common.sale')}</option>
            <option value="echange">{isAr ? 'استبدال' : 'Échange'}</option>
            <option value="retour">{t(isAr, 'common.returnNoun')}</option>
          </Select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-faint" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder={isAr ? 'زبون، هاتف، منتج، رقم…' : 'Client, téléphone, article, n°…'}
              className="w-full text-sm border border-ez-border rounded-xl ps-9 pe-3 py-2 bg-white focus:outline-none focus:border-gold" />
          </div>

          <label className="flex items-center gap-2 text-xs text-ez-subtle cursor-pointer select-none">
            <input type="checkbox" checked={withVoided} onChange={e => setWithVoided(e.target.checked)} />
            {isAr ? 'إظهار الملغاة' : 'Afficher les annulées'}
          </label>

          {(filterOp || filterStore || query) && (
            <button
              onClick={() => { setFilterOp(''); setFilterStore(''); setQuery('') }}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              <X className="w-3 h-3" />
              {isAr ? 'مسح' : 'Effacer'}
            </button>
          )}
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 pb-6">
        <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-ez-muted">
              {[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="w-7 h-7" />}
              title={t(isAr, 'common.noTransactions')}
              description={isAr ? 'حاول تعديل الفلاتر' : 'Essayez de modifier les filtres'}
            />
          ) : (
            <div className="divide-y divide-ez-muted">
              {transactions.map(txn => {
                const store = stores.find(s => s.id === txn.store_id)
                const isExp = expanded === txn.txn_id
                const lang  = isAr ? 'ar' : 'fr'
                const pay   = codeLabel('payment_method', txn.payment_method as PaymentMethod, lang)
                const cell  = (label: string, value: React.ReactNode, cls = 'text-ez-text') => (
                  <div><p className="text-ez-faint mb-0.5">{label}</p><div className={`font-bold ${cls}`}>{value}</div></div>
                )
                return (
                  <div key={txn.txn_id} className={`hover:bg-ez-bg transition-all ${txn.voided ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-4 px-5 py-3.5 cursor-pointer" onClick={() => setExpanded(isExp ? null : txn.txn_id)}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: scope === 'all' ? (store?.color ?? '#B0ADA6') : '#C9A440' }} />

                      <div className="flex-1 min-w-0">
                        {/* what was sold */}
                        <p className={`text-sm font-bold text-ez-text truncate ${txn.voided ? 'line-through' : ''}`}>
                          {(txn.qty ?? 1) > 1 && <span className="text-gold">{txn.qty} × </span>}
                          {txn.device_label}
                        </p>
                        {/* to whom, when, where, how, by whom */}
                        <div className="flex items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-ez-faint flex-wrap">
                          <span className="text-ez-subtle font-medium">{txn.clients?.nom || (isAr ? 'زبون غير معروف' : 'Client anonyme')}</span>
                          <span>·</span>
                          <span>{formatDate(txn.date_vente)} {hour(txn.created_at)}</span>
                          {scope === 'all' && store && (<><span>·</span><span style={{ color: store.color }}>{store.name}</span></>)}
                          <span>·</span>
                          <span>{codeLabel('operation_type', txn.type_operation as OperationType, lang)}</span>
                          <span>·</span>
                          <span>{pay}</span>
                          {txn.seller && (<><span>·</span><span>{isAr ? 'البائع' : 'par'} {txn.seller}</span></>)}
                          {txn.override_required && (
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-1.5 rounded font-bold">{isAr ? 'تحت الحد الأدنى' : 'Sous le minimum'}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0 space-y-1">
                        <p className="text-sm font-bold text-ez-text">{formatMAD(txn.prix_vente)}</p>
                        <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-lg border ${STATE_STYLE[txn.state]}`}>
                          {txn.state === 'reste' ? `${isAr ? 'باقي' : 'Reste'} ${formatMAD(txn.reste)}` : codeLabel('sale_state', txn.state, lang)}
                        </span>
                      </div>

                      {isExp ? <ChevronUp className="w-4 h-4 text-ez-faint flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-ez-faint flex-shrink-0" />}
                    </div>

                    {isExp && (
                      <div className="px-5 pb-4 animate-fade-in space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-ez-bg rounded-xl text-xs">
                          {cell(isAr ? 'رقم المعاملة' : 'N° de vente', <span className="font-mono">{txn.txn_id}</span>)}
                          {cell(isAr ? 'المنتج' : 'Article', <span className="font-mono">{txn.device_id}</span>)}
                          {cell(isAr ? 'الكمية' : 'Quantité', txn.qty ?? 1)}
                          {cell(t(isAr, 'common.salePrice'), formatMAD(txn.prix_vente), 'text-gold')}

                          {/* how it was paid */}
                          {cell(isAr ? 'الدفع' : 'Paiement', pay)}
                          {Number(txn.montant_especes ?? 0) > 0 && cell(isAr ? 'نقداً' : 'En espèces', formatMAD(Number(txn.montant_especes)))}
                          {Number(txn.montant_carte ?? 0) > 0 && cell(isAr ? 'تحويل / بطاقة' : 'Virement / carte', formatMAD(Number(txn.montant_carte)))}
                          {Number(txn.montant_rendu ?? 0) > 0 && cell(isAr ? 'الباقي المُرجع' : 'Monnaie rendue', formatMAD(Number(txn.montant_rendu)))}
                          {Number(txn.avoir_montant ?? 0) > 0 && cell(isAr ? 'رصيد مستعمل' : 'Avoir utilisé', formatMAD(Number(txn.avoir_montant)))}
                          {txn.payment_ref && cell(isAr ? 'مرجع الدفع' : 'Réf. paiement', txn.payment_ref)}
                          {Number(txn.avance ?? 0) > 0 && cell(t(isAr, 'common.avance'), formatMAD(Number(txn.avance)))}

                          {/* trade-in */}
                          {Number(txn.valeur_echange ?? 0) > 0 && cell(isAr ? 'الاسترجاع' : 'Reprise',
                            <>{formatMAD(Number(txn.valeur_echange))}<span className="block font-normal text-ez-subtle">{[txn.marque_echange, txn.model_echange, txn.stockage_echange].filter(Boolean).join(' ')}{txn.imei_echange ? ` · ${txn.imei_echange}` : ''}</span></>)}

                          {/* payment plan / client account */}
                          {txn.plan && cell(isAr ? 'ملف الدفع' : 'Paiement en plusieurs fois',
                            <>{txn.plan.credit_id}<span className="block font-normal text-ez-subtle">{formatMAD(txn.plan.paye)} / {formatMAD(txn.plan.total)} · {codeLabel('credit_status', txn.plan.statut as never, lang)}{txn.plan.remis ? (isAr ? ' · سُلّم' : ' · remis') : (isAr ? ' · محجوز' : ' · réservé')}</span></>)}
                          {txn.paid_later > 0 && cell(isAr ? 'دُفع بعد البيع' : 'Payé depuis la vente', formatMAD(txn.paid_later))}
                          {!txn.voided && cell(t(isAr, 'common.remainingToPay'), formatMAD(txn.reste), txn.reste > 0 ? 'text-amber-600' : 'text-emerald-600')}

                          {txn.warranty_expiry && cell(isAr ? 'الضمان حتى' : 'Garantie jusqu’au', formatDate(txn.warranty_expiry))}
                          {txn.clients?.telephone && cell(isAr ? 'هاتف الزبون' : 'Tél. client', txn.clients.telephone)}
                          {txn.seller && cell(isAr ? 'البائع' : 'Vendu par', txn.seller)}
                          {cell(isAr ? 'سُجّل في' : 'Enregistré le', `${formatDate(txn.created_at)} ${hour(txn.created_at)}`)}
                        </div>

                        {txn.override_reason && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{isAr ? 'تحت الحد الأدنى:' : 'Sous le prix minimum :'} {txn.override_reason}</p>
                        )}

                        {/* returns on this sale */}
                        {txn.retours.length > 0 && (
                          <div className="text-xs bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 space-y-1">
                            {txn.retours.map(r => (
                              <p key={r.retour_id} className="text-blue-800">
                                <b>{r.type === 'retour' ? (isAr ? 'إرجاع' : 'Retour') : (isAr ? 'تسديد رصيد' : 'Avoir remboursé')} {r.retour_id}</b>
                                {' · '}{formatDate(r.date)} · {r.qty} × · {formatMAD(r.montant)} · {codeLabel('retour_mode', r.mode as never, lang)}{r.motif ? ` · ${r.motif}` : ''}
                              </p>
                            ))}
                          </div>
                        )}

                        {txn.voided && (
                          <p className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                            <Ban className="w-3.5 h-3.5 flex-shrink-0" />
                            <span><b>{isAr ? 'ملغاة' : 'Annulée'}</b>{txn.voided_at ? ` ${isAr ? 'في' : 'le'} ${formatDate(txn.voided_at)}` : ''}{txn.voided_reason ? ` · ${txn.voided_reason}` : ''}</span>
                          </p>
                        )}
                        {txn.notes && <p className="text-xs text-ez-subtle px-1">{txn.notes}</p>}

                        {canVoid && !txn.voided && (
                          <button
                            onClick={e => { e.stopPropagation(); setVoidTxnId(txn.txn_id); setVoidReason('') }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-all"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            {isAr ? 'إلغاء المعاملة' : 'Annuler la transaction'}
                          </button>
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
              className="w-full border border-ez-border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none"
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
