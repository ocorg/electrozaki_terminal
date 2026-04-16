'use client'
import { useState, useEffect } from 'react'
import { Modal, Field, inputClass, selectClass, Btn } from '@/components/shared'
import { BatteryBar } from '@/components/shared'
import { toast } from 'sonner'
import type { Phone, DeviceCondition, DeviceSource, LocationType } from '@/types/database'

interface PhoneFormProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  phone?: Phone | null
  role?: string
}

const EMPTY: Partial<Phone> = {
  source: 'Fournisseur',
  condition: 'مستعمل',
  marque: '',
  model: '',
  stockage: '',
  ram: '',
  couleur: '',
  battery_level: undefined,
  imei: '',
  prix_achat: undefined,
  prix_vente_recommande: undefined,
  prix_vente_minimum: undefined,
  warranty_months: 6,
  status: 'متوفر',
  location: 'Magasin Principal',
  description: '',
}

export default function PhoneForm({ open, onClose, onSaved, phone, role }: PhoneFormProps) {
  const [form, setForm] = useState<Partial<Phone>>(EMPTY)
  const [loading, setLoading] = useState(false)
  const isEdit = !!phone

  useEffect(() => {
    setForm(phone ? { ...phone } : { ...EMPTY })
  }, [phone, open])

  function set(field: keyof Phone, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.marque || !form.model) {
      toast.error('Marque et modèle obligatoires')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/phones', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { ...form, phone_id: phone!.phone_id } : form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isEdit ? 'Téléphone modifié ✓' : 'Téléphone ajouté ✓')
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const canSeePrices = role !== 'staff'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Modifier — ${phone?.marque} ${phone?.model}` : 'Ajouter un téléphone'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Row 1 — Source + Condition */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Source" required>
            <select className={selectClass} value={form.source || ''} onChange={e => set('source', e.target.value as DeviceSource)}>
              <option value="Fournisseur">Fournisseur</option>
              <option value="Reprise">Reprise</option>
              <option value="Échange">Échange</option>
            </select>
          </Field>
          <Field label="État" required>
            <select className={selectClass} value={form.condition || ''} onChange={e => set('condition', e.target.value as DeviceCondition)}>
              <option value="جديد">Neuf (جديد)</option>
              <option value="مستعمل">Occasion (مستعمل)</option>
              <option value="معطوب">Défectueux (معطوب)</option>
            </select>
          </Field>
        </div>

        {/* Row 2 — Marque + Modèle */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Marque" required>
            <select className={selectClass} value={form.marque || ''} onChange={e => set('marque', e.target.value)}>
              <option value="">Sélectionner...</option>
              {['Apple','Samsung','Xiaomi','Redmi','Huawei','Oppo','Realme','OnePlus','Autre'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Modèle" required>
            <input className={inputClass} value={form.model || ''} onChange={e => set('model', e.target.value)} placeholder="iPhone 14 Pro, Galaxy S23..." />
          </Field>
        </div>

        {/* Row 3 — Série + Couleur */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Série">
            <input className={inputClass} value={form.serie || ''} onChange={e => set('serie', e.target.value)} placeholder="Ex: iPhone 15 Pro Max" />
          </Field>
          <Field label="Couleur">
            <input className={inputClass} value={form.couleur || ''} onChange={e => set('couleur', e.target.value)} placeholder="Noir Minuit, Blanc..." />
          </Field>
        </div>

        {/* Row 4 — Stockage + RAM */}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Stockage">
            <select className={selectClass} value={form.stockage || ''} onChange={e => set('stockage', e.target.value)}>
              <option value="">—</option>
              {['16GB','32GB','64GB','128GB','256GB','512GB','1TB'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="RAM">
            <select className={selectClass} value={form.ram || ''} onChange={e => set('ram', e.target.value)}>
              <option value="">—</option>
              {['2GB','3GB','4GB','6GB','8GB','12GB','16GB'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Batterie (%)">
            <input type="number" min={0} max={100} className={inputClass} value={form.battery_level ?? ''} onChange={e => set('battery_level', e.target.value ? Number(e.target.value) : undefined)} placeholder="85" />
          </Field>
        </div>

        {/* IMEI */}
        <Field label="IMEI" hint="Scannez le code-barres ou saisissez manuellement">
          <input className={inputClass} value={form.imei || ''} onChange={e => set('imei', e.target.value)} placeholder="352999XXXXXXXXX" maxLength={17} />
        </Field>

        {/* Prices — manager/owner only */}
        {canSeePrices && (
          <div className="bg-gold/5 border border-gold/15 rounded-xl p-4">
            <p className="text-xs font-bold text-gold/70 uppercase tracking-widest mb-3">Tarification</p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Prix achat (MAD)">
                <input type="number" className={inputClass} value={form.prix_achat ?? ''} onChange={e => set('prix_achat', e.target.value ? Number(e.target.value) : undefined)} placeholder="0.00" />
              </Field>
              <Field label="Prix conseillé (MAD)">
                <input type="number" className={inputClass} value={form.prix_vente_recommande ?? ''} onChange={e => set('prix_vente_recommande', e.target.value ? Number(e.target.value) : undefined)} placeholder="0.00" />
              </Field>
              <Field label="Prix minimum (MAD)">
                <input type="number" className={inputClass} value={form.prix_vente_minimum ?? ''} onChange={e => set('prix_vente_minimum', e.target.value ? Number(e.target.value) : undefined)} placeholder="0.00" />
              </Field>
            </div>
          </div>
        )}

        {/* Location + Warranty */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Emplacement">
            <select className={selectClass} value={form.location || 'Magasin Principal'} onChange={e => set('location', e.target.value as LocationType)}>
              <option value="Magasin Principal">Magasin Principal</option>
              <option value="Magasin Secondaire">Magasin Secondaire</option>
              <option value="Externe">Externe</option>
            </select>
          </Field>
          <Field label="Garantie (mois)">
            <select className={selectClass} value={form.warranty_months ?? 6} onChange={e => set('warranty_months', Number(e.target.value))}>
              {[0,1,3,6,12,18,24].map(m => <option key={m} value={m}>{m} mois</option>)}
            </select>
          </Field>
        </div>

        {/* Description */}
        <Field label="Description / Notes">
          <textarea
            className={`${inputClass} resize-none`}
            rows={2}
            value={form.description || ''}
            onChange={e => set('description', e.target.value)}
            placeholder="Défauts, détails Good Deal..."
          />
        </Field>

        {/* Status (edit only) */}
        {isEdit && (
          <Field label="Statut">
            <select className={selectClass} value={form.status || 'متوفر'} onChange={e => set('status', e.target.value)}>
              <option value="متوفر">Disponible (متوفر)</option>
              <option value="مباع">Vendu (مباع)</option>
              <option value="إصلاح">Réparation (إصلاح)</option>
            </select>
          </Field>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-ez-border">
          <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" type="submit" loading={loading}>
            {isEdit ? 'Enregistrer' : 'Ajouter le téléphone'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}