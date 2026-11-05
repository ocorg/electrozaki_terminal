'use client'
import { useState } from 'react'
import { Modal } from '@/components/shared'
import { ColourDot, useCouleurs, useColourLabel } from '@/components/shared/ColourPicker'

// The till's colour popup (owner, 2026-11-06; rules in lib/saleColour):
// picking an accessory sold in several colours asks which one before it goes
// into the cart. `options`: each colour (with its design for pochette families,
// and its own stock when the colour is a separate article).

export type ColourOption = { key: string; couleur: string | null; design?: string | null; stock?: number }

export function ColourChoiceModal({ title, options, isAr, onPick, onClose }: {
  title: string
  options: ColourOption[]
  isAr: boolean
  onPick: (option: ColourOption) => void
  onClose: () => void
}) {
  const { byName } = useCouleurs()
  const label = useColourLabel()
  const designs = [...new Set(options.map(o => o.design).filter((d): d is string => !!d))]
  const [design, setDesign] = useState<string | null>(designs.length === 1 ? designs[0] : null)
  const shown = designs.length > 1 ? options.filter(o => o.design === design) : options
  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {designs.length > 1 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ez-subtle mb-2">{isAr ? 'التصميم' : 'Design'}</p>
            <div className="flex flex-wrap gap-2">
              {designs.map(d => (
                <button key={d} type="button" onClick={() => setDesign(d)}
                  className={`min-h-12 px-5 rounded-xl border text-sm font-semibold transition-colors ${design === d ? 'border-gold bg-gold/10 text-ez-text' : 'border-ez-border hover:border-gold'}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        {(designs.length <= 1 || design) && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ez-subtle mb-2">{isAr ? 'اللون' : 'Couleur'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {shown.map(o => {
                const c = o.couleur ? byName.get(o.couleur) : undefined
                const out = o.stock !== undefined && o.stock <= 0
                return (
                  <button key={o.key} type="button" disabled={out} onClick={() => onPick(o)}
                    className="flex items-center gap-3 min-h-14 rounded-xl border border-ez-border px-3 text-start transition-colors hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed">
                    <ColourDot colour={c} size={26} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{o.couleur ? label(c, o.couleur) : (isAr ? 'بدون لون' : 'Sans couleur')}</span>
                      {o.stock !== undefined && (
                        <span className={`block text-xs ${out ? 'text-red-600' : 'text-ez-subtle'}`}>
                          {out ? (isAr ? 'نفد' : 'Épuisé') : `${o.stock} ${isAr ? 'في المخزون' : 'en stock'}`}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
