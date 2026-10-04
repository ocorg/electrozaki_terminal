'use client'
// The two ways a phone that left without a POS sale is put right (owner,
// 2026-10-04): "Vente passée" when the sale is remembered (true date), and
// "The Void" when it isn't, or when the phone was taken apart for parts.
import { useState } from 'react'
import { Modal, Field, Btn, inputClass } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { getBusinessDate } from '@/lib/utils'

interface PhoneRef { phone_id: string; marque: string; model: string; prix_vente_recommande?: number | null }

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Erreur')
  return json.data
}

const REASONS = ['Vendu, sans trace de la vente', 'Démonté pour pièces', 'Perdu / introuvable']

export function VoidModal({ phone, onClose, onDone }: { phone: PhoneRef; onClose: () => void; onDone: () => void }) {
  const [motif, setMotif] = useState('')
  const [busy, setBusy]   = useState(false)
  async function submit() {
    setBusy(true)
    try {
      await send(`/api/phones/${phone.phone_id}/void`, 'POST', { motif })
      showSuccess('Téléphone envoyé dans The Void'); onDone(); onClose()
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Envoyer dans The Void" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ez-subtle">
          <b className="text-ez-text">{phone.marque} {phone.model}</b> sort du stock sans vente. Son prix d&apos;achat est compté comme une perte, et reste dû à son fournisseur.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map(r => (
            <button key={r} type="button" onClick={() => setMotif(r)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${motif === r ? 'bg-ez-dark text-white border-ez-dark' : 'border-ez-border text-ez-subtle'}`}>{r}</button>
          ))}
        </div>
        <Field label="Motif *">
          <input className={inputClass} value={motif} onChange={e => setMotif(e.target.value)} placeholder="Ce qui s'est passé…" />
        </Field>
        <p className="text-xs text-ez-faint">Si vous vous souvenez de la vente (date et prix), utilisez plutôt « Vente passée ».</p>
        <div className="flex gap-2">
          <Btn variant="secondary" className="flex-1" onClick={onClose}>Retour</Btn>
          <Btn variant="primary" className="flex-1" disabled={motif.trim().length < 3} loading={busy} onClick={submit}
            style={{ backgroundColor: '#1A1A1A' }}>Envoyer dans The Void</Btn>
        </div>
      </div>
    </Modal>
  )
}

export function PastSaleModal({ phone, onClose, onDone }: { phone: PhoneRef; onClose: () => void; onDone: () => void }) {
  const [date, setDate]     = useState(getBusinessDate())
  const [prix, setPrix]     = useState(phone.prix_vente_recommande != null ? String(phone.prix_vente_recommande) : '')
  const [method, setMethod] = useState<'especes' | 'virement'>('especes')
  const [notes, setNotes]   = useState('')
  const [busy, setBusy]     = useState(false)
  async function submit() {
    setBusy(true)
    try {
      const d = await send(`/api/phones/${phone.phone_id}/past-sale`, 'POST', { date_vente: date, prix_vente: Number(prix), payment_method: method, notes })
      showSuccess(`Vente enregistrée au ${d.date_vente} — ${d.txn_id}`); onDone(); onClose()
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Enregistrer une vente passée" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ez-subtle">
          <b className="text-ez-text">{phone.marque} {phone.model}</b> a été vendu sans passer par le POS. La vente est enregistrée <b>à sa vraie date</b> et entre dans les chiffres de ce jour-là.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date de la vente *">
            <input type="date" className={inputClass} value={date} max={getBusinessDate()} onChange={e => setDate(e.target.value)} />
          </Field>
          <Field label="Prix de vente (DH) *">
            <input type="number" min={0} className={inputClass} value={prix} onChange={e => setPrix(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['especes', 'virement'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMethod(m)}
              className={`py-2 rounded-xl text-xs font-bold border ${method === m ? 'bg-gold text-white border-gold' : 'border-ez-border text-ez-subtle'}`}>
              {m === 'especes' ? 'Espèces' : 'Virement'}
            </button>
          ))}
        </div>
        <Field label="Note (client, détail…)">
          <input className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optionnel" />
        </Field>
        <p className="text-xs text-ez-faint">Une caisse déjà clôturée garde ses totaux. La garantie part de la date de vente.</p>
        <div className="flex gap-2">
          <Btn variant="secondary" className="flex-1" onClick={onClose}>Retour</Btn>
          <Btn variant="primary" className="flex-1" disabled={!date || !(Number(prix) > 0)} loading={busy} onClick={submit}>Enregistrer la vente</Btn>
        </div>
      </div>
    </Modal>
  )
}

export async function leaveVoid(phoneId: string) {
  await send(`/api/phones/${phoneId}/void`, 'DELETE')
}
