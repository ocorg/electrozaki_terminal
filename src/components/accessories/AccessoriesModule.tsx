'use client'
import { useCategories } from '@/lib/hooks/useCategories'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader, EmptyState, SkeletonRow, StatusBadge } from '@/components/shared'
import ScanButton from '@/components/scanner/ScanButton'
import LabelGenerator, { type LabelProduct } from '@/components/print/LabelGenerator'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { AccCategory } from '@/types/database'
import {
  Package, Plus, Search, X, RefreshCw,
  Edit2, AlertTriangle, Minus, TrendingUp, Trash2, Loader2
} from 'lucide-react'



interface Accessory {
  acc_id:                 string
  barcode?:               string | null
  nom:                    string
  categorie:              AccCategory
  marque?:                string | null
  compatible_with?:       string | null
  prix_achat?:            number | null
  prix_vente_recommande?: number | null
  prix_vente_minimum?:    number | null
  quantite:               number
  seuil_alerte:           number
  store_id?:              string | null
  status_computed?:       string
  is_low_stock?:          boolean
}

interface AccessoryForm {
  nom:                   string
  categorie:             string
  marque:                string
  barcode:               string
  compatible_with:       string
  quantite:              string
  seuil_alerte:          string
  prix_achat:            string
  prix_vente_recommande: string
  prix_vente_minimum:    string
}

const EMPTY_FORM: AccessoryForm = {
  nom:                   '',
  categorie:             '',
  marque:                 '',
  barcode:                '',
  compatible_with:        '',
  quantite:               '1',
  seuil_alerte:           '5',
  prix_achat:             '',
  prix_vente_recommande:  '',
  prix_vente_minimum:     '',
}

interface AccessoriesModuleProps {
  storeId: string
}

export default function AccessoriesModule({ storeId }: AccessoriesModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canFinancials = user?.role === 'manager' || user?.role === 'owner'

  const [accessories, setAccessories] = useState<Accessory[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterCat, setFilterCat]     = useState('')
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [formOpen, setFormOpen]       = useState(false)
  const [editAcc, setEditAcc]         = useState<Accessory | null>(null)
  const [form, setForm]               = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting]   = useState(false)
  const [adjusting, setAdjusting]     = useState<string | null>(null)
  const [labelProduct,  setLabelProduct]  = useState<LabelProduct | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState(false)

  const fetchAccessories = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (filterCat)    params.set('categorie', filterCat)
      if (onlyLowStock) params.set('low_stock', 'true')
      if (search.length >= 2) params.set('search', search)
      const res  = await fetch(`/api/accessories?${params}`)
      const json = await res.json()
      setAccessories(json.data || [])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, filterCat, onlyLowStock, search])

  useEffect(() => {
    const t = setTimeout(() => fetchAccessories(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchAccessories, search])

  function setF(k: keyof AccessoryForm, v: string) {
    setForm((prev: AccessoryForm) => ({ ...prev, [k]: v }))
  }

  async function handleDelete(acc_id: string) {
    setDeleting(true)
    try {
      const res  = await fetch(`/api/accessories?acc_id=${acc_id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الحذف ✓' : 'Supprimé ✓')
      setConfirmDelete(null)
      fetchAccessories()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  function openAdd() {
    setEditAcc(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }

  function openEdit(acc: Accessory) {
    setEditAcc(acc)
    setForm({
      nom:                   acc.nom,
      categorie:             acc.categorie,
      marque:                acc.marque ?? '',
      barcode:               acc.barcode ?? '',
      compatible_with:       acc.compatible_with ?? '',
      quantite:              String(acc.quantite),
      seuil_alerte:          String(acc.seuil_alerte),
      prix_achat:            acc.prix_achat != null ? String(acc.prix_achat) : '',
      prix_vente_recommande: acc.prix_vente_recommande != null ? String(acc.prix_vente_recommande) : '',
      prix_vente_minimum:    acc.prix_vente_minimum != null ? String(acc.prix_vente_minimum) : '',
    })
    setFormOpen(true)
  }

  async function handleSubmit() {
    if (!form.nom) {
      showError(isAr ? 'اسم الاكسسوار مطلوب' : 'Nom obligatoire')
      return
    }
    setSubmitting(true)
    try {
      const isEdit  = !!editAcc
      const payload = {
        store_id:              storeId,
        nom:                   form.nom,
        categorie:             form.categorie,
        marque:                form.marque          || null,
        barcode:               form.barcode         || null,
        compatible_with:       form.compatible_with || null,
        quantite:              parseInt(form.quantite) || 0,
        seuil_alerte:          parseInt(form.seuil_alerte) || 5,
        prix_achat:            form.prix_achat            ? parseFloat(form.prix_achat)            : null,
        prix_vente_recommande: form.prix_vente_recommande ? parseFloat(form.prix_vente_recommande) : null,
        prix_vente_minimum:    form.prix_vente_minimum    ? parseFloat(form.prix_vente_minimum)    : null,
      }

      const res = await fetch('/api/accessories', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(isEdit ? { acc_id: editAcc!.acc_id, ...payload } : payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isEdit
        ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓')
        : (isAr ? 'تم الإضافة ✓' : 'Ajouté ✓'))
      setFormOpen(false)
      await fetchAccessories()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function adjustQty(acc: Accessory, delta: number) {
    const newQty = Math.max(0, acc.quantite + delta)
    setAdjusting(acc.acc_id)
    try {
      const res  = await fetch('/api/accessories', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ acc_id: acc.acc_id, quantite: newQty }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAccessories(prev =>
        prev.map(a => a.acc_id === acc.acc_id ? { ...a, quantite: newQty } : a)
      )
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setAdjusting(null)
    }
  }

  const lowStockCount = accessories.filter(a => a.is_low_stock).length
  const totalValue    = accessories.reduce((s, a) =>
    s + ((a.prix_achat ?? 0) * a.quantite), 0
  )

  const { accessories: dynamicCategories } = useCategories()
  function getCatLabel(v: string) { return v }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'الإكسسوارات' : 'Accessoires'}
          subtitle={`${accessories.length} ${isAr ? 'منتج' : 'produit(s)'}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchAccessories} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Btn variant="primary" onClick={openAdd}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة' : 'Ajouter'}
              </Btn>
            </div>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
               style={{ borderLeftColor: primary, borderLeftWidth: '3px' }}>
            <p className="text-xs text-[#6B6860]">{isAr ? 'إجمالي المنتجات' : 'Total produits'}</p>
            <p className="font-display font-bold text-lg text-[#1A1A1A]">{accessories.length}</p>
          </div>
          <div className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
               style={{ borderLeftColor: lowStockCount > 0 ? '#EF4444' : '#10B981', borderLeftWidth: '3px' }}>
            <p className="text-xs text-[#6B6860]">{isAr ? 'تنبيهات المخزون' : 'Alertes stock'}</p>
            <p className={`font-display font-bold text-lg ${lowStockCount > 0 ? 'text-red-500' : 'text-[#1A1A1A]'}`}>
              {lowStockCount}
            </p>
          </div>
          {canFinancials && (
            <div className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
                 style={{ borderLeftColor: '#10B981', borderLeftWidth: '3px' }}>
              <p className="text-xs text-[#6B6860]">{isAr ? 'قيمة المخزون' : 'Valeur stock'}</p>
              <p className="font-display font-bold text-lg text-[#1A1A1A]">{formatMAD(totalValue)}</p>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
            <input
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
              placeholder={isAr ? 'بحث بالاسم أو الباركود...' : 'Rechercher nom, marque, code...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
              onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
            />
          </div>
          <ScanButton
            onScan={v => setSearch(v)}
            hint="Scannez un code-barres accessoire"
            color={primary}
          />
          <select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
          >
            <option value="">{isAr ? 'كل الفئات' : 'Toutes catégories'}</option>
            {dynamicCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={() => setOnlyLowStock(!onlyLowStock)}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-all"
            style={{
              backgroundColor: onlyLowStock ? '#FEF2F2' : 'white',
              borderColor:     onlyLowStock ? '#EF4444' : '#E8E5DE',
              color:           onlyLowStock ? '#EF4444' : '#6B6860',
            }}
          >
            <AlertTriangle className="w-4 h-4" />
            {isAr ? 'المخزون المنخفض' : 'Stock bas'}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">

          {/* Table header */}
          <div className="hidden lg:grid border-b border-[#F2F0EB] px-5 py-3 text-[10px] font-bold text-[#B0ADA6] uppercase tracking-widest"
               style={{ gridTemplateColumns: canFinancials ? '2fr 1fr 1fr 1fr 1fr 120px' : '2fr 1fr 1fr 1fr 120px' }}>
            <span>{isAr ? 'المنتج' : 'Produit'}</span>
            <span>{isAr ? 'الفئة' : 'Catégorie'}</span>
            <span>{isAr ? 'الكمية' : 'Quantité'}</span>
            <span>{isAr ? 'الحالة' : 'Statut'}</span>
            {canFinancials && <span>{isAr ? 'سعر البيع' : 'Prix vente'}</span>}
            <span />
          </div>

          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : accessories.length === 0 ? (
            <EmptyState
              icon={<Package className="w-7 h-7" />}
              title={isAr ? 'لا توجد إكسسوارات' : 'Aucun accessoire'}
              action={
                <Btn variant="primary" onClick={openAdd}
                  style={{ backgroundColor: primary } as React.CSSProperties}>
                  <Plus className="w-4 h-4" />
                  {isAr ? 'إضافة' : 'Ajouter'}
                </Btn>
              }
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {accessories.map(acc => (
                <div
                  key={acc.acc_id}
                  className={`hidden lg:grid items-center px-5 py-3.5 transition-all ${acc.is_low_stock ? 'bg-red-50/30' : 'hover:bg-[#F8F7F4]'}`}
                  style={{ gridTemplateColumns: canFinancials ? '2fr 1fr 1fr 1fr 1fr 120px' : '2fr 1fr 1fr 1fr 120px' }}
                >
                  {/* Name */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: `${primary}12` }}>
                      <Package className="w-4 h-4" style={{ color: primary }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{acc.nom}</p>
                      <p className="text-xs text-[#B0ADA6]">
                        {acc.marque ? `${acc.marque} · ` : ''}{acc.barcode || acc.acc_id}
                      </p>
                    </div>
                  </div>

                  {/* Category */}
                  <p className="text-xs text-[#6B6860]">{getCatLabel(acc.categorie)}</p>

                  {/* Quantity adjuster */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => adjustQty(acc, -1)}
                      disabled={acc.quantite === 0 || adjusting === acc.acc_id}
                      className="w-6 h-6 rounded-lg border border-[#E8E5DE] flex items-center justify-center text-[#6B6860] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all disabled:opacity-30"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className={`text-sm font-bold w-6 text-center ${acc.is_low_stock ? 'text-red-500' : 'text-[#1A1A1A]'}`}>
                      {acc.quantite}
                    </span>
                    <button
                      onClick={() => adjustQty(acc, 1)}
                      disabled={adjusting === acc.acc_id}
                      className="w-6 h-6 rounded-lg border border-[#E8E5DE] flex items-center justify-center text-[#6B6860] hover:bg-emerald-50 hover:text-emerald-500 hover:border-emerald-200 transition-all"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    {acc.is_low_stock && (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    )}
                  </div>

                  {/* Status */}
                  <StatusBadge
                    status={acc.status_computed ?? (acc.quantite === 0 ? 'نفذ' : 'متوفر')}
                    lang={isAr ? 'ar' : 'fr'}
                  />

                  {/* Price */}
                  {canFinancials && (
                    <p className="text-sm font-bold text-[#1A1A1A]">
                      {acc.prix_vente_recommande ? formatMAD(acc.prix_vente_recommande) : '—'}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => setLabelProduct({
                        id:       acc.acc_id,
                        name:     `${acc.marque ? acc.marque + ' ' : ''}${acc.nom}`,
                        category: getCatLabel(acc.categorie),
                        stockage: undefined,
                        couleur:  undefined,
                      })}
                      className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all"
                      title="Générer étiquette"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V5a2 2 0 012-2h2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => openEdit(acc)}
                      className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {canFinancials && (
                      <button
                        onClick={() => setConfirmDelete(acc.acc_id)}
                        className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Mobile cards */}
              {accessories.map(acc => (
                <div key={`mob-${acc.acc_id}`}
                  className={`lg:hidden flex items-center gap-4 px-4 py-3.5 transition-all ${acc.is_low_stock ? 'bg-red-50/40' : 'hover:bg-[#F8F7F4]'}`}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                       style={{ backgroundColor: `${primary}12` }}>
                    <Package className="w-5 h-5" style={{ color: primary }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">{acc.nom}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[#B0ADA6]">{getCatLabel(acc.categorie)}</span>
                      <StatusBadge status={acc.status_computed ?? 'متوفر'} size="sm" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => adjustQty(acc, -1)} disabled={acc.quantite === 0}
                      className="w-7 h-7 rounded-lg border border-[#E8E5DE] flex items-center justify-center">
                      <Minus className="w-3 h-3 text-[#6B6860]" />
                    </button>
                    <span className={`text-sm font-bold w-5 text-center ${acc.is_low_stock ? 'text-red-500' : ''}`}>
                      {acc.quantite}
                    </span>
                    <button onClick={() => adjustQty(acc, 1)}
                      className="w-7 h-7 rounded-lg border border-[#E8E5DE] flex items-center justify-center">
                      <Plus className="w-3 h-3 text-[#6B6860]" />
                    </button>
                    <button onClick={() => openEdit(acc)}
                      className="w-7 h-7 rounded-lg border border-[#E8E5DE] flex items-center justify-center">
                      <Edit2 className="w-3.5 h-3.5 text-[#6B6860]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <p className="text-base font-bold text-[#1A1A1A] mb-2">
              {isAr ? 'تأكيد الحذف' : 'Confirmer la suppression'}
            </p>
            <p className="text-sm text-[#6B6860] mb-6">
              {isAr ? 'هذا الإجراء لا يمكن التراجع عنه.' : 'Cette action est irréversible.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-xl border border-[#E8E5DE] text-sm text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
                {isAr ? 'إلغاء' : 'Annuler'}
              </button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={deleting}
                className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-2">
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isAr ? 'حذف' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Label generator */}
      {labelProduct && (
        <LabelGenerator
          product={labelProduct}
          open={!!labelProduct}
          onClose={() => setLabelProduct(null)}
        />
      )}

      {/* Form Modal */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditAcc(null) }}
        title={editAcc
          ? (isAr ? 'تعديل الإكسسوار' : 'Modifier l\'accessoire')
          : (isAr ? 'إضافة إكسسوار' : 'Ajouter un accessoire')}
        size="md"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'الاسم' : 'Nom'} required>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'كفر آيفون 15...' : 'Coque iPhone 15...'}
                value={form.nom} onChange={e => setF('nom', e.target.value)} autoFocus />
            </Field>
            <Field label={isAr ? 'الفئة' : 'Catégorie'} required>
              <select className={selectClass} value={form.categorie}
                onChange={e => setF('categorie', e.target.value)}>
                <option value="">{isAr ? 'اختر الفئة...' : 'Choisir...'}</option>
                {dynamicCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'الماركة' : 'Marque'}>
              <input type="text" className={inputClass}
                placeholder="Apple, Samsung..."
                value={form.marque} onChange={e => setF('marque', e.target.value)} />
            </Field>
            <Field label={isAr ? 'رمز الباركود' : 'Code-barres'}>
              <div className="flex gap-2">
                <input type="text" className={inputClass}
                  placeholder="6901234567890"
                  value={form.barcode} onChange={e => setF('barcode', e.target.value)} />
                <ScanButton
                  onScan={v => setF('barcode', v)}
                  hint="Scannez le code-barres"
                  color={primary}
                  size="sm"
                />
              </div>
            </Field>
          </div>

          <Field label={isAr ? 'متوافق مع' : 'Compatible avec'}>
            <input type="text" className={inputClass}
              placeholder="iPhone 14/15, Galaxy S23..."
              value={form.compatible_with} onChange={e => setF('compatible_with', e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'الكمية الحالية' : 'Quantité actuelle'} required>
              <input type="number" min={0} className={inputClass}
                value={form.quantite} onChange={e => setF('quantite', e.target.value)} />
            </Field>
            <Field label={isAr ? 'حد التنبيه' : 'Seuil d\'alerte'} required>
              <input type="number" min={0} className={inputClass}
                value={form.seuil_alerte} onChange={e => setF('seuil_alerte', e.target.value)} />
            </Field>
          </div>

          {canFinancials && (
            <div className="border-t border-[#E8E5DE] pt-4">
              <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-4">
                {isAr ? 'الأسعار' : 'Prix'}
              </p>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: isAr ? 'سعر الشراء' : 'Prix achat',       key: 'prix_achat' },
                  { label: isAr ? 'سعر البيع'   : 'Prix recommandé',  key: 'prix_vente_recommande' },
                  { label: isAr ? 'السعر الأدنى' : 'Prix minimum',    key: 'prix_vente_minimum' },
                ].map(f => (
                  <Field key={f.key} label={f.label}>
                    <input type="number" min={0} step={0.01} className={inputClass}
                      placeholder="0.00"
                      value={(form as Record<string, string>)[f.key]}
                      onChange={e => setF(f.key as keyof typeof EMPTY_FORM, e.target.value)} />
                  </Field>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary" onClick={() => { setFormOpen(false); setEditAcc(null) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handleSubmit} loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editAcc ? (isAr ? 'حفظ' : 'Enregistrer') : (isAr ? 'إضافة' : 'Ajouter')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}