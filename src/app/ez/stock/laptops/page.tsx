'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate, getWarrantyFlag } from '@/lib/utils'
import { StatusBadge, BatteryBar, EmptyState, SkeletonRow, PageHeader, Btn, Modal, Field, inputClass, selectClass } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Laptop, DeviceCondition, DeviceSource, LocationType } from '@/types/database'
import { Plus, Search, RefreshCw, Laptop as LaptopIcon, Edit2, MapPin, X, Filter } from 'lucide-react'

const STORE_ID  = 'EZ-001'
const MARQUES   = ['Apple', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Toshiba', 'Samsung', 'Autre']
const STOCKAGES = ['128GB', '256GB', '512GB', '1TB', '2TB']
const RAMS      = ['4GB', '8GB', '16GB', '32GB', '64GB']
const STATUSES  = ['متوفر', 'مباع', 'إستبدال', 'إصلاح']

const EMPTY: Partial<Laptop> = {
  source: 'Fournisseur', condition: 'مستعمل',
  marque: '', model: '', stockage: '', ram: '',
  prix_achat: undefined, prix_vente_recommande: undefined,
  prix_vente_minimum: undefined, warranty_months: 6,
  status: 'متوفر', location: 'Magasin Principal',
}

export default function EZLaptopsPage() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canFinancials = user?.role === 'manager' || user?.role === 'owner'

  const [laptops, setLaptops]   = useState<Laptop[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editLaptop, setEditLaptop]   = useState<Laptop | null>(null)
  const [form, setForm]         = useState<Partial<Laptop>>({ ...EMPTY })
  const [submitting, setSubmitting]   = useState(false)

  const fetchLaptops = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: STORE_ID })
      if (filterStatus)    params.set('status', filterStatus)
      if (search.length >= 2) params.set('search', search)
      const res  = await fetch(`/api/laptops?${params}`)
      const json = await res.json()
      setLaptops(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [search, filterStatus])

  useEffect(() => {
    const t = setTimeout(() => fetchLaptops(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchLaptops, search])

  function set(field: keyof Laptop, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function openAdd()          { setEditLaptop(null); setForm({ ...EMPTY }); setFormOpen(true) }
  function openEdit(l: Laptop){ setEditLaptop(l); setForm({ ...l }); setFormOpen(true) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.marque || !form.model) {
      showError(isAr ? 'الماركة والموديل مطلوبان' : 'Marque et modèle obligatoires')
      return
    }
    setSubmitting(true)
    try {
      const isEdit  = !!editLaptop
      const payload = { ...form, store_id: STORE_ID }
      const res = await fetch('/api/laptops', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(isEdit ? { laptop_id: editLaptop!.laptop_id, ...payload } : payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isEdit ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓') : (isAr ? 'تم الإضافة ✓' : 'Ajouté ✓'))
      setFormOpen(false)
      await fetchLaptops()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const STATUS_LABELS: Record<string, string> = {
    'متوفر': 'Disponible', 'مباع': 'Vendu', 'إستبدال': 'Échangé', 'إصلاح': 'Réparation',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'اللابتوبات' : 'Laptops'}
          subtitle={`${laptops.length} laptop${laptops.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchLaptops} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Btn variant="primary" onClick={openAdd} style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة لابتوب' : 'Ajouter'}
              </Btn>
            </div>
          }
        />

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
            <input className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none"
              placeholder={isAr ? 'بحث...' : 'Rechercher série, marque, modèle...'}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{isAr ? 'كل الحالات' : 'Tous statuts'}</option>
            {STATUSES.map(s => <option key={s} value={s}>{isAr ? s : STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : laptops.length === 0 ? (
            <EmptyState icon={<LaptopIcon className="w-7 h-7" />}
              title={isAr ? 'لا توجد لابتوبات' : 'Aucun laptop'}
              action={<Btn variant="primary" onClick={openAdd} style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />{isAr ? 'إضافة' : 'Ajouter'}
              </Btn>} />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {laptops.map(laptop => {
                const name = `${laptop.marque} ${laptop.model}${laptop.stockage ? ' ' + laptop.stockage : ''}`
                const warrantyFlag = getWarrantyFlag(
                  laptop.date_entree
                    ? new Date(new Date(laptop.date_entree).getTime() + (laptop.warranty_months ?? 6) * 30 * 86400000).toISOString()
                    : null
                )
                return (
                  <div key={laptop.laptop_id}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#F8F7F4] transition-all">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${primary}12` }}>
                      <LaptopIcon className="w-4 h-4" style={{ color: primary }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">
                        {name} {warrantyFlag && <span>{warrantyFlag}</span>}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <BatteryBar level={laptop.battery_level} />
                        {laptop.ram && <span className="text-xs text-[#B0ADA6]">{laptop.ram}</span>}
                        <span className="text-xs text-[#B0ADA6] flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {laptop.location === 'Magasin Principal' ? (isAr ? 'الرئيسي' : 'Principal') : (isAr ? 'الثاني' : 'Secondaire')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <StatusBadge status={laptop.status} lang={isAr ? 'ar' : 'fr'} />
                      {canFinancials && laptop.prix_vente_recommande && (
                        <p className="text-sm font-bold" style={{ color: primary }}>
                          {formatMAD(laptop.prix_vente_recommande)}
                        </p>
                      )}
                      <button onClick={() => openEdit(laptop)}
                        className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)}
        title={editLaptop ? (isAr ? 'تعديل اللابتوب' : 'Modifier') : (isAr ? 'إضافة لابتوب' : 'Ajouter un laptop')}
        size="lg">
        <form onSubmit={handleSubmit} className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
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
          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'الماركة' : 'Marque'} required>
              <select className={selectClass} value={form.marque || ''} onChange={e => set('marque', e.target.value)}>
                <option value="">{isAr ? 'اختر...' : 'Choisir...'}</option>
                {MARQUES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label={isAr ? 'الموديل' : 'Modèle'} required>
              <input type="text" className={inputClass} placeholder="MacBook Pro 14, ThinkPad X1..."
                value={form.model || ''} onChange={e => set('model', e.target.value)} />
            </Field>
          </div>
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
            <Field label={isAr ? 'بطارية %' : 'Batterie %'}>
              <input type="number" min={0} max={100} className={inputClass} placeholder="85"
                value={form.battery_level ?? ''} onChange={e => set('battery_level', e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'المعالج' : 'Processeur'}>
              <input type="text" className={inputClass} placeholder="Intel i7, Apple M2..."
                value={form.processeur || ''} onChange={e => set('processeur', e.target.value)} />
            </Field>
            <Field label={isAr ? 'الشاشة' : 'Écran'}>
              <input type="text" className={inputClass} placeholder='14", 15.6"...'
                value={form.ecran || ''} onChange={e => set('ecran', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'الحالة في المخزون' : 'Statut'}>
              <select className={selectClass} value={form.status || 'متوفر'} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{isAr ? s : STATUS_LABELS[s]}</option>)}
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
          {canFinancials && (
            <div className="border-t border-[#E8E5DE] pt-4">
              <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-4">
                {isAr ? 'الأسعار' : 'Prix'}
              </p>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: isAr ? 'سعر الشراء' : 'Prix achat', field: 'prix_achat' as keyof Laptop },
                  { label: isAr ? 'السعر المقترح' : 'Prix recommandé', field: 'prix_vente_recommande' as keyof Laptop },
                  { label: isAr ? 'السعر الأدنى' : 'Prix minimum', field: 'prix_vente_minimum' as keyof Laptop },
                ].map(f => (
                  <Field key={f.field} label={f.label}>
                    <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00"
                      value={(form[f.field] as number) ?? ''}
                      onChange={e => set(f.field, e.target.value ? Number(e.target.value) : undefined)} />
                  </Field>
                ))}
              </div>
              <div className="mt-4">
                <Field label={isAr ? 'ملاحظات / كلمة المرور' : 'Notes / Mot de passe'}>
                  <textarea className={`${inputClass} resize-none text-sm`} rows={2}
                    value={form.notes || ''} onChange={e => set('notes', e.target.value)}
                    placeholder={isAr ? 'كلمة مرور الجهاز...' : 'Mot de passe, notes...'} />
                </Field>
              </div>
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t border-[#E8E5DE]">
            <Btn variant="secondary" type="button" onClick={() => setFormOpen(false)}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" type="submit" loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editLaptop ? (isAr ? 'حفظ' : 'Enregistrer') : (isAr ? 'إضافة' : 'Ajouter')}
            </Btn>
          </div>
        </form>
      </Modal>
    </div>
  )
}