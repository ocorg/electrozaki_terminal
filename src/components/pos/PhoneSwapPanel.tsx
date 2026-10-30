'use client'
import { useMemo, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { formatMAD } from '@/lib/utils'
import { Btn } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { useWorkDay } from '@/lib/stores/workDay'
import type { Phone } from '@/types/database'

// Échange SAV (owner, 2026-10-30): the client gives back the phone of a sale
// and leaves with another one. The sale (date, payments, trade-in, payment
// plan) stays; its phone changes; a price difference is settled today or on
// the payment plan. Rules in src/lib/phoneSwap.ts.

export interface SwapSale {
  txn_id:       string
  device_label: string
  prix_vente:   number
  file:         { credit_id: string; open: boolean; discharged: boolean } | null
}

type Destination = 'stock' | 'reparation' | 'defectueux'
type Settlement  = 'especes' | 'virement' | 'avoir' | 'hors_caisse' | 'dossier'

const DEST: { v: Destination; l: string }[] = [
  { v: 'reparation', l: 'En réparation' }, { v: 'stock', l: 'Remis en vente' }, { v: 'defectueux', l: 'Défectueux' },
]

export default function PhoneSwapPanel({ sale, storeId, primary, onDone, onCancel }: {
  sale: SwapSale; storeId: string; primary: string; onDone: () => void; onCancel: () => void
}) {
  const work = useWorkDay()
  const phonesQ = useApi<Phone[]>(`/api/phones?status=disponible&store_id=${storeId}&limit=500`)
  const [q, setQ]               = useState('')
  const [picked, setPicked]     = useState<Phone | null>(null)
  const [price, setPrice]       = useState(String(sale.prix_vente))
  const [settle, setSettle]     = useState<Settlement | ''>('')
  const [ref, setRef]           = useState('')
  const [dest, setDest]         = useState<Destination>('reparation')
  const [motif, setMotif]       = useState('')
  const [saving, setSaving]     = useState(false)

  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return (phonesQ.data ?? []).filter(p => {
      const hay = `${p.marque} ${p.model} ${p.stockage ?? ''} ${p.couleur ?? ''} ${p.imei ?? ''} ${p.phone_id}`.toLowerCase()
      return words.every(w => hay.includes(w))
    }).slice(0, 8)
  }, [phonesQ.data, q])

  const newPrice = Math.round((Number(price) || 0) * 100) / 100
  const diff     = Math.round((newPrice - sale.prix_vente) * 100) / 100
  const fileOk   = !!sale.file && !sale.file.discharged
  const options: { v: Settlement; l: string }[] = diff > 0
    ? [{ v: 'especes', l: 'Payé en espèces' }, { v: 'virement', l: 'Payé par virement' }, ...(fileOk ? [{ v: 'dossier' as const, l: 'Ajouté au paiement en plusieurs fois' }] : [])]
    : diff < 0
      ? [...(sale.file?.open ? [] : [{ v: 'especes' as const, l: 'Rendu en espèces' }, { v: 'virement' as const, l: 'Rendu par virement' }, { v: 'avoir' as const, l: 'En avoir' }, { v: 'hors_caisse' as const, l: 'Rendu hors caisse' }]),
         ...(fileOk ? [{ v: 'dossier' as const, l: 'Déduit du paiement en plusieurs fois' }] : [])]
      : []

  function pick(p: Phone) {
    setPicked(p); setQ('')
    // same price by default (a SAV swap); the new phone's own price one click away
    setPrice(String(sale.prix_vente)); setSettle('')
  }

  async function confirm() {
    if (!picked) { showError('Choisissez le téléphone remis au client'); return }
    if (!(newPrice > 0)) { showError('Prix du nouveau téléphone invalide'); return }
    if (Math.abs(diff) >= 0.01 && !settle) { showError(diff > 0 ? 'Choisissez comment le client paie la différence' : 'Choisissez comment la différence est rendue'); return }
    if (settle === 'virement' && diff > 0 && !ref.trim()) { showError('Référence du virement obligatoire'); return }
    if (motif.trim().length < 3) { showError("Motif de l'échange obligatoire"); return }
    setSaving(true)
    try {
      await apiWrite('/api/echanges', {
        method: 'POST',
        body: {
          txn_id: sale.txn_id, new_phone_id: picked.phone_id, nouveau_prix: newPrice,
          reglement: Math.abs(diff) >= 0.01 ? settle : null, payment_ref: ref.trim() || undefined,
          destination: dest, motif: motif.trim(), date: work.late ? work.date : undefined,
        },
      })
      showSuccess(`Échange enregistré : ${picked.model} remis au client`)
      onDone()
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  const choice = (on: boolean) => ({ backgroundColor: on ? primary : 'white', borderColor: on ? primary : '#E8E5DE', color: on ? 'white' : '#6B6860' })

  return (
    <div className="space-y-3">
      <p className="text-xs text-ez-subtle">
        La vente reste la même (date, paiements, reprise{sale.file ? `, dossier ${sale.file.credit_id}` : ''}) : seul le téléphone change.
      </p>

      {/* New phone */}
      <div>
        <label className="text-xs font-bold text-ez-subtle block mb-1">Téléphone remis au client</label>
        {picked ? (
          <div className="flex items-center gap-2 bg-white border border-ez-border rounded-xl px-3 py-2">
            <span className="text-xs text-ez-faint truncate">{sale.device_label}</span>
            <ArrowRight className="w-3.5 h-3.5 text-ez-faint flex-shrink-0" />
            <span className="text-sm font-bold truncate flex-1">{picked.model}{picked.stockage ? ` ${picked.stockage}` : ''}{picked.couleur ? ` · ${picked.couleur}` : ''}</span>
            <span className="text-xs font-mono text-ez-faint">{picked.imei?.slice(-6)}</span>
            <button type="button" onClick={() => setPicked(null)} className="text-xs font-bold text-ez-subtle underline">Changer</button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ez-faint" />
              <input value={q} onChange={e => setQ(e.target.value)} autoFocus
                placeholder="Chercher en stock : modèle, couleur, IMEI…"
                className="w-full pl-9 pr-3 py-2 bg-white border border-ez-border rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
            {matches.length > 0 && (
              <div className="border border-ez-border rounded-xl divide-y divide-ez-muted bg-white max-h-52 overflow-y-auto">
                {matches.map(p => (
                  <button key={p.phone_id} type="button" onClick={() => pick(p)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ez-bg">
                    <span className="flex-1 truncate">{p.model}{p.stockage ? ` ${p.stockage}` : ''}{p.couleur ? ` · ${p.couleur}` : ''}{p.battery_level ? ` · ${p.battery_level}%` : ''}</span>
                    <span className="text-xs font-mono text-ez-faint">{p.imei?.slice(-6)}</span>
                    <span className="text-xs font-bold" style={{ color: primary }}>{p.prix_vente_recommande ? formatMAD(p.prix_vente_recommande) : '—'}</span>
                  </button>
                ))}
              </div>
            )}
            {q.trim() && !matches.length && !phonesQ.isLoading && <p className="text-xs text-ez-faint">Aucun téléphone disponible ne correspond</p>}
          </div>
        )}
      </div>

      {picked && (
        <>
          {/* Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-ez-subtle block mb-1">Prix de l'échange</label>
              <input type="number" min={0} step={0.01} inputMode="decimal" value={price}
                onChange={e => { setPrice(e.target.value); setSettle('') }}
                className="w-full border border-ez-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
              <div className="flex flex-wrap gap-1 mt-1">
                <button type="button" onClick={() => { setPrice(String(sale.prix_vente)); setSettle('') }} className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-ez-border text-ez-subtle">
                  Même prix {formatMAD(sale.prix_vente)}
                </button>
                {!!picked.prix_vente_recommande && picked.prix_vente_recommande !== sale.prix_vente && (
                  <button type="button" onClick={() => { setPrice(String(picked.prix_vente_recommande)); setSettle('') }} className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-ez-border text-ez-subtle">
                    Prix du téléphone {formatMAD(picked.prix_vente_recommande)}
                  </button>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-ez-border bg-white px-3 py-2 text-sm">
              <div className="flex justify-between"><span className="text-ez-subtle">Vente</span><span>{formatMAD(sale.prix_vente)}</span></div>
              <div className="flex justify-between"><span className="text-ez-subtle">Échange</span><span>{formatMAD(newPrice)}</span></div>
              <div className={`flex justify-between font-bold ${diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-red-600' : ''}`}>
                <span>{diff > 0 ? 'Le client paie' : diff < 0 ? 'À rendre au client' : 'Différence'}</span><span>{formatMAD(Math.abs(diff))}</span>
              </div>
            </div>
          </div>

          {/* How the difference is settled */}
          {Math.abs(diff) >= 0.01 && (
            <div>
              <label className="text-xs font-bold text-ez-subtle block mb-1">{diff > 0 ? 'Comment le client paie la différence' : 'Comment la différence est rendue'}</label>
              {options.length ? (
                <div className="flex flex-wrap gap-2">
                  {options.map(o => (
                    <button key={o.v} type="button" onClick={() => setSettle(o.v)} className="px-3 py-1.5 rounded-xl text-xs font-bold border" style={choice(settle === o.v)}>{o.l}</button>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-bold text-amber-700">Le dossier est déchargé et pas soldé : gardez le même prix, ou voyez avec le propriétaire.</p>
              )}
              {settle === 'virement' && diff > 0 && (
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Référence du virement"
                  className="mt-2 w-full border border-ez-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
              )}
            </div>
          )}

          {/* Returned phone */}
          <div>
            <label className="text-xs font-bold text-ez-subtle block mb-1">Le téléphone rendu ({sale.device_label}) va</label>
            <div className="flex flex-wrap gap-2">
              {DEST.map(d => (
                <button key={d.v} type="button" onClick={() => setDest(d.v)} className="px-3 py-1.5 rounded-xl text-xs font-bold border" style={choice(dest === d.v)}>{d.l}</button>
              ))}
            </div>
          </div>

          <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={2}
            placeholder="Motif de l'échange (ex. son faible)"
            className="w-full border border-ez-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
        </>
      )}

      <div className="flex justify-end gap-2">
        <Btn variant="secondary" onClick={onCancel}>Annuler</Btn>
        <Btn onClick={confirm} loading={saving} disabled={!picked || motif.trim().length < 3} style={{ backgroundColor: primary }}>Confirmer l'échange</Btn>
      </div>
    </div>
  )
}
