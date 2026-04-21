'use client'
import { useState, useEffect } from 'react'
import { Modal, Field, inputClass, selectClass, Btn } from '@/components/shared'
import { BatteryBar } from '@/components/shared'
import { toast } from 'sonner'
import { usePortal } from '@/lib/context/portal'
import { useLanguageStore } from '@/lib/stores/language'
import type { Phone, DeviceCondition, DeviceSource, LocationType } from '@/types/database'
import ScanButton from '@/components/scanner/ScanButton'

interface PhoneFormProps {
  open:     boolean
  onClose:  () => void
  onSaved:  () => void
  phone?:   Phone | null
  role?:    string
  storeId:  string
}

const MARQUES   = ['Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Huawei', 'Oppo', 'Realme', 'Autre']
const STOCKAGES = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
const RAMS      = ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB']
const COULEURS  = ['Noir', 'Blanc', 'Gris', 'Bleu', 'Rouge', 'Vert', 'Or', 'Violet', 'Rose', 'Autre']

const EMPTY: Partial<Phone> = {
  source:                'Fournisseur',
  condition:             'مستعمل',
  marque:                '',
  model:                 '',
  stockage:              '',
  ram:                   '',
  couleur:               '',
  battery_level:         undefined,
  imei:                  '',
  prix_achat:            undefined,
  prix_vente_recommande: undefined,
  prix_vente_minimum:    undefined,
  warranty_months:       6,
  status:                'متوفر',
  location:              'Magasin Principal',
  description:           '',
}

export default function PhoneForm({ open, onClose, onSaved, phone, role, storeId }: PhoneFormProps) {
  const portal   = usePortal()
  const { language } = useLanguageStore()
  const isAr     = language === 'ar'
  const primary  = portal.primaryColor
  const isEdit   = !!phone
  const canSeeFinancials = role === 'manager' || role === 'owner'

  const [form, setForm]       = useState<Partial<Phone>>({ ...EMPTY })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setForm(phone ? { ...phone } : { ...EMPTY })
  }, [phone, open])

  function set(field: keyof Phone, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.marque || !form.model) {
      toast.error(isAr ? 'الماركة والموديل مطلوبان' : 'Marque et modèle obligatoires')
      return
    }
    setLoading(true)
    try {
      const payload = { ...form, store_id: storeId }
      const res = await fetch('/api/phones', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(isEdit ? { phone_id: phone!.phone_id, ...payload } : payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isEdit
        ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓')
        : (isAr ? 'تم الإضافة ✓' : 'Ajouté ✓'))
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit
        ? (isAr ? 'تعديل الهاتف' : 'Modifier le téléphone')
        : (isAr ? 'إضافة هاتف جديد' : 'Ajouter un téléphone')}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>

        {/* Row 1 — Source + Condition */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={isAr ? 'المصدر' : 'Source'} required>
            <select className={selectClass} value={form.source || ''} onChange={e => set('source', e.target.value as DeviceSource)}>
              <option value="Fournisseur">Fournisseur</option>
              <option value="Reprise">Reprise</option>
              <option value="Échange">Échange</option>
            </select>
          </Field>
          <Field label={isAr ? 'الحالة' : 'Condition'} required>
            <select className={selectClass} value={form.condition || ''} onChange={e => set('condition', e.target.value as DeviceCondition)}>
              <option value="جديد">{isAr ? 'جديد' : 'Neuf'}</option>
              <option value="مستعمل">{isAr ? 'مستعمل' : 'Occasion'}</option>
              <option value="معطوب">{isAr ? 'معطوب' : 'Défectueux'}</option>
            </select>
          </Field>
        </div>

        {/* Row 2 — Marque + Model */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={isAr ? 'الماركة' : 'Marque'} required>
            <select className={selectClass} value={form.marque || ''} onChange={e => set('marque', e.target.value)}>
              <option value="">{isAr ? 'اختر...' : 'Choisir...'}</option>
              {MARQUES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label={isAr ? 'الموديل' : 'Modèle'} required>
            <input
              type="text"
              className={inputClass}
              placeholder="iPhone 15 Pro, Galaxy S24..."
              value={form.model || ''}
              onChange={e => set('model', e.target.value)}
            />
          </Field>
        </div>

        {/* Row 3 — Stockage + RAM + Couleur */}
        <div className="grid grid-cols-3 gap-4">
          <Field label={isAr ? 'السعة' : 'Stockage'}>
            <select className={selectClass} value={form.stockage || ''} onChange={e => set('stockage', e.target.value)}>
              <option value="">—</option>
              {STOCKAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="RAM">
            <select className={selectClass} value={form.ram || ''} onChange={e => set('ram', e.target.value)}>
              <option value="">—</option>
              {RAMS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label={isAr ? 'اللون' : 'Couleur'}>
            <select className={selectClass} value={form.couleur || ''} onChange={e => set('couleur', e.target.value)}>
              <option value="">—</option>
              {COULEURS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {/* Row 4 — IMEI + Battery */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="IMEI">
            <div className="flex gap-2">
              <input
                type="text"
                className={inputClass}
                placeholder="356XXXXXXXXXXXXX"
                value={form.imei || ''}
                onChange={e => set('imei', e.target.value)}
                maxLength={20}
              />
              <ScanButton
                onScan={v => set('imei', v)}
                hint="Scannez le code-barres IMEI"
                color={primary}
              />
            </div>
          </Field>
          <Field label={isAr ? 'مستوى البطارية (%)' : 'Batterie (%)'}>
            <input
              type="number"
              min={0} max={100}
              className={inputClass}
              placeholder="85"
              value={form.battery_level ?? ''}
              onChange={e => set('battery_level', e.target.value ? Number(e.target.value) : undefined)}
            />
            {form.battery_level != null && (
              <div className="mt-2">
                <BatteryBar level={form.battery_level} />
              </div>
            )}
          </Field>
        </div>

        {/* Row 5 — Status + Location */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={isAr ? 'الحالة في المخزون' : 'Statut'} required>
            <select className={selectClass} value={form.status || 'متوفر'} onChange={e => set('status', e.target.value)}>
              <option value="متوفر">{isAr ? 'متوفر' : 'Disponible'}</option>
              <option value="مباع">{isAr ? 'مباع' : 'Vendu'}</option>
              <option value="إستبدال">{isAr ? 'مستبدل' : 'Échangé'}</option>
              <option value="إصلاح">{isAr ? 'في الإصلاح' : 'En réparation'}</option>
            </select>
          </Field>
          <Field label={isAr ? 'الموقع' : 'Emplacement'}>
            <select className={selectClass} value={form.location || 'Magasin Principal'} onChange={e => set('location', e.target.value as LocationType)}>
              <option value="Magasin Principal">{isAr ? 'المحل الرئيسي' : 'Magasin Principal'}</option>
              <option value="Magasin Secondaire">{isAr ? 'المحل الثاني' : 'Magasin Secondaire'}</option>
              <option value="Externe">{isAr ? 'خارجي' : 'Externe'}</option>
            </select>
          </Field>
        </div>

        {/* Warranty */}
        <Field label={isAr ? 'مدة الضمان (شهر)' : 'Garantie (mois)'}>
          <input
            type="number"
            min={0} max={36}
            className={inputClass}
            value={form.warranty_months ?? 6}
            onChange={e => set('warranty_months', Number(e.target.value))}
          />
        </Field>

        {/* Description */}
        <Field label={isAr ? 'الوصف' : 'Description'}>
          <textarea
            className={`${inputClass} resize-none`}
            rows={2}
            placeholder={isAr ? 'ملاحظات عن الجهاز...' : 'Notes sur l\'appareil...'}
            value={form.description || ''}
            onChange={e => set('description', e.target.value)}
          />
        </Field>

        {/* Financial fields — manager/owner only */}
        {canSeeFinancials && (
          <>
            <div className="border-t border-[#E8E5DE] pt-4">
              <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-4">
                {isAr ? 'الأسعار (للإدارة فقط)' : 'Prix (gestion uniquement)'}
              </p>
              <div className="grid grid-cols-3 gap-4">
                <Field label={isAr ? 'سعر الشراء' : 'Prix achat'}>
                  <input type="number" min={0} step={0.01} className={inputClass}
                    placeholder="0.00"
                    value={form.prix_achat ?? ''} onChange={e => set('prix_achat', e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
                <Field label={isAr ? 'سعر البيع المقترح' : 'Prix vente recommandé'}>
                  <input type="number" min={0} step={0.01} className={inputClass}
                    placeholder="0.00"
                    value={form.prix_vente_recommande ?? ''} onChange={e => set('prix_vente_recommande', e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
                <Field label={isAr ? 'سعر البيع الأدنى' : 'Prix vente minimum'}>
                  <input type="number" min={0} step={0.01} className={inputClass}
                    placeholder="0.00"
                    value={form.prix_vente_minimum ?? ''} onChange={e => set('prix_vente_minimum', e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
              </div>
            </div>

            {/* iCloud — Apple only */}
            {(form.marque === 'Apple' || form.marque === 'apple') && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-[#F8F7F4] rounded-xl border border-[#E8E5DE]">
                <Field label="Compte iCloud">
                  <input type="text" className={inputClass}
                    placeholder="exemple@icloud.com"
                    value={form.icloud_compte || ''} onChange={e => set('icloud_compte', e.target.value)} />
                </Field>
                <Field label="Mot de passe iCloud">
                  <input type="text" className={inputClass}
                    placeholder="••••••••"
                    value={form.icloud_mdp || ''} onChange={e => set('icloud_mdp', e.target.value)} />
                </Field>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2 border-t border-[#E8E5DE]">
          <Btn variant="secondary" type="button" onClick={onClose}>
            {isAr ? 'إلغاء' : 'Annuler'}
          </Btn>
          <Btn
            variant="primary"
            type="submit"
            loading={loading}
            style={{ backgroundColor: primary } as React.CSSProperties}
          >
            {isEdit
              ? (isAr ? 'حفظ التعديلات' : 'Enregistrer les modifications')
              : (isAr ? 'إضافة الهاتف' : 'Ajouter le téléphone')}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}