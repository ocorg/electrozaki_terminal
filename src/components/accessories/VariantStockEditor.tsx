'use client'
import { useMemo, useState } from 'react'
import { Plus, Minus, Trash2, Search, Layers } from 'lucide-react'
import { apiWrite } from '@/lib/data/api'
import { Btn, inputClass } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { confirmDialog } from '@/components/shared/ConfirmHost'
import { ColourPicker, ColourDot, useCouleurs, useColourLabel } from '@/components/shared/ColourPicker'
import { ModelPicker } from '@/components/site/ModelPicker'

// Stock per variant in the fiche (owner, 2026-11-06; rules in lib/accessoryVariants):
// design × colour × phone model, each optional. Pieces not counted here are
// "non réparti". Adding: one design + colour, then tick the phone models →
// one line per model.

export type Variant = { variant_id?: string; design: string | null; couleur: string | null; modele: string | null; quantite: number }
type Line = Variant & { key: string }

const keyOf = (v: Omit<Variant, 'quantite'>) => `${(v.design ?? '').toLowerCase()}|${(v.couleur ?? '').toLowerCase()}|${(v.modele ?? '').toLowerCase()}`

export function VariantStockEditor({ accId, total, variants, isAr, photoChoices = [], onSaved }: {
  accId: string
  total: number
  variants: Variant[]
  isAr: boolean
  /** design × colour of the website photos, to start from */
  photoChoices?: { design: string | null; couleur: string }[]
  onSaved?: () => void
}) {
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const couleurs = useCouleurs()
  const colourLabel = useColourLabel()
  const initial = useMemo(() => variants.map(v => ({ ...v, key: keyOf(v) })), [variants])
  const [lines, setLines] = useState<Line[]>(initial)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  // the "add" form
  const [adding, setAdding] = useState(false)
  const [design, setDesign] = useState('')
  const [couleur, setCouleur] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [qty, setQty] = useState('0')

  const counted = lines.reduce((n, l) => n + l.quantite, 0)
  const unassigned = Math.max(0, total - counted)
  const extra = Math.max(0, counted - total)
  const changed = JSON.stringify(lines.map(l => [l.key, l.quantite])) !== JSON.stringify(initial.map(l => [l.key, l.quantite]))
  const designs = [...new Set([...photoChoices.map(p => p.design), ...lines.map(l => l.design)].filter((d): d is string => !!d))]

  const label = (l: Variant) => [l.design, l.couleur && colourLabel(couleurs.byName.get(l.couleur), l.couleur), l.modele].filter(Boolean).join(' · ')
  const shown = filter.trim() ? lines.filter(l => label(l).toLowerCase().includes(filter.trim().toLowerCase())) : lines

  function setQ(key: string, q: number) { setLines(ls => ls.map(l => l.key === key ? { ...l, quantite: Math.max(0, Math.floor(q) || 0) } : l)) }
  function remove(key: string) { setLines(ls => ls.filter(l => l.key !== key)) }

  function addLines() {
    const d = design.trim() || null
    const q = Math.max(0, Math.floor(Number(qty)) || 0)
    const list = (models.length ? models : [null]).map(m => ({ design: d, couleur, modele: m, quantite: q }))
    if (list.every(v => !v.design && !v.couleur && !v.modele)) { showError(L('Choisissez un design, une couleur ou un modèle', 'اختر تصميماً أو لوناً أو طرازاً')); return }
    setLines(ls => {
      const out = [...ls]
      for (const v of list) {
        const key = keyOf(v)
        const i = out.findIndex(l => l.key === key)
        if (i >= 0) out[i] = { ...out[i], quantite: q || out[i].quantite }
        else out.push({ ...v, key })
      }
      return out
    })
    setModels([]); setQty('0')
    showSuccess(L(`${list.length} ligne(s) ajoutée(s) — pensez à enregistrer`, 'تمت الإضافة'))
  }

  function fromPhotos() {
    setLines(ls => {
      const out = [...ls]
      for (const p of photoChoices) {
        const v = { design: p.design, couleur: p.couleur, modele: null, quantite: 0 }
        const key = keyOf(v)
        if (!out.some(l => l.key === key)) out.push({ ...v, key })
      }
      return out
    })
  }

  async function save() {
    if (extra > 0 && !(await confirmDialog(L(
      `Les variantes comptent ${counted} pièces, le stock en a ${total} : ${extra} nouvelle(s) pièce(s) seront ajoutées au stock (${total} → ${counted}). Continuer ?`,
      `ستضاف ${extra} قطعة جديدة إلى المخزون. متابعة؟`)))) return
    setSaving(true)
    try {
      await apiWrite(`/api/accessories/${encodeURIComponent(accId)}/variants`, {
        method: 'PUT', body: { lines: lines.map(({ design, couleur, modele, quantite }) => ({ design, couleur, modele, quantite })) },
      })
      showSuccess(L('Stock par variante enregistré', 'تم الحفظ'))
      onSaved?.()
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { k: L('Stock total', 'المخزون'), v: Math.max(total, counted) },
          { k: L('Compté par variante', 'حسب النوع'), v: counted },
          { k: L('Non réparti', 'غير موزع'), v: unassigned },
        ].map(x => (
          <div key={x.k} className="rounded-xl border border-ez-border bg-white px-2 py-2">
            <p className="text-[11px] text-ez-subtle">{x.k}</p>
            <p className="text-lg font-bold tabular-nums">{x.v}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-ez-subtle">
        {L('Non réparti = les pièces pas encore comptées par variante : elles se vendent comme avant. Donnez-leur une variante petit à petit (ou pendant un inventaire).',
           'غير موزع = قطع لم تُحسب بعد حسب النوع.')}
      </p>

      {lines.length > 0 && (
        <div className="rounded-xl border border-ez-border">
          {lines.length > 8 && (
            <div className="relative border-b border-ez-border">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-placeholder" />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={L('Chercher une variante…', 'بحث…')}
                className="w-full ps-9 pe-3 py-2 text-sm rounded-t-xl focus:outline-none" />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto divide-y divide-ez-border">
            {shown.map(l => (
              <div key={l.key} className="flex items-center gap-2 px-3 py-2">
                {l.couleur ? <ColourDot colour={couleurs.byName.get(l.couleur)} size={14} /> : <Layers className="w-3.5 h-3.5 text-ez-faint" />}
                <span className="flex-1 min-w-0 text-sm truncate">{label(l)}</span>
                <button type="button" onClick={() => setQ(l.key, l.quantite - 1)} disabled={l.quantite === 0} aria-label={L('Retirer 1', 'إنقاص')}
                  className="w-8 h-8 rounded-lg border border-ez-border flex items-center justify-center disabled:opacity-30"><Minus className="w-3.5 h-3.5" /></button>
                <input type="number" min={0} value={l.quantite} onChange={e => setQ(l.key, Number(e.target.value))}
                  className="w-14 text-center rounded-lg border border-ez-border py-1 text-sm tabular-nums" aria-label={L('Quantité', 'الكمية')} />
                <button type="button" onClick={() => setQ(l.key, l.quantite + 1)} aria-label={L('Ajouter 1', 'إضافة')}
                  className="w-8 h-8 rounded-lg border border-ez-border flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => remove(l.key)} aria-label={L('Supprimer la variante', 'حذف')}
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Btn variant="secondary" size="sm" onClick={() => setAdding(a => !a)}><Plus className="w-4 h-4" />{L('Ajouter des variantes', 'إضافة')}</Btn>
        {photoChoices.length > 0 && (
          <Btn variant="secondary" size="sm" onClick={fromPhotos}>{L('Partir des photos du site (design × couleur)', 'من صور الموقع')}</Btn>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <p className="text-xs font-semibold text-ez-subtle mb-1">{L('Design (si plusieurs)', 'التصميم')}</p>
              <input value={design} onChange={e => setDesign(e.target.value)} list={`designs-${accId}`} maxLength={40} className={inputClass} placeholder={L('ex. Monogramme', 'مثال')} />
              <datalist id={`designs-${accId}`}>{designs.map(d => <option key={d} value={d} />)}</datalist>
            </div>
            <div>
              <p className="text-xs font-semibold text-ez-subtle mb-1">{L('Couleur', 'اللون')}</p>
              <ColourPicker value={couleur} onChange={setCouleur} emptyLabel={L('Sans couleur', 'بدون لون')} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-ez-subtle mb-1">{L('Téléphones (une ligne par modèle coché ; aucun = pas de modèle)', 'الهواتف')}</p>
            <ModelPicker selected={models} onChange={setModels} emptyNote={null} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <p className="text-xs font-semibold text-ez-subtle mb-1">{L('Pièces par ligne', 'القطع لكل سطر')}</p>
              <input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} className={`${inputClass} w-28`} />
            </div>
            <Btn size="sm" onClick={addLines}><Plus className="w-4 h-4" />{L(`Ajouter ${Math.max(1, models.length)} ligne(s)`, 'إضافة')}</Btn>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        {extra > 0 && <span className="text-xs text-amber-700">{L(`+${extra} nouvelle(s) pièce(s) au stock`, `+${extra}`)}</span>}
        <Btn onClick={save} loading={saving} disabled={!changed}>{L('Enregistrer le stock par variante', 'حفظ')}</Btn>
      </div>
    </div>
  )
}
