'use client'
import { useState } from 'react'
import { Plus, X, Barcode } from 'lucide-react'
import { apiWrite } from '@/lib/data/api'
import { Btn, inputClass, selectClass, Select } from '@/components/shared'
import ScanButton from '@/components/scanner/ScanButton'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { playScanSound } from '@/lib/scanSound'
import { useCouleurs, useColourLabel } from '@/components/shared/ColourPicker'
import { modelsLabel } from '@/lib/phoneGroups'
import type { Variant } from './VariantStockEditor'

// The codes that find this article when scanned (owner, 2026-11-07; rules in
// lib/accessoryCodes): the manufacturer's codes on its boxes and sachets,
// for the whole article or one variant. « Scanner des codes »: scan the boxes
// one after the other, each new code is added, a known one beeps differently.

export function AccessoryCodes({ accId, codes, variants, isAr, canDelete }: {
  accId: string
  codes: { code: string; variant_id: string | null }[]
  variants: Variant[]
  isAr: boolean
  canDelete: boolean
}) {
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const couleurs = useCouleurs()
  const colourLabel = useColourLabel()
  const [typed, setTyped] = useState('')
  const [target, setTarget] = useState('')   // '' = the whole article, else a variant_id
  const [busy, setBusy] = useState(false)
  const vLabel = (v: Variant) => [v.design, v.couleur && colourLabel(couleurs.byName.get(v.couleur), v.couleur), modelsLabel(v.modeles)].filter(Boolean).join(' · ')
  const of = (id: string | null) => { const v = id ? variants.find(x => x.variant_id === id) : null; return v ? vLabel(v) : L('tout l’article', 'كل المنتج') }

  async function add(code: string) {
    if (!code.trim()) return
    setBusy(true)
    try {
      const r = await apiWrite<{ data: { added: boolean; moved?: boolean } }>(`/api/accessories/${encodeURIComponent(accId)}/codes`, { method: 'POST', body: { code, variant_id: target || null } })
      const d = (r as unknown as { data: { added: boolean; moved?: boolean } }).data ?? r
      if (d.added) { playScanSound('inv_found'); showSuccess(L(`Code ${code.trim()} ajouté`, 'تمت الإضافة')) }
      else if (d.moved) { playScanSound('inv_found'); showSuccess(L('Code déplacé sur la variante choisie', 'تم النقل')) }
      else { playScanSound('inv_duplicate'); showSuccess(L('Code déjà connu', 'الرمز معروف')) }
      setTyped('')
    } catch (e) { playScanSound('error'); showError((e as Error).message) } finally { setBusy(false) }
  }

  async function remove(code: string) {
    try { await apiWrite(`/api/accessories/${encodeURIComponent(accId)}/codes`, { method: 'DELETE', body: { code } }); showSuccess(L('Code retiré', 'تم الحذف')) }
    catch (e) { showError((e as Error).message) }
  }

  return (
    <div className="rounded-xl border border-ez-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Barcode className="w-4 h-4 text-ez-subtle" />
        <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest">{L('Codes pour scanner cet article', 'رموز المسح')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-gold/10 border border-gold/30" title={L('Le code de nos étiquettes', 'رمز ملصقاتنا')}>EZ{Number(accId.replace(/\D/g, ''))}</span>
        {codes.map(c => (
          <span key={c.code} className="inline-flex items-center gap-1 ps-2.5 pe-1 py-1 rounded-full text-xs border border-ez-border bg-white">
            <span className="font-mono">{c.code}</span>
            <span className="text-ez-faint">· {of(c.variant_id)}</span>
            {canDelete && <button type="button" onClick={() => remove(c.code)} aria-label={L(`Retirer ${c.code}`, 'حذف')} className="p-0.5 rounded-full hover:bg-red-50 text-red-500"><X className="w-3 h-3" /></button>}
          </span>
        ))}
        {!codes.length && <span className="text-xs text-ez-faint">{L('Aucun code de boîte enregistré', 'لا يوجد رمز')}</span>}
      </div>
      <div className="grid sm:grid-cols-[1fr_1.2fr] gap-2">
        {variants.length > 0 ? (
          <Select value={target} onChange={e => setTarget(e.target.value)} className={selectClass} aria-label={L('Le code est pour', 'الرمز لـ')}>
            <option value="">{L('Pour : tout l’article', 'لكل المنتج')}</option>
            {variants.filter(v => v.variant_id).map(v => <option key={v.variant_id} value={v.variant_id}>{L('Pour : ', '')}{vLabel(v)}</option>)}
          </Select>
        ) : <span className="hidden sm:block" />}
        <div className="flex gap-2">
          <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(typed) }}
            placeholder={L('Scanner ou taper un code de boîte', 'امسح أو اكتب الرمز')} className={`${inputClass} font-mono`} />
          <ScanButton sound="accessories" onScan={v => add(v)} hint={L('Scannez le code de la boîte', 'امسح رمز العلبة')} mode="barcode" size="sm" />
          <Btn size="sm" variant="secondary" onClick={() => add(typed)} loading={busy} disabled={!typed.trim()}><Plus className="w-4 h-4" /></Btn>
        </div>
      </div>
      <p className="text-xs text-ez-faint">{L('Scannez les boîtes l’une après l’autre : chaque nouveau code est ajouté. Un code d’un autre article est refusé avec son nom.', 'امسح العلب واحدة تلو الأخرى.')}</p>
    </div>
  )
}
