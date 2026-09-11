'use client'
import { useState } from 'react'
import { showSuccess, showError } from '@/lib/utils/toasts'

interface Props {
  open:    boolean
  onClose: () => void
  storeId: string
  isAr:    boolean
  primary: string
}

export default function CashDropModal({ open, onClose, storeId, isAr, primary }: Props) {
  const [amount,     setAmount]     = useState('')
  const [reason,     setReason]     = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  function handleClose() { setAmount(''); setReason(''); onClose() }

  async function handleSubmit() {
    if (!amount || !reason.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/cash-drops', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount: Number(amount), reason: reason.trim(), store_id: storeId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      showSuccess(isAr ? 'تم تسجيل الإيداع ✓' : 'Encaissement enregistré ✓')
      handleClose()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <p className="text-sm font-bold text-[#1A1A1A]">
          {isAr ? 'إيداع نقدي' : 'Encaissement manuel'}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
              {isAr ? 'المبلغ (درهم) *' : 'Montant (MAD) *'}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2.5 text-sm border border-[#E8E5DE] rounded-xl focus:outline-none focus:border-emerald-400"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
              {isAr ? 'السبب *' : 'Motif *'}
            </label>
            <input
              type="text"
              className="w-full px-3 py-2.5 text-sm border border-[#E8E5DE] rounded-xl focus:outline-none focus:border-emerald-400"
              placeholder={isAr ? 'مثال: دفع دين قديم' : 'Ex: remboursement dette ancienne'}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
            {isAr ? 'إلغاء' : 'Annuler'}
          </button>
          <button type="button" disabled={submitting || !amount || !reason.trim()} onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: primary }}>
            {submitting ? '...' : (isAr ? 'تأكيد' : 'Confirmer')}
          </button>
        </div>
      </div>
    </div>
  )
}