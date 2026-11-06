'use client'
import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useApi } from '@/lib/data/api'
import { selectClass, inputClass, Select } from '@/components/shared'
import { useSiteLang } from './common'

// Which phones an accessory fits (owner, 2026-11-06; lib/compatModels):
// brand → series → models to tick, from the ERP phone list (every brand).
// The ticked names are saved as the fiche's "Modèle" choices.

type CompatModel = { brand: string; serie: string; model: string }

export function ModelPicker({ selected, onChange }: { selected: string[]; onChange: (models: string[]) => void }) {
  const { L } = useSiteLang()
  const q = useApi<CompatModel[]>('/api/site/compat-models')
  const all = useMemo(() => q.data ?? [], [q.data])
  const brands = useMemo(() => [...new Set(all.map(m => m.brand))], [all])
  const brandOf = useMemo(() => new Map(all.map(m => [m.model.toLowerCase(), m.brand])), [all])
  const firstBrand = selected.map(s => brandOf.get(s.toLowerCase())).find(Boolean) ?? 'Apple'
  const [brand, setBrand] = useState<string | null>(null)
  const [serie, setSerie] = useState('')
  const [search, setSearch] = useState('')
  const b = brand ?? firstBrand
  const series = useMemo(() => [...new Set(all.filter(m => m.brand === b).map(m => m.serie))], [all, b])
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const shown = all.filter(m => search.trim()
    ? norm(m.model).includes(norm(search.trim()))
    : m.brand === b && (!serie || m.serie === serie))
  const on = new Set(selected.map(s => s.toLowerCase()))
  const allShownOn = shown.length > 0 && shown.every(m => on.has(m.model.toLowerCase()))

  function toggle(model: string) {
    onChange(on.has(model.toLowerCase()) ? selected.filter(s => s.toLowerCase() !== model.toLowerCase()) : [...selected, model])
  }
  function toggleShown() {
    const names = new Set(shown.map(m => m.model.toLowerCase()))
    onChange(allShownOn ? selected.filter(s => !names.has(s.toLowerCase())) : [...selected, ...shown.map(m => m.model).filter(m => !on.has(m.toLowerCase()))])
  }

  // what is ticked, by brand
  const byBrand = new Map<string, string[]>()
  for (const s of selected) { const k = brandOf.get(s.toLowerCase()) ?? L('Autres', 'أخرى'); byBrand.set(k, [...(byBrand.get(k) ?? []), s]) }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Select value={b} onChange={e => { setBrand(e.target.value); setSerie(''); setSearch('') }} className={selectClass} aria-label={L('Marque', 'العلامة')}>
          {brands.map(x => <option key={x} value={x}>{x}</option>)}
        </Select>
        <Select value={serie} onChange={e => { setSerie(e.target.value); setSearch('') }} className={selectClass} aria-label={L('Série', 'السلسلة')}>
          <option value="">{L('Toutes les séries', 'كل السلاسل')}</option>
          {series.map(x => <option key={x} value={x}>{x}</option>)}
        </Select>
        <div className="relative">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-placeholder" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Chercher un modèle…', 'ابحث عن طراز…')} className={`${inputClass} ps-9`} />
        </div>
      </div>

      <div className="rounded-xl border border-ez-border">
        <label className="flex items-center gap-2 px-3 py-2 border-b border-ez-border text-sm font-semibold cursor-pointer bg-ez-bg rounded-t-xl">
          <input type="checkbox" checked={allShownOn} onChange={toggleShown} disabled={!shown.length} />
          {search.trim() ? L('Tout cocher (résultats)', 'تحديد الكل') : serie ? L(`Toute la série ${serie}`, `كل سلسلة ${serie}`) : L(`Tout ${b}`, `كل ${b}`)}
          <span className="ms-auto text-xs font-normal text-ez-subtle">{shown.length} {L('modèles', 'طراز')}</span>
        </label>
        <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-4 px-3 py-2">
          {q.isLoading && <p className="text-sm text-ez-subtle py-2">…</p>}
          {shown.map(m => (
            <label key={m.model} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
              <input type="checkbox" checked={on.has(m.model.toLowerCase())} onChange={() => toggle(m.model)} />
              <span className="truncate">{m.model}</span>
              {search.trim() && <span className="text-xs text-ez-faint truncate">· {m.serie}</span>}
            </label>
          ))}
          {!q.isLoading && !shown.length && <p className="text-sm text-ez-subtle py-2">{L('Aucun modèle', 'لا يوجد')}</p>}
        </div>
      </div>

      {selected.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-ez-subtle">{selected.length} {L('modèle(s) coché(s)', 'طراز محدد')}</p>
          {[...byBrand.entries()].map(([brandName, list]) => (
            <div key={brandName} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-ez-subtle me-1">{brandName}</span>
              {list.map(s => (
                <span key={s} className="inline-flex items-center gap-1 ps-2.5 pe-1 py-0.5 rounded-full bg-gold/10 border border-gold/30 text-xs">
                  {s}
                  <button type="button" onClick={() => toggle(s)} aria-label={L(`Retirer ${s}`, `حذف ${s}`)} className="p-0.5 rounded-full hover:bg-gold/20"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ez-subtle">{L('Aucun modèle coché : sur le site, l’article ne demande pas de modèle (universel).', 'بدون طراز: المنتج عام.')}</p>
      )}
    </div>
  )
}
