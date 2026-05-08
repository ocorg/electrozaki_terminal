'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import ScanButton from '@/components/scanner/ScanButton'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { DeviceType, LocationType, MovementReason } from '@/types/database'
import {
  ArrowLeftRight, Plus, RefreshCw,
  MapPin, Clock, Smartphone, Laptop, Package,
  ArrowRight, Search, X
} from 'lucide-react'

interface Movement {
  movement_id:   string
  device_type:   DeviceType
  device_id:     string
  quantity:      number
  from_location: LocationType
  to_location:   LocationType
  external_name?: string | null
  reason:        MovementReason
  store_id?:     string | null
  notes?:        string | null
  moved_at:      string
  created_at:    string
}

const LOCATIONS: LocationType[] = ['Magasin Principal', 'Magasin Secondaire', 'Externe']
const REASONS:   MovementReason[] = ['Transfert', 'Réparation Externe', 'Retour', 'Prêt']

const LOCATION_LABELS_FR: Record<string, string> = {
  'Magasin Principal':  'Magasin Principal',
  'Magasin Secondaire': 'Magasin Secondaire',
  'Externe':            'Externe',
}
const LOCATION_LABELS_AR: Record<string, string> = {
  'Magasin Principal':  'المحل الرئيسي',
  'Magasin Secondaire': 'المحل الثاني',
  'Externe':            'خارجي',
}
const REASON_LABELS_FR: Record<string, string> = {
  'Transfert':          'Transfert',
  'Réparation Externe': 'Réparation Externe',
  'Retour':             'Retour',
  'Prêt':               'Prêt',
}
const REASON_LABELS_AR: Record<string, string> = {
  'Transfert':          'نقل',
  'Réparation Externe': 'إصلاح خارجي',
  'Retour':             'إرجاع',
  'Prêt':               'إعارة',
}

const EMPTY_FORM = {
  device_type:    'هاتف' as DeviceType,
  device_id:      '',
  from_location:  'Magasin Principal' as LocationType,
  to_location:    'Magasin Secondaire' as LocationType,
  from_store_id:  '',
  to_store_id:    '',
  is_inter_store: false,
  reason:         'Transfert' as MovementReason,
  external_name:  '',
  notes:          '',
}

const DEVICE_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  'هاتف':    Smartphone,
  'لابتوب':  Laptop,
  'إكسسوار': Package,
}

interface MovementsModuleProps {
  storeId: string
}

export default function MovementsModule({ storeId }: MovementsModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor

  const [movements, setMovements]   = useState<Movement[]>([])
  const [loading, setLoading]       = useState(true)
  const [formOpen, setFormOpen]     = useState(false)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch]         = useState('')

  const canMove = user?.role === 'manager' || user?.role === 'owner'

  const fetchMovements = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/movements?store_id=${storeId}&limit=100`)
      const json = await res.json()
      setMovements(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => { fetchMovements() }, [fetchMovements])

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.device_id.trim()) {
      showError(isAr ? 'معرف الجهاز مطلوب' : 'ID de l\'appareil requis')
      return
    }
    if (form.from_location === form.to_location) {
      showError(isAr ? 'المصدر والوجهة متطابقان' : 'Source et destination identiques')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/movements', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          store_id:      form.is_inter_store ? form.from_store_id : storeId,
          device_type:   form.device_type,
          device_id:     form.device_id,
          from_location: form.from_location,
          to_location:   form.to_location,
          from_store_id: form.is_inter_store ? form.from_store_id : null,
          to_store_id:   form.is_inter_store ? form.to_store_id   : null,
          reason:        form.reason,
          external_name: form.external_name || null,
          notes:         form.notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل الحركة ✓' : 'Transfert enregistré ✓')
      setFormOpen(false)
      setForm({ ...EMPTY_FORM })
      await fetchMovements()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = movements.filter(m =>
    !search || m.device_id.toLowerCase().includes(search.toLowerCase())
  )

  function locLabel(loc: string) {
    return isAr ? LOCATION_LABELS_AR[loc] ?? loc : LOCATION_LABELS_FR[loc] ?? loc
  }
  function reasonLabel(r: string) {
    return isAr ? REASON_LABELS_AR[r] ?? r : REASON_LABELS_FR[r] ?? r
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'حركات المخزون' : 'Transferts de stock'}
          subtitle={isAr
            ? `${movements.length} حركة مسجلة`
            : `${movements.length} mouvement${movements.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchMovements} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {canMove && (
                <Btn variant="primary" onClick={() => setFormOpen(true)}
                  style={{ backgroundColor: primary } as React.CSSProperties}>
                  <Plus className="w-4 h-4" />
                  {isAr ? 'تسجيل حركة' : 'Nouveau transfert'}
                </Btn>
              )}
            </div>
          }
        />

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
            <input
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
              placeholder={isAr ? 'بحث بمعرف الجهاز...' : 'Rechercher par ID appareil...'}
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
            hint="Scannez l'ID de l'appareil"
            color={primary}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight className="w-7 h-7" />}
              title={isAr ? 'لا توجد حركات' : 'Aucun transfert'}
              description={isAr ? 'لم يتم تسجيل أي حركة بعد' : 'Aucun mouvement enregistré'}
              action={canMove
                ? <Btn variant="primary" onClick={() => setFormOpen(true)}
                    style={{ backgroundColor: primary } as React.CSSProperties}>
                    <Plus className="w-4 h-4" />
                    {isAr ? 'تسجيل حركة' : 'Nouveau transfert'}
                  </Btn>
                : undefined
              }
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {filtered.map(mov => {
                const Icon = DEVICE_ICONS[mov.device_type] ?? Package
                return (
                  <div key={mov.movement_id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-[#F8F7F4] transition-all">
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: `${primary}12` }}>
                      <Icon className="w-5 h-5" style={{ color: primary }} />
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#1A1A1A]">{mov.device_id}</p>
                        <span className="text-xs text-[#B0ADA6]">·</span>
                        <span className="text-xs text-[#6B6860]">{reasonLabel(mov.reason)}</span>
                      </div>

                      {/* Route */}
                      <div className="flex items-center gap-1.5 mt-1">
                        <MapPin className="w-3 h-3 text-[#B0ADA6] flex-shrink-0" />
                        <span className="text-xs text-[#6B6860]">{locLabel(mov.from_location)}</span>
                        <ArrowRight className="w-3 h-3 text-[#B0ADA6]" />
                        <span className="text-xs font-medium" style={{ color: primary }}>
                          {locLabel(mov.to_location)}
                          {mov.external_name ? ` (${mov.external_name})` : ''}
                        </span>
                      </div>

                      {mov.notes && (
                        <p className="text-xs text-[#B0ADA6] mt-0.5 truncate">{mov.notes}</p>
                      )}
                    </div>

                    {/* Date */}
                    <div className="text-right flex-shrink-0">
                      <div className="flex items-center gap-1 text-xs text-[#B0ADA6]">
                        <Clock className="w-3 h-3" />
                        {formatDate(mov.moved_at)}
                      </div>
                      {mov.quantity > 1 && (
                        <p className="text-xs font-bold mt-0.5" style={{ color: primary }}>
                          ×{mov.quantity}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }) }}
        title={isAr ? 'تسجيل حركة مخزون' : 'Nouveau transfert de stock'}
        size="sm"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>

          <Field label={isAr ? 'نوع الجهاز' : 'Type d\'appareil'} required>
            <select className={selectClass} value={form.device_type}
              onChange={e => setF('device_type', e.target.value)}>
              <option value="هاتف">{isAr ? 'هاتف' : 'Téléphone'}</option>
              <option value="لابتوب">{isAr ? 'لابتوب' : 'Laptop'}</option>
              <option value="إكسسوار">{isAr ? 'إكسسوار' : 'Accessoire'}</option>
            </select>
          </Field>

          <Field label={isAr ? 'معرف الجهاز' : 'ID de l\'appareil'} required>
            <div className="flex gap-2">
              <input type="text" className={inputClass}
                placeholder="PHO-0001, LAP-0001, EZ-ACC-000001..."
                value={form.device_id}
                onChange={e => setF('device_id', e.target.value)} />
              <ScanButton
                onScan={v => setF('device_id', v)}
                hint="Scannez l'ID"
                color={primary}
                size="sm"
              />
            </div>
          </Field>

              <Field label={isAr ? 'نوع النقل' : 'Type de transfert'}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, is_inter_store: false }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${!form.is_inter_store ? 'bg-[#C9A440] text-white border-[#C9A440]' : 'bg-white text-[#6B6860] border-[#E8E5DE]'}`}
                >
                  {isAr ? 'داخل المحل' : 'Intra-magasin'}
                </button>
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, is_inter_store: true }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${form.is_inter_store ? 'bg-[#C9A440] text-white border-[#C9A440]' : 'bg-white text-[#6B6860] border-[#E8E5DE]'}`}
                >
                  {isAr ? 'بين المحلات' : 'Inter-magasin'}
                </button>
              </div>
            </Field>

            {form.is_inter_store && (
              <div className="grid grid-cols-2 gap-4">
                <Field label={isAr ? 'من المحل' : 'Magasin source'}>
                  <select className={selectClass} value={form.from_store_id} onChange={e => setForm(p => ({ ...p, from_store_id: e.target.value }))}>
                    <option value="EZ-001">Electro Zaki (EZ)</option>
                    <option value="HP-001">Hamid Phone (HP)</option>
                  </select>
                </Field>
                <Field label={isAr ? 'إلى المحل' : 'Magasin destination'}>
                  <select className={selectClass} value={form.to_store_id} onChange={e => setForm(p => ({ ...p, to_store_id: e.target.value }))}>
                    <option value="EZ-001">Electro Zaki (EZ)</option>
                    <option value="HP-001">Hamid Phone (HP)</option>
                  </select>
                </Field>
              </div>
            )}

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'من' : 'De'} required>
              <select className={selectClass} value={form.from_location}
                onChange={e => setF('from_location', e.target.value)}>
                {LOCATIONS.map(l => (
                  <option key={l} value={l}>{locLabel(l)}</option>
                ))}
              </select>
            </Field>
            <Field label={isAr ? 'إلى' : 'Vers'} required>
              <select className={selectClass} value={form.to_location}
                onChange={e => setF('to_location', e.target.value)}>
                {LOCATIONS.map(l => (
                  <option key={l} value={l}>{locLabel(l)}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* External name — shown when destination is Externe */}
          {form.to_location === 'Externe' && (
            <Field label={isAr ? 'اسم الجهة الخارجية' : 'Nom de la destination externe'}>
              <input type="text" className={inputClass}
                placeholder={isAr ? 'اسم المحل، التقني...' : 'Atelier, technicien...'}
                value={form.external_name}
                onChange={e => setF('external_name', e.target.value)} />
            </Field>
          )}

          <Field label={isAr ? 'السبب' : 'Motif'} required>
            <select className={selectClass} value={form.reason}
              onChange={e => setF('reason', e.target.value)}>
              {REASONS.map(r => (
                <option key={r} value={r}>{reasonLabel(r)}</option>
              ))}
            </select>
          </Field>

          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={form.notes}
              onChange={e => setF('notes', e.target.value)}
              placeholder={isAr ? 'ملاحظة...' : 'Note...'} />
          </Field>

          {/* Preview */}
          {form.device_id && form.from_location !== form.to_location && (
            <div className="flex items-center gap-3 p-3 rounded-xl border"
                 style={{ backgroundColor: `${primary}08`, borderColor: `${primary}25` }}>
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: primary }} />
              <p className="text-sm text-[#1A1A1A]">
                <span className="font-bold">{form.device_id}</span>
                {' : '}
                {locLabel(form.from_location)}
                {' → '}
                <span className="font-bold" style={{ color: primary }}>
                  {locLabel(form.to_location)}
                  {form.to_location === 'Externe' && form.external_name
                    ? ` (${form.external_name})` : ''}
                </span>
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary"
              onClick={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handleSubmit} loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {isAr ? 'تسجيل الحركة' : 'Enregistrer'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}