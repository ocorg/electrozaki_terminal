'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser }          from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal }        from '@/lib/context/portal'
import { formatDate }       from '@/lib/utils'
import { usePhoneCatalog }  from '@/lib/hooks/usePhoneCatalog'
import ComboBox             from '@/components/phones/ComboBox'
import {
  Modal, Field, inputClass, selectClass, Btn, PageHeader,
} from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Prospect, Phone } from '@/types/database'
import {
  Plus, Search, X, RefreshCw, Edit2, Trash2,
  CheckCircle, XCircle, ClipboardList,
} from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────
const SOURCES  = ['TikTok', 'Instagram', 'WhatsApp', 'En magasin', 'Autre'] as const
const STATUTS  = ['Nouveau', 'Contacté', 'Converti', 'Perdu']               as const
const STOCKAGES = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB']

const SOURCE_STYLES: Record<string, { bg: string; color: string }> = {
  'TikTok':     { bg: '#F3F3F3', color: '#010101' },
  'Instagram':  { bg: '#FCE4EC', color: '#C2185B' },
  'WhatsApp':   { bg: '#E8F5E9', color: '#2E7D32' },
  'En magasin': { bg: '#FAF5E8', color: '#C9A440' },
  'Autre':      { bg: '#F8F7F4', color: '#6B6860' },
}

const STATUT_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  'Nouveau':  { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  'Contacté': { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' },
  'Converti': { bg: '#ECFDF5', color: '#059669', border: '#A7F3D0' },
  'Perdu':    { bg: '#F9FAFB', color: '#9CA3AF', border: '#E5E7EB' },
}

const EMPTY_FORM = {
  nom:         '',
  telephone:   '',
  source:      'En magasin' as string,
  demand_type: 'modele'     as 'modele' | 'budget',
  marque:      '',
  model:       '',
  stockage:    '',
  budget_max:  '' as string | number,
  notes:       '',
}

// ── Component ──────────────────────────────────────────────────
interface ProspectsModuleProps {
  storeId: string
  role?:   string
}

export default function ProspectsModule({ storeId, role }: ProspectsModuleProps) {
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canDelete    = role === 'manager' || role === 'owner'

  const { brands, modelsFor } = usePhoneCatalog()

  const [prospects,       setProspects]       = useState<Prospect[]>([])
  const [availablePhones, setAvailablePhones] = useState<Phone[]>([])
  const [loading,         setLoading]         = useState(true)
  const [formOpen,        setFormOpen]        = useState(false)
  const [editProspect,    setEditProspect]    = useState<Prospect | null>(null)
  const [saving,          setSaving]          = useState(false)
  const [search,          setSearch]          = useState('')
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterSource,    setFilterSource]    = useState('')
  const [filterType,      setFilterType]      = useState('')
  const [form,            setForm]            = useState({ ...EMPTY_FORM })

  // Fetch available phones once for stock-matching
  useEffect(() => {
    fetch(`/api/phones?store_id=${storeId}&status=متوفر`)
      .then(r => r.json())
      .then(json => setAvailablePhones(json.data || []))
      .catch(() => {})
  }, [storeId])

  // Fetch prospects
  const fetchProspects = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (filterStatus) params.set('statut', filterStatus)
      if (filterSource) params.set('source', filterSource)
      if (filterType)   params.set('demand_type', filterType)
      if (search.length >= 2) params.set('search', search)
      const res  = await fetch(`/api/prospects?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProspects(json.data || [])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, filterStatus, filterSource, filterType, search])

  useEffect(() => {
    const t = setTimeout(() => fetchProspects(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchProspects, search])

  // Stock match — returns matching available phones for a given prospect
  const getStockMatches = (p: Prospect): Phone[] => {
    if (p.demand_type === 'modele') {
      return availablePhones.filter(ph => {
        const marqueOk   = !p.marque   || p.marque.toLowerCase()  === ph.marque.toLowerCase()
        const modelOk    = !p.model    || ph.model.toLowerCase().includes(p.model.toLowerCase())
        const stockageOk = !p.stockage || p.stockage              === ph.stockage
        return marqueOk && modelOk && stockageOk
      })
    }
    if (p.demand_type === 'budget') {
      return availablePhones.filter(ph =>
        !!(p.budget_max && ph.prix_vente_recommande && ph.prix_vente_recommande <= p.budget_max)
      )
    }
    return []
  }

  // Form field helper
  const setF = (k: keyof typeof EMPTY_FORM, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const openAdd = () => {
    setEditProspect(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }

  const openEdit = (p: Prospect) => {
    setEditProspect(p)
    setForm({
      nom:         p.nom,
      telephone:   p.telephone  ?? '',
      source:      p.source,
      demand_type: p.demand_type,
      marque:      p.marque     ?? '',
      model:       p.model      ?? '',
      stockage:    p.stockage   ?? '',
      budget_max:  p.budget_max ?? '',
      notes:       p.notes      ?? '',
    })
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditProspect(null)
    setForm({ ...EMPTY_FORM })
  }

  // Save
  const handleSubmit = async () => {
    if (!form.nom.trim()) {
      showError(isAr ? 'الاسم مطلوب' : 'Nom obligatoire')
      return
    }
    if (form.demand_type === 'modele' && !form.marque && !form.model) {
      showError(isAr ? 'حدد الماركة أو الموديل على الأقل' : 'Précisez au moins la marque ou le modèle')
      return
    }
    if (form.demand_type === 'budget' && !form.budget_max) {
      showError(isAr ? 'الميزانية مطلوبة' : 'Budget obligatoire')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        store_id:   storeId,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
        marque:     form.demand_type === 'budget' ? null : (form.marque   || null),
        model:      form.demand_type === 'budget' ? null : (form.model    || null),
        stockage:   form.demand_type === 'budget' ? null : (form.stockage || null),
      }
      const res  = await fetch('/api/prospects', {
        method:  editProspect ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(
          editProspect
            ? { prospect_id: editProspect.prospect_id, ...payload }
            : payload
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(editProspect
        ? (isAr ? 'تم التعديل ✓' : 'Modifié ✓')
        : (isAr ? 'تم إضافة الطلب ✓' : 'Prospect ajouté ✓'))
      closeForm()
      fetchProspects()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Quick status update
  const updateStatut = async (prospect_id: string, statut: string) => {
    try {
      const res  = await fetch('/api/prospects', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prospect_id, statut }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      fetchProspects()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  // Soft delete
  const handleDelete = async (prospect_id: string) => {
    try {
      const res  = await fetch(`/api/prospects?prospect_id=${prospect_id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الحذف ✓' : 'Supprimé ✓')
      fetchProspects()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  const hasFilters = filterStatus || filterSource || filterType || search
  const clearFilters = () => {
    setFilterStatus('')
    setFilterSource('')
    setFilterType('')
    setSearch('')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Top bar ───────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'الطلبات المحتملة' : 'Prospects'}
          subtitle={`${prospects.length} demande${prospects.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchProspects} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Btn variant="primary" onClick={openAdd}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة طلب' : 'Ajouter'}
              </Btn>
            </div>
          }
        />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
          <input
            className="w-full pl-9 pr-10 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none"
            placeholder={isAr ? 'بحث بالاسم، الماركة، الموديل...' : 'Rechercher par nom, marque, modèle...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-1.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{isAr ? 'كل الحالات' : 'Tous statuts'}</option>
            {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-1.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">{isAr ? 'كل المصادر' : 'Toutes sources'}</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-1.5 bg-white text-[#6B6860] focus:outline-none"
            value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">{isAr ? 'كل الأنواع' : 'Tous types'}</option>
            <option value="modele">{isAr ? 'موديل محدد' : 'Modèle précis'}</option>
            <option value="budget">{isAr ? 'ميزانية' : 'Budget'}</option>
          </select>

          {hasFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors">
              <X className="w-3 h-3" />
              {isAr ? 'مسح الكل' : 'Effacer tout'}
            </button>
          )}
        </div>
      </div>

      {/* ── Cards ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white border border-[#E8E5DE] rounded-2xl p-5 animate-pulse space-y-3">
                <div className="h-4 bg-[#F2F0EB] rounded w-2/3" />
                <div className="h-3 bg-[#F2F0EB] rounded w-1/3" />
                <div className="h-10 bg-[#F2F0EB] rounded" />
                <div className="h-3 bg-[#F2F0EB] rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : prospects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <ClipboardList className="w-10 h-10 text-[#B0ADA6] mb-3 opacity-40" />
            <p className="text-sm text-[#6B6860] mb-4">
              {hasFilters
                ? (isAr ? 'لا توجد نتائج لهذه التصفية' : 'Aucun résultat pour ces filtres')
                : (isAr ? 'لا توجد طلبات بعد' : 'Aucun prospect pour le moment')}
            </p>
            {!hasFilters && (
              <Btn variant="primary" onClick={openAdd}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة أول طلب' : 'Ajouter le premier prospect'}
              </Btn>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {prospects.map(p => {
              const matches   = getStockMatches(p)
              const isClosed  = p.statut === 'Converti' || p.statut === 'Perdu'
              const srcStyle  = SOURCE_STYLES[p.source]  ?? SOURCE_STYLES['Autre']
              const statStyle = STATUT_STYLES[p.statut]  ?? STATUT_STYLES['Nouveau']

              return (
                <div
                  key={p.prospect_id}
                  className={`bg-white border rounded-2xl p-5 space-y-3 hover:shadow-md transition-all ${isClosed ? 'opacity-60' : ''}`}
                  style={{ borderColor: matches.length > 0 && !isClosed ? '#A7F3D0' : '#E8E5DE' }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#1A1A1A] truncate">{p.nom}</p>
                      {p.telephone && (
                        <p className="text-xs text-[#6B6860] font-mono mt-0.5">{p.telephone}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: srcStyle.bg, color: srcStyle.color }}>
                        {p.source}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ backgroundColor: statStyle.bg, color: statStyle.color, borderColor: statStyle.border }}>
                        {p.statut}
                      </span>
                    </div>
                  </div>

                  {/* Demand */}
                  <div className="px-3 py-2.5 bg-[#F8F7F4] rounded-xl">
                    {p.demand_type === 'modele' ? (
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#B0ADA6] flex-shrink-0">
                          {isAr ? 'موديل' : 'MODÈLE'}
                        </span>
                        <span className="text-sm font-bold text-[#1A1A1A]">
                          {[p.marque, p.model, p.stockage].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#B0ADA6] flex-shrink-0">
                          {isAr ? 'ميزانية' : 'BUDGET'}
                        </span>
                        <span className="text-sm font-bold text-[#1A1A1A]">
                          ≤ {p.budget_max?.toLocaleString('fr-MA')} MAD
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stock match */}
                  {matches.length > 0 && !isClosed && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <p className="text-xs font-bold text-emerald-700">
                        {isAr
                          ? `${matches.length} جهاز متوفر الآن`
                          : `${matches.length} appareil${matches.length > 1 ? 's' : ''} disponible${matches.length > 1 ? 's' : ''} en stock`}
                      </p>
                    </div>
                  )}

                  {/* Notes */}
                  {p.notes && (
                    <p className="text-xs text-[#6B6860] leading-relaxed border-l-2 border-[#E8E5DE] pl-2.5">
                      {p.notes}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#F2F0EB]">
                    <p className="text-[10px] text-[#B0ADA6]">{formatDate(p.created_at)}</p>
                    <div className="flex items-center gap-1">
                      {!isClosed && (
                        <>
                          {p.statut === 'Nouveau' && (
                            <button
                              onClick={() => updateStatut(p.prospect_id, 'Contacté')}
                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all">
                              {isAr ? 'تم التواصل' : 'Contacté'}
                            </button>
                          )}
                          <button
                            onClick={() => updateStatut(p.prospect_id, 'Converti')}
                            title={isAr ? 'تم البيع' : 'Marquer converti'}
                            className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-emerald-600 hover:bg-emerald-50 transition-all">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => updateStatut(p.prospect_id, 'Perdu')}
                            title={isAr ? 'طلب مفقود' : 'Marquer perdu'}
                            className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {isClosed && (
                        <button
                          onClick={() => updateStatut(p.prospect_id, 'Nouveau')}
                          className="px-2 py-1 text-[10px] font-bold rounded-lg bg-[#F8F7F4] text-[#6B6860] border border-[#E8E5DE] hover:bg-white transition-all">
                          {isAr ? 'إعادة فتح' : 'Réouvrir'}
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(p)}
                        className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(p.prospect_id)}
                          className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit modal ──────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editProspect
          ? (isAr ? 'تعديل الطلب' : 'Modifier le prospect')
          : (isAr ? 'طلب جديد' : 'Nouveau prospect')}
        size="md"
      >
        <div className="space-y-4">

          {/* Name + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={isAr ? 'الاسم *' : 'Nom *'}>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'اسم الزبون' : 'Nom du client'}
                value={form.nom}
                onChange={e => setF('nom', e.target.value)} />
            </Field>
            <Field label={isAr ? 'الهاتف' : 'Téléphone'}>
              <input type="tel" className={inputClass} placeholder="06XXXXXXXX"
                value={form.telephone as string}
                onChange={e => setF('telephone', e.target.value)} />
            </Field>
          </div>

          {/* Source */}
          <Field label={isAr ? 'المصدر *' : 'Source *'}>
            <select className={selectClass}
              value={form.source}
              onChange={e => setF('source', e.target.value)}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          {/* Demand type */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-2">
              {isAr ? 'نوع الطلب *' : 'Type de demande *'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['modele', 'budget'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => setF('demand_type', t)}
                  className="py-2 rounded-xl text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: form.demand_type === t ? primary : 'white',
                    borderColor:     form.demand_type === t ? primary : '#E8E5DE',
                    color:           form.demand_type === t ? 'white' : '#6B6860',
                  }}>
                  {t === 'modele'
                    ? (isAr ? '📱 موديل محدد' : '📱 Modèle précis')
                    : (isAr ? '💰 ميزانية'    : '💰 Budget')}
                </button>
              ))}
            </div>
          </div>

          {/* Demand fields */}
          {form.demand_type === 'modele' ? (
            <div className="space-y-3">
              <ComboBox
                options={brands}
                value={form.marque as string}
                onChange={v => { setF('marque', v); setF('model', '') }}
                placeholder={isAr ? 'الماركة' : 'Marque'}
              />
              <ComboBox
                options={modelsFor(form.marque as string)}
                value={form.model as string}
                onChange={v => setF('model', v)}
                placeholder={!form.marque
                  ? (isAr ? 'اختر الماركة أولاً' : 'Choisissez d\'abord la marque')
                  : (isAr ? 'الموديل' : 'Modèle')}
                disabled={!form.marque}
              />
              <ComboBox
                options={STOCKAGES}
                value={form.stockage as string}
                onChange={v => setF('stockage', v)}
                placeholder={isAr ? 'السعة (اختياري)' : 'Stockage (optionnel)'}
              />
            </div>
          ) : (
            <Field label={isAr ? 'الميزانية القصوى (درهم) *' : 'Budget maximum (MAD) *'}>
              <input type="number" min={0} step={50} className={inputClass}
                placeholder="2000"
                value={form.budget_max as string}
                onChange={e => setF('budget_max', e.target.value)} />
            </Field>
          )}

          {/* Notes */}
          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none`} rows={2}
              placeholder={isAr ? 'تفاصيل، تفضيلات، متابعة...' : 'Détails, préférences, suivi...'}
              value={form.notes as string}
              onChange={e => setF('notes', e.target.value)} />
          </Field>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-1 border-t border-[#E8E5DE]">
            <Btn variant="secondary" onClick={closeForm}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" loading={saving} onClick={handleSubmit}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editProspect
                ? (isAr ? 'حفظ التعديلات' : 'Enregistrer les modifications')
                : (isAr ? 'إضافة الطلب'    : 'Ajouter le prospect')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}