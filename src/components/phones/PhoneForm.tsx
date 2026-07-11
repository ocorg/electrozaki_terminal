'use client'
import { useState, useEffect } from 'react'
import { Modal, Field, inputClass, selectClass, Btn } from '@/components/shared'
import { BatteryBar } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { usePortal } from '@/lib/context/portal'
import { useLanguageStore } from '@/lib/stores/language'
import type { Phone, DeviceCondition, DeviceSource, LocationType } from '@/types/database'
import ScanButton from '@/components/scanner/ScanButton'
import ComboBox from '@/components/phones/ComboBox'
import { usePhoneCatalog } from '@/lib/hooks/usePhoneCatalog'

interface PhoneFormProps {
  open:     boolean
  onClose:  () => void
  onSaved:  () => void
  phone?:   Phone | null
  role?:    string
  storeId:  string
}

const STOCKAGES = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
const RAMS      = ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB']

const EMPTY: Partial<Phone> = {
  source:                'Fournisseur',
  condition:             'مستعمل',
  marque:                '',
  serie:                 '',
  type:                  '',
  model:                 '',
  stockage:              '',
  ram:                   '',
  couleur:               '',
  battery_level:         undefined,
  imei:                  '',
  prix_achat:            undefined,
  prix_vente_recommande: undefined,
  prix_vente_minimum:    undefined,
  warranty_months:       3,
  status:                'متوفر',
  location:              'Magasin Principal',
  description:          '',
  replaced_components:  [],
  is_damaged:           false,
  damage_notes:         null,
}

export default function PhoneForm({ open, onClose, onSaved, phone, role, storeId }: PhoneFormProps) {
  const portal   = usePortal()
  const { language } = useLanguageStore()
  const isAr     = language === 'ar'
  const primary  = portal.primaryColor
  const isEdit   = !!phone
  const canSeeFinancials = role === 'manager' || role === 'owner'

  const { brands, seriesFor, modelsFor, couleursFor, addEntry, loading: catalogLoading } = usePhoneCatalog()

  const [form, setForm]           = useState<Partial<Phone>>({ ...EMPTY })
  const [loading, setLoading]     = useState(false)
  const [newCompName, setNewCompName]           = useState('')
  const [newCompCondition, setNewCompCondition] = useState<'original' | 'standard'>('original')

  // ── Derived state ────────────────────────────────────────
  const isApple = form.marque === 'Apple'
  const isNeuf  = form.condition === 'جديد'

  // Dependent dropdown options
  const serieOptions  = seriesFor(form.marque ?? '')
  const modelOptions  = modelsFor(form.marque ?? '', form.serie ?? '')
  const couleurOptions = couleursFor(form.model ?? '')

  // ── Init ─────────────────────────────────────────────────
  useEffect(() => {
    setForm(phone ? { ...phone } : { ...EMPTY })
  }, [phone, open])

  // ── Auto-set battery 100 when Neuf + Apple ───────────────
  useEffect(() => {
    if (isApple && isNeuf) {
      setForm(prev => ({ ...prev, battery_level: 100 }))
    }
  }, [isApple, isNeuf])

  function set(field: keyof Phone, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleMarqueChange(val: string) {
    setForm(prev => ({
      ...prev,
      marque:  val,
      serie:   '',
      type:    '',
      model:   '',
      couleur: '',
      ram:     val === 'Apple' ? '' : prev.ram,
      battery_level: val === 'Apple' && prev.condition === 'جديد' ? 100 : (val === 'Apple' ? prev.battery_level : undefined),
    }))
  }

  function handleSerieChange(val: string) {
    setForm(prev => ({ ...prev, serie: val, model: '', couleur: '' }))
  }

  function handleModelChange(val: string) {
    setForm(prev => ({ ...prev, model: val, couleur: '' }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.marque || !form.model) {
      showError(isAr ? 'الماركة والموديل مطلوبان' : 'Marque et modèle obligatoires')
      return
    }
    setLoading(true)
    try {
      // If the model+couleur combo doesn't exist in catalog, auto-add it
      if (form.marque && form.model && form.couleur) {
        await addEntry({
          marque:  form.marque,
          serie:   form.serie  || form.marque,
          type:    form.type   || 'Normal',
          model:   form.model,
          couleur: form.couleur,
        })
      }

      const payload = { ...form, store_id: storeId }
      const res = await fetch('/api/phones', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(isEdit ? { phone_id: phone!.phone_id, ...payload } : payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isEdit
        ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓')
        : (isAr ? 'تم الإضافة ✓' : 'Ajouté ✓'))
      onSaved()
      onClose()
    } catch (err: unknown) {
      showError((err as Error).message)
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

        {/* Row 2 — Marque */}
        <Field label={isAr ? 'الماركة' : 'Marque'} required>
          <ComboBox
            options={brands}
            value={form.marque ?? ''}
            onChange={handleMarqueChange}
            placeholder={catalogLoading
              ? 'Chargement...'
              : (isAr ? 'اختر أو اكتب...' : 'Choisir ou saisir...')}
            disabled={catalogLoading}
          />
        </Field>

        {/* Row 3 — Série + Modèle */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={isAr ? 'السلسلة' : 'Série'}>
            <ComboBox
              options={serieOptions}
              value={form.serie ?? ''}
              onChange={handleSerieChange}
              placeholder={!form.marque ? 'Choisissez d\'abord la marque' : 'Choisir ou saisir...'}
              disabled={!form.marque}
            />
          </Field>
          <Field label={isAr ? 'الموديل' : 'Modèle'} required>
            <ComboBox
              options={modelOptions}
              value={form.model ?? ''}
              onChange={handleModelChange}
              placeholder={!form.marque ? 'Choisissez d\'abord la marque' : 'Choisir ou saisir...'}
              disabled={!form.marque}
            />
          </Field>
        </div>

        {/* Row 4 — Stockage + RAM (non-Apple) + Couleur */}
        <div className={`grid gap-4 ${isApple ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <Field label={isAr ? 'السعة' : 'Stockage'}>
            <ComboBox
              options={STOCKAGES}
              value={form.stockage ?? ''}
              onChange={v => set('stockage', v)}
              placeholder="128GB..."
            />
          </Field>

          {!isApple && (
            <Field label="RAM">
              <ComboBox
                options={RAMS}
                value={form.ram ?? ''}
                onChange={v => set('ram', v)}
                placeholder="4GB..."
              />
            </Field>
          )}

          <Field label={isAr ? 'اللون' : 'Couleur'}>
            <ComboBox
              options={couleurOptions}
              value={form.couleur ?? ''}
              onChange={v => set('couleur', v)}
              placeholder={!form.model ? 'Choisissez d\'abord le modèle' : 'Choisir ou saisir...'}
              disabled={!form.model}
            />
          </Field>
        </div>

        {/* Row 5 — IMEI + Batterie (Apple only) */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="IMEI">
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className={inputClass}
                placeholder="356XXXXXXXXXXXXX"
                value={form.imei || ''}
                onChange={e => set('imei', e.target.value.replace(/\D/g, '').slice(0, 15))}
                maxLength={15}
              />
              <ScanButton
                onScan={v => set('imei', v)}
                hint="Scannez le code-barres IMEI"
                mode="barcode"
                color={primary}
              />
            </div>
          </Field>

          {isApple && (
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
                <div className="mt-2"><BatteryBar level={form.battery_level} /></div>
              )}
              {isNeuf && (
                <p className="text-xs text-[#9A9690] mt-1">
                  ✓ Automatiquement défini à 100% pour un appareil neuf
                </p>
              )}
            </Field>
          )}
        </div>

        {/* Row 6 — Statut + Emplacement */}
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

        {/* Garantie */}
        <Field label={isAr ? 'مدة الضمان (شهر)' : 'Garantie (mois)'}>
          <input type="number" min={0} max={36} className={inputClass}
            value={form.warranty_months ?? 6}
            onChange={e => set('warranty_months', Number(e.target.value))} />
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

        {/* Replaced components */}
        <div className="space-y-3">
          <p className="text-xs text-ez-subtle uppercase tracking-widest font-medium">
            {isAr ? 'القطع المستبدلة' : 'Composants remplacés'}
          </p>

          {/* Existing component list */}
          {(form.replaced_components || []).length > 0 && (
            <div className="space-y-1.5">
              {(form.replaced_components || []).map((comp, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-[#F8F7F4] rounded-xl">
                  <span className="flex-1 text-sm text-[#1A1A1A] font-medium truncate">{comp.name}</span>
                  <span className="text-xs text-[#6B6860] flex-shrink-0">
                    {comp.condition === 'original' ? 'Original' : 'Standard (Générique)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (form.replaced_components || []).filter((_, i) => i !== idx)
                      set('replaced_components', updated)
                    }}
                    className="text-xs text-[#B0ADA6] hover:text-red-500 transition-colors flex-shrink-0 ml-1"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Add component row */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              list="comp-suggestions"
              className={inputClass}
              placeholder={isAr ? 'اسم القطعة...' : 'Nom du composant...'}
              value={newCompName}
              onChange={e => setNewCompName(e.target.value)}
            />
            <datalist id="comp-suggestions">
              <option value="Écran" />
              <option value="Batterie" />
              <option value="Caméra arrière" />
              <option value="Caméra avant" />
              <option value="Vitre arrière" />
              <option value="Châssis" />
              <option value="Haut-parleur" />
              <option value="Connecteur de charge" />
            </datalist>
            <select
              className={`${selectClass} flex-shrink-0 w-36`}
              value={newCompCondition}
              onChange={e => setNewCompCondition(e.target.value as 'original' | 'standard')}
            >
              <option value="original">Original</option>
              <option value="standard">Standard</option>
            </select>
            <button
              type="button"
              onClick={() => {
                if (!newCompName.trim()) return
                const updated = [...(form.replaced_components || []), { name: newCompName.trim(), condition: newCompCondition }]
                set('replaced_components', updated)
                setNewCompName('')
                setNewCompCondition('original')
              }}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-sm font-bold border border-[#E8E5DE] text-[#6B6860] hover:border-[#C9A440] hover:text-[#C9A440] transition-all"
            >+</button>
          </div>
        </div>

        {/* Damage */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded"
              checked={!!form.is_damaged}
              onChange={e => {
                set('is_damaged', e.target.checked)
                if (!e.target.checked) set('damage_notes', null)
              }}
            />
            <span className="text-xs text-ez-subtle uppercase tracking-widest font-medium">
              {isAr ? 'جهاز تالف' : 'Endommagé'}
            </span>
          </label>
          {form.is_damaged && (
            <input
              type="text"
              className={inputClass}
              placeholder={isAr ? 'وصف العطل...' : 'Description du dommage...'}
              value={form.damage_notes || ''}
              onChange={e => set('damage_notes', e.target.value)}
            />
          )}
        </div>

        {/* Financial fields */}
        {canSeeFinancials && (
          <>
            <div className="border-t border-[#E8E5DE] pt-4">
              <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-4">
                {isAr ? 'الأسعار (للإدارة فقط)' : 'Prix (gestion uniquement)'}
              </p>
              <div className="grid grid-cols-3 gap-4">
                <Field label={isAr ? 'سعر الشراء' : 'Prix achat'}>
                  <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00"
                    value={form.prix_achat ?? ''} onChange={e => set('prix_achat', e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
                <Field label={isAr ? 'سعر البيع المقترح' : 'Prix vente recommandé'}>
                  <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00"
                    value={form.prix_vente_recommande ?? ''} onChange={e => set('prix_vente_recommande', e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
                <Field label={isAr ? 'سعر البيع الأدنى' : 'Prix vente minimum'}>
                  <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00"
                    value={form.prix_vente_minimum ?? ''} onChange={e => set('prix_vente_minimum', e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
              </div>
            </div>

            {isApple && canSeeFinancials && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-[#F8F7F4] rounded-xl border border-[#E8E5DE]">
                <Field label="Compte iCloud">
                  <input type="text" className={inputClass} placeholder="exemple@icloud.com"
                    value={form.icloud_compte || ''} onChange={e => set('icloud_compte', e.target.value)} />
                </Field>
                <Field label="Mot de passe iCloud">
                  <input type="password" className={inputClass} placeholder="••••••••"
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
          <Btn variant="primary" type="submit" loading={loading}
            style={{ backgroundColor: primary } as React.CSSProperties}>
            {isEdit
              ? (isAr ? 'حفظ التعديلات' : 'Enregistrer les modifications')
              : (isAr ? 'إضافة الهاتف' : 'Ajouter le téléphone')}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}