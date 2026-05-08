'use client'
import { useState, useEffect } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatDate } from '@/lib/utils'
import { PageHeader, Modal, Field, inputClass, selectClass, Btn, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { FileText, Plus, RefreshCw, Tag, Layers, User, Calendar } from 'lucide-react'

interface ChangeEntry {
  change_id:       string
  title:           string
  description?:    string | null
  affected_module?: string | null
  version_tag?:    string | null
  author:          string
  changed_at:      string
  created_at:      string
}

const MODULES = [
  'auth', 'phones', 'laptops', 'accessories', 'transactions',
  'reparations', 'clients', 'suppliers', 'expenses', 'caisse',
  'stock_movements', 'users', 'scanner', 'labels', 'dashboard',
  'general',
]

const EMPTY_FORM = {
  title:           '',
  description:     '',
  affected_module: '',
  version_tag:     '',
  author:          '',
  changed_at:      new Date().toISOString().split('T')[0],
}

const MODULE_COLORS: Record<string, string> = {
  auth:            '#6366F1',
  phones:          '#3B82F6',
  laptops:         '#8B5CF6',
  accessories:     '#10B981',
  transactions:    '#F59E0B',
  reparations:     '#EF4444',
  clients:         '#EC4899',
  caisse:          '#C9A440',
  dashboard:       '#6366F1',
  general:         '#6B6860',
}

export default function BZGChangelogPage() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'

  const [entries, setEntries]       = useState<ChangeEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [formOpen, setFormOpen]     = useState(false)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)

  async function fetchChangelog() {
    setLoading(true)
    try {
      const res  = await fetch('/api/changelog')
      const json = await res.json()
      setEntries(json.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchChangelog() }, [])

  // Pre-fill author from current user
  useEffect(() => {
    if (user?.display_name) {
      setForm(prev => ({ ...prev, author: user.display_name }))
    }
  }, [user])

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.author.trim()) {
      showError(isAr ? 'العنوان والمؤلف مطلوبان' : 'Titre et auteur obligatoires')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/changelog', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title:           form.title,
          description:     form.description     || null,
          affected_module: form.affected_module || null,
          version_tag:     form.version_tag     || null,
          author:          form.author,
          changed_at:      form.changed_at,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم الإضافة ✓' : 'Entrée ajoutée ✓')
      setFormOpen(false)
      setForm({ ...EMPTY_FORM, author: user?.display_name ?? '' })
      await fetchChangelog()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // Group entries by month
  const grouped = entries.reduce((acc, entry) => {
    const month = entry.changed_at.slice(0, 7)
    if (!acc[month]) acc[month] = []
    acc[month].push(entry)
    return acc
  }, {} as Record<string, ChangeEntry[]>)

  const monthLabels: Record<string, string> = {
    '01': 'Janvier', '02': 'Février', '03': 'Mars', '04': 'Avril',
    '05': 'Mai',     '06': 'Juin',    '07': 'Juillet', '08': 'Août',
    '09': 'Septembre', '10': 'Octobre', '11': 'Novembre', '12': 'Décembre',
  }

  function monthTitle(key: string) {
    const [year, month] = key.split('-')
    return `${monthLabels[month] ?? month} ${year}`
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <PageHeader
          title={isAr ? 'سجل التغييرات' : 'Changelog plateforme'}
          subtitle={isAr
            ? `${entries.length} تغيير مسجل`
            : `${entries.length} entrée${entries.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchChangelog} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Btn variant="primary" onClick={() => setFormOpen(true)}
                style={{ backgroundColor: '#6366F1' } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة تغيير' : 'Ajouter une entrée'}
              </Btn>
            </div>
          }
        />
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            <EmptyState
              icon={<FileText className="w-7 h-7" />}
              title={isAr ? 'لا توجد تغييرات مسجلة' : 'Aucune entrée'}
              description={isAr ? 'أضف أول تغيير للمنصة' : 'Commencez à documenter les changements'}
              action={
                <Btn variant="primary" onClick={() => setFormOpen(true)}
                  style={{ backgroundColor: '#6366F1' } as React.CSSProperties}>
                  <Plus className="w-4 h-4" />
                  {isAr ? 'إضافة' : 'Ajouter'}
                </Btn>
              }
            />
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([month, monthEntries]) => (
              <div key={month}>
                {/* Month label */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full bg-[#6366F1]" />
                  <h3 className="font-display font-bold text-[#1A1A1A] tracking-wide">
                    {monthTitle(month)}
                  </h3>
                  <div className="flex-1 h-px bg-[#E8E5DE]" />
                  <span className="text-xs text-[#B0ADA6]">{monthEntries.length}</span>
                </div>

                {/* Entries */}
                <div className="space-y-3 ml-5">
                  {monthEntries.map(entry => {
                    const modColor = MODULE_COLORS[entry.affected_module ?? ''] ?? '#6B6860'
                    return (
                      <div key={entry.change_id}
                        className="bg-white border border-[#E8E5DE] rounded-2xl p-5 hover:shadow-sm transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Title + tags */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <h4 className="font-bold text-sm text-[#1A1A1A]">{entry.title}</h4>
                              {entry.version_tag && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#6366F1]/10 text-[#6366F1] text-xs font-bold border border-[#6366F1]/20">
                                  <Tag className="w-2.5 h-2.5" />
                                  {entry.version_tag}
                                </span>
                              )}
                              {entry.affected_module && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold border"
                                  style={{
                                    backgroundColor: `${modColor}12`,
                                    color:           modColor,
                                    borderColor:     `${modColor}30`,
                                  }}
                                >
                                  <Layers className="w-2.5 h-2.5" />
                                  {entry.affected_module}
                                </span>
                              )}
                            </div>

                            {/* Description */}
                            {entry.description && (
                              <p className="text-sm text-[#6B6860] leading-relaxed mb-3">
                                {entry.description}
                              </p>
                            )}

                            {/* Footer */}
                            <div className="flex items-center gap-4 text-xs text-[#B0ADA6]">
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" />
                                {entry.author}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatDate(entry.changed_at)}
                              </span>
                              <span className="font-mono">{entry.change_id}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setForm({ ...EMPTY_FORM, author: user?.display_name ?? '' }) }}
        title={isAr ? 'إضافة تغيير جديد' : 'Nouvelle entrée changelog'}
        size="md"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <Field label={isAr ? 'عنوان التغيير' : 'Titre du changement'} required>
            <input type="text" className={inputClass} autoFocus
              placeholder={isAr ? 'مثال: إضافة وحدة الكاسيير' : 'Ex: Ajout du module Caisse'}
              value={form.title} onChange={e => setF('title', e.target.value)} />
          </Field>

          <Field label={isAr ? 'الوصف' : 'Description'}>
            <textarea className={`${inputClass} resize-none`} rows={3}
              placeholder={isAr ? 'تفاصيل التغيير...' : 'Détails du changement...'}
              value={form.description} onChange={e => setF('description', e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'الوحدة المتأثرة' : 'Module concerné'}>
              <select className={selectClass} value={form.affected_module}
                onChange={e => setF('affected_module', e.target.value)}>
                <option value="">{isAr ? 'اختر...' : 'Choisir...'}</option>
                {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label={isAr ? 'رقم الإصدار' : 'Tag de version'}>
              <input type="text" className={inputClass}
                placeholder="v1.2.0, Phase 2..."
                value={form.version_tag} onChange={e => setF('version_tag', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={isAr ? 'المؤلف' : 'Auteur'} required>
              <input type="text" className={inputClass}
                value={form.author} onChange={e => setF('author', e.target.value)} />
            </Field>
            <Field label={isAr ? 'تاريخ التغيير' : 'Date du changement'} required>
              <input type="date" className={inputClass}
                value={form.changed_at} onChange={e => setF('changed_at', e.target.value)} />
            </Field>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary"
              onClick={() => { setFormOpen(false); setForm({ ...EMPTY_FORM, author: user?.display_name ?? '' }) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handleSubmit} loading={submitting}
              style={{ backgroundColor: '#6366F1' } as React.CSSProperties}>
              {isAr ? 'إضافة' : 'Ajouter'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}