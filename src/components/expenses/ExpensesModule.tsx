'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { ExpenseCategory } from '@/types/database'
import {
  Receipt, Plus, Trash2, RefreshCw,
  ShoppingBag, Zap, Truck, Wrench,
  Users, Megaphone, Monitor, MoreHorizontal,
  Calendar, AlertTriangle, Loader2
} from 'lucide-react'

import { useCategories } from '@/lib/hooks/useCategories'

// Icon mapping for built-in categories — custom categories fall back to MoreHorizontal
const CAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'إيجار':  ShoppingBag,
  'فاتورة': Zap,
  'نقل':    Truck,
  'صيانة':  Wrench,
  'أجور':   Users,
  'تسويق':  Megaphone,
  'معدات':  Monitor,
  'أخرى':   MoreHorizontal,
}

interface Expense {
  exp_id:            string
  categorie:         ExpenseCategory
  montant:           number
  date:              string
  facture_ref?:      string | null
  receipt_photo_url?: string | null
  store_id?:         string | null
  notes?:            string | null
  created_by?:       string | null
}

const EMPTY_FORM = {
  categorie:   '',
  montant:     '',
  date:        new Date().toISOString().split('T')[0],
  facture_ref: '',
  notes:       '',
  receipt_photo_url: '' as string,
}

interface ExpensesModuleProps {
  storeId: string
}

export default function ExpensesModule({ storeId }: ExpensesModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canDelete    = user?.role === 'manager' || user?.role === 'owner'

  const [expenses, setExpenses]     = useState<Expense[]>([])
  const [loading, setLoading]       = useState(true)
  const [modalOpen, setModalOpen]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [uploading, setUploading]   = useState(false)
  

  // Filters
  const today = new Date().toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(today.slice(0, 7) + '-01')
  const [dateTo, setDateTo]     = useState(today)
  const [filterCat, setFilterCat] = useState('')

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId, date_from: dateFrom, date_to: dateTo })
      if (filterCat) params.set('categorie', filterCat)
      const res  = await fetch(`/api/expenses?${params}`)
      const json = await res.json()
      setExpenses(json.data || [])
    } catch {
      showError(isAr ? 'خطأ في التحميل' : 'Erreur chargement')
    } finally {
      setLoading(false)
    }
  }, [storeId, dateFrom, dateTo, filterCat])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.montant || parseFloat(form.montant) <= 0) {
      showError(isAr ? 'أدخل مبلغاً صحيحاً' : 'Montant invalide')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/expenses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          store_id:         storeId,
          categorie:        form.categorie,
          montant:          parseFloat(form.montant),
          date:             form.date,
          facture_ref:      form.facture_ref || null,
          notes:            form.notes || null,
          receipt_photo_url: form.receipt_photo_url || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل الدépense ✓' : 'Dépense enregistrée ✓')
      setModalOpen(false)
      setForm({ ...EMPTY_FORM })
      await fetchExpenses()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(expId: string) {
    if (!confirm(isAr ? 'هل أنت متأكد من الحذف؟' : 'Confirmer la suppression ?')) return
    setDeleting(expId)
    try {
      const res = await fetch(`/api/expenses?exp_id=${expId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الحذف' : 'Supprimée')
      await fetchExpenses()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  // Totals
  const totalPeriod = expenses.reduce((s, e) => s + e.montant, 0)
  const totalToday  = expenses
    .filter(e => e.date === today)
    .reduce((s, e) => s + e.montant, 0)

  const { expenses: dynamicCategories } = useCategories()
  const getCatIcon  = (v: string) => CAT_ICONS[v] ?? MoreHorizontal
  const getCatLabel = (v: string) => {
    const c = dynamicCategories.find(x => x.ar === v)
    return c ? (isAr ? c.ar : c.fr) : v
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <PageHeader
        title={isAr ? 'المصاريف' : 'Dépenses'}
        subtitle={isAr ? 'تسجيل ومتابعة المصاريف اليومية' : 'Enregistrement et suivi des dépenses'}
        actions={
          <Btn variant="primary" onClick={() => setModalOpen(true)} style={{ backgroundColor: primary } as React.CSSProperties}>
            <Plus className="w-4 h-4" />
            {isAr ? 'مصروف جديد' : 'Nouvelle dépense'}
          </Btn>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5"
             style={{ borderLeftColor: primary, borderLeftWidth: '3px' }}>
          <p className="text-xs text-[#6B6860] mb-1">{isAr ? 'اليوم' : "Aujourd'hui"}</p>
          <p className="font-display text-2xl font-bold text-[#1A1A1A]">{formatMAD(totalToday)}</p>
        </div>
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5"
             style={{ borderLeftColor: '#EF4444', borderLeftWidth: '3px' }}>
          <p className="text-xs text-[#6B6860] mb-1">{isAr ? 'إجمالي الفترة' : 'Total période'}</p>
          <p className="font-display text-2xl font-bold text-[#1A1A1A]">{formatMAD(totalPeriod)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#B0ADA6]" />
          <input
            type="date"
            className={`${inputClass} w-auto text-sm py-2`}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
          <span className="text-[#B0ADA6] text-sm">→</span>
          <input
            type="date"
            className={`${inputClass} w-auto text-sm py-2`}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
        <select
          className={`${selectClass} w-auto text-sm py-2`}
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
        >
          <option value="">{isAr ? 'كل الفئات' : 'Toutes catégories'}</option>
          {dynamicCategories.map(cat => (
            <option key={cat.ar} value={cat.ar}>
              {isAr ? cat.ar : cat.fr}
            </option>
          ))}
        </select>
        <button
          onClick={fetchExpenses}
          className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* List */}
      <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y divide-[#F2F0EB]">
            {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title={isAr ? 'لا توجد مصاريف' : 'Aucune dépense'}
            description={isAr ? 'لم يتم تسجيل أي مصروف في هذه الفترة' : 'Aucune dépense enregistrée pour cette période'}
            action={
              <Btn variant="primary" onClick={() => setModalOpen(true)}>
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة مصروف' : 'Ajouter une dépense'}
              </Btn>
            }
          />
        ) : (
          <div className="divide-y divide-[#F2F0EB]">
            {expenses.map(exp => {
              const Icon = getCatIcon(exp.categorie)
              return (
                <div key={exp.exp_id}
                     className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#F8F7F4] transition-all">
                  <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A]">{getCatLabel(exp.categorie)}</p>
                    <p className="text-xs text-[#B0ADA6]">
                      {formatDate(exp.date)}
                      {exp.facture_ref && ` · Réf: ${exp.facture_ref}`}
                      {exp.notes && ` · ${exp.notes}`}
                    </p>
                  </div>
                  <p className="font-bold text-sm text-red-500 flex-shrink-0">
                    - {formatMAD(exp.montant)}
                  </p>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(exp.exp_id)}
                      disabled={deleting === exp.exp_id}
                      className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0 disabled:opacity-50"
                    >
                      {deleting === exp.exp_id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />
                      }
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setForm({ ...EMPTY_FORM }) }}
        title={isAr ? 'تسجيل مصروف جديد' : 'Nouvelle dépense'}
        size="sm"
      >
        <div className="space-y-4">
          <Field label={isAr ? 'الفئة' : 'Catégorie'} required>
            <div className="grid grid-cols-4 gap-2">
              {dynamicCategories.map(cat => {
              const active = filterCat === cat.ar
              const Icon   = getCatIcon(cat.ar)
              return (
                <button key={cat.ar}
                  onClick={() => setFilterCat(active ? '' : cat.ar)}
                    className="flex flex-col items-center gap-1 p-2 rounded-xl border text-xs font-medium transition-all"
                    style={{ backgroundColor: active ? '#1A1A1A' : 'white', color: active ? 'white' : '#6B6860', borderColor: active ? '#1A1A1A' : '#E8E5DE' }}>
                    <Icon className="w-3.5 h-3.5" />
                    <span>{isAr ? cat.ar : cat.fr}</span>
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={isAr ? 'المبلغ (درهم)' : 'Montant (MAD)'} required>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              placeholder="0.00"
              value={form.montant}
              onChange={e => setF('montant', e.target.value)}
              autoFocus
            />
          </Field>

          <Field label={isAr ? 'التاريخ' : 'Date'} required>
            <input
              type="date"
              className={inputClass}
              value={form.date}
              onChange={e => setF('date', e.target.value)}
            />
          </Field>

          <Field label={isAr ? 'رقم الفاتورة (اختياري)' : 'Référence facture (optionnel)'}>
            <input
              type="text"
              className={inputClass}
              placeholder={isAr ? 'رقم الفاتورة...' : 'FAC-001...'}
              value={form.facture_ref}
              onChange={e => setF('facture_ref', e.target.value)}
            />
          </Field>

          <Field label={isAr ? 'ملاحظات (اختياري)' : 'Notes (optionnel)'}>
            <textarea
              className={`${inputClass} resize-none text-sm`}
              rows={2}
              value={form.notes}
              onChange={e => setF('notes', e.target.value)}
              placeholder={isAr ? 'ملاحظة...' : 'Note...'}
            />
          </Field>

          {/* Warning if today's caisse is not open */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              {isAr
                ? 'سيتم خصم هذا المبلغ تلقائياً من كاسيير اليوم'
                : 'Ce montant sera automatiquement déduit de la caisse du jour'}
            </p>
          </div>

            <Field label={isAr ? 'صورة الفاتورة' : 'Photo du reçu'}>
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setUploading(true)
                  try {
                    const { createClient: mkClient } = await import('@/lib/supabase/client')
                    const sb = mkClient()
                    const ext  = file.name.split('.').pop()
                    const path = `receipts/${storeId}/${Date.now()}.${ext}`
                    const { error: upErr } = await sb.storage.from('expenses').upload(path, file, { upsert: true })
                    if (upErr) throw upErr
                    const { data: { publicUrl } } = sb.storage.from('expenses').getPublicUrl(path)
                    setForm(p => ({ ...p, receipt_photo_url: publicUrl }))
                    showSuccess(isAr ? 'تم رفع الصورة ✓' : 'Photo téléversée ✓')
                  } catch (err: unknown) {
                    showError((err as Error).message)
                  } finally {
                    setUploading(false)
                  }
                }}
                className="w-full text-sm text-[#6B6860] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#F2F0EB] file:text-[#1A1A1A] cursor-pointer"
              />
              {uploading && <p className="text-xs text-[#B0ADA6]">{isAr ? 'جارٍ الرفع...' : 'Téléversement...'}</p>}
              {form.receipt_photo_url && (
                <img src={form.receipt_photo_url} alt="reçu" className="h-24 rounded-xl object-cover border border-[#E8E5DE]" />
              )}
            </div>
          </Field>      

          <div className="flex gap-3 justify-end pt-1">
            <Btn variant="secondary" onClick={() => { setModalOpen(false); setForm({ ...EMPTY_FORM }) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSubmit}
              loading={submitting}
              disabled={!form.montant}
              style={{ backgroundColor: primary } as React.CSSProperties}
            >
              {isAr ? 'تسجيل' : 'Enregistrer'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}