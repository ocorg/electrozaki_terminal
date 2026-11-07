'use client'
import { useMemo, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { Modal } from '@/components/shared'
import { ColourDot, useCouleurs, useColourLabel } from '@/components/shared/ColourPicker'

// The till's choice popup (owner, 2026-11-06; rules in lib/saleColour and
// lib/accessoryVariants): picking an accessory sold in several designs,
// colours or phone models asks which one before it goes into the cart —
// design, then colour, then phone model, each step only when there is a choice.
// `stock`: the variant's own count; undefined = not counted per variant (sold
// from the non réparti pieces when `free` > 0).

// group / variant_id: a variant covering several phones (13 · 14 · 15) gives one
// option per phone, all with the same shared stock (owner, 2026-11-07)
export type ColourOption = { key: string; couleur: string | null; design?: string | null; modele?: string | null; stock?: number; photos?: string[]; group?: string; variant_id?: string }

export function ColourChoiceModal({ title, options, isAr, free, onPick, onClose }: {
  title: string
  options: ColourOption[]
  isAr: boolean
  /** non réparti pieces of the article (stock per variant); undefined = not counted per variant */
  free?: number
  onPick: (option: ColourOption) => void
  onClose: () => void
}) {
  const { byName } = useCouleurs()
  const label = useColourLabel()
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const designs = [...new Set(options.map(o => o.design).filter((d): d is string => !!d))]
  const [design, setDesign] = useState<string | null>(designs.length === 1 ? designs[0] : null)
  // each design button shows one of its website photos, picked at random each
  // time the popup opens (owner, 2026-11-07); the colour step keeps its dots
  const designPhoto = useMemo(() => {
    const out = new Map<string, string>()
    for (const d of designs) {
      const pool = options.filter(o => o.design === d).flatMap(o => o.photos ?? [])
      if (pool.length) out.set(d, pool[Math.floor(Math.random() * pool.length)])
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [colour, setColour] = useState<string | null | undefined>(undefined)
  const byDesign = designs.length > 1 ? options.filter(o => o.design === design) : options
  const colours = [...new Map(byDesign.map(o => [o.couleur ?? '', o.couleur])).values()]
  const byColour = colour === undefined ? [] : byDesign.filter(o => (o.couleur ?? null) === colour)
  const withModels = byColour.some(o => o.modele)

  const free0 = free ?? 0
  // its own count first; otherwise (or when it ran out) the non réparti pieces
  const canSell = (o: ColourOption) => o.stock !== undefined
    ? o.stock > 0 || (free !== undefined && free0 > 0)
    : free === undefined || free0 > 0
  const stockText = (o: ColourOption) => o.stock !== undefined && o.stock > 0
    ? `${o.stock} ${L('en stock', 'في المخزون')}`
    : free !== undefined
      ? free0 > 0 ? L('non compté · pris du non réparti', 'من غير الموزع') : L('Épuisé', 'نفد')
      : null
  // a colour's total for the colour step
  // a colour's count: each variant once (a group of phones repeats its stock on each phone)
  const colourStock = (c: string | null) => {
    const seen = new Set<string>()
    return byDesign.filter(o => (o.couleur ?? null) === c && o.stock !== undefined).reduce((n, o) => {
      const k = o.variant_id ?? o.key
      if (seen.has(k)) return n
      seen.add(k); return n + (o.stock ?? 0)
    }, 0)
  }

  function chooseColour(c: string | null) {
    const list = byDesign.filter(o => (o.couleur ?? null) === c)
    // one choice, no phone model: done
    if (list.length === 1 && !list[0].modele) { if (canSell(list[0])) onPick(list[0]); return }
    setColour(c)
  }

  const step = 'text-xs font-bold uppercase tracking-widest text-ez-subtle mb-2'
  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {designs.length > 1 && (
          <div>
            <p className={step}>{L('Type / design', 'النوع / التصميم')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {designs.map(d => {
                const photo = designPhoto.get(d)
                return (
                  <button key={d} type="button" onClick={() => { setDesign(d); setColour(undefined) }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-sm font-semibold transition-colors ${design === d ? 'border-gold bg-gold/10 text-ez-text' : 'border-ez-border hover:border-gold'}`}>
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" className="w-full aspect-square object-contain rounded-lg bg-ez-bg" />
                    ) : (
                      <span className="w-full aspect-square rounded-lg bg-ez-bg" />
                    )}
                    <span className="truncate max-w-full">{d}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {(designs.length <= 1 || design) && (
          <div>
            <p className={step}>{L('Couleur', 'اللون')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {colours.map(c => {
                const col = c ? byName.get(c) : undefined
                const list = byDesign.filter(o => (o.couleur ?? null) === c)
                const out = !list.some(canSell)
                const counted = list.some(o => o.stock !== undefined)
                const single = list.length === 1 && !list[0].modele ? list[0] : null
                return (
                  <button key={c ?? '-'} type="button" disabled={out} onClick={() => chooseColour(c)}
                    className={`flex items-center gap-3 min-h-14 rounded-xl border px-3 text-start transition-colors hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed ${colour !== undefined && colour === c ? 'border-gold bg-gold/10' : 'border-ez-border'}`}>
                    <ColourDot colour={col} size={26} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{c ? label(col, c) : L('Sans couleur', 'بدون لون')}</span>
                      {single ? (stockText(single) && <span className={`block text-xs ${out ? 'text-red-600' : 'text-ez-subtle'}`}>{stockText(single)}</span>)
                        : counted && <span className="block text-xs text-ez-subtle">{colourStock(c)} {L('compté(s)', 'محسوب')}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {colour !== undefined && (withModels || byColour.length > 1) && (
          <div>
            <p className={step}>{L('Téléphone', 'الهاتف')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {byColour.map(o => {
                const out = !canSell(o)
                return (
                  <button key={o.key} type="button" disabled={out} onClick={() => onPick(o)}
                    className="flex items-center gap-3 min-h-14 rounded-xl border border-ez-border px-3 text-start transition-colors hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed">
                    <Smartphone className="w-5 h-5 text-ez-subtle flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{o.modele ?? L('Modèle non précisé', 'غير محدد')}</span>
                      {stockText(o) && <span className={`block text-xs ${out ? 'text-red-600' : 'text-ez-subtle'}`}>{stockText(o)}</span>}
                      {o.group && <span className="block text-[11px] text-ez-faint truncate" title={L('Un seul stock pour ce groupe', 'مخزون مشترك')}>{L('stock commun', 'مشترك')} · {o.group}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {free !== undefined && free0 > 0 && (
          <button type="button" onClick={() => onPick({ key: '||', couleur: null, design: null, modele: null })}
            className="text-sm text-ez-subtle underline">
            {L(`Vendre sans préciser la variante (${free0} non réparti${free0 > 1 ? 's' : ''})`, 'بيع بدون تحديد')}
          </button>
        )}
      </div>
    </Modal>
  )
}
