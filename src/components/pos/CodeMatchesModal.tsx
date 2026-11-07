'use client'
import { Modal } from '@/components/shared'
import { formatMAD } from '@/lib/utils'
import { modelsLabel } from '@/lib/phoneGroups'

// A box code printed on several products (owner, 2026-11-07; lib/accessoryCodes):
// « Ce code correspond à plusieurs articles » — the seller picks the right one.

type Hit = { acc_id: string; variant_id: string | null }
type Acc = { acc_id: string; nom: string; marque?: string | null; quantite?: number; prix_vente_recommande?: number | string | null; variants?: { variant_id: string; design: string | null; couleur: string | null; modeles: string[] }[] }

export function CodeMatchesModal({ code, hits, accessories, onPick, onClose, showPrice = true }: {
  code: string
  hits: Hit[]
  accessories: Acc[]
  onPick: (hit: Hit) => void
  onClose: () => void
  showPrice?: boolean
}) {
  return (
    <Modal open onClose={onClose} title="Ce code correspond à plusieurs articles" size="md">
      <div className="space-y-2">
        <p className="text-xs text-ez-subtle font-mono">{code}</p>
        {hits.map(h => {
          const a = accessories.find(x => x.acc_id === h.acc_id)
          if (!a) return null
          const v = h.variant_id ? a.variants?.find(x => x.variant_id === h.variant_id) : null
          return (
            <button key={`${h.acc_id}|${h.variant_id ?? ''}`} type="button" onClick={() => onPick(h)}
              className="w-full text-start rounded-xl border border-ez-border px-3 py-2.5 hover:border-gold">
              <span className="block text-sm font-semibold">{a.nom}{a.marque ? <span className="font-normal text-ez-subtle"> · {a.marque}</span> : null}</span>
              <span className="block text-xs text-ez-subtle">
                {v ? `${[v.design, v.couleur, modelsLabel(v.modeles)].filter(Boolean).join(' · ')} · ` : ''}
                {showPrice && a.prix_vente_recommande ? `${formatMAD(Number(a.prix_vente_recommande))} · ` : ''}
                {a.quantite ?? 0} en stock
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
