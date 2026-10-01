'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, Btn } from '@/components/shared'
import { useLanguageStore } from '@/lib/stores/language'

// The ERP's own "are you sure?" window, in place of the browser's grey
// window.confirm(). Usage (inside an async handler):
//   if (!(await confirmDialog('Supprimer cet import ?'))) return
type Ask = { message: string; danger: boolean; resolve: (ok: boolean) => void }
let show: ((ask: Ask) => void) | null = null

// Destructive wording gets a red confirm button
const DANGER = /supprim|retir|annul|effac|حذف|إلغاء/i

export function confirmDialog(message: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => {
    const danger = opts.danger ?? DANGER.test(message)
    if (show) show({ message, danger, resolve })
    else resolve(window.confirm(message))   // host not mounted (should not happen)
  })
}

export default function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const isAr = useLanguageStore(s => s.language) === 'ar'
  useEffect(() => {
    show = setAsk
    return () => { show = null }
  }, [])

  const answer = (ok: boolean) => { ask?.resolve(ok); setAsk(null) }

  return (
    <Modal open={!!ask} onClose={() => answer(false)} title={isAr ? 'تأكيد' : 'Confirmation'} size="sm">
      <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-3">
          {ask?.danger && (
            <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </div>
          )}
          <p className="text-sm text-ez-text leading-relaxed pt-1.5">{ask?.message}</p>
        </div>
        <div className="flex gap-3 justify-end">
          <Btn variant="secondary" onClick={() => answer(false)}>{isAr ? 'رجوع' : 'Retour'}</Btn>
          <Btn variant={ask?.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
            {isAr ? 'تأكيد' : 'Confirmer'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
