'use client'
import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Modal, Field, Btn, inputClass } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'

interface Props {
  open:         boolean
  onClose:      () => void
  overrideItem: { _id: string; _displayName: string } | null
  isAr:         boolean
  primary:      string
  onAuthorized: (userId: string | null, reason: string) => void
}

export default function OverridePinModal({ open, onClose, isAr, primary, onAuthorized }: Props) {
  const [pin,     setPin]     = useState('')
  const [reason,  setReason]  = useState('')
  const [loading, setLoading] = useState(false)

  function handleClose() { setPin(''); setReason(''); onClose() }

  async function handleVerify() {
    if (pin.length !== 4) {
      showError(isAr ? 'يلزم كود PIN من 4 أرقام' : 'Code PIN 4 chiffres requis')
      return
    }
    if (!reason.trim()) {
      showError(isAr ? 'سبب التجاوز مطلوب' : 'Motif de dérogation obligatoire')
      return
    }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/verify-override', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin }),
      })
      const json = await res.json()
      if (!json.authorized) throw new Error(isAr ? 'كود غلط' : 'Code incorrect')
      showSuccess(isAr ? 'تمت الموافقة ✓' : 'Dérogation autorisée ✓')
      onAuthorized(json.user_id ?? null, reason.trim())
      handleClose()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally { setLoading(false) }
  }

  return (
    <Modal open={open} onClose={handleClose}
      title={isAr ? 'تجاوز السعر الأدنى' : 'Dérogation prix minimum'} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {isAr ? 'السعر أقل من الحد الأدنى' : 'Prix sous le minimum autorisé'}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {isAr ? 'يلزم كود PIN من المدير أو المالك' : 'Un manager ou propriétaire doit saisir son code PIN'}
            </p>
          </div>
        </div>
        <Field label={isAr ? 'كود PIN (4 أرقام)' : 'Code PIN (4 chiffres)'}>
          <input type="password" maxLength={4}
            className={`${inputClass} text-center text-2xl tracking-[0.5em] font-mono`}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="••••" autoFocus />
        </Field>
        <Field label={isAr ? 'سبب التجاوز *' : 'Motif de dérogation *'}>
          <input type="text" className={inputClass} value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={isAr ? 'مثال: موافقة العميل...' : 'Ex: Accord client, vente en gros...'} />
        </Field>
        <div className="flex gap-3 justify-end">
          <Btn variant="secondary" onClick={handleClose}>{isAr ? 'إلغاء' : 'Annuler'}</Btn>
          <Btn variant="primary" onClick={handleVerify} loading={loading} disabled={pin.length !== 4}
            style={{ backgroundColor: primary } as React.CSSProperties}>
            {isAr ? 'تأكيد' : 'Confirmer'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}