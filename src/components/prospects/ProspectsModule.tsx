'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '@/lib/data/api'
import { useUser }          from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { usePortal }        from '@/lib/context/portal'
import { formatDate }       from '@/lib/utils'
import { usePhoneCatalog }  from '@/lib/hooks/usePhoneCatalog'
import ComboBox             from '@/components/phones/ComboBox'
import {
  Modal, Field, inputClass, selectClass, Btn, PageHeader, Select } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Prospect, Phone } from '@/types/database'
import {
  Plus, Search, X, RefreshCw, Edit2, Trash2,
  CheckCircle, XCircle, ClipboardList, ChevronDown, BatteryMedium, AlertTriangle, Wrench,
} from 'lucide-react'
import { codeLabel, type Lang } from '@/lib/codes'
import { prospectMatches, prospectBrands, phoneIssues } from '@/lib/prospects'

// ── Constants ──────────────────────────────────────────────────
const SOURCES  = ['tiktok', 'instagram', 'whatsapp', 'en_magasin', 'autre'] as const
const STATUTS  = ['nouveau', 'contacte', 'converti', 'perdu']               as const
const STOCKAGES = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB']

const SOURCE_STYLES: Record<string, { bg: string; color: string }> = {
  tiktok:     { bg: '#F3F3F3', color: '#010101' },
  instagram:  { bg: '#FCE4EC', color: '#C2185B' },
  whatsapp:   { bg: '#E8F5E9', color: '#2E7D32' },
  en_magasin: { bg: '#FAF5E8', color: '#C9A440' },
  autre:      { bg: '#F8F7F4', color: '#6B6860' },
}

const STATUT_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  nouveau:  { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  contacte: { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' },
  converti: { bg: '#ECFDF5', color: '#059669', border: '#A7F3D0' },
  perdu:    { bg: '#F9FAFB', color: '#9CA3AF', border: '#E5E7EB' },
}

// Brands shown first as quick choices (the catalog's others follow)
const TOP_BRANDS = ['Apple', 'Samsung', 'Xiaomi']

const EMPTY_FORM = {
  nom:         '',
  telephone:   '',
  source:      'en_magasin' as string,
  marques:     [] as string[],
  model:       '',
  stockage:    '',
  budget_min:  '' as string | number,
  budget_max:  '' as string | number,
  notes:       '',
}

// How many matching phones a card shows before "Voir les N"
const PREVIEW = 3

const mad = (n: unknown) => Number(n ?? 0).toLocaleString('fr-MA')

// ── Component ──────────────────────────────────────────────────
interface ProspectsModuleProps {
  storeId: string
  role?:   string
}

export default function ProspectsModule({ storeId, role }: ProspectsModuleProps) {
  const { language } = useLanguageStore()
  const lang: Lang = language === 'ar' ? 'ar' : 'fr'
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canDelete    = role === 'gerant' || role === 'proprietaire'

  const { brands, modelsFor } = usePhoneCatalog()

  const [formOpen,        setFormOpen]        = useState(false)
  const [editProspect,    setEditProspect]    = useState<Prospect | null>(null)
  const [saving,          setSaving]          = useState(false)
  const [search,          setSearch]          = useState('')
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterSource,    setFilterSource]    = useState('')
  const [form,            setForm]            = useState({ ...EMPTY_FORM })
  // Cards whose matching-phone list is open, and those showing every match
  const [openLists,       setOpenLists]       = useState<Set<string>>(() => new Set())
  const [fullLists,       setFullLists]       = useState<Set<string>>(() => new Set())
  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }

  // Available stock for matching: same cached list as the POS
  const availablePhones = useApi<Phone[]>(`/api/phones?status=disponible&store_id=${storeId}&limit=500`).data ?? []

  // All the store's prospects are cached; filters and search apply instantly here
  const prospectsQ = useApi<Prospect[]>(`/api/prospects?store_id=${storeId}`)
  const loading    = prospectsQ.isLoading
  const [manualRefresh, setManualRefresh] = useState(false)
  useEffect(() => { if (prospectsQ.error) showError(prospectsQ.error.message) }, [prospectsQ.error])
  const prospects = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (prospectsQ.data ?? []).filter(p =>
      (!filterStatus || p.statut      === filterStatus) &&
      (!filterSource || p.source      === filterSource) &&
      (q.length < 2  || [p.nom, p.telephone, p.model, p.marque].some(v => v?.toLowerCase().includes(q)))
    )
  }, [prospectsQ.data, filterStatus, filterSource, search])

  const fetchProspects = useCallback(async () => {
    setManualRefresh(true)
    try { await prospectsQ.refresh() } finally { setManualRefresh(false) }
  }, [prospectsQ])

  // Stock match — available phones for a given prospect, most relevant first
  const getStockMatches = (p: Prospect): Phone[] => prospectMatches(p, availablePhones)

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
      marques:     prospectBrands(p),
      model:       p.model      ?? '',
      stockage:    p.stockage   ?? '',
      budget_min:  p.budget_min ?? '',
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
    // One request mixing every criterion: at least one of them
    if (!form.marques.length && !form.model && !form.stockage && !form.budget_max && !form.budget_min) {
      showError(isAr ? 'حدد معيارا واحدا على الأقل' : 'Indiquez au moins un critère : marque, modèle, stockage ou budget')
      return
    }
    if (form.budget_min && form.budget_max && Number(form.budget_min) > Number(form.budget_max)) {
      showError(isAr ? 'الحد الأدنى أكبر من الحد الأقصى' : 'Le budget minimum dépasse le maximum')
      return
    }
    setSaving(true)
    try {
      const { marques, ...rest } = form
      const payload = {
        ...rest,
        store_id:    storeId,
        marque:      marques.length ? marques.join(', ') : null,
        model:       marques.length === 1 && form.model ? form.model : null,
        stockage:    form.stockage || null,
        budget_min:  form.budget_min !== '' ? Number(form.budget_min) : null,
        budget_max:  form.budget_max !== '' ? Number(form.budget_max) : null,
        // kept for older screens/exports: a model asked → 'modele', else 'budget'
        demand_type: marques.length === 1 && form.model ? 'modele' : 'budget',
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
        ? (t(isAr, 'common.editedOk'))
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
      showSuccess(t(isAr, 'common.deletedOk'))
      fetchProspects()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  const hasFilters = filterStatus || filterSource || search
  const clearFilters = () => {
    setFilterStatus('')
    setFilterSource('')
    setSearch('')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Top bar ───────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'الطلبات المحتملة' : 'Prospects'}
          subtitle={`${prospects.length} demande${prospects.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchProspects} disabled={manualRefresh}
                className="p-2 rounded-xl border border-ez-border bg-white text-ez-subtle hover:bg-ez-bg transition-all disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${manualRefresh ? 'animate-spin' : ''}`} />
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ez-faint" />
          <input
            className="w-full pl-9 pr-10 py-2.5 bg-white border border-ez-border rounded-xl text-sm placeholder:text-ez-placeholder focus:outline-none"
            placeholder={isAr ? 'بحث بالاسم، الماركة، الموديل...' : 'Rechercher par nom, marque, modèle...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ez-faint hover:text-ez-text">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select
            className="text-sm border border-ez-border rounded-xl px-3 py-1.5 bg-white text-ez-subtle focus:outline-none"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{t(isAr, 'common.allStatuses')}</option>
            {STATUTS.map(s => <option key={s} value={s}>{codeLabel('prospect_status', s, lang)}</option>)}
          </Select>

          <Select
            className="text-sm border border-ez-border rounded-xl px-3 py-1.5 bg-white text-ez-subtle focus:outline-none"
            value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">{isAr ? 'كل المصادر' : 'Toutes sources'}</option>
            {SOURCES.map(s => <option key={s} value={s}>{codeLabel('prospect_source', s, lang)}</option>)}
          </Select>

          {hasFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors">
              <X className="w-3 h-3" />
              {t(isAr, 'common.clearAll')}
            </button>
          )}
        </div>
      </div>

      {/* ── Cards ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 pb-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white border border-ez-border rounded-2xl p-5 animate-pulse space-y-3">
                <div className="h-4 bg-ez-muted rounded w-2/3" />
                <div className="h-3 bg-ez-muted rounded w-1/3" />
                <div className="h-10 bg-ez-muted rounded" />
                <div className="h-3 bg-ez-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : prospects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <ClipboardList className="w-10 h-10 text-ez-faint mb-3 opacity-40" />
            <p className="text-sm text-ez-subtle mb-4">
              {hasFilters
                ? (t(isAr, 'common.noResultsFiltered'))
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
              const isClosed  = p.statut === 'converti' || p.statut === 'perdu'
              const srcStyle  = SOURCE_STYLES[p.source]  ?? SOURCE_STYLES.autre
              const statStyle = STATUT_STYLES[p.statut]  ?? STATUT_STYLES.nouveau

              return (
                <div
                  key={p.prospect_id}
                  className={`bg-white border rounded-2xl p-5 space-y-3 hover:shadow-md transition-all ${isClosed ? 'opacity-60' : ''}`}
                  style={{ borderColor: matches.length > 0 && !isClosed ? '#A7F3D0' : '#E8E5DE' }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ez-text truncate">{p.nom}</p>
                      {p.telephone && (
                        <p className="text-xs text-ez-subtle font-mono mt-0.5">{p.telephone}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: srcStyle.bg, color: srcStyle.color }}>
                        {codeLabel('prospect_source', p.source, lang)}
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full border"
                        style={{ backgroundColor: statStyle.bg, color: statStyle.color, borderColor: statStyle.border }}>
                        {codeLabel('prospect_status', p.statut, lang)}
                      </span>
                    </div>
                  </div>

                  {/* Demand */}
                  <div className="px-3 py-2.5 bg-ez-bg rounded-xl">
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ...prospectBrands(p),
                        ...(p.model ? [p.model] : []),
                        ...(p.stockage ? [`${p.stockage}${isAr ? '+' : ' ou plus'}`] : []),
                        ...(p.budget_max != null || p.budget_min != null
                          ? [p.budget_min != null && p.budget_max != null ? `${mad(p.budget_min)} – ${mad(p.budget_max)} MAD`
                            : p.budget_max != null ? `≤ ${mad(p.budget_max)} MAD` : `≥ ${mad(p.budget_min)} MAD`]
                          : []),
                      ].map((c, i) => (
                        <span key={i} className="text-xs font-bold text-ez-text bg-white border border-ez-border rounded-lg px-2 py-0.5">{c}</span>
                      ))}
                      {!prospectBrands(p).length && !p.model && !p.stockage && p.budget_max == null && p.budget_min == null && (
                        <span className="text-sm text-ez-faint">—</span>
                      )}
                    </div>
                  </div>

                  {/* Stock match — click to see the matching phones right here */}
                  {matches.length > 0 && !isClosed && (() => {
                    const listOpen = openLists.has(p.prospect_id)
                    const shown    = fullLists.has(p.prospect_id) ? matches : matches.slice(0, PREVIEW)
                    return (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl overflow-hidden">
                        <button type="button"
                          onClick={() => setOpenLists(s => toggleIn(s, p.prospect_id))}
                          aria-expanded={listOpen}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-emerald-100/60 transition-colors">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          <span className="flex-1 text-xs font-bold text-emerald-700">
                            {isAr
                              ? `${matches.length} جهاز متوفر الآن`
                              : `${matches.length} appareil${matches.length > 1 ? 's' : ''} disponible${matches.length > 1 ? 's' : ''} en stock`}
                            {(() => {
                              const flawed = matches.filter(m => { const i = phoneIssues(m); return i.damaged || i.replaced > 0 }).length
                              return flawed > 0 ? <span className="font-medium text-amber-700"> · dont {flawed} endommagé{flawed > 1 ? 's' : ''} / pièces changées</span> : null
                            })()}
                          </span>
                          <span className="text-xs font-bold text-emerald-700">
                            {listOpen ? (isAr ? 'إخفاء' : 'Masquer') : (isAr ? 'عرض' : 'Voir')}
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 text-emerald-700 transition-transform ${listOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {listOpen && (
                          <ul className="border-t border-emerald-200 bg-white divide-y divide-ez-muted">
                            {shown.map(ph => {
                              const issue = phoneIssues(ph)
                              return (
                              <li key={ph.phone_id} className="flex items-center gap-2 px-2.5 py-2"
                                style={issue.damaged ? { backgroundColor: '#FEF2F2' } : issue.replaced ? { backgroundColor: '#FFFBEB' } : undefined}>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold text-ez-text truncate">
                                    {(ph.model ?? '').toLowerCase().startsWith((ph.marque ?? '').toLowerCase()) ? ph.model : [ph.marque, ph.model].join(' ')} {ph.stockage ?? ''}
                                  </p>
                                  {(issue.damaged || issue.replaced > 0) && (
                                    <p className="flex flex-wrap gap-1 my-0.5">
                                      {issue.damaged && (
                                        <span className="inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                          <AlertTriangle className="w-3 h-3" />Endommagé{ph.damage_notes ? ` : ${ph.damage_notes}` : ''}
                                        </span>
                                      )}
                                      {issue.replaced > 0 && (
                                        <span className="inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                          <Wrench className="w-3 h-3" />Pièces changées : {(ph.replaced_components ?? []).map(c => c.name).join(', ')}
                                        </span>
                                      )}
                                    </p>
                                  )}
                                  <p className="text-xs text-ez-subtle flex items-center gap-1.5 flex-wrap">
                                    <span className="font-mono">{ph.phone_id}</span>
                                    <span>· {codeLabel('device_condition', ph.condition, lang)}</span>
                                    {ph.couleur && <span>· {ph.couleur}</span>}
                                    {ph.battery_level != null && (
                                      <span className="inline-flex items-center gap-0.5">
                                        · <BatteryMedium className="w-3 h-3" />{ph.battery_level} %
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <span className="text-xs font-bold text-ez-text tabular-nums flex-shrink-0">
                                  {mad(ph.prix_vente_recommande)} MAD
                                </span>
                              </li>
                              )
                            })}
                            {matches.length > PREVIEW && (
                              <li>
                                <button type="button"
                                  onClick={() => setFullLists(s => toggleIn(s, p.prospect_id))}
                                  className="w-full px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition-colors">
                                  {fullLists.has(p.prospect_id)
                                    ? (isAr ? 'عرض أقل' : 'Voir moins')
                                    : (isAr ? `عرض الكل (${matches.length})` : `Voir les ${matches.length}`)}
                                </button>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    )
                  })()}

                  {/* Notes */}
                  {p.notes && (
                    <p className="text-xs text-ez-subtle leading-relaxed border-l-2 border-ez-border pl-2.5">
                      {p.notes}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-ez-muted">
                    <p className="text-xs text-ez-faint">{formatDate(p.created_at)}</p>
                    <div className="flex items-center gap-1">
                      {!isClosed && (
                        <>
                          {p.statut === 'nouveau' && (
                            <button
                              onClick={() => updateStatut(p.prospect_id, 'contacte')}
                              className="px-2 py-1 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all">
                              {isAr ? 'تم التواصل' : 'Contacté'}
                            </button>
                          )}
                          <button
                            onClick={() => updateStatut(p.prospect_id, 'converti')}
                            title={isAr ? 'تم البيع' : 'Marquer converti'}
                            className="p-1.5 rounded-lg text-ez-faint hover:text-emerald-600 hover:bg-emerald-50 transition-all">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => updateStatut(p.prospect_id, 'perdu')}
                            title={isAr ? 'طلب مفقود' : 'Marquer perdu'}
                            className="p-1.5 rounded-lg text-ez-faint hover:text-red-500 hover:bg-red-50 transition-all">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {isClosed && (
                        <button
                          onClick={() => updateStatut(p.prospect_id, 'nouveau')}
                          className="px-2 py-1 text-xs font-bold rounded-lg bg-ez-bg text-ez-subtle border border-ez-border hover:bg-white transition-all">
                          {isAr ? 'إعادة فتح' : 'Réouvrir'}
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(p)}
                        className="p-1.5 rounded-lg text-ez-faint hover:text-ez-text hover:bg-ez-muted transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(p.prospect_id)}
                          className="p-1.5 rounded-lg text-ez-faint hover:text-red-500 hover:bg-red-50 transition-all">
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
            <Field label={t(isAr, 'common.nameRequired')}>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'اسم الزبون' : 'Nom du client'}
                value={form.nom}
                onChange={e => setF('nom', e.target.value)} />
            </Field>
            <Field label={t(isAr, 'common.phoneField')}>
              <input type="tel" className={inputClass} placeholder="06XXXXXXXX"
                value={form.telephone as string}
                onChange={e => setF('telephone', e.target.value)} />
            </Field>
          </div>

          {/* Source */}
          <Field label={isAr ? 'المصدر *' : 'Source *'}>
            <Select className={selectClass}
              value={form.source}
              onChange={e => setF('source', e.target.value)}>
              {SOURCES.map(s => <option key={s} value={s}>{codeLabel('prospect_source', s, lang)}</option>)}
            </Select>
          </Field>

          {/* What the client wants — every criterion optional, combined */}
          <div className="space-y-3 p-3 bg-ez-bg rounded-xl">
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest">
              {isAr ? 'ما يبحث عنه الزبون' : 'Ce que cherche le client'}
              <span className="normal-case tracking-normal font-medium text-ez-faint"> · {isAr ? 'معيار واحد على الأقل' : 'au moins un critère'}</span>
            </p>

            <div>
              <p className="text-xs font-bold text-ez-faint uppercase tracking-wider mb-1.5">
                {isAr ? 'الماركة (يمكن اختيار عدة)' : 'Marque(s) — plusieurs possibles'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...TOP_BRANDS, ...brands.filter(b => !TOP_BRANDS.includes(b)), ...form.marques.filter(b => !TOP_BRANDS.includes(b) && !brands.includes(b))].map(b => {
                  const on = form.marques.includes(b)
                  return (
                    <button key={b} type="button"
                      onClick={() => setForm(prev => {
                        const marques = on ? prev.marques.filter(x => x !== b) : [...prev.marques, b]
                        return { ...prev, marques, model: marques.length === 1 ? prev.model : '' }
                      })}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold border transition-all"
                      style={{ backgroundColor: on ? primary : 'white', borderColor: on ? primary : '#E8E5DE', color: on ? 'white' : '#6B6860' }}>
                      {b === 'Apple' ? 'Apple (iPhone)' : b}
                    </button>
                  )
                })}
              </div>
            </div>

            <ComboBox
              options={form.marques.length === 1 ? modelsFor(form.marques[0]) : []}
              value={form.model as string}
              onChange={v => setF('model', v)}
              placeholder={form.marques.length === 1
                ? (isAr ? 'موديل محدد (اختياري)' : 'Modèle précis (optionnel)')
                : (isAr ? 'اختر ماركة واحدة لتحديد الموديل' : 'Modèle (une seule marque)')}
              disabled={form.marques.length !== 1}
            />

            <div>
              <p className="text-xs font-bold text-ez-faint uppercase tracking-wider mb-1.5">
                {isAr ? 'السعة الدنيا' : 'Stockage minimum'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STOCKAGES.filter(g => g !== '16GB').map(g => {
                  const on = form.stockage === g
                  return (
                    <button key={g} type="button" onClick={() => setF('stockage', on ? '' : g)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold border transition-all"
                      style={{ backgroundColor: on ? primary : 'white', borderColor: on ? primary : '#E8E5DE', color: on ? 'white' : '#6B6860' }}>
                      {g} +
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={isAr ? 'الميزانية الدنيا (درهم)' : 'Budget minimum (MAD)'}>
                <input type="number" min={0} step={50} className={inputClass}
                  placeholder={isAr ? 'اختياري' : 'Optionnel'}
                  value={form.budget_min as string}
                  onChange={e => setF('budget_min', e.target.value)} />
              </Field>
              <Field label={isAr ? 'الميزانية القصوى (درهم)' : 'Budget maximum (MAD)'}>
                <input type="number" min={0} step={50} className={inputClass}
                  placeholder="6000"
                  value={form.budget_max as string}
                  onChange={e => setF('budget_max', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Notes */}
          <Field label={t(isAr, 'common.notes')}>
            <textarea className={`${inputClass} resize-none`} rows={2}
              placeholder={isAr ? 'تفاصيل، تفضيلات، متابعة...' : 'Détails, préférences, suivi...'}
              value={form.notes as string}
              onChange={e => setF('notes', e.target.value)} />
          </Field>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-1 border-t border-ez-border">
            <Btn variant="secondary" onClick={closeForm}>
              {t(isAr, 'common.cancel')}
            </Btn>
            <Btn variant="primary" loading={saving} onClick={handleSubmit}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editProspect
                ? (t(isAr, 'common.saveEditsFull'))
                : (isAr ? 'إضافة الطلب'    : 'Ajouter le prospect')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}