'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate, getWarrantyFlag } from '@/lib/utils'
import { StatusBadge, BatteryBar, EmptyState, SkeletonRow, PageHeader, Btn, Modal, Field, inputClass, selectClass } from '@/components/shared'
import PhoneForm from '@/components/phones/PhoneForm'
import type { Phone } from '@/types/database'
import { showSuccess, showError } from '@/lib/utils/toasts'
import ScanButton from '@/components/scanner/ScanButton'
import LabelGenerator, { type LabelProduct } from '@/components/print/LabelGenerator'
import {
  Plus, Search, Filter, RefreshCw,
  Smartphone, Edit2, MapPin, Shield,
  ChevronDown, X, Eye, EyeOff, Trash2, Loader2, BookOpen, Check
} from 'lucide-react'

const STATUSES = ['متوفر', 'مباع', 'إستبدال', 'إصلاح']
const MARQUES  = ['Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Huawei', 'Oppo', 'Realme']
const LOCATIONS = ['Magasin Principal', 'Magasin Secondaire', 'Externe']

interface PhonesModuleProps {
  storeId: string
}

export default function PhonesModule({ storeId }: PhonesModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canSeeFinancials = user?.role === 'manager' || user?.role === 'owner'

  const [phones, setPhones]           = useState<Phone[]>([])
  const [loading, setLoading]         = useState(true)
  const [formOpen, setFormOpen]       = useState(false)
  const [editPhone, setEditPhone]     = useState<Phone | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [labelProduct,  setLabelProduct]  = useState<LabelProduct | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)  // holds phone_id
  const [deleting,      setDeleting]      = useState(false)
  const [catalogOpen, setCatalogOpen]   = useState(false)
  const [catalogItems, setCatalogItems] = useState<{ catalog_id: string; marque: string; serie: string; type: string; model: string; couleur: string }[]>([])
  const [catForm, setCatForm]           = useState({ marque: '', serie: '', type: 'Normal', model: '', couleur: '' })
  const [catSaving,    setCatSaving]    = useState(false)
  const [catDeleting,  setCatDeleting]  = useState<string | null>(null)
  const [catSearch,    setCatSearch]    = useState('')
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [editForm,     setEditForm]     = useState({ marque: '', serie: '', type: 'Normal', model: '', couleur: '' })

  async function updateCatalogEntry() {
    if (!editingId || !editForm.marque || !editForm.model || !editForm.couleur) return
    setCatSaving(true)
    try {
      const res  = await fetch('/api/phones/catalog', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ catalog_id: editingId, ...editForm }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم التعديل ✓' : 'Modifié ✓')
      setEditingId(null)
      fetchCatalog()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setCatSaving(false)
    }
  }

  async function deleteCatalogEntry(catalog_id: string) {
    setCatDeleting(catalog_id)
    try {
      const res  = await fetch('/api/phones/catalog', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ catalog_id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الحذف ✓' : 'Supprimé ✓')
      fetchCatalog()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setCatDeleting(null)
    }
  }

  async function fetchCatalog() {
    const res  = await fetch('/api/phones/catalog')
    const json = await res.json()
    setCatalogItems(json.data || [])
  }

  async function saveCatalogEntry() {
    if (!catForm.marque || !catForm.model || !catForm.couleur) return
    setCatSaving(true)
    try {
      const res  = await fetch('/api/phones/catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catForm),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess('Modèle ajouté ✓')
      setCatForm({ marque: '', serie: '', type: 'Normal', model: '', couleur: '' })
      fetchCatalog()
    } catch (err: unknown) { showError((err as Error).message) }
    finally { setCatSaving(false) }
  }

  // Filters
  const [search, setSearch]       = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterMarque, setFilterMarque]   = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterStorage, setFilterStorage] = useState('')

  const fetchPhones = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (filterStatus)   params.set('status', filterStatus)
      if (filterMarque)   params.set('marque', filterMarque)
      if (filterLocation) params.set('location', filterLocation)
      if (filterStorage)  params.set('stockage', filterStorage)
      if (search.length >= 2) params.set('search', search)

      const res  = await fetch(`/api/phones?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPhones(json.data || [])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, filterStatus, filterMarque, filterLocation, filterStorage, search])

  useEffect(() => {
    const t = setTimeout(() => fetchPhones(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchPhones, search])

  function openAdd() { setEditPhone(null); setFormOpen(true) }
  async function handleDelete(phone_id: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/phones?phone_id=${phone_id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الحذف ✓' : 'Supprimé ✓')
      setConfirmDelete(null)
      fetchPhones()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }
  function openEdit(p: Phone) { setEditPhone(p); setFormOpen(true) }

  function clearFilters() {
    setFilterStatus('')
    setFilterMarque('')
    setFilterLocation('')
    setFilterStorage('')
    setSearch('')
  }

  const hasFilters = filterStatus || filterMarque || filterLocation || filterStorage || search

  // Counts by status
  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = phones.filter(p => p.status === s).length
    return acc
  }, {} as Record<string, number>)

  const STATUS_LABELS_FR: Record<string, string> = {
    'متوفر': 'Disponible', 'مباع': 'Vendu',
    'إستبدال': 'Échangé', 'إصلاح': 'Réparation',
  }
  const STATUS_COLORS: Record<string, string> = {
    'متوفر': '#10B981', 'مباع': '#6B6860',
    'إستبدال': '#3B82F6', 'إصلاح': '#F59E0B',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Top bar ───────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'الهواتف' : 'Téléphones'}
          subtitle={isAr
            ? `${phones.length} جهاز في المخزون`
            : `${phones.length} appareil${phones.length !== 1 ? 's' : ''} en stock`}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all"
                style={{
                  borderColor: hasFilters ? primary : '#E8E5DE',
                  backgroundColor: hasFilters ? `${primary}10` : 'white',
                  color: hasFilters ? primary : '#6B6860',
                }}
              >
                <Filter className="w-4 h-4" />
                {isAr ? 'تصفية' : 'Filtres'}
                {hasFilters && (
                  <span className="w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                        style={{ backgroundColor: primary }}>
                    {[filterStatus, filterMarque, filterLocation, filterStorage, search].filter(Boolean).length}
                  </span>
                )}
              </button>
              <button
                onClick={fetchPhones}
                disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {canSeeFinancials && (
                <Btn variant="secondary" onClick={() => { setCatalogOpen(true); fetchCatalog() }}>
                  <span className="text-xs">📋</span>
                  {isAr ? 'إدارة الكتالوج' : 'Catalogue'}
                </Btn>
              )}
              <Btn
                variant="primary"
                onClick={openAdd}
                style={{ backgroundColor: primary } as React.CSSProperties}
              >
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة هاتف' : 'Ajouter'}
              </Btn>
            </div>
          }
        />

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
            <input
              className="w-full pl-9 pr-10 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#1A1A1A] placeholder:text-[#B0ADA6] focus:outline-none transition-all"
              placeholder={isAr ? 'بحث بـ IMEI، الماركة، الموديل...' : 'Rechercher IMEI, marque, modèle...'}
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
          <ScanButton
            onScan={v => setSearch(v)}
            hint="Scannez un IMEI ou code-barres"
            color={primary}
          />
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 p-4 bg-white border border-[#E8E5DE] rounded-2xl animate-fade-in">
            {/* Status */}
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all"
                  style={{
                    backgroundColor: filterStatus === s ? `${STATUS_COLORS[s]}15` : 'transparent',
                    borderColor:     filterStatus === s ? STATUS_COLORS[s] : '#E8E5DE',
                    color:           filterStatus === s ? STATUS_COLORS[s] : '#6B6860',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[s] }} />
                  {isAr ? s : STATUS_LABELS_FR[s]}
                  {counts[s] > 0 && <span className="opacity-60">({counts[s]})</span>}
                </button>
              ))}
            </div>

            <div className="w-px bg-[#E8E5DE]" />

            {/* Marque */}
            <select
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-1.5 bg-white text-[#6B6860] focus:outline-none"
              value={filterMarque}
              onChange={e => setFilterMarque(e.target.value)}
            >
              <option value="">{isAr ? 'كل الماركات' : 'Toutes marques'}</option>
              {MARQUES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            {/* Location */}
            <select
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-1.5 bg-white text-[#6B6860] focus:outline-none"
              value={filterLocation}
              onChange={e => setFilterLocation(e.target.value)}
            >
              <option value="">{isAr ? 'كل الأماكن' : 'Tous emplacements'}</option>
              {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            {/* Storage */}
            <select
              className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-1.5 bg-white text-[#6B6860] focus:outline-none"
              value={filterStorage}
              onChange={e => setFilterStorage(e.target.value)}
            >
              <option value="">{isAr ? 'كل السعات' : 'Tous stockages'}</option>
              {Array.from(new Set(phones.map(p => p.stockage).filter((s): s is string => !!s)))
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {hasFilters && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors ml-auto">
                <X className="w-3 h-3" />
                {isAr ? 'مسح الكل' : 'Effacer tout'}
              </button>
            )}
          </div>
        )}

        {/* Status summary strip */}
        <div className="flex gap-3">
          {STATUSES.map(s => (
            <div key={s} className="flex items-center gap-1.5 text-xs text-[#6B6860]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
              {counts[s]} {isAr ? s : STATUS_LABELS_FR[s]}
            </div>
          ))}
        </div>
      </div>

      {/* ── List ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">

          {/* Table header */}
          <div className="hidden lg:grid border-b border-[#F2F0EB] px-5 py-3 text-[10px] font-bold text-[#B0ADA6] uppercase tracking-widest"
               style={{ gridTemplateColumns: canSeeFinancials ? '2fr 1fr 1fr 1fr 1fr 1fr 80px' : '2fr 1fr 1fr 1fr 1fr 80px' }}>
            <span>{isAr ? 'الجهاز' : 'Appareil'}</span>
            <span>IMEI</span>
            <span>{isAr ? 'البطارية' : 'Batterie'}</span>
            <span>{isAr ? 'الموقع' : 'Emplacement'}</span>
            <span>{isAr ? 'الحالة' : 'Statut'}</span>
            {canSeeFinancials && <span>{isAr ? 'السعر' : 'Prix vente'}</span>}
            <span />
          </div>

          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : phones.length === 0 ? (
            <EmptyState
              icon={<Smartphone className="w-7 h-7" />}
              title={isAr ? 'لا توجد هواتف' : 'Aucun téléphone'}
              description={hasFilters
                ? (isAr ? 'لا توجد نتائج لهذه التصفية' : 'Aucun résultat pour ces filtres')
                : (isAr ? 'أضف أول هاتف للمخزون' : 'Ajoutez le premier téléphone')}
              action={!hasFilters
                ? <Btn variant="primary" onClick={openAdd} style={{ backgroundColor: primary } as React.CSSProperties}>
                    <Plus className="w-4 h-4" />{isAr ? 'إضافة هاتف' : 'Ajouter un téléphone'}
                  </Btn>
                : <Btn variant="ghost" onClick={clearFilters}>
                    <X className="w-4 h-4" />{isAr ? 'مسح التصفية' : 'Effacer les filtres'}
                  </Btn>
              }
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {phones.map(phone => {
                const warrantyFlag = getWarrantyFlag(phone.date_entree
                  ? new Date(new Date(phone.date_entree).getTime() + (phone.warranty_months ?? 6) * 30 * 86400000).toISOString()
                  : null)
                const baseName   = phone.model.toLowerCase().startsWith(phone.marque.toLowerCase())
                  ? phone.model
                  : `${phone.marque} ${phone.model}`
                const deviceName = baseName + (phone.stockage ? ` ${phone.stockage}` : '')

                return (
                  <div
                    key={phone.phone_id}
                    onClick={() => openEdit(phone)}
                    className="hidden lg:grid items-center px-5 py-3.5 hover:bg-[#F8F7F4] transition-all cursor-pointer"
                    style={{ gridTemplateColumns: canSeeFinancials ? '2fr 1fr 1fr 1fr 1fr 1fr 80px' : '2fr 1fr 1fr 1fr 1fr 80px' }}
                  >
                    {/* Device name */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                           style={{ backgroundColor: `${primary}12` }}>
                        <Smartphone className="w-4 h-4" style={{ color: primary }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1A1A1A] truncate">{deviceName}</p>
                        <p className="text-xs text-[#B0ADA6]">
                          {phone.condition === 'جديد' ? (isAr ? 'جديد' : 'Neuf')
                            : phone.condition === 'مستعمل' ? (isAr ? 'مستعمل' : 'Occasion')
                            : (isAr ? 'معطوب' : 'Défectueux')}
                          {phone.couleur ? ` · ${phone.couleur}` : ''}
                          {warrantyFlag && <span className="ml-1">{warrantyFlag}</span>}
                        </p>
                        {(phone.has_replaced_component || phone.is_damaged) && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {phone.has_replaced_component && (
                              <span
                                className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 border-l-2"
                                style={{ backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#F59E0B' }}
                              >
                                COMP. REMPLACÉ — {phone.component_condition === 'original' ? 'ORIGINAL' : 'STANDARD'}
                              </span>
                            )}
                            {phone.is_damaged && (
                              <span
                                className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 border-l-2"
                                style={{ backgroundColor: '#FFF1F2', color: '#991B1B', borderColor: '#F87171' }}
                                title={phone.damage_notes || undefined}
                              >
                                ENDOMMAGÉ
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* IMEI */}
                    <p className="text-xs text-[#6B6860] font-mono truncate">
                      {phone.imei || '—'}
                    </p>

                    {/* Battery */}
                    <BatteryBar level={phone.battery_level} marque={phone.marque} />

                    {/* Location */}
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-[#B0ADA6] flex-shrink-0" />
                      <span className="text-xs text-[#6B6860] truncate">
                        {phone.location === 'Magasin Principal' ? (isAr ? 'المحل الرئيسي' : 'Principal')
                          : phone.location === 'Magasin Secondaire' ? (isAr ? 'المحل الثاني' : 'Secondaire')
                          : (isAr ? 'خارجي' : 'Externe')}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="min-w-0 overflow-hidden">
                      <StatusBadge status={phone.status} lang={isAr ? 'ar' : 'fr'} />
                    </div>

                    {/* Price — manager/owner only */}
                    {canSeeFinancials && (
                      <div>
                        <p className="text-sm font-bold text-[#1A1A1A]">
                          {phone.prix_vente_recommande ? formatMAD(phone.prix_vente_recommande) : '—'}
                        </p>
                        {phone.prix_achat && phone.prix_vente_recommande && (
                          <p className="text-xs text-emerald-600">
                            +{formatMAD(phone.prix_vente_recommande - phone.prix_achat)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setLabelProduct({
                          id:            phone.phone_id,
                          name:          phone.model.toLowerCase().startsWith(phone.marque.toLowerCase())
                            ? phone.model
                            : `${phone.marque} ${phone.model}`,
                          marque:        phone.marque,
                          model:         phone.model,
                          category:      'Téléphone',
                          type:          phone.condition === 'جديد' ? 'Neuf' : phone.condition === 'مستعمل' ? 'Occasion' : 'Défectueux',
                          imei:          phone.imei          ?? undefined,
                          couleur:       phone.couleur       ?? undefined,
                          stockage:      phone.stockage      ?? undefined,
                          battery_level: phone.marque === 'Apple' ? (phone.battery_level ?? undefined) : undefined,
                          ram:           phone.marque !== 'Apple' ? (phone.ram ?? undefined) : undefined,
                        })}
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all"
                        title="Générer étiquette"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V5a2 2 0 012-2h2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openEdit(phone)}
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {canSeeFinancials && (
                        <button
                          onClick={() => setConfirmDelete(phone.phone_id)}
                          className="flex items-center justify-center w-8 h-8 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Mobile cards */}
              {phones.map(phone => {
                const baseName   = phone.model.toLowerCase().startsWith(phone.marque.toLowerCase())
                  ? phone.model
                  : `${phone.marque} ${phone.model}`
                const deviceName = baseName + (phone.stockage ? ` ${phone.stockage}` : '')
                return (
                  <div key={`mob-${phone.phone_id}`}
                       onClick={() => openEdit(phone)}
                       className="lg:hidden flex items-center gap-4 px-4 py-3.5 hover:bg-[#F8F7F4] transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: `${primary}12` }}>
                      <Smartphone className="w-5 h-5" style={{ color: primary }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{deviceName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StatusBadge status={phone.status} lang={isAr ? 'ar' : 'fr'} size="sm" />
                        {phone.battery_level != null && (
                          <span className={`text-xs ${
                            phone.marque.toLowerCase() === 'apple'
                              ? phone.battery_level > 79  ? 'text-emerald-600'
                              : phone.battery_level >= 60 ? 'text-amber-600'
                              : 'text-red-600'
                              : 'text-[#B0ADA6]'
                          }`}>{phone.battery_level}%</span>
                        )}
                      </div>
                      {(phone.has_replaced_component || phone.is_damaged) && (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {phone.has_replaced_component && (
                            <span
                              className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 border-l-2"
                              style={{ backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#F59E0B' }}
                            >
                              COMP. REMPLACÉ
                            </span>
                          )}
                          {phone.is_damaged && (
                            <span
                              className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 border-l-2"
                              style={{ backgroundColor: '#FFF1F2', color: '#991B1B', borderColor: '#F87171' }}
                            >
                              ENDOMMAGÉ
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {canSeeFinancials && phone.prix_vente_recommande && (
                      <p className="text-sm font-bold flex-shrink-0" style={{ color: primary }}>
                        {formatMAD(phone.prix_vente_recommande)}
                      </p>
                    )}
                    <button onClick={() => openEdit(phone)}
                      className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all flex-shrink-0">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
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

      {/* Form modal */}
      <PhoneForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchPhones}
        phone={editPhone}
        role={user?.role}
        storeId={storeId}
      />

      {/* Catalogue modal */}
      <Modal
        open={catalogOpen}
        onClose={() => { setCatalogOpen(false); setCatSearch(''); setEditingId(null) }}
        title={isAr ? 'إدارة كتالوج الهواتف' : 'Gestion du catalogue'}
        size="lg"
      >
        {(() => {
          // Build suggestion lists from live catalog data — no hardcoding
          const suggestions = {
            marques:  Array.from(new Set(catalogItems.map(i => i.marque))).sort(),
            series:   Array.from(new Set(catalogItems.map(i => i.serie).filter(Boolean))).sort(),
            models:   Array.from(new Set(catalogItems.map(i => i.model))).sort(),
            couleurs: Array.from(new Set(catalogItems.map(i => i.couleur))).sort(),
            types:    Array.from(new Set(['Normal', ...catalogItems.map(i => i.type).filter(Boolean)])).sort(),
          }

          const filtered = catalogItems
            .filter(item => !catSearch || [item.marque, item.serie, item.model, item.couleur, item.type]
              .some(v => v?.toLowerCase().includes(catSearch.toLowerCase())))
            .sort((a, b) => a.marque.localeCompare(b.marque) || a.model.localeCompare(b.model))

          const grouped: Record<string, typeof filtered> = {}
          filtered.forEach(item => {
            if (!grouped[item.marque]) grouped[item.marque] = []
            grouped[item.marque].push(item)
          })

          const sharedInput = 'w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#C9A440] transition-all bg-white'

          return (
            <div className="space-y-4">

              {/* Datalists — populated from live catalog */}
              <datalist id="dl-marque">{suggestions.marques.map(v => <option key={v} value={v} />)}</datalist>
              <datalist id="dl-serie">{suggestions.series.map(v => <option key={v} value={v} />)}</datalist>
              <datalist id="dl-model">{suggestions.models.map(v => <option key={v} value={v} />)}</datalist>
              <datalist id="dl-couleur">{suggestions.couleurs.map(v => <option key={v} value={v} />)}</datalist>
              <datalist id="dl-type">{suggestions.types.map(v => <option key={v} value={v} />)}</datalist>

              {/* Add form */}
              <div className="bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-[#1A1A1A] flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5 text-[#C9A440]" />
                  {isAr ? 'إضافة موديل' : 'Ajouter un modèle'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'marque',  label: isAr ? 'الماركة *' : 'Marque *',  list: 'dl-marque',  ph: 'Apple, Samsung...' },
                    { key: 'serie',   label: isAr ? 'السلسلة'   : 'Série',      list: 'dl-serie',   ph: 'iPhone 15...' },
                    { key: 'model',   label: isAr ? 'الموديل *' : 'Modèle *',   list: 'dl-model',   ph: 'iPhone 15 Pro...' },
                    { key: 'couleur', label: isAr ? 'اللون *'   : 'Couleur *',  list: 'dl-couleur', ph: 'Black, Blanc...' },
                    { key: 'type',    label: 'Type',                             list: 'dl-type',    ph: 'Normal, Pro...' },
                  ].map(({ key, label, list, ph }) => (
                    <div key={key}>
                      <p className="text-[10px] font-bold text-[#B0ADA6] uppercase tracking-wider mb-1">{label}</p>
                      <input
                        list={list}
                        className={sharedInput}
                        placeholder={ph}
                        value={(catForm as Record<string, string>)[key]}
                        onChange={e => setCatForm(f => ({ ...f, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <button onClick={saveCatalogEntry}
                  disabled={catSaving || !catForm.marque || !catForm.model || !catForm.couleur}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1A1A1A] text-white text-xs font-bold hover:bg-[#333] transition-all disabled:opacity-40">
                  {catSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  {isAr ? 'إضافة' : 'Ajouter'}
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#B0ADA6]" />
                <input className={`${sharedInput} pl-9`}
                  placeholder={isAr ? 'بحث...' : 'Rechercher...'}
                  value={catSearch}
                  onChange={e => setCatSearch(e.target.value)} />
              </div>

              {/* List */}
              <div className="border border-[#E8E5DE] rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                {catalogItems.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-sm text-[#B0ADA6] gap-2">
                    <BookOpen className="w-4 h-4" />
                    {isAr ? 'الكتالوج فارغ' : 'Catalogue vide'}
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-center text-xs text-[#B0ADA6] py-6">
                    {isAr ? 'لا توجد نتائج' : 'Aucun résultat'}
                  </p>
                ) : Object.entries(grouped).map(([brand, items]) => (
                  <div key={brand}>
                    <div className="px-4 py-2 bg-[#F8F7F4] border-b border-[#E8E5DE] sticky top-0">
                      <p className="text-[10px] font-bold text-[#6B6860] uppercase tracking-wider">{brand}</p>
                    </div>
                    {items.map(item => (
                      <div key={item.catalog_id}
                        className="border-b border-[#F2F0EB] last:border-0">

                        {editingId === item.catalog_id ? (
                          /* ── Inline edit row ── */
                          <div className="px-4 py-3 bg-amber-50 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { k: 'marque',  list: 'dl-marque',  ph: 'Marque' },
                                { k: 'serie',   list: 'dl-serie',   ph: 'Série' },
                                { k: 'model',   list: 'dl-model',   ph: 'Modèle' },
                                { k: 'couleur', list: 'dl-couleur', ph: 'Couleur' },
                                { k: 'type',    list: 'dl-type',    ph: 'Type' },
                              ].map(({ k, list, ph }) => (
                                <input key={k} list={list}
                                  className="border border-amber-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#C9A440] bg-white"
                                  placeholder={ph}
                                  value={(editForm as Record<string, string>)[k]}
                                  onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} />
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={updateCatalogEntry} disabled={catSaving}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1A1A1A] text-white text-xs font-bold disabled:opacity-40">
                                {catSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                {isAr ? 'حفظ' : 'Sauver'}
                              </button>
                              <button onClick={() => setEditingId(null)}
                                className="px-3 py-1.5 rounded-lg border border-[#E8E5DE] text-xs text-[#6B6860] hover:bg-white transition-all">
                                {isAr ? 'إلغاء' : 'Annuler'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Normal row ── */
                          <div className="flex items-center justify-between px-4 py-2.5 hover:bg-[#F8F7F4] transition-all group">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#1A1A1A] truncate">{item.model}</p>
                              <p className="text-[10px] text-[#B0ADA6]">
                                {[item.serie, item.type !== 'Normal' && item.type, item.couleur].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                              <button onClick={() => { setEditingId(item.catalog_id); setEditForm({ marque: item.marque, serie: item.serie, type: item.type, model: item.model, couleur: item.couleur }) }}
                                className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-[#C9A440] hover:bg-amber-50 transition-all">
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {user?.role === 'owner' && (
                                <button onClick={() => deleteCatalogEntry(item.catalog_id)}
                                  disabled={catDeleting === item.catalog_id}
                                  className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all">
                                  {catDeleting === item.catalog_id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-[#B0ADA6] text-center">
                {catalogItems.length} {isAr ? 'إدخال' : 'entrée(s)'}
                {' · '}{isAr ? 'النوع والحقول الأخرى: أدخل قيمة جديدة لإضافتها تلقائياً' : 'Tapez une nouvelle valeur dans n\'importe quel champ pour l\'ajouter aux suggestions'}
              </p>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}