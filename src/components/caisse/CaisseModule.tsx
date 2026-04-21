'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Btn, Field, inputClass, Modal } from '@/components/shared'
import { toast } from 'sonner'
import {
  Vault, TrendingUp, Receipt, Wrench,
  CheckCircle, Clock, XCircle, RefreshCw,
  ArrowDown, ArrowUp, AlertTriangle, Loader2
} from 'lucide-react'

interface CaisseData {
  caisse_id:          string
  date:               string
  ouverture:          number
  total_ventes:       number
  total_reparations:  number
  total_depenses:     number
  solde_theorique:    number
  solde_reel:         number | null
  ecart:              number | null
  status:             'open' | 'pending_eod' | 'closed'
  payment_breakdown:  { cash: number; transfer: number; credit: number }
  nb_transactions:    number
  notes:              string | null
  rejection_note:     string | null
  eod_submitted_at:   string | null
}

interface CaisseModuleProps {
  storeId: string
}

export default function CaisseModule({ storeId }: CaisseModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor

  const [caisse, setCaisse]         = useState<CaisseData | null>(null)
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // BOD form
  const [bodOpen, setBodOpen]       = useState(false)
  const [bodAmount, setBodAmount]   = useState('')

  // EOD form
  const [eodOpen, setEodOpen]       = useState(false)
  const [eodAmount, setEodAmount]   = useState('')
  const [eodNotes, setEodNotes]     = useState('')

  const today = new Date().toISOString().split('T')[0]

  const fetchCaisse = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/caisse?store_id=${storeId}&date=${today}`)
      const json = await res.json()
      setCaisse(json.data ?? null)
    } catch {
      toast.error(isAr ? 'خطأ في تحميل صندوق الدفع' : 'Erreur chargement caisse')
    } finally {
      setLoading(false)
    }
  }, [storeId, today])

  useEffect(() => { fetchCaisse() }, [fetchCaisse])

  // Auto-refresh every 60 seconds while open
  useEffect(() => {
    if (caisse?.status !== 'open') return
    const interval = setInterval(fetchCaisse, 60_000)
    return () => clearInterval(interval)
  }, [caisse?.status, fetchCaisse])

  async function handleBOD() {
    const amount = parseFloat(bodAmount)
    if (isNaN(amount) || amount < 0) {
      toast.error(isAr ? 'أدخل مبلغاً صحيحاً' : 'Montant invalide')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/caisse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ store_id: storeId, ouverture: amount }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isAr ? 'تم فتح صندوق الدفع ✓' : 'Caisse ouverte ✓')
      setBodOpen(false)
      setBodAmount('')
      await fetchCaisse()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEOD() {
    const amount = parseFloat(eodAmount)
    if (isNaN(amount) || amount < 0) {
      toast.error(isAr ? 'أدخل مبلغاً صحيحاً' : 'Montant invalide')
      return
    }
    if (!caisse?.caisse_id) return
    setSubmitting(true)
    try {
      const res  = await fetch('/api/caisse', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          caisse_id: caisse.caisse_id,
          solde_reel: amount,
          notes: eodNotes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isAr ? 'تم إرسال طلب الإغلاق ✓' : 'Clôture soumise pour approbation ✓')
      setEodOpen(false)
      setEodAmount('')
      setEodNotes('')
      await fetchCaisse()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────
  if (loading && !caisse) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: primary }} />
      </div>
    )
  }

  // ── No caisse today — BOD needed ──────────────────────────
  if (!caisse) {
    return (
      <div className="p-6 max-w-lg mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
               style={{ backgroundColor: `${primary}15` }}>
            <Vault className="w-10 h-10" style={{ color: primary }} />
          </div>
          <h1 className="font-display text-3xl font-bold text-[#1A1A1A] tracking-wide mb-2">
            {isAr ? 'صندوق الدفع مغلق' : 'Caisse non ouverte'}
          </h1>
          <p className="text-[#6B6860] text-sm mb-8">
            {isAr
              ? 'يجب فتح صندوق الدفع قبل تسجيل أي عملية اليوم'
              : 'Ouvrez la caisse avant de commencer les opérations du jour'}
          </p>
          <button
            className="font-display tracking-wider px-8 py-3 rounded-xl text-white font-bold text-lg transition-all active:scale-[0.98] hover:opacity-90"
            style={{ backgroundColor: primary, boxShadow: `0 4px 16px ${primary}40` }}
            onClick={() => setBodOpen(true)}
          >
            {isAr ? 'فتح صندوق الدفع' : 'Ouvrir la caisse'}
          </button>
        </div>

        {/* BOD Modal */}
        <Modal
          open={bodOpen}
          onClose={() => setBodOpen(false)}
          title={isAr ? 'فتح صندوق الدفع' : 'Ouverture de caisse'}
          size="sm"
        >
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-4 rounded-xl" style={{ backgroundColor: `${primary}10`, border: `1px solid ${primary}30` }}>
              <ArrowDown className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: primary }} />
              <div>
                <p className="text-sm font-medium text-[#1A1A1A]">
                  {isAr ? 'عد النقود في الصندوق' : 'Comptez le cash dans le tiroir'}
                </p>
                <p className="text-xs text-[#6B6860] mt-0.5">
                  {isAr ? 'أدخل المبلغ الفعلي الموجود' : 'Entrez le montant physique présent'}
                </p>
              </div>
            </div>

            <Field label={isAr ? 'مبلغ الافتتاح (درهم)' : 'Montant d\'ouverture (MAD)'} required>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                placeholder="0.00"
                value={bodAmount}
                onChange={e => setBodAmount(e.target.value)}
                autoFocus
              />
            </Field>

            <div className="flex gap-3 justify-end pt-2">
              <Btn variant="secondary" onClick={() => setBodOpen(false)}>
                {isAr ? 'إلغاء' : 'Annuler'}
              </Btn>
              <button
                onClick={handleBOD}
                disabled={submitting || !bodAmount}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                style={{ backgroundColor: primary }}
              >
                {submitting && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
                {isAr ? 'فتح صندوق الدفع' : 'Ouvrir'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    )
  }

  // ── Pending EOD — waiting for manager approval ────────────
  if (caisse.status === 'pending_eod') {
    return (
      <div className="p-6 max-w-lg mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="font-display text-2xl font-bold text-[#1A1A1A] tracking-wide mb-2">
            {isAr ? 'في انتظار الموافقة' : 'En attente d\'approbation'}
          </h2>
          <p className="text-[#6B6860] text-sm">
            {isAr
              ? 'تم إرسال طلب إغلاق صندوق الدفع. في انتظار موافقة المدير أو المالك.'
              : 'La clôture a été soumise. En attente de validation manager/propriétaire.'}
          </p>
          {caisse.eod_submitted_at && (
            <p className="text-xs text-[#B0ADA6] mt-2">
              {isAr ? 'أرسل في' : 'Soumis le'}{' '}
              {new Date(caisse.eod_submitted_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        {/* Summary */}
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5 space-y-3">
          <SummaryRow label={isAr ? 'مبلغ الافتتاح' : 'Ouverture'}       value={formatMAD(caisse.ouverture)}          />
          <SummaryRow label={isAr ? 'إجمالي المبيعات' : 'Total ventes'}    value={formatMAD(caisse.total_ventes)}       color="text-emerald-600" />
          <SummaryRow label={isAr ? 'إجمالي الإصلاحات' : 'Total réparations'} value={formatMAD(caisse.total_reparations)} color="text-emerald-600" />
          <SummaryRow label={isAr ? 'إجمالي المصاريف' : 'Total dépenses'}  value={formatMAD(caisse.total_depenses)}     color="text-red-500" />
          <div className="border-t border-[#E8E5DE] pt-3">
            <SummaryRow label={isAr ? 'الرصيد المتوقع' : 'Solde théorique'} value={formatMAD(caisse.solde_theorique)} bold />
            <SummaryRow label={isAr ? 'الرصيد الفعلي' : 'Solde réel'}       value={formatMAD(caisse.solde_reel ?? 0)} bold />
            {caisse.ecart != null && (
              <SummaryRow
                label={isAr ? 'الفرق' : 'Écart'}
                value={formatMAD(caisse.ecart)}
                bold
                color={caisse.ecart === 0 ? 'text-emerald-600' : 'text-red-500'}
              />
            )}
          </div>
        </div>

        {/* Rejection note if any */}
        {caisse.rejection_note && (
          <div className="mt-4 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">
                {isAr ? 'تم رفض الإغلاق' : 'Clôture rejetée'}
              </p>
              <p className="text-xs text-red-600 mt-0.5">{caisse.rejection_note}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Closed ─────────────────────────────────────────────────
  if (caisse.status === 'closed') {
    return (
      <div className="p-6 max-w-lg mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="font-display text-2xl font-bold text-[#1A1A1A] tracking-wide mb-1">
            {isAr ? 'صندوق الدفع مغلق' : 'Caisse clôturée'}
          </h2>
          <p className="text-[#6B6860] text-sm">
            {isAr ? 'تمت الموافقة على إغلاق اليوم' : 'La clôture du jour a été approuvée'}
          </p>
        </div>

        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5 space-y-3">
          <SummaryRow label={isAr ? 'مبلغ الافتتاح' : 'Ouverture'}          value={formatMAD(caisse.ouverture)} />
          <SummaryRow label={isAr ? 'إجمالي المبيعات' : 'Total ventes'}       value={formatMAD(caisse.total_ventes)} color="text-emerald-600" />
          <SummaryRow label={isAr ? 'إجمالي الإصلاحات' : 'Total réparations'} value={formatMAD(caisse.total_reparations)} color="text-emerald-600" />
          <SummaryRow label={isAr ? 'إجمالي المصاريف' : 'Total dépenses'}     value={formatMAD(caisse.total_depenses)} color="text-red-500" />
          <div className="border-t border-[#E8E5DE] pt-3">
            <SummaryRow label={isAr ? 'الرصيد المتوقع' : 'Solde théorique'}   value={formatMAD(caisse.solde_theorique)} bold />
            <SummaryRow label={isAr ? 'الرصيد الفعلي' : 'Solde réel'}         value={formatMAD(caisse.solde_reel ?? 0)} bold />
            {caisse.ecart != null && (
              <SummaryRow
                label={isAr ? 'الفرق' : 'Écart'}
                value={formatMAD(caisse.ecart)}
                bold
                color={caisse.ecart === 0 ? 'text-emerald-600' : 'text-red-500'}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Open — main view ──────────────────────────────────────
  const ecartPreview = eodAmount
    ? parseFloat(eodAmount) - caisse.solde_theorique
    : null

  return (
    <div className="p-6 space-y-5 max-w-2xl mx-auto animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#1A1A1A] tracking-wide">
            {isAr ? 'كاسيير اليوم' : 'Caisse du jour'}
          </h1>
          <p className="text-[#6B6860] text-sm mt-0.5">
            {formatDate(caisse.date)}
            {' · '}
            <span className="text-emerald-600 font-medium">
              {isAr ? 'مفتوح' : 'Ouverte'}
            </span>
          </p>
        </div>
        <button
          onClick={fetchCaisse}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-white transition-all disabled:opacity-50"
          style={{ borderColor: `${primary}40`, color: '#6B6860' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isAr ? 'تحديث' : 'Actualiser'}
        </button>
      </div>

      {/* Opening amount */}
      <div className="bg-white border border-[#E8E5DE] rounded-2xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{ backgroundColor: `${primary}15` }}>
          <Vault className="w-5 h-5" style={{ color: primary }} />
        </div>
        <div>
          <p className="text-xs text-[#6B6860]">{isAr ? 'مبلغ الافتتاح' : 'Montant d\'ouverture'}</p>
          <p className="font-display text-xl font-bold text-[#1A1A1A]">{formatMAD(caisse.ouverture)}</p>
        </div>
      </div>

      {/* Live aggregation cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label:  isAr ? 'إجمالي المبيعات' : 'Total ventes',
            value:  caisse.total_ventes,
            count:  `${caisse.nb_transactions} op.`,
            icon:   TrendingUp,
            color:  '#10B981',
            bg:     '#F0FDF4',
          },
          {
            label:  isAr ? 'إجمالي الإصلاحات' : 'Total réparations',
            value:  caisse.total_reparations,
            icon:   Wrench,
            color:  '#F59E0B',
            bg:     '#FFFBEB',
          },
          {
            label:  isAr ? 'إجمالي المصاريف' : 'Total dépenses',
            value:  caisse.total_depenses,
            icon:   Receipt,
            color:  '#EF4444',
            bg:     '#FEF2F2',
          },
        ].map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-white border border-[#E8E5DE] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#6B6860] leading-snug">{card.label}</p>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                     style={{ backgroundColor: card.bg }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: card.color }} />
                </div>
              </div>
              <p className="font-display text-lg font-bold text-[#1A1A1A]">{formatMAD(card.value)}</p>
              {card.count && <p className="text-xs text-[#B0ADA6] mt-0.5">{card.count}</p>}
            </div>
          )
        })}
      </div>

      {/* Payment breakdown */}
      {caisse.payment_breakdown && (
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5">
          <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-4">
            {isAr ? 'تفصيل طرق الدفع' : 'Répartition paiements'}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: isAr ? 'نقد' : 'Espèces',  value: caisse.payment_breakdown.cash },
              { label: isAr ? 'تحويل' : 'Virement', value: caisse.payment_breakdown.transfer },
              { label: isAr ? 'تسبيق' : 'Avances',  value: caisse.payment_breakdown.credit },
            ].map(row => (
              <div key={row.label} className="text-center p-3 bg-[#F8F7F4] rounded-xl">
                <p className="text-xs text-[#6B6860] mb-1">{row.label}</p>
                <p className="font-bold text-sm text-[#1A1A1A]">{formatMAD(row.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Theoretical balance */}
      <div className="bg-white border-2 rounded-2xl p-5"
           style={{ borderColor: primary }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[#6B6860] uppercase tracking-widest">
              {isAr ? 'الرصيد النظري المتوقع' : 'Solde théorique attendu'}
            </p>
            <p className="font-display text-3xl font-bold mt-1" style={{ color: primary }}>
              {formatMAD(caisse.solde_theorique)}
            </p>
            <p className="text-xs text-[#B0ADA6] mt-1">
              {isAr
                ? `${formatMAD(caisse.ouverture)} + ${formatMAD(caisse.total_ventes)} + ${formatMAD(caisse.total_reparations)} - ${formatMAD(caisse.total_depenses)}`
                : `${formatMAD(caisse.ouverture)} + ventes + rép. - dépenses`}
            </p>
          </div>
          <ArrowUp className="w-8 h-8 opacity-20" style={{ color: primary }} />
        </div>
      </div>

      {/* EOD Button */}
      <button
        onClick={() => setEodOpen(true)}
        className="w-full py-4 rounded-2xl font-display font-bold text-lg tracking-wider text-white transition-all active:scale-[0.98] hover:opacity-90"
        style={{
          backgroundColor: '#1A1A1A',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}
      >
        {isAr ? 'إغلاق صندوق الدفع (نهاية اليوم)' : 'Clôturer la caisse (fin de journée)'}
      </button>

      {/* EOD Modal */}
      <Modal
        open={eodOpen}
        onClose={() => { setEodOpen(false); setEodAmount(''); setEodNotes('') }}
        title={isAr ? 'إغلاق صندوق الدفع' : 'Clôture de caisse'}
        size="sm"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 bg-[#F8F7F4] rounded-xl border border-[#E8E5DE]">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[#1A1A1A]">
                {isAr ? 'عد النقود في الصندوق الآن' : 'Comptez le cash dans le tiroir maintenant'}
              </p>
              <p className="text-xs text-[#6B6860] mt-0.5">
                {isAr
                  ? `الرصيد المتوقع: ${formatMAD(caisse.solde_theorique)}`
                  : `Solde théorique: ${formatMAD(caisse.solde_theorique)}`}
              </p>
            </div>
          </div>

          <Field label={isAr ? 'الرصيد الفعلي المعدود (درهم)' : 'Solde réel compté (MAD)'} required>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              placeholder="0.00"
              value={eodAmount}
              onChange={e => setEodAmount(e.target.value)}
              autoFocus
            />
          </Field>

          {/* Live ecart preview */}
          {ecartPreview != null && (
            <div className={`flex items-center justify-between p-3 rounded-xl border text-sm font-bold ${
              ecartPreview === 0
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : ecartPreview > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-red-50 border-red-200 text-red-600'
            }`}>
              <span>{isAr ? 'الفرق' : 'Écart'}</span>
              <span>
                {ecartPreview > 0 ? '+' : ''}{formatMAD(ecartPreview)}
                {' '}
                {ecartPreview === 0
                  ? '✓'
                  : ecartPreview > 0
                  ? (isAr ? '(زيادة)' : '(excédent)')
                  : (isAr ? '(نقص)' : '(manquant)')}
              </span>
            </div>
          )}

          <Field label={isAr ? 'ملاحظات (اختياري)' : 'Notes (optionnel)'}>
            <textarea
              className={`${inputClass} resize-none text-sm`}
              rows={2}
              value={eodNotes}
              onChange={e => setEodNotes(e.target.value)}
              placeholder={isAr ? 'أي ملاحظة للمدير...' : 'Note pour le manager...'}
            />
          </Field>

          <div className="flex gap-3 justify-end pt-1">
            <Btn variant="secondary" onClick={() => { setEodOpen(false); setEodAmount(''); setEodNotes('') }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn
              variant="primary"
              onClick={handleEOD}
              loading={submitting}
              disabled={!eodAmount}
            >
              {isAr ? 'إرسال للموافقة' : 'Soumettre pour approbation'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Sub-component: summary row ─────────────────────────────────
function SummaryRow({
  label, value, bold, color,
}: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-sm ${bold ? 'font-bold text-[#1A1A1A]' : 'text-[#6B6860]'}`}>{label}</span>
      <span className={`text-sm font-bold ${color || (bold ? 'text-[#1A1A1A]' : 'text-[#1A1A1A]')}`}>{value}</span>
    </div>
  )
}