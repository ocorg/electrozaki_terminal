'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate, computeFariq, getWarrantyFlag } from '@/lib/utils'
import { StatusBadge, BatteryBar, EmptyState, SkeletonRow, PageHeader, Btn } from '@/components/shared'
import PhoneForm from '@/components/phones/PhoneForm'
import type { Phone } from '@/types/database'
import {
  Plus, Search, Filter, RefreshCw, Smartphone,
  Edit2, MapPin, Calendar, Shield, ChevronDown
} from 'lucide-react'

const STATUSES = ['متوفر', 'مباع', 'إستبدال', 'إصلاح']
const MARQUES  = ['Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Huawei', 'Oppo', 'Realme', 'Autre']
const LOCATIONS = ['Magasin Principal', 'Magasin Secondaire', 'Externe']

export default function PhonesPage() {
  const { user } = useUser()
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const canWrite = user?.role === 'manager' || user?.role === 'owner'
  const canSeePrices = canWrite

  const [phones, setPhones]       = useState<Phone[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMarque, setFilterMarque] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [formOpen, setFormOpen]   = useState(false)
  const [editPhone, setEditPhone] = useState<Phone | null>(null)
  const [view, setView]           = useState<'grid' | 'table'>('grid')

  const fetchPhones = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus)   params.set('status', filterStatus)
    if (filterMarque)   params.set('marque', filterMarque)
    if (filterLocation) params.set('location', filterLocation)
    if (search)         params.set('search', search)

    const res = await fetch(`/api/phones?${params}`)
    const json = await res.json()
    setPhones(json.data || [])
    setLoading(false)
  }, [filterStatus, filterMarque, filterLocation, search])

  useEffect(() => { fetchPhones() }, [fetchPhones])

  function openAdd() { setEditPhone(null); setFormOpen(true) }
  function openEdit(p: Phone) { setEditPhone(p); setFormOpen(true) }

  const available = phones.filter(p => p.status === 'متوفر').length
  const sold      = phones.filter(p => p.status === 'مباع').length
  const repair    = phones.filter(p => p.status === 'إصلاح').length

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title={isAr ? 'الهواتف' : 'Téléphones'}
        subtitle={`${phones.length} appareils · ${available} disponibles`}
        actions={
          <>
            <Btn variant="ghost" size="sm" onClick={fetchPhones}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Btn>
            {canWrite && (
              <Btn variant="primary" size="sm" onClick={openAdd}>
                <Plus className="w-3.5 h-3.5" />
                {isAr ? 'إضافة هاتف' : 'Ajouter'}
              </Btn>
            )}
          </>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Disponibles', value: available, color: 'text-emerald-600' },
          { label: 'Vendus',      value: sold,      color: 'text-slate-500' },
          { label: 'Réparation', value: repair,     color: 'text-orange-500' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-ez-border rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-ez-subtle">{s.label}</span>
            <span className={`font-display text-xl font-bold ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ez-placeholder" />
          <input
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-ez-border rounded-xl text-sm text-ez-text placeholder:text-ez-placeholder focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/10 transition-all"
            placeholder={isAr ? 'بحث بـ IMEI، ماركة، موديل...' : 'IMEI, marque, modèle...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
            showFilters || filterStatus || filterMarque || filterLocation
              ? 'bg-gold/10 border-gold/30 text-gold'
              : 'bg-white border-ez-border text-ez-subtle hover:text-ez-text'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtres
          {(filterStatus || filterMarque || filterLocation) && (
            <span className="w-1.5 h-1.5 rounded-full bg-gold" />
          )}
        </button>
        <div className="flex border border-ez-border rounded-xl overflow-hidden">
          {(['grid','table'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-2 text-xs transition-all ${view === v ? 'bg-gold text-white' : 'bg-white text-ez-subtle hover:bg-ez-muted'}`}>
              {v === 'grid' ? '⊞' : '☰'}
            </button>
          ))}
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white border border-ez-border rounded-xl p-4 mb-4 grid grid-cols-3 gap-4 animate-fade-in">
          <div>
            <label className="text-xs text-ez-subtle uppercase tracking-widest mb-1 block">Statut</label>
            <select className="w-full bg-ez-bg border border-ez-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold"
              value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Tous</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ez-subtle uppercase tracking-widest mb-1 block">Marque</label>
            <select className="w-full bg-ez-bg border border-ez-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold"
              value={filterMarque} onChange={e => setFilterMarque(e.target.value)}>
              <option value="">Toutes</option>
              {MARQUES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ez-subtle uppercase tracking-widest mb-1 block">Emplacement</label>
            <select className="w-full bg-ez-bg border border-ez-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold"
              value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
              <option value="">Tous</option>
              {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {(filterStatus || filterMarque || filterLocation) && (
            <div className="col-span-3 flex justify-end">
              <button onClick={() => { setFilterStatus(''); setFilterMarque(''); setFilterLocation('') }}
                className="text-xs text-red-500 hover:text-red-700">
                Réinitialiser les filtres
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
          {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : phones.length === 0 ? (
        <EmptyState
          icon={<Smartphone className="w-6 h-6" />}
          title="Aucun téléphone"
          description="Ajoutez votre premier téléphone pour commencer"
          action={canWrite ? <Btn variant="primary" onClick={openAdd}><Plus className="w-3.5 h-3.5" /> Ajouter</Btn> : undefined}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {phones.map(phone => (
            <PhoneCard key={phone.phone_id} phone={phone} canWrite={canWrite} canSeePrices={canSeePrices} onEdit={openEdit} />
          ))}
        </div>
      ) : (
        <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ez-border">
                {['Appareil','IMEI','Batterie','Emplacement',canSeePrices ? 'Prix achat' : null,'Prix vente','Statut',''].filter(Boolean).map(h => (
                  <th key={h!} className="text-left px-4 py-3 text-xs text-ez-subtle uppercase tracking-widest font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {phones.map(phone => (
                <tr key={phone.phone_id} className="border-b border-ez-border last:border-0 hover:bg-ez-bg transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm text-ez-text">{phone.marque} {phone.model}</p>
                    <p className="text-xs text-ez-subtle">{phone.stockage}{phone.ram ? ` · ${phone.ram}` : ''}{phone.couleur ? ` · ${phone.couleur}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-ez-subtle font-mono">{phone.imei || '—'}</td>
                  <td className="px-4 py-3"><BatteryBar level={phone.battery_level} /></td>
                  <td className="px-4 py-3 text-xs text-ez-subtle">{phone.location}</td>
                  {canSeePrices && <td className="px-4 py-3 text-sm text-ez-subtle">{phone.prix_achat ? formatMAD(phone.prix_achat) : '—'}</td>}
                  <td className="px-4 py-3 text-sm font-medium text-ez-text">{phone.prix_vente_recommande ? formatMAD(phone.prix_vente_recommande) : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={phone.status} /></td>
                  <td className="px-4 py-3">
                    {canWrite && (
                      <button onClick={() => openEdit(phone)} className="p-1.5 rounded-lg text-ez-subtle hover:text-gold hover:bg-gold/8 transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PhoneForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchPhones}
        phone={editPhone}
        role={user?.role}
      />
    </div>
  )
}

// ── Phone Card ────────────────────────────────────────────────
function PhoneCard({ phone, canWrite, canSeePrices, onEdit }: {
  phone: Phone
  canWrite: boolean
  canSeePrices: boolean
  onEdit: (p: Phone) => void
}) {
  const warranty = getWarrantyFlag(phone.warranty_months
    ? new Date(new Date(phone.date_entree || Date.now()).getTime() + phone.warranty_months * 30 * 86400000).toISOString()
    : null)

  return (
    <div className="bg-white border border-ez-border rounded-2xl p-4 hover:border-gold/30 hover:shadow-[0_4px_16px_rgba(201,164,64,0.08)] transition-all group">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-ez-muted flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-5 h-5 text-ez-subtle" />
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={phone.status} />
          {canWrite && (
            <button
              onClick={() => onEdit(phone)}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-ez-subtle hover:text-gold hover:bg-gold/8 transition-all"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Name */}
      <h3 className="font-display text-base font-bold text-ez-text leading-tight">
        {phone.marque} {phone.model}
      </h3>
      <p className="text-xs text-ez-subtle mt-0.5">
        {[phone.stockage, phone.ram, phone.couleur].filter(Boolean).join(' · ')}
      </p>

      {/* Battery */}
      <div className="mt-3">
        <BatteryBar level={phone.battery_level} />
      </div>

      {/* Meta */}
      <div className="mt-3 space-y-1">
        {phone.imei && (
          <p className="text-[10px] text-ez-placeholder font-mono truncate">IMEI: {phone.imei}</p>
        )}
        <div className="flex items-center gap-1 text-[10px] text-ez-placeholder">
          <MapPin className="w-3 h-3" />
          {phone.location}
        </div>
        {phone.date_entree && (
          <div className="flex items-center gap-1 text-[10px] text-ez-placeholder">
            <Calendar className="w-3 h-3" />
            {formatDate(phone.date_entree)}
          </div>
        )}
      </div>

      {/* Price */}
      {canSeePrices && phone.prix_vente_recommande && (
        <div className="mt-3 pt-3 border-t border-ez-border flex items-center justify-between">
          <span className="text-xs text-ez-subtle">Prix conseillé</span>
          <span className="font-display font-bold text-gold">{formatMAD(phone.prix_vente_recommande)}</span>
        </div>
      )}
      {!canSeePrices && phone.prix_vente_recommande && (
        <div className="mt-3 pt-3 border-t border-ez-border">
          <span className="font-display font-bold text-gold">{formatMAD(phone.prix_vente_recommande)}</span>
        </div>
      )}
    </div>
  )
}