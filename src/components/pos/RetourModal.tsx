'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal, Btn } from '@/components/shared'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD } from '@/lib/utils'
import { Loader2, RotateCcw, AlertTriangle } from 'lucide-react'
import { showSuccess, showError } from '@/lib/utils/toasts'

interface Transaction {
  txn_id:         string
  device_type:    string
  device_id:      string
  prix_vente:     number
  date_vente:     string
  payment_method: string
  voided:         boolean
  clients?:       { nom: string } | null
}

interface RetourModalProps {
  open:         boolean
  onClose:      () => void
  storeId:      string
  primary:      string
  onRetourDone: () => void
}

export default function RetourModal({
  open, onClose, storeId, primary, onRetourDone,
}: RetourModalProps) {
  const { language } = useLanguageStore()
  const isAr   = language === 'ar'
  const supabase = createClient()

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [deviceNames,  setDeviceNames]  = useState<Record<string, string>>({})
  const [loading,      setLoading]      = useState(false)
  const [selected,     setSelected]     = useState<Transaction | null>(null)
  const [reason,       setReason]       = useState('')
  const [submitting,   setSubmitting]   = useState(false)

  useEffect(() => {
    if (!open) {
      setSelected(null)
      setReason('')
      return
    }
    setLoading(true)
    fetch(`/api/transactions?store_id=${storeId}&limit=30`)
      .then(r => r.json())
      .then(async j => {
        const nonVoided = (j.data || []).filter((t: Transaction) => !t.voided) as Transaction[]
        setTransactions(nonVoided)

        if (nonVoided.length === 0) return

        // Batch-resolve device names per type
        const pIds = nonVoided.filter(t => t.device_type === 'هاتف').map(t => t.device_id)
        const aIds = nonVoided.filter(t => t.device_type === 'إكسسوار').map(t => t.device_id)
        const lIds = nonVoided.filter(t => t.device_type === 'لابتوب').map(t => t.device_id)

        const [pRes, aRes, lRes] = await Promise.all([
          pIds.length > 0
            ? supabase.from('phones').select('phone_id, marque, model, stockage, couleur').in('phone_id', pIds)
            : { data: [] },
          aIds.length > 0
            ? supabase.from('accessories').select('acc_id, nom, marque').in('acc_id', aIds)
            : { data: [] },
          lIds.length > 0
            ? supabase.from('laptops').select('laptop_id, marque, model, stockage').in('laptop_id', lIds)
            : { data: [] },
        ])

        const names: Record<string, string> = {}

        for (const p of (pRes.data || []) as {
          phone_id: string; marque: string; model: string
          stockage?: string | null; couleur?: string | null
        }[]) {
          names[p.phone_id] = [
            p.marque, p.model, p.stockage,
            p.couleur ? `· ${p.couleur}` : '',
          ].filter(Boolean).join(' ')
        }

        for (const a of (aRes.data || []) as {
          acc_id: string; nom: string; marque?: string | null
        }[]) {
          names[a.acc_id] = [a.nom, a.marque ? `· ${a.marque}` : ''].filter(Boolean).join(' ')
        }

        for (const l of (lRes.data || []) as {
          laptop_id: string; marque: string; model: string; stockage?: string | null
        }[]) {
          names[l.laptop_id] = [l.marque, l.model, l.stockage].filter(Boolean).join(' ')
        }

        setDeviceNames(names)
      })
      .catch(e => showError(e.message))
      .finally(() => setLoading(false))
  }, [open, storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVoid() {
    if (!selected) return
    if (!reason.trim()) {
      showError(isAr ? 'سبب الإرجاع مطلوب' : 'Motif de retour obligatoire')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/transactions/void', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txn_id: selected.txn_id, voided_reason: reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الإرجاع بنجاح ✓' : 'Retour enregistré ✓')
      onClose()
      onRetourDone()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // Human-readable label: resolved name first, typed fallback second
  function deviceLabel(t: Transaction): string {
    if (deviceNames[t.device_id]) return deviceNames[t.device_id]
    const type = t.device_type === 'هاتف'
      ? (isAr ? 'هاتف' : 'Téléphone')
      : t.device_type === 'إكسسوار'
      ? (isAr ? 'إكسسوار' : 'Accessoire')
      : (isAr ? 'لابتوب' : 'Laptop')
    return `${type} — ${t.device_id}`
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAr ? 'تسجيل إرجاع' : 'Retour de vente'}
      size="lg"
    >
      <div className="space-y-4">

        {/* Warning banner */}
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">
            {isAr
              ? 'سيتم إلغاء المعاملة المختارة وإعادة الجهاز إلى المخزون وخصم المبلغ من الصندوق تلقائياً.'
              : "La transaction sera annulée, l'appareil remis en stock et le montant déduit de la caisse automatiquement."}
          </p>
        </div>

        {/* Transaction list */}
        <div className="max-h-64 overflow-y-auto border border-[#E8E5DE] rounded-xl divide-y divide-[#F2F0EB]">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-[#B0ADA6] animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-center text-sm text-[#B0ADA6] py-10">
              {isAr ? 'لا توجد معاملات مؤخراً' : 'Aucune transaction récente'}
            </p>
          ) : (
            transactions.map(t => (
              <button
                key={t.txn_id}
                onClick={() => setSelected(t)}
                className="w-full flex items-start gap-4 px-4 py-3 text-left transition-all"
                style={{
                  backgroundColor: selected?.txn_id === t.txn_id ? `${primary}12` : 'white',
                  borderLeft:      selected?.txn_id === t.txn_id ? `3px solid ${primary}` : '3px solid transparent',
                }}
              >
                <div className="flex-1 min-w-0">
                  {/* Device name — the key improvement */}
                  <p className="text-sm font-bold text-[#1A1A1A] truncate">
                    {deviceLabel(t)}
                  </p>
                  <p className="text-xs text-[#6B6860]">
                    {t.txn_id} · {t.clients?.nom ?? (isAr ? 'عميل عابر' : 'Comptoir')}
                  </p>
                  <p className="text-xs text-[#B0ADA6]">
                    {t.date_vente} · {t.payment_method}
                  </p>
                </div>
                <p className="text-sm font-bold flex-shrink-0" style={{ color: primary }}>
                  {formatMAD(t.prix_vente)}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Selected transaction summary */}
        {selected && (
          <div className="bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest">
              {isAr ? 'المعاملة المختارة' : 'Transaction sélectionnée'}
            </p>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm">
              <span className="text-[#6B6860]">{isAr ? 'المنتج' : 'Article'}</span>
              <span className="font-bold truncate">{deviceLabel(selected)}</span>
              <span className="text-[#6B6860]">Réf.</span>
              <span className="font-mono text-xs text-[#B0ADA6]">{selected.txn_id}</span>
              <span className="text-[#6B6860]">{isAr ? 'العميل' : 'Client'}</span>
              <span className="font-bold">{selected.clients?.nom ?? '—'}</span>
              <span className="text-[#6B6860]">{isAr ? 'المبلغ المُسترد' : 'Montant à rembourser'}</span>
              <span className="font-bold text-red-600">- {formatMAD(selected.prix_vente)}</span>
            </div>
            <div>
              <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1.5">
                {isAr ? 'سبب الإرجاع *' : 'Motif du retour *'}
              </label>
              <input
                className="w-full border border-[#E8E5DE] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none transition-all"
                placeholder={isAr
                  ? 'مثال: عيب مصنعي، طلب العميل...'
                  : 'Ex: Défaut fabricant, demande client...'}
                value={reason}
                onChange={e => setReason(e.target.value)}
                onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
                onBlur={e =>  { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Btn variant="secondary" onClick={onClose}>
            {isAr ? 'إلغاء' : 'Annuler'}
          </Btn>
          <button
            onClick={handleVoid}
            disabled={!selected || !reason.trim() || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold transition-all hover:bg-red-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RotateCcw className="w-4 h-4" />}
            {isAr ? 'تأكيد الإرجاع' : 'Confirmer le retour'}
          </button>
        </div>

      </div>
    </Modal>
  )
}