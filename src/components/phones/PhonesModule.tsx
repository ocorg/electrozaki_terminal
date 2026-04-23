'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate, getWarrantyFlag } from '@/lib/utils'
import { StatusBadge, BatteryBar, EmptyState, SkeletonRow, PageHeader, Btn } from '@/components/shared'
import PhoneForm from '@/components/phones/PhoneForm'
import type { Phone } from '@/types/database'
import { toast } from 'sonner'
import ScanButton from '@/components/scanner/ScanButton'
import LabelGenerator, { type LabelProduct } from '@/components/print/LabelGenerator'
import {
  Plus, Search, Filter, RefreshCw,
  Smartphone, Edit2, MapPin, Shield,
  ChevronDown, X, Eye, EyeOff
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
  const [labelProduct, setLabelProduct] = useState<LabelProduct | null>(null)

  // Filters
  const [search, setSearch]       = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterMarque, setFilterMarque]   = useState('')
  const [filterLocation, setFilterLocation] = useState('')

  const fetchPhones = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (filterStatus)   params.set('status', filterStatus)
      if (filterMarque)   params.set('marque', filterMarque)
      if (filterLocation) params.set('location', filterLocation)
      if (search.length >= 2) params.set('search', search)

      const res  = await fetch(`/api/phones?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPhones(json.data || [])
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, filterStatus, filterMarque, filterLocation, search])

  useEffect(() => {
    const t = setTimeout(() => fetchPhones(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchPhones, search])

  function openAdd() { setEditPhone(null); setFormOpen(true) }
  function openEdit(p: Phone) { setEditPhone(p); setFormOpen(true) }

  function clearFilters() {
    setFilterStatus('')
    setFilterMarque('')
    setFilterLocation('')
    setSearch('')
  }

  const hasFilters = filterStatus || filterMarque || filterLocation || search

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
                    {[filterStatus, filterMarque, filterLocation, search].filter(Boolean).length}
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
                const deviceName = `${phone.marque} ${phone.model}${phone.stockage ? ` ${phone.stockage}` : ''}`

                return (
                  <div
                    key={phone.phone_id}
                    className="hidden lg:grid items-center px-5 py-3.5 hover:bg-[#F8F7F4] transition-all"
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
                      </div>
                    </div>

                    {/* IMEI */}
                    <p className="text-xs text-[#6B6860] font-mono truncate">
                      {phone.imei || '—'}
                    </p>

                    {/* Battery */}
                    <BatteryBar level={phone.battery_level} />

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
                    <StatusBadge status={phone.status} lang={isAr ? 'ar' : 'fr'} />

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
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setLabelProduct({
                          id:       phone.phone_id,
                          name:     `${phone.marque} ${phone.model}${phone.stockage ? ' ' + phone.stockage : ''}`,
                          category: 'Téléphone',
                          type:     phone.condition === 'جديد' ? 'Neuf' : phone.condition === 'مستعمل' ? 'Occasion' : 'Défectueux',
                          prix:     canSeeFinancials ? (phone.prix_vente_recommande ?? undefined) : undefined,
                          barcode:  phone.imei ?? undefined,
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
                    </div>
                  </div>
                )
              })}

              {/* Mobile cards */}
              {phones.map(phone => {
                const deviceName = `${phone.marque} ${phone.model}${phone.stockage ? ` ${phone.stockage}` : ''}`
                return (
                  <div key={`mob-${phone.phone_id}`}
                       className="lg:hidden flex items-center gap-4 px-4 py-3.5 hover:bg-[#F8F7F4] transition-all">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: `${primary}12` }}>
                      <Smartphone className="w-5 h-5" style={{ color: primary }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{deviceName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StatusBadge status={phone.status} lang={isAr ? 'ar' : 'fr'} size="sm" />
                        {phone.battery_level != null && (
                          <span className="text-xs text-[#B0ADA6]">{phone.battery_level}%</span>
                        )}
                      </div>
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
    </div>
  )
}