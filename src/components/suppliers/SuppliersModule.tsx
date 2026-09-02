'use client'
import { useCategories } from '@/lib/hooks/useCategories'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import {
  Truck, Plus, Search, X, RefreshCw,
  Edit2, Phone, MapPin, MessageCircle,
  ChevronRight, Check, Loader2, Package,
} from 'lucide-react'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Supplier {
  supplier_id:        string
  nom:                string
  telephone?:         string | null
  email?:             string | null
  adresse?:           string | null
  ville?:             string | null
  categorie?:         string | null
  type_fournisseur:   string
  store_id?:          string | null
  notes?:             string | null
  created_at:         string
  total_paye?:        number
  total_achats?:      number
  solde_du?:          number
  nb_en_stock?:       number
  nb_vendus?:         number
  a_montant_en_stock?: number
}

interface UnsettledPhone {
  phone_id:   string
  marque:     string
  model:      string
  imei?:      string | null
  couleur?:   string | null
  stockage?:  string | null
  cash_recu:  number
  fac_ref?:   string | null
}

interface SupplierPhone {
  phone_id:    string
  marque:      string
  model:       string
  imei?:       string | null
  couleur?:    string | null
  stockage?:   string | null
  prix_achat?: number | null
  status:      string
}

interface Payment {
  payment_id:    string
  payment_type:  string
  montant:       number
  phone_ids:     string[]
  date_paiement: string
  notes?:        string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  nom: '', telephone: '', email: '',
  adresse: '', ville: '', categorie: '',
  notes: '', type_fournisseur: 'B',
}

const EMPTY_PAY = {
  montant: '',
  date_paiement: new Date().toISOString().split('T')[0],
  notes: '',
}

const TYPE_CFG: Record<string, { bg: string; color: string; border: string; desc: string }> = {
  A: { bg: '#FAF5E8', color: '#C9A440', border: '1px solid #E8D494', desc: 'Consignation' },
  B: { bg: '#EFF6FF', color: '#3B82F6', border: '1px solid #BFDBFE', desc: 'Paiement direct' },
  C: { bg: '#F5F3FF', color: '#7C3AED', border: '1px solid #DDD6FE', desc: 'Paiement direct' },
}

const PAY_LABEL: Record<string, string> = {
  REGLEMENT_A: 'Règlement ventes',
  AVANCE_A:    'Avance stock',
  PAIEMENT_B:  'Paiement',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SuppliersModuleProps { storeId: string }

export default function SuppliersModule({ storeId }: SuppliersModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor

  const { suppliers: supplierCats } = useCategories()

  // ── Core state ──────────────────────────────────────────────────────────────
  const [suppliers,       setSuppliers]       = useState<Supplier[]>([])
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [selected,        setSelected]        = useState<Supplier | null>(null)
  const [formOpen,        setFormOpen]        = useState(false)
  const [editSupplier,    setEditSupplier]    = useState<Supplier | null>(null)
  const [payOpen,         setPayOpen]         = useState(false)
  const [payments,        setPayments]        = useState<Payment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [form,            setForm]            = useState({ ...EMPTY_FORM })
  const [payForm,         setPayForm]         = useState({ ...EMPTY_PAY })
  const [submitting,      setSubmitting]      = useState(false)

  // ── Type A — settlement state ────────────────────────────────────────────────
  const [unsettledPhones,  setUnsettledPhones]  = useState<UnsettledPhone[]>([])
  const [selectedPhoneIds, setSelectedPhoneIds] = useState<Set<string>>(new Set())
  const [unsettledLoading, setUnsettledLoading] = useState(false)
  const [showAvance,       setShowAvance]       = useState(false)
  const [avanceMontant,    setAvanceMontant]    = useState('')

  // ── Type B/C — phone linking state ──────────────────────────────────────────
  const [supplierPhones,       setSupplierPhones]       = useState<SupplierPhone[]>([])
  const [linkedPhoneIds,       setLinkedPhoneIds]       = useState<Set<string>>(new Set())
  const [supplierPhonesLoading,setSupplierPhonesLoading]= useState(false)
  const [showPhoneSelector,    setShowPhoneSelector]    = useState(false)

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selectedTotal = useMemo(() =>
    unsettledPhones
      .filter(p => selectedPhoneIds.has(p.phone_id))
      .reduce((sum, p) => sum + (p.cash_recu ?? 0), 0),
    [unsettledPhones, selectedPhoneIds]
  )

  const totalDue = suppliers.reduce((s, sup) => s + (sup.solde_du ?? 0), 0)

  // ── Fetch functions ──────────────────────────────────────────────────────────

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

  async function fetchUnsettledPhones(supplierId: string) {
    setUnsettledLoading(true)
    try {
      const res  = await fetch(`/api/supplier-payments?mode=unsettled_phones&supplier_id=${supplierId}`)
      const json = await res.json()
      const phones: UnsettledPhone[] = json.data || []
      setUnsettledPhones(phones)
      setSelectedPhoneIds(new Set(phones.map(p => p.phone_id)))
    } finally {
      setUnsettledLoading(false)
    }
  }

  async function fetchSupplierPhones(supplierId: string) {
    setSupplierPhonesLoading(true)
    try {
      const res  = await fetch(`/api/phones?fournisseur_id=${supplierId}&store_id=${storeId}`)
      const json = await res.json()
      setSupplierPhones(json.data || [])
    } finally {
      setSupplierPhonesLoading(false)
    }
  }

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => fetchSuppliers(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchSuppliers, search])

  // ── Modal helpers ────────────────────────────────────────────────────────────

  function closeDetail() {
    setSelected(null)
    setUnsettledPhones([])
    setSelectedPhoneIds(new Set())
    setSupplierPhones([])
    setLinkedPhoneIds(new Set())
    setShowAvance(false)
    setAvanceMontant('')
    setShowPhoneSelector(false)
    setPayments([])
  }

  function openAdd() {
    setEditSupplier(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }

  function openEdit(s: Supplier) {
    setEditSupplier(s)
    setForm({
      nom:              s.nom,
      telephone:        s.telephone        ?? '',
      email:            s.email            ?? '',
      adresse:          s.adresse          ?? '',
      ville:            s.ville            ?? '',
      categorie:        s.categorie        ?? '',
      notes:            s.notes            ?? '',
      type_fournisseur: s.type_fournisseur ?? 'B',
    })
    setFormOpen(true)
    closeDetail()
  }

  function openDetail(s: Supplier) {
    setSelected(s)
    fetchPayments(s.supplier_id)
    if (s.type_fournisseur === 'A') {
      fetchUnsettledPhones(s.supplier_id)
    } else {
      fetchSupplierPhones(s.supplier_id)
    }
  }

  // ── Toggle helpers ───────────────────────────────────────────────────────────

  function togglePhone(id: string) {
    setSelectedPhoneIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllPhones() {
    if (selectedPhoneIds.size === unsettledPhones.length) {
      setSelectedPhoneIds(new Set())
    } else {
      setSelectedPhoneIds(new Set(unsettledPhones.map(p => p.phone_id)))
    }
  }

  function toggleLinkedPhone(id: string) {
    setLinkedPhoneIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!form.nom.trim()) {
      showError(isAr ? 'اسم المورد مطلوب' : 'Nom obligatoire')
      return
    }
    setSubmitting(true)
    try {
      const isEdit  = !!editSupplier
      const payload = {
        store_id:         storeId,
        nom:              form.nom,
        telephone:        form.telephone        || null,
        email:            form.email            || null,
        adresse:          form.adresse          || null,
        ville:            form.ville            || null,
        categorie:        form.categorie        || null,
        notes:            form.notes            || null,
        type_fournisseur: form.type_fournisseur || 'B',
      }
      const res  = await fetch('/api/suppliers', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(
          isEdit ? { supplier_id: editSupplier!.supplier_id, ...payload } : payload
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isEdit ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓') : (isAr ? 'تم الإضافة ✓' : 'Ajouté ✓'))
      setFormOpen(false)
      await fetchSuppliers()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReglement() {
    if (!selected || selectedPhoneIds.size === 0) return
    setSubmitting(true)
    try {
      const res  = await fetch('/api/supplier-payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          supplier_id:   selected.supplier_id,
          store_id:      storeId,
          payment_type:  'REGLEMENT_A',
          montant:       selectedTotal,
          phone_ids:     Array.from(selectedPhoneIds),
          date_paiement: new Date().toISOString().split('T')[0],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(`${isAr ? 'تمت التسوية ✓' : 'Règlement enregistré ✓'} — ${formatMAD(selectedTotal)}`)
      await fetchSuppliers()
      fetchUnsettledPhones(selected.supplier_id)
      fetchPayments(selected.supplier_id)
      setSelected(prev => prev ? { ...prev, solde_du: Math.max(0, (prev.solde_du ?? 0) - selectedTotal) } : null)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAvance() {
    if (!selected || !avanceMontant || parseFloat(avanceMontant) <= 0) return
    setSubmitting(true)
    try {
      const montant = parseFloat(avanceMontant)
      const res  = await fetch('/api/supplier-payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          supplier_id:   selected.supplier_id,
          store_id:      storeId,
          payment_type:  'AVANCE_A',
          montant,
          phone_ids:     [],
          date_paiement: new Date().toISOString().split('T')[0],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل المسبقة ✓' : 'Avance enregistrée ✓')
      setAvanceMontant('')
      setShowAvance(false)
      await fetchSuppliers()
      fetchPayments(selected.supplier_id)
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
      const res  = await fetch('/api/supplier-payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          supplier_id:   selected.supplier_id,
          store_id:      storeId,
          payment_type:  'PAIEMENT_B',
          montant:       parseFloat(payForm.montant),
          phone_ids:     Array.from(linkedPhoneIds),
          date_paiement: payForm.date_paiement,
          notes:         payForm.notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل الدفعة ✓' : 'Paiement enregistré ✓')
      setPayOpen(false)
      setPayForm({ ...EMPTY_PAY })
      setLinkedPhoneIds(new Set())
      setShowPhoneSelector(false)
      await fetchSuppliers()
      fetchPayments(selected.supplier_id)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function getTypeBadge(type: string) {
    const cfg = TYPE_CFG[type] ?? { bg: '#F8F7F4', color: '#6B6860', border: '1px solid #E8E5DE', desc: '' }
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: cfg.bg, color: cfg.color, border: cfg.border }}
      >
        {type} · {cfg.desc}
      </span>
    )
  }

  function getCatLabel(v: string) {
    const c = supplierCats.find((x: any) => x.ar === v)
    return c ? (isAr ? c.ar : c.fr) : v
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'الموردون' : 'Fournisseurs'}
          subtitle={`${suppliers.length} fournisseur${suppliers.length !== 1 ? 's' : ''}`}
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

        {/* KPI strip */}
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
            placeholder={isAr ? 'بحث...' : 'Rechercher par nom, téléphone...'}
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

      {/* ── List ────────────────────────────────────────────────────────────── */}
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
              {suppliers.map(sup => {
                const cfg = TYPE_CFG[sup.type_fournisseur] ?? TYPE_CFG['B']
                return (
                  <div key={sup.supplier_id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-[#F8F7F4] transition-all cursor-pointer"
                    onClick={() => openDetail(sup)}>

                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm"
                         style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}>
                      {sup.nom.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#1A1A1A]">{sup.nom}</p>
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: cfg.bg, color: cfg.color, border: cfg.border }}
                        >
                          {sup.type_fournisseur}
                        </span>
                      </div>
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
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="text-right flex-shrink-0">
                      {(sup.solde_du ?? 0) > 0 && (
                        <p className="text-sm font-bold text-red-500">
                          {formatMAD(sup.solde_du ?? 0)}
                        </p>
                      )}
                      {(sup.nb_en_stock ?? 0) > 0 && (
                        <p className="text-[10px] text-[#B0ADA6]">
                          {sup.nb_en_stock} {isAr ? 'في المخزون' : 'en stock'}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Modal ─────────────────────────────────────────────────────── */}
      {selected && (
        <Modal open={!!selected} onClose={closeDetail} title={selected.nom} size="lg">
          <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>

            {/* Type badge */}
            <div className="flex items-center gap-2 flex-wrap">
              {getTypeBadge(selected.type_fournisseur)}
              {selected.categorie && (
                <span className="text-xs text-[#6B6860]">{getCatLabel(selected.categorie)}</span>
              )}
            </div>

            {/* ── TYPE A ── */}
            {selected.type_fournisseur === 'A' ? (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl p-3 text-center border"
                       style={{ backgroundColor: (selected.solde_du ?? 0) > 0 ? '#FFF1F2' : '#F0FDF4', borderColor: (selected.solde_du ?? 0) > 0 ? '#FECDD3' : '#BBF7D0' }}>
                    <p className="text-[10px] uppercase tracking-wider font-bold mb-1"
                       style={{ color: (selected.solde_du ?? 0) > 0 ? '#9B1C1C' : '#065F46' }}>
                      {isAr ? 'المستحق' : 'Solde dû'}
                    </p>
                    <p className="font-bold text-sm"
                       style={{ color: (selected.solde_du ?? 0) > 0 ? '#EF4444' : '#059669' }}>
                      {formatMAD(selected.solde_du ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-xl p-3 text-center bg-[#F0FDF4] border border-emerald-100">
                    <p className="text-[10px] text-emerald-700 uppercase tracking-wider font-bold mb-1">
                      {isAr ? 'المُسوَّى' : 'Total réglé'}
                    </p>
                    <p className="font-bold text-sm text-emerald-600">
                      {formatMAD(selected.total_paye ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-xl p-3 text-center bg-[#F8F7F4] border border-[#E8E5DE]">
                    <p className="text-[10px] text-[#6B6860] uppercase tracking-wider font-bold mb-1">
                      {isAr ? 'المخزون' : 'En stock'}
                    </p>
                    <p className="font-bold text-sm text-[#1A1A1A]">
                      {selected.nb_en_stock ?? 0} tél.
                    </p>
                  </div>
                </div>

                {/* Unsettled phones */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest">
                      {isAr ? 'مبيعات غير مُسوَّاة' : `Ventes non réglées (${unsettledPhones.length})`}
                    </p>
                    {unsettledPhones.length > 0 && (
                      <button onClick={toggleAllPhones}
                        className="text-xs font-medium transition-colors"
                        style={{ color: primary }}>
                        {selectedPhoneIds.size === unsettledPhones.length
                          ? (isAr ? 'إلغاء الكل' : 'Désélectionner')
                          : (isAr ? 'تحديد الكل' : 'Tout sélectionner')}
                      </button>
                    )}
                  </div>

                  {unsettledLoading ? (
                    <div className="flex items-center justify-center py-6 gap-2 text-[#B0ADA6]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">{isAr ? 'جارٍ التحميل...' : 'Chargement...'}</span>
                    </div>
                  ) : unsettledPhones.length === 0 ? (
                    <div className="flex items-center justify-center py-5 gap-2">
                      <Package className="w-4 h-4 text-emerald-500" />
                      <p className="text-sm text-emerald-600 font-medium">
                        {isAr ? 'لا توجد مبيعات غير مُسوَّاة ✓' : 'Tout est à jour ✓'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {unsettledPhones.map(phone => {
                        const isSel = selectedPhoneIds.has(phone.phone_id)
                        return (
                          <div
                            key={phone.phone_id}
                            onClick={() => togglePhone(phone.phone_id)}
                            className="flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all select-none"
                            style={{
                              borderColor:     isSel ? '#C9A440' : '#E8E5DE',
                              backgroundColor: isSel ? '#FAF5E8' : 'white',
                            }}
                          >
                            <div
                              className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                              style={{
                                border:          `2px solid ${isSel ? '#C9A440' : '#D1D5DB'}`,
                                backgroundColor: isSel ? '#C9A440' : 'transparent',
                              }}
                            >
                              {isSel && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-[#1A1A1A] truncate">
                                {phone.marque} {phone.model}
                                {phone.stockage ? ` · ${phone.stockage}` : ''}
                                {phone.couleur  ? ` · ${phone.couleur}`  : ''}
                              </p>
                              {(phone.imei || phone.fac_ref) && (
                                <p className="text-[10px] text-[#B0ADA6] truncate">
                                  {phone.imei ? `IMEI: ${phone.imei}` : ''}
                                  {phone.fac_ref ? ` · ${phone.fac_ref}` : ''}
                                </p>
                              )}
                            </div>
                            <p className="text-sm font-bold flex-shrink-0" style={{ color: '#C9A440' }}>
                              {formatMAD(phone.cash_recu)}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {unsettledPhones.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                           style={{ backgroundColor: '#FAF5E8', border: '1px solid #E8D494' }}>
                        <span className="text-xs font-bold" style={{ color: '#C9A440' }}>
                          {isAr ? `محدد (${selectedPhoneIds.size})` : `Sélectionné (${selectedPhoneIds.size})`}
                        </span>
                        <span className="text-sm font-bold" style={{ color: '#C9A440' }}>
                          {formatMAD(selectedTotal)}
                        </span>
                      </div>
                      <button
                        onClick={handleReglement}
                        disabled={submitting || selectedPhoneIds.size === 0}
                        className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                        style={{ backgroundColor: '#C9A440' }}
                      >
                        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isAr
                          ? `تسوية المحدد — ${formatMAD(selectedTotal)}`
                          : `Régler la sélection — ${formatMAD(selectedTotal)}`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Avance */}
                <div>
                  {!showAvance ? (
                    <button onClick={() => setShowAvance(true)}
                      className="text-xs text-[#B0ADA6] hover:text-[#6B6860] transition-colors flex items-center gap-1">
                      <Plus className="w-3 h-3" />
                      {isAr ? 'تسجيل مسبقة على المخزون' : 'Enregistrer une avance sur stock'}
                    </button>
                  ) : (
                    <div className="flex items-end gap-2 p-3 bg-[#F8F7F4] rounded-xl border border-[#E8E5DE]">
                      <div className="flex-1">
                        <p className="text-[10px] text-[#B0ADA6] uppercase tracking-wider font-bold mb-1">
                          {isAr ? 'مبلغ المسبقة (درهم)' : 'Montant avance (MAD)'}
                        </p>
                        <input
                          type="number" min={0} step={50}
                          className={inputClass}
                          placeholder="0.00"
                          autoFocus
                          value={avanceMontant}
                          onChange={e => setAvanceMontant(e.target.value)}
                        />
                      </div>
                      <Btn variant="primary" onClick={handleAvance} loading={submitting}
                        style={{ backgroundColor: primary } as React.CSSProperties}>
                        {isAr ? 'تسجيل' : 'Valider'}
                      </Btn>
                      <button onClick={() => { setShowAvance(false); setAvanceMontant('') }}
                        className="text-[#B0ADA6] hover:text-[#1A1A1A] transition-colors pb-2">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ── TYPE B/C ── */
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl p-3 text-center bg-[#F8F7F4] border border-[#E8E5DE]">
                    <p className="text-[10px] text-[#6B6860] uppercase tracking-wider font-bold mb-1">
                      {isAr ? 'إجمالي الشراء' : 'Total achats'}
                    </p>
                    <p className="font-bold text-sm text-[#1A1A1A]">{formatMAD(selected.total_achats ?? 0)}</p>
                  </div>
                  <div className="rounded-xl p-3 text-center bg-[#F0FDF4] border border-emerald-100">
                    <p className="text-[10px] text-emerald-700 uppercase tracking-wider font-bold mb-1">
                      {isAr ? 'المدفوع' : 'Total payé'}
                    </p>
                    <p className="font-bold text-sm text-emerald-600">{formatMAD(selected.total_paye ?? 0)}</p>
                  </div>
                  <div className="rounded-xl p-3 text-center border"
                       style={{ backgroundColor: (selected.solde_du ?? 0) > 0 ? '#FFF1F2' : '#F0FDF4', borderColor: (selected.solde_du ?? 0) > 0 ? '#FECDD3' : '#BBF7D0' }}>
                    <p className="text-[10px] uppercase tracking-wider font-bold mb-1"
                       style={{ color: (selected.solde_du ?? 0) > 0 ? '#9B1C1C' : '#065F46' }}>
                      {isAr ? 'المستحق' : 'Solde dû'}
                    </p>
                    <p className="font-bold text-sm"
                       style={{ color: (selected.solde_du ?? 0) > 0 ? '#EF4444' : '#059669' }}>
                      {formatMAD(selected.solde_du ?? 0)}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setPayOpen(true)}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all border"
                  style={{ borderColor: primary, color: primary, backgroundColor: `${primary}10` }}
                >
                  <Plus className="w-4 h-4" />
                  {isAr ? 'دفعة جديدة' : 'Nouveau paiement'}
                </button>
              </>
            )}

            {/* SHARED — Contact */}
            {(selected.telephone || selected.ville || selected.adresse) && (
              <div className="space-y-2">
                {selected.telephone && (
                  <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                    <Phone className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#B0ADA6]">{isAr ? 'الهاتف' : 'Téléphone'}</p>
                      <p className="text-sm font-medium text-[#1A1A1A]">{selected.telephone}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <a href={`tel:${selected.telephone}`}
                         className="text-xs font-bold py-1 px-3 rounded-lg"
                         style={{ backgroundColor: `${primary}15`, color: primary }}>
                        {isAr ? 'اتصال' : 'Appeler'}
                      </a>
                      <a href={`https://wa.me/212${selected.telephone.replace(/^0/, '')}`}
                         target="_blank" rel="noopener noreferrer"
                         className="text-xs font-bold py-1 px-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <MessageCircle className="w-3.5 h-3.5 inline" />
                      </a>
                    </div>
                  </div>
                )}
                {(selected.ville || selected.adresse) && (
                  <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                    <MapPin className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                    <div>
                      <p className="text-xs text-[#B0ADA6]">{isAr ? 'الموقع' : 'Adresse'}</p>
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
            )}

            {/* SHARED — Payment history */}
            <div>
              <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3">
                {isAr ? 'سجل الدفعات' : 'Historique paiements'}
              </p>
              {paymentsLoading ? (
                <div className="space-y-2">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-12 bg-[#F8F7F4] rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : payments.length === 0 ? (
                <p className="text-xs text-[#B0ADA6] text-center py-4">
                  {isAr ? 'لا توجد دفعات' : 'Aucun paiement enregistré'}
                </p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {payments.map(p => {
                    const count = Array.isArray(p.phone_ids) ? p.phone_ids.length : 0
                    return (
                      <div key={p.payment_id}
                           className="flex items-center justify-between p-3 bg-[#F8F7F4] rounded-xl">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#1A1A1A]">
                            {PAY_LABEL[p.payment_type] ?? p.payment_type}
                            {count > 0 ? ` · ${count} tél.` : ''}
                          </p>
                          <p className="text-[10px] text-[#B0ADA6]">
                            {formatDate(p.date_paiement)}
                            {p.notes ? ` · ${p.notes}` : ''}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-emerald-600 flex-shrink-0 ml-3">
                          {formatMAD(p.montant)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* SHARED — Actions */}
            <div className="flex gap-3 pt-2 border-t border-[#E8E5DE]">
              <Btn variant="secondary" className="flex-1" onClick={closeDetail}>
                {isAr ? 'إغلاق' : 'Fermer'}
              </Btn>
              <Btn variant="primary" className="flex-1"
                onClick={() => openEdit(selected)}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Edit2 className="w-4 h-4" />
                {isAr ? 'تعديل' : 'Modifier'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── B/C Payment Modal ─────────────────────────────────────────────── */}
      <Modal
        open={payOpen}
        onClose={() => { setPayOpen(false); setPayForm({ ...EMPTY_PAY }); setLinkedPhoneIds(new Set()); setShowPhoneSelector(false) }}
        title={isAr ? 'تسجيل دفعة' : 'Nouveau paiement'}
        size="sm"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <p className="text-sm text-[#6B6860]">
            {isAr ? 'مورد:' : 'Fournisseur:'}{' '}
            <span className="font-bold text-[#1A1A1A]">{selected?.nom}</span>
          </p>

          <Field label={isAr ? 'المبلغ (درهم)' : 'Montant (MAD)'} required>
            <input type="number" min={0} step={0.01} className={inputClass}
              placeholder="0.00" autoFocus
              value={payForm.montant}
              onChange={e => setPayForm(p => ({ ...p, montant: e.target.value }))} />
          </Field>

          <Field label={isAr ? 'تاريخ الدفع' : 'Date paiement'}>
            <input type="date" className={inputClass}
              value={payForm.date_paiement}
              onChange={e => setPayForm(p => ({ ...p, date_paiement: e.target.value }))} />
          </Field>

          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={payForm.notes}
              onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} />
          </Field>

          {/* Phone selector — optional */}
          <div>
            <button
              onClick={() => setShowPhoneSelector(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors"
              style={{ color: showPhoneSelector ? primary : '#B0ADA6' }}
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${showPhoneSelector ? 'rotate-90' : ''}`} />
              {isAr ? 'ربط بهواتف محددة' : 'Lier à des téléphones spécifiques'}
              {linkedPhoneIds.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: primary }}>
                  {linkedPhoneIds.size}
                </span>
              )}
            </button>

            {showPhoneSelector && (
              <div className="mt-2 border border-[#E8E5DE] rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                {supplierPhonesLoading ? (
                  <div className="flex items-center justify-center py-4 gap-2 text-[#B0ADA6]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs">Chargement...</span>
                  </div>
                ) : supplierPhones.length === 0 ? (
                  <p className="text-xs text-[#B0ADA6] text-center py-4">
                    {isAr ? 'لا توجد هواتف' : 'Aucun téléphone'}
                  </p>
                ) : (
                  supplierPhones.map(phone => {
                    const isLinked = linkedPhoneIds.has(phone.phone_id)
                    return (
                      <div
                        key={phone.phone_id}
                        onClick={() => toggleLinkedPhone(phone.phone_id)}
                        className="flex items-center gap-2.5 px-3 py-2 border-b border-[#F2F0EB] last:border-0 cursor-pointer hover:bg-[#F8F7F4] transition-all"
                      >
                        <div
                          className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center"
                          style={{
                            border: `2px solid ${isLinked ? primary : '#D1D5DB'}`,
                            backgroundColor: isLinked ? primary : 'transparent',
                          }}
                        >
                          {isLinked && <Check className="w-2 h-2 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#1A1A1A] truncate">
                            {phone.marque} {phone.model}
                            {phone.stockage ? ` · ${phone.stockage}` : ''}
                          </p>
                          {phone.imei && (
                            <p className="text-[10px] text-[#B0ADA6]">IMEI: {phone.imei}</p>
                          )}
                        </div>
                        {phone.prix_achat && (
                          <p className="text-xs font-bold text-[#6B6860] flex-shrink-0">
                            {formatMAD(phone.prix_achat)}
                          </p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary"
              onClick={() => { setPayOpen(false); setPayForm({ ...EMPTY_PAY }); setLinkedPhoneIds(new Set()); setShowPhoneSelector(false) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handlePayment} loading={submitting}
              disabled={!payForm.montant}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {isAr ? 'تسجيل الدفعة' : 'Enregistrer'}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditSupplier(null) }}
        title={editSupplier ? (isAr ? 'تعديل المورد' : 'Modifier') : (isAr ? 'مورد جديد' : 'Nouveau fournisseur')}
        size="sm"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>

          {/* Type — shown first so it's obvious */}
          <Field label={isAr ? 'نوع المورد' : 'Type de fournisseur'} required>
            <select className={selectClass}
              value={form.type_fournisseur}
              onChange={e => setForm(f => ({ ...f, type_fournisseur: e.target.value }))}>
              <option value="A">A — Consignation (règlement sur ventes)</option>
              <option value="B">B — Paiement direct (groupe B)</option>
              <option value="C">C — Paiement direct (groupe C)</option>
            </select>
          </Field>

          <Field label={isAr ? 'اسم المورد' : 'Nom du fournisseur'} required>
            <input type="text" className={inputClass} autoFocus
              placeholder={isAr ? 'اسم الشركة أو الشخص...' : 'Société ou nom...'}
              value={form.nom}
              onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={isAr ? 'الهاتف' : 'Téléphone'}>
              <input type="tel" className={inputClass} placeholder="06XXXXXXXX"
                value={form.telephone}
                onChange={e => setForm(f => ({ ...f, telephone: e.target.value }))} />
            </Field>
            <Field label={isAr ? 'المدينة' : 'Ville'}>
              <input type="text" className={inputClass} placeholder="Meknès..."
                value={form.ville}
                onChange={e => setForm(f => ({ ...f, ville: e.target.value }))} />
            </Field>
          </div>

          <Field label="Email">
            <input type="email" className={inputClass} placeholder="contact@..."
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>

          <Field label={isAr ? 'الفئة' : 'Catégorie'}>
            <select className={selectClass}
              value={form.categorie}
              onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
              <option value="">{isAr ? 'اختر...' : 'Choisir...'}</option>
              {supplierCats.map((c: any) => (
                <option key={c.ar} value={c.ar}>{isAr ? c.ar : c.fr}</option>
              ))}
            </select>
          </Field>

          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary"
              onClick={() => { setFormOpen(false); setEditSupplier(null) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handleSubmit} loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editSupplier
                ? (isAr ? 'حفظ التعديلات' : 'Enregistrer')
                : (isAr ? 'إضافة' : 'Ajouter')}
            </Btn>
          </div>
        </div>
      </Modal>

    </div>
  )
}