'use client'
import { useState } from 'react'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { Modal, Field, Btn, inputClass } from '@/components/shared'
import { t } from '@/lib/i18n/t'

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
    <Modal open={open} onClose={handleClose} title={t(isAr, 'common.manualCashDeposit')} size="sm"
           closeLabel={t(isAr, 'common.close')}>
      <div className="space-y-4">
        <Field label={t(isAr, 'common.amountMad')}>
          <input
            type="number"
            className={inputClass}
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label={isAr ? 'السبب *' : 'Motif *'}>
          <input
            type="text"
            className={inputClass}
            placeholder={isAr ? 'مثال: دفع دين قديم' : 'Ex: remboursement dette ancienne'}
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </Field>
        <div className="flex gap-2 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={handleClose}>
            {t(isAr, 'common.cancel')}
          </Btn>
          <Btn
            variant="primary"
            className="flex-1"
            disabled={!amount || !reason.trim()}
            loading={submitting}
            onClick={handleSubmit}
            style={{ backgroundColor: primary }}
          >
            {t(isAr, 'common.confirm')}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
