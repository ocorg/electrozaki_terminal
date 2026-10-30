'use client'
import { useState } from 'react'
import { Modal, Field, inputClass, Btn } from '@/components/shared'
import ComboBox from '@/components/phones/ComboBox'
import { usePhoneCatalog } from '@/lib/hooks/usePhoneCatalog'
import { modelNameProblem, colourLooksEnglish } from '@/lib/phoneNaming'
import { apiWrite } from '@/lib/data/api'
import { showError } from '@/lib/utils/toasts'
import type { Phone } from '@/types/database'

// A phone ordered for a client who pays an advance (owner, 2026-10-30): the
// phone is created "en commande" (no IMEI) and goes into the cart; it is then
// sold "Plusieurs fois", kept at the shop, the advance as down payment.
// When it arrives its IMEI is typed in Téléphones (lib/phoneOrder).

const STOCKAGES = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']

export default function OrderPhoneModal({ open, onClose, storeId, primary, onCreated }: {
  open: boolean; onClose: () => void; storeId: string; primary: string; onCreated: (phone: Phone) => void
}) {
  const { brands, seriesFor, modelsFor, couleursFor } = usePhoneCatalog()
  const [f, setF] = useState({ marque: '', serie: '', model: '', stockage: '', couleur: '', condition: 'neuf' as 'neuf' | 'occasion', prix: '' })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))
  const problem = modelNameProblem(f.marque, f.model)
  const english = colourLooksEnglish(f.couleur)

  async function create() {
    if (!f.marque || !f.model) { showError('Marque et modèle obligatoires'); return }
    if (problem) { showError(problem); return }
    if (english) { showError('Couleur : tapez-la en français'); return }
    if (!(Number(f.prix) > 0)) { showError('Prix convenu avec le client obligatoire'); return }
    setSaving(true)
    try {
      const { data } = await apiWrite<{ data: Phone }>('/api/phones/commande', {
        method: 'POST', body: { ...f, prix: Number(f.prix), store_id: storeId },
      })
      onCreated(data)
      setF({ marque: '', serie: '', model: '', stockage: '', couleur: '', condition: 'neuf', prix: '' })
      onClose()
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  const choice = (on: boolean) => ({ backgroundColor: on ? primary : 'white', borderColor: on ? primary : '#E8E5DE', color: on ? 'white' : '#6B6860' })

  return (
    <Modal open={open} onClose={onClose} title="Commande client (téléphone pas encore en stock)" size="md">
      <div className="space-y-3">
        <p className="text-xs text-ez-subtle">
          Le téléphone demandé est ajouté au panier « en commande » (sans IMEI). Ensuite : <b>Plusieurs fois</b>, l’acompte du client,
          téléphone <b>gardé au magasin</b>. Les versements se suivent avec l’icône carte (Crédit / Avance). À son arrivée, saisissez son IMEI dans Téléphones.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Marque" required>
            <ComboBox options={brands} value={f.marque} onChange={v => setF(p => ({ ...p, marque: v, serie: '', model: '', couleur: '' }))} placeholder="Apple, Samsung…" />
          </Field>
          <Field label="Série">
            <ComboBox options={seriesFor(f.marque)} value={f.serie} onChange={v => setF(p => ({ ...p, serie: v, model: '' }))} placeholder="iPhone 16…" disabled={!f.marque} />
          </Field>
        </div>
        <Field label="Modèle" required>
          <ComboBox options={modelsFor(f.marque, f.serie)} value={f.model} onChange={v => setF(p => ({ ...p, model: v, couleur: '' }))} placeholder="iPhone 16 Pro…" disabled={!f.marque} />
          {problem && f.model && <p className="text-xs font-medium text-amber-700 mt-1">{problem}</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stockage">
            <ComboBox options={STOCKAGES} value={f.stockage} onChange={v => set('stockage', v)} placeholder="256GB" />
          </Field>
          <Field label="Couleur">
            <ComboBox options={couleursFor(f.model)} value={f.couleur} onChange={v => set('couleur', v)} placeholder="Noir…" disabled={!f.model} />
            {english && <p className="text-xs font-medium text-amber-700 mt-1">En français, ex. « Noir », « Bleu Ciel »</p>}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div className="flex gap-2">
            {(['neuf', 'occasion'] as const).map(c => (
              <button key={c} type="button" onClick={() => setF(p => ({ ...p, condition: c }))} className="flex-1 py-2 rounded-xl text-xs font-bold border" style={choice(f.condition === c)}>
                {c === 'neuf' ? 'Neuf' : 'Occasion'}
              </button>
            ))}
          </div>
          <Field label="Prix convenu (DH)" required>
            <input type="number" min={0} step={1} inputMode="decimal" className={inputClass} value={f.prix} onChange={e => set('prix', e.target.value)} placeholder="0" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
          <Btn onClick={create} loading={saving} style={{ backgroundColor: primary }}>Ajouter au panier</Btn>
        </div>
      </div>
    </Modal>
  )
}
