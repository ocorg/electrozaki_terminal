'use client'
import { useMemo, useState } from 'react'
import { Search, Barcode } from 'lucide-react'
import { Modal, Btn, inputClass, selectClass, Select } from '@/components/shared'
import { apiWrite } from '@/lib/data/api'
import { showError, showSuccess } from '@/lib/utils/toasts'
import { modelsLabel } from '@/lib/phoneGroups'
import { confirmDialog } from '@/components/shared/ConfirmHost'

// An unknown code scanned at the till (owner, 2026-11-07; lib/accessoryCodes):
// « C'est quel article ? ». Picked once, the code is kept on the article (or one
// of its variants) and found straight away the next times.

type Acc = { acc_id: string; nom: string; marque?: string | null; couleur?: string | null; variants?: { variant_id: string; design: string | null; couleur: string | null; modeles: string[] }[] }

export function LinkCodeModal({ code, accessories, isAr, onLinked, onClose }: {
  code: string
  accessories: Acc[]
  isAr: boolean
  onLinked: (accId: string, variantId: string | null) => void
  onClose: () => void
}) {
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Acc | null>(null)
  const [variant, setVariant] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return []
    return accessories.filter(a => tokens.every(t => [a.nom, a.marque, a.couleur, a.acc_id].some(v => v?.toLowerCase().includes(t)))).slice(0, 8)
  }, [q, accessories])

  async function link(share = false) {
    if (!picked) return
    setBusy(true)
    try {
      await apiWrite(`/api/accessories/${encodeURIComponent(picked.acc_id)}/codes`, { method: 'POST', body: { code, variant_id: variant || null, share } })
      showSuccess(L('Code associé : il sera reconnu la prochaine fois', 'تم الربط'))
      onLinked(picked.acc_id, variant || null)
    } catch (e) {
      const msg = (e as Error).message
      if (!share && /partagez-le/.test(msg)) {
        setBusy(false)
        if (await confirmDialog(`${msg}\n\nPartager ce code ?`)) return link(true)
        return
      }
      showError(msg)
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={L('Code inconnu : c’est quel article ?', 'رمز غير معروف')} size="md">
      <div className="space-y-3" dir={isAr ? 'rtl' : 'ltr'}>
        <p className="flex items-center gap-2 text-sm"><Barcode className="w-4 h-4 text-ez-subtle" /><span className="font-mono">{code}</span></p>
        {!picked ? (
          <>
            <div className="relative">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-placeholder" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('Nom de l’article…', 'اسم المنتج…')} className={`${inputClass} ps-9`} />
            </div>
            <div className="border border-ez-border rounded-xl divide-y divide-ez-border">
              {shown.map(a => (
                <button key={a.acc_id} type="button" onClick={() => setPicked(a)} className="w-full text-start px-3 py-2.5 hover:bg-ez-muted text-sm">
                  <b>{a.nom}</b>{a.marque ? <span className="text-ez-subtle"> · {a.marque}</span> : null}
                  <span className="block text-xs text-ez-faint">{a.acc_id}{a.variants?.length ? ` · ${a.variants.length} variante(s)` : ''}</span>
                </button>
              ))}
              {!shown.length && <p className="px-3 py-3 text-sm text-ez-faint">{q.trim() ? L('Aucun article', 'لا شيء') : L('Tapez le nom pour chercher', 'اكتب الاسم')}</p>}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-gold/40 bg-gold/5 px-3 py-2 text-sm flex items-center justify-between gap-2">
              <span><b>{picked.nom}</b>{picked.marque ? ` · ${picked.marque}` : ''}</span>
              <button type="button" onClick={() => { setPicked(null); setVariant('') }} className="text-xs underline text-ez-subtle">{L('Changer', 'تغيير')}</button>
            </div>
            {!!picked.variants?.length && (
              <Select value={variant} onChange={e => setVariant(e.target.value)} className={selectClass} aria-label={L('Le code est pour', 'الرمز لـ')}>
                <option value="">{L('Pour : tout l’article (la caisse demandera la variante)', 'لكل المنتج')}</option>
                {picked.variants.map(v => <option key={v.variant_id} value={v.variant_id}>{L('Pour : ', '')}{[v.design, v.couleur, modelsLabel(v.modeles)].filter(Boolean).join(' · ')}</option>)}
              </Select>
            )}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={onClose}>{L('Annuler', 'إلغاء')}</Btn>
              <Btn onClick={() => link()} loading={busy}>{L('Associer et ajouter au panier', 'ربط وإضافة')}</Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
