'use client'
import { useCategories } from '@/lib/hooks/useCategories'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { SupplierCategory } from '@/types/database'
import {
  Truck, Plus, Search, X, RefreshCw,
  Edit2, Phone, Mail, MapPin, TrendingUp,
  CreditCard, ChevronRight, MessageCircle
} from 'lucide-react'

interface Supplier {
  supplier_id:  string
  nom:          string
  telephone?:   string | null
  email?:       string | null
  adresse?:     string | null
  ville?:       string | null
  categorie?:   SupplierCategory | null
  store_id?:    string | null
  notes?:       string | null
  created_at:   string
  total_paye?:  number
  total_achats?: number
  solde_du?:    number
}

interface Payment {
  payment_id:     string
  montant:        number
  payment_method: string
  date_paiement:  string
  facture_ref?:   string | null
  notes?:         string | null
}


const PAYMENT_METHODS = [
  { value: 'نقد',    labelFr: 'Espèces',  labelAr: 'نقد' },
  { value: 'تحويل', labelFr: 'Virement', labelAr: 'تحويل' },
]

const EMPTY_FORM = {
  nom: '', telephone: '', email: '',
  adresse: '', ville: '', categorie: '' as SupplierCategory | '',
  notes: '',
}

const EMPTY_PAYMENT = {
  montant: '', payment_method: 'نقد', date_paiement: new Date().toISOString().split('T')[0],
  facture_ref: '', notes: '',
}

interface SuppliersModuleProps { storeId: string }

export default function SuppliersModule({ storeId }: SuppliersModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor

  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [selected, setSelected]       = useState<Supplier | null>(null)
  const [formOpen, setFormOpen]       = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [payOpen, setPayOpen]         = useState(false)
  const [payments, setPayments]       = useState<Payment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [form, setForm]               = useState({ ...EMPTY_FORM })
  const [payForm, setPayForm]         = useState({ ...EMPTY_PAYMENT })
  const [submitting, setSubmitting]   = useState(false)

  const fetchSuppliers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (search.length >= 2) params.set('search', search)
      const res  = await fetch(`/api/suppliers?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuppliers(json.data || [])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, search])

  useEffect(() => {
    const t = setTimeout(() => fetchSuppliers(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchSuppliers, search])

  async function fetchPayments(supplierId: string) {
    setPaymentsLoading(true)
    try {
      const res  = await fetch(`/api/supplier-payments?supplier_id=${supplierId}`)
      const json = await res.json()
      setPayments(json.data || [])
    } finally {
      setPaymentsLoading(false)
    }
  }

  function openAdd() {
    setEditSupplier(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }

  function openEdit(s: Supplier) {
    setEditSupplier(s)
    setForm({
      nom:       s.nom,
      telephone: s.telephone ?? '',
      email:     s.email     ?? '',
      adresse:   s.adresse   ?? '',
      ville:     s.ville     ?? '',
      categorie: s.categorie ?? '',
      notes:     s.notes     ?? '',
    })
    setFormOpen(true)
    setSelected(null)
  }

  function openDetail(s: Supplier) {
    setSelected(s)
    fetchPayments(s.supplier_id)
  }

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.nom.trim()) {
      showError(isAr ? 'اسم المورد مطلوب' : 'Nom obligatoire')
      return
    }
    setSubmitting(true)
    try {
      const isEdit  = !!editSupplier
      const payload = {
        store_id:  storeId,
        nom:       form.nom,
        telephone: form.telephone || null,
        email:     form.email     || null,
        adresse:   form.adresse   || null,
        ville:     form.ville     || null,
        categorie: form.categorie || null,
        notes:     form.notes     || null,
      }
      const res = await fetch('/api/suppliers', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(
          isEdit ? { supplier_id: editSupplier!.supplier_id, ...payload } : payload
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isEdit
        ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓')
        : (isAr ? 'تم الإضافة ✓' : 'Fournisseur ajouté ✓'))
      setFormOpen(false)
      await fetchSuppliers()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePayment() {
    if (!selected || !payForm.montant || parseFloat(payForm.montant) <= 0) {
      showError(isAr ? 'أدخل مبلغاً صحيحاً' : 'Montant invalide')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/supplier-payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          supplier_id:    selected.supplier_id,
          store_id:       storeId,
          montant:        parseFloat(payForm.montant),
          payment_method: payForm.payment_method,
          date_paiement:  payForm.date_paiement,
          facture_ref:    payForm.facture_ref || null,
          notes:          payForm.notes       || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل الدفع ✓' : 'Paiement enregistré ✓')
      setPayOpen(false)
      setPayForm({ ...EMPTY_PAYMENT })
      await fetchSuppliers()
      await fetchPayments(selected.supplier_id)
      // Update selected supplier balance
      setSelected(prev => prev ? {
        ...prev,
        total_paye: (prev.total_paye ?? 0) + parseFloat(payForm.montant),
      } : null)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const { suppliers: dynamicSupplierCats } = useCategories()
  const getCatLabel = (v: string) => {
    const c = dynamicSupplierCats.find(x => x.ar === v)
    return c ? (isAr ? c.ar : c.fr) : v
  }

  const totalDue = suppliers.reduce((s, sup) => s + (sup.solde_du ?? 0), 0)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'الموردون' : 'Fournisseurs'}
          subtitle={isAr
            ? `${suppliers.length} مورد`
            : `${suppliers.length} fournisseur${suppliers.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchSuppliers} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Btn variant="primary" onClick={openAdd}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'مورد جديد' : 'Ajouter'}
              </Btn>
            </div>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
               style={{ borderLeftColor: primary, borderLeftWidth: '3px' }}>
            <p className="text-xs text-[#6B6860]">{isAr ? 'إجمالي الموردين' : 'Total fournisseurs'}</p>
            <p className="font-display font-bold text-xl text-[#1A1A1A]">{suppliers.length}</p>
          </div>
          <div className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
               style={{ borderLeftColor: totalDue > 0 ? '#EF4444' : '#10B981', borderLeftWidth: '3px' }}>
            <p className="text-xs text-[#6B6860]">{isAr ? 'المستحق الإجمالي' : 'Total dû'}</p>
            <p className={`font-display font-bold text-xl ${totalDue > 0 ? 'text-red-500' : 'text-[#1A1A1A]'}`}>
              {formatMAD(totalDue)}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
          <input
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
            placeholder={isAr ? 'بحث بالاسم أو الهاتف...' : 'Rechercher par nom, téléphone...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
            onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : suppliers.length === 0 ? (
            <EmptyState
              icon={<Truck className="w-7 h-7" />}
              title={isAr ? 'لا يوجد موردون' : 'Aucun fournisseur'}
              action={
                <Btn variant="primary" onClick={openAdd}
                  style={{ backgroundColor: primary } as React.CSSProperties}>
                  <Plus className="w-4 h-4" />
                  {isAr ? 'إضافة مورد' : 'Ajouter un fournisseur'}
                </Btn>
              }
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {suppliers.map(sup => (
                <div key={sup.supplier_id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-[#F8F7F4] transition-all cursor-pointer"
                  onClick={() => openDetail(sup)}>
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm"
                       style={{ backgroundColor: `${primary}18`, color: primary }}>
                    {sup.nom.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1A1A1A] truncate">{sup.nom}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {sup.telephone && (
                        <span className="text-xs text-[#B0ADA6] flex items-center gap-1">
                          <Phone className="w-3 h-3" />{sup.telephone}
                        </span>
                      )}
                      {sup.ville && (
                        <span className="text-xs text-[#B0ADA6] flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{sup.ville}
                        </span>
                      )}
                      {sup.categorie && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-md"
                              style={{ backgroundColor: `${primary}15`, color: primary }}>
                          {getCatLabel(sup.categorie)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="text-right flex-shrink-0">
                    {(sup.total_paye ?? 0) > 0 && (
                      <p className="text-xs text-emerald-600">
                        {isAr ? 'مدفوع' : 'Payé'}: {formatMAD(sup.total_paye ?? 0)}
                      </p>
                    )}
                    {(sup.solde_du ?? 0) > 0 && (
                      <p className="text-sm font-bold text-red-500">
                        {isAr ? 'مستحق' : 'Dû'}: {formatMAD(sup.solde_du ?? 0)}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected.nom} size="md">
          <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F8F7F4] rounded-xl p-3 text-center">
                <TrendingUp className="w-4 h-4 mx-auto mb-1 text-emerald-500" />
                <p className="font-bold text-sm text-[#1A1A1A]">{formatMAD(selected.total_paye ?? 0)}</p>
                <p className="text-xs text-[#B0ADA6]">{isAr ? 'إجمالي المدفوع' : 'Total payé'}</p>
              </div>
              <div className="bg-[#F8F7F4] rounded-xl p-3 text-center">
                <CreditCard className="w-4 h-4 mx-auto mb-1 text-red-500" />
                <p className={`font-bold text-sm ${(selected.solde_du ?? 0) > 0 ? 'text-red-500' : 'text-[#1A1A1A]'}`}>
                  {formatMAD(selected.solde_du ?? 0)}
                </p>
                <p className="text-xs text-[#B0ADA6]">{isAr ? 'المستحق' : 'Solde dû'}</p>
              </div>
            </div>

            {/* Contact */}
            <div className="space-y-2">
              {selected.telephone && (
                <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                  <Phone className="w-4 h-4 text-[#B0ADA6]" />
                  <div className="flex-1">
                    <p className="text-xs text-[#B0ADA6]">{isAr ? 'الهاتف' : 'Téléphone'}</p>
                    <p className="text-sm font-medium text-[#1A1A1A]">{selected.telephone}</p>
                  </div>
                  <a href={`tel:${selected.telephone}`}
                    className="text-xs font-bold py-1 px-3 rounded-lg"
                    style={{ backgroundColor: `${primary}15`, color: primary }}>
                    {isAr ? 'اتصال' : 'Appeler'}
                  </a>
                </div>
              )}
              {selected.email && (
                <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                  <Mail className="w-4 h-4 text-[#B0ADA6]" />
                  <div>
                    <p className="text-xs text-[#B0ADA6]">Email</p>
                    <p className="text-sm font-medium text-[#1A1A1A]">{selected.email}</p>
                  </div>
                </div>
              )}
              {(selected.ville || selected.adresse) && (
                <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                  <MapPin className="w-4 h-4 text-[#B0ADA6]" />
                  <div>
                    <p className="text-xs text-[#B0ADA6]">{isAr ? 'العنوان' : 'Adresse'}</p>
                    <p className="text-sm font-medium text-[#1A1A1A]">
                      {[selected.adresse, selected.ville].filter(Boolean).join(', ')}
                    </p>
                  </div>
                </div>
              )}
              {selected.notes && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="text-xs text-amber-700">{selected.notes}</p>
                </div>
              )}
            </div>

            {/* WhatsApp */}
            {selected.telephone && (() => {
              const phone = selected.telephone.replace(/^0/, '')
              return (
                <a href={`https://wa.me/212${phone}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-all">
                  <MessageCircle className="w-4 h-4" />
                  {isAr ? 'تواصل عبر واتساب' : 'Contacter via WhatsApp'}
                </a>
              )
            })()}

            {/* Payment history */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest">
                  {isAr ? 'سجل المدفوعات' : 'Historique paiements'}
                </p>
                <button
                  onClick={() => setPayOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{ backgroundColor: `${primary}15`, color: primary }}>
                  <Plus className="w-3 h-3" />
                  {isAr ? 'دفع جديد' : 'Nouveau paiement'}
                </button>
              </div>
              {paymentsLoading ? (
                <div className="space-y-2">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-12 bg-[#F8F7F4] rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : payments.length === 0 ? (
                <p className="text-xs text-[#B0ADA6] text-center py-4">
                  {isAr ? 'لا توجد مدفوعات' : 'Aucun paiement enregistré'}
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {payments.map(p => (
                    <div key={p.payment_id}
                      className="flex items-center justify-between p-3 bg-[#F8F7F4] rounded-xl">
                      <div>
                        <p className="text-sm font-bold text-[#1A1A1A]">{formatMAD(p.montant)}</p>
                        <p className="text-xs text-[#B0ADA6]">
                          {formatDate(p.date_paiement)} · {p.payment_method}
                          {p.facture_ref ? ` · ${p.facture_ref}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2 border-t border-[#E8E5DE]">
              <Btn variant="secondary" className="flex-1" onClick={() => setSelected(null)}>
                {isAr ? 'إغلاق' : 'Fermer'}
              </Btn>
              <Btn variant="primary" className="flex-1" onClick={() => openEdit(selected)}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Edit2 className="w-4 h-4" />
                {isAr ? 'تعديل' : 'Modifier'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Payment modal */}
      <Modal open={payOpen} onClose={() => { setPayOpen(false); setPayForm({ ...EMPTY_PAYMENT }) }}
        title={isAr ? 'تسجيل دفعة' : 'Nouveau paiement'} size="sm">
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <p className="text-sm text-[#6B6860]">
            {isAr ? 'مورد:' : 'Fournisseur:'} <span className="font-bold text-[#1A1A1A]">{selected?.nom}</span>
          </p>
          <Field label={isAr ? 'المبلغ (درهم)' : 'Montant (MAD)'} required>
            <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00" autoFocus
              value={payForm.montant} onChange={e => setPayForm(p => ({ ...p, montant: e.target.value }))} />
          </Field>
          <Field label={isAr ? 'طريقة الدفع' : 'Mode de paiement'} required>
            <select className={selectClass} value={payForm.payment_method}
              onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))}>
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value}>{isAr ? m.labelAr : m.labelFr}</option>
              ))}
            </select>
          </Field>
          <Field label={isAr ? 'تاريخ الدفع' : 'Date paiement'}>
            <input type="date" className={inputClass} value={payForm.date_paiement}
              onChange={e => setPayForm(p => ({ ...p, date_paiement: e.target.value }))} />
          </Field>
          <Field label={isAr ? 'رقم الفاتورة' : 'Référence facture'}>
            <input type="text" className={inputClass} placeholder="FAC-001..."
              value={payForm.facture_ref} onChange={e => setPayForm(p => ({ ...p, facture_ref: e.target.value }))} />
          </Field>
          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary" onClick={() => { setPayOpen(false); setPayForm({ ...EMPTY_PAYMENT }) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handlePayment} loading={submitting}
              disabled={!payForm.montant}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {isAr ? 'تسجيل الدفع' : 'Enregistrer'}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Add/Edit modal */}
      <Modal open={formOpen} onClose={() => { setFormOpen(false); setEditSupplier(null) }}
        title={editSupplier ? (isAr ? 'تعديل المورد' : 'Modifier') : (isAr ? 'مورد جديد' : 'Nouveau fournisseur')}
        size="sm">
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <Field label={isAr ? 'اسم المورد' : 'Nom du fournisseur'} required>
            <input type="text" className={inputClass} autoFocus
              placeholder={isAr ? 'اسم الشركة أو الشخص...' : 'Société ou nom...'}
              value={form.nom} onChange={e => setF('nom', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={isAr ? 'الهاتف' : 'Téléphone'}>
              <input type="tel" className={inputClass} placeholder="06XXXXXXXX"
                value={form.telephone} onChange={e => setF('telephone', e.target.value)} />
            </Field>
            <Field label={isAr ? 'المدينة' : 'Ville'}>
              <input type="text" className={inputClass} placeholder={isAr ? 'مكناس...' : 'Meknès...'}
                value={form.ville} onChange={e => setF('ville', e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <input type="email" className={inputClass} placeholder="contact@..."
              value={form.email} onChange={e => setF('email', e.target.value)} />
          </Field>
          <Field label={isAr ? 'الفئة' : 'Catégorie'}>
            <select className={selectClass} value={form.categorie}
              onChange={e => setF('categorie', e.target.value)}>
              <option value="">{isAr ? 'اختر...' : 'Choisir...'}</option>
              {dynamicSupplierCats.map(c => (
                <option key={c.ar} value={c.ar}>{isAr ? c.ar : c.fr}</option>
              ))}
            </select>
          </Field>
          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={form.notes} onChange={e => setF('notes', e.target.value)} />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary" onClick={() => { setFormOpen(false); setEditSupplier(null) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handleSubmit} loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editSupplier ? (isAr ? 'حفظ' : 'Enregistrer') : (isAr ? 'إضافة' : 'Ajouter')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}