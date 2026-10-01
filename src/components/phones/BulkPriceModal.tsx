'use client'
import { useState } from 'react'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Modal, Btn, Field, inputClass, selectClass, Select } from '@/components/shared'
import { apiWrite } from '@/lib/data/api'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { confirmDialog } from '@/components/shared/ConfirmHost'

// Téléphones → "Prix en masse" (managers): e.g. +200 DH on every new phone in
// stock. Preview before / after, then apply (logged per phone; the website
// updates by itself).

type Row = { phone_id: string; name: string; condition: string; status: string; pv: number | null; newPv: number | null; pm: number | null; newPm: number | null; warning: string | null }

const mad = (v: number | null) => (v === null ? '—' : `${new Intl.NumberFormat('fr-MA').format(v)} DH`)

export default function BulkPriceModal({ open, onClose, storeId, brands }: { open: boolean; onClose: () => void; storeId: string; brands: string[] }) {
  const [condition, setCondition] = useState<'neuf' | 'occasion' | 'tous'>('neuf')
  const [status, setStatus]       = useState<'disponible' | 'tous'>('disponible')
  const [marque, setMarque]       = useState('')
  const [field, setField]         = useState<'vente' | 'minimum' | 'les_deux'>('vente')
  const [mode, setMode]           = useState<'montant' | 'pourcentage'>('montant')
  const [direction, setDirection] = useState<1 | -1>(1)
  const [amount, setAmount]       = useState('200')
  const [round, setRound]         = useState('0')
  const [rows, setRows]           = useState<Row[] | null>(null)
  const [busy, setBusy]           = useState(false)

  const body = (apply: boolean) => ({
    store_id: storeId, condition, status, marque, field, mode, amount: direction * Number(amount), round: Number(round), apply,
  })
  const reset = () => setRows(null)

  async function preview() {
    if (!Number(amount)) { showError('Indiquez un montant'); return }
    setBusy(true)
    try {
      const r = await apiWrite<{ data: { rows: Row[]; count: number } }>('/api/phones/bulk-price', { method: 'POST', body: body(false) })
      setRows(r.data.rows)
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }

  async function apply() {
    const n = changed.length
    if (!(await confirmDialog(`Appliquer ${direction > 0 ? '+' : '−'}${amount}${mode === 'pourcentage' ? ' %' : ' DH'} à ${n} téléphone(s) ?`))) return
    setBusy(true)
    try {
      const r = await apiWrite<{ data: { count: number } }>('/api/phones/bulk-price', { method: 'POST', body: body(true) })
      showSuccess(`Prix mis à jour sur ${r.data.count} téléphone(s) — le site web suit automatiquement`)
      setRows(null)
      onClose()
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }

  const changed = (rows ?? []).filter(r => r.newPv !== r.pv || r.newPm !== r.pm)
  const blocking = changed.some(r => r.warning === 'Dernier prix au-dessus du prix de vente')
  const choice = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button key={value} type="button" onClick={() => { set(value); reset() }}
      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${current === value ? 'bg-ez-dark border-ez-dark text-white' : 'bg-white border-ez-border text-ez-subtle'}`}>
      {label}
    </button>
  )

  return (
    <Modal open={open} onClose={onClose} title="Modifier les prix en masse" size="lg">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Téléphones">
            <div className="flex gap-2">
              {choice('neuf', condition, setCondition, 'Neufs')}
              {choice('occasion', condition, setCondition, 'Occasion')}
              {choice('tous', condition, setCondition, 'Tous')}
            </div>
          </Field>
          <Field label="Statut">
            <div className="flex gap-2">
              {choice('disponible', status, setStatus, 'Disponibles')}
              {choice('tous', status, setStatus, 'Tous (sauf supprimés)')}
            </div>
          </Field>
          <Field label="Marque">
            <Select value={marque} onChange={e => { setMarque(e.target.value); reset() }} className={selectClass}>
              <option value="">Toutes les marques</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="Prix à modifier">
            <div className="flex gap-2">
              {choice('vente', field, setField, 'Prix de vente')}
              {choice('minimum', field, setField, 'Dernier prix')}
              {choice('les_deux', field, setField, 'Les deux')}
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-ez-bg border border-ez-border">
          <div className="flex gap-2">
            {choice('1' as string, String(direction), v => setDirection(v === '1' ? 1 : -1), 'Hausse +')}
            {choice('-1' as string, String(direction), v => setDirection(v === '1' ? 1 : -1), 'Baisse −')}
          </div>
          <input type="number" min={0} value={amount} onChange={e => { setAmount(e.target.value); reset() }}
            className={`${inputClass} w-28 text-right`} />
          <div className="flex gap-2 w-40">
            {choice('montant', mode, setMode, 'DH')}
            {choice('pourcentage', mode, setMode, '%')}
          </div>
          {mode === 'pourcentage' && (
            <Select value={round} onChange={e => { setRound(e.target.value); reset() }} className={`${selectClass} w-44`}>
              <option value="0">Sans arrondi</option>
              <option value="10">Arrondi à 10 DH</option>
              <option value="50">Arrondi à 50 DH</option>
              <option value="100">Arrondi à 100 DH</option>
            </Select>
          )}
        </div>

        {field === 'vente' && (
          <p className="text-xs text-ez-subtle">
            Seul le prix de vente change : le vendeur pourra toujours descendre jusqu’à l’ancien dernier prix. Choisissez « Les deux » pour relever aussi le dernier prix.
          </p>
        )}

        {rows && (
          <div className="border border-ez-border rounded-xl overflow-hidden">
            <p className="px-3 py-2 text-sm font-semibold bg-ez-bg border-b border-ez-border">
              {changed.length} téléphone(s) concerné(s)
            </p>
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ez-faint">Aucun téléphone ne correspond à ces critères.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-ez-muted">
                {rows.map(r => (
                  <div key={r.phone_id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium text-ez-text">{r.name}</p>
                      <p className="text-xs text-ez-faint font-mono">{r.phone_id}</p>
                    </div>
                    {field !== 'minimum' && (
                      <span className="tabular-nums text-xs flex items-center gap-1">
                        <span className="text-ez-faint">Vente</span> {mad(r.pv)} <ArrowRight className="w-3 h-3" /> <b>{mad(r.newPv)}</b>
                      </span>
                    )}
                    {field !== 'vente' && (
                      <span className="tabular-nums text-xs flex items-center gap-1">
                        <span className="text-ez-faint">Dernier</span> {mad(r.pm)} <ArrowRight className="w-3 h-3" /> <b>{mad(r.newPm)}</b>
                      </span>
                    )}
                    {r.warning && <span className="w-full text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{r.warning}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {blocking && <p className="text-sm text-red-600">Certains derniers prix dépasseraient le prix de vente : ajustez la variation ou choisissez « Les deux ».</p>}

        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
          {!rows ? (
            <Btn onClick={preview} loading={busy}>Voir l’aperçu</Btn>
          ) : (
            <Btn onClick={apply} loading={busy} disabled={changed.length === 0 || blocking}>
              Appliquer à {changed.length} téléphone(s)
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  )
}
