'use client'
import { useMemo, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { useApi, apiWrite, refreshPrefixes } from '@/lib/data/api'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { Modal, Btn, Field, inputClass, selectClass } from '@/components/shared'
import { showError, showSuccess } from '@/lib/utils/toasts'

// The accessory colour list (owner, 2026-11-04; rules in lib/couleurs): a dot
// button that opens the list to pick from; owner and managers can add a colour.

export type Couleur = { nom: string; nom_en: string | null; nom_ar: string | null; hex: string; motif: string | null; ordre: number; actif: boolean }

/** The dot: a flat colour, or a pattern for clear / multicolour / tartan. */
export function dotStyle(c: Pick<Couleur, 'hex' | 'motif'> | undefined): React.CSSProperties {
  if (!c) return { background: 'repeating-linear-gradient(45deg,#e5e5e5 0 3px,#fafafa 3px 6px)' }
  if (c.motif === 'transparent') return { background: 'repeating-conic-gradient(#e6eaee 0 25%, #ffffff 0 50%) 50% / 8px 8px' }
  if (c.motif === 'multicolore') return { background: 'conic-gradient(#e8784a, #f2d15c, #4f8a63, #3d6fb0, #8d6fb8, #e8784a)' }
  if (c.motif === 'ecossais') return { background: `repeating-linear-gradient(0deg, rgba(160,40,40,.35) 0 2px, transparent 2px 7px), repeating-linear-gradient(90deg, rgba(40,40,40,.25) 0 2px, transparent 2px 7px), ${c.hex}` }
  return { background: c.hex }
}

export function ColourDot({ colour, size = 16 }: { colour?: Pick<Couleur, 'hex' | 'motif'>; size?: number }) {
  return <span aria-hidden className="inline-block flex-none rounded-full border border-black/15" style={{ width: size, height: size, ...dotStyle(colour) }} />
}

export function useCouleurs(all = false) {
  const { data, isLoading } = useApi<Couleur[]>(all ? '/api/couleurs?all=1' : '/api/couleurs')
  const list = data ?? []
  const byName = useMemo(() => new Map(list.map(c => [c.nom, c])), [list])
  return { list, byName, loading: isLoading }
}

/** The colour's name in the screen's language (the data keeps French). */
export function useColourLabel() {
  const { language } = useLanguageStore()
  return (c: Couleur | undefined, fallback = '') => (!c ? fallback : language === 'ar' && c.nom_ar ? c.nom_ar : c.nom)
}

export function ColourPicker({ value, onChange, compact = false, emptyLabel }: {
  value: string | null | undefined
  onChange: (nom: string | null) => void
  compact?: boolean
  emptyLabel?: string
}) {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const { byName } = useCouleurs()
  const label = useColourLabel()
  const [open, setOpen] = useState(false)
  const current = value ? byName.get(value) : undefined
  const shown = value ? label(current, value) : (emptyLabel ?? L('Couleur', 'اللون'))
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={shown}
        className={`flex items-center gap-1.5 w-full rounded-md border bg-ez-bg text-start transition-colors hover:border-gold ${value && !current ? 'border-amber-500' : 'border-ez-border'} ${compact ? 'px-1.5 py-1 text-[11px]' : 'px-3 py-2.5 text-sm rounded-xl'}`}>
        <ColourDot colour={current} size={compact ? 12 : 16} />
        <span className={`truncate ${value ? 'text-ez-text' : 'text-ez-placeholder'}`}>{shown}</span>
      </button>
      {open && <ColourListModal value={value ?? null} onClose={() => setOpen(false)} onPick={nom => { onChange(nom); setOpen(false) }} />}
    </>
  )
}

function ColourListModal({ value, onPick, onClose }: { value: string | null; onPick: (nom: string | null) => void; onClose: () => void }) {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const { user } = useUser()
  const manager = user?.role === 'gerant' || user?.role === 'proprietaire'
  const { list } = useCouleurs()
  const label = useColourLabel()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const shown = list.filter(c => !q || [c.nom, c.nom_en, c.nom_ar].some(v => norm(v).includes(norm(q))))
  return (
    <Modal open onClose={onClose} title={L('Choisir une couleur', 'اختر لوناً')} size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-placeholder" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('Chercher (français, anglais ou arabe)…', 'ابحث…')} className={`${inputClass} ps-9`} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[52vh] overflow-y-auto pe-1">
          {value && (
            <button type="button" onClick={() => onPick(null)} className="flex items-center gap-2 rounded-lg border border-dashed border-ez-border px-2.5 py-2 text-sm text-ez-subtle hover:border-gold">
              <X className="w-4 h-4" /> {L('Aucune couleur', 'بدون لون')}
            </button>
          )}
          {shown.map(c => (
            <button key={c.nom} type="button" onClick={() => onPick(c.nom)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm text-start transition-colors hover:border-gold ${c.nom === value ? 'border-gold bg-gold/10' : 'border-ez-border'}`}>
              <ColourDot colour={c} size={18} />
              <span className="flex-1 min-w-0 truncate">{label(c)}</span>
              {c.nom === value && <Check className="w-4 h-4 text-gold flex-none" />}
            </button>
          ))}
          {!shown.length && <p className="col-span-full text-sm text-ez-subtle py-4 text-center">{L('Aucune couleur ne correspond.', 'لا يوجد لون مطابق')}</p>}
        </div>
        {manager && (adding
          ? <ColourForm onDone={c => { setAdding(false); if (c) onPick(c.nom) }} initialName={q} />
          : <Btn variant="secondary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> {L('Nouvelle couleur', 'لون جديد')}</Btn>)}
      </div>
    </Modal>
  )
}

/** Add a colour, or edit one (`edit`). Owner and managers. */
export function ColourForm({ edit, initialName = '', onDone }: { edit?: Couleur; initialName?: string; onDone: (saved: Couleur | null) => void }) {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const [f, setF] = useState({
    nom: edit?.nom ?? initialName, hex: edit?.hex ?? '#808080', nom_en: edit?.nom_en ?? '', nom_ar: edit?.nom_ar ?? '',
    motif: edit?.motif ?? '', actif: edit?.actif ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f, v: string | boolean) => setF(x => ({ ...x, [k]: v }))
  async function save() {
    setSaving(true)
    try {
      const body = { hex: f.hex.toUpperCase(), nom_en: f.nom_en, nom_ar: f.nom_ar, motif: f.motif, ...(edit ? { nom: edit.nom, newNom: f.nom, actif: f.actif } : { nom: f.nom }) }
      const res = await apiWrite<{ data: Couleur }>('/api/couleurs', { method: edit ? 'PATCH' : 'POST', body })
      refreshPrefixes(['/api/couleurs'])
      showSuccess(edit ? L('Couleur enregistrée', 'تم حفظ اللون') : L('Couleur ajoutée à la liste', 'تمت إضافة اللون'))
      onDone(res.data)
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }
  return (
    <div className="rounded-xl border border-ez-border p-3 space-y-3 bg-ez-bg/50">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={L('Nom (en français)', 'الاسم بالفرنسية')} required>
          <input value={f.nom} maxLength={30} onChange={e => set('nom', e.target.value)} placeholder="Bleu marine" className={inputClass} />
        </Field>
        <Field label={L('Couleur', 'اللون')} required hint={L('Cliquez sur le carré pour choisir, ou tapez le code.', 'اضغط على المربع للاختيار')}>
          <div className="flex gap-2">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(f.hex) ? f.hex : '#808080'} onChange={e => set('hex', e.target.value.toUpperCase())} className="h-11 w-14 rounded-lg border border-ez-border bg-transparent cursor-pointer" />
            <input value={f.hex} maxLength={7} onChange={e => set('hex', e.target.value)} className={`${inputClass} font-mono`} />
          </div>
        </Field>
        <Field label={L('Nom en anglais (site)', 'الاسم بالإنجليزية')}>
          <input value={f.nom_en} maxLength={40} onChange={e => set('nom_en', e.target.value)} placeholder="Navy Blue" className={inputClass} />
        </Field>
        <Field label={L('Nom en arabe (site)', 'الاسم بالعربية')}>
          <input value={f.nom_ar} maxLength={40} onChange={e => set('nom_ar', e.target.value)} dir="rtl" placeholder="أزرق كحلي" className={inputClass} />
        </Field>
        <Field label={L('Motif (si une couleur unie ne suffit pas)', 'نقش')}>
          <select value={f.motif} onChange={e => set('motif', e.target.value)} className={selectClass}>
            <option value="">{L('Aucun : couleur unie', 'بدون')}</option>
            <option value="transparent">{L('Transparent', 'شفاف')}</option>
            <option value="multicolore">{L('Multicolore', 'متعدد الألوان')}</option>
            <option value="ecossais">{L('Écossais (carreaux)', 'مربعات')}</option>
          </select>
        </Field>
        {edit && (
          <Field label={L('Dans la liste', 'في القائمة')} hint={L('Retirée : on ne peut plus la choisir, les articles qui l’ont la gardent.', '')}>
            <label className="flex items-center gap-2 text-sm py-2.5"><input type="checkbox" checked={f.actif} onChange={e => set('actif', e.target.checked)} /> {L('Proposée dans la liste', 'مقترح')}</label>
          </Field>
        )}
      </div>
      <div className="flex items-center gap-3">
        <ColourDot colour={{ hex: f.hex, motif: f.motif || null }} size={28} />
        <span className="flex-1 text-sm text-ez-subtle">{f.nom || L('Aperçu', 'معاينة')}</span>
        <Btn variant="ghost" onClick={() => onDone(null)}>{L('Annuler', 'إلغاء')}</Btn>
        <Btn onClick={save} loading={saving} disabled={!f.nom.trim()}>{L('Enregistrer', 'حفظ')}</Btn>
      </div>
    </div>
  )
}

/** Site web → Catalogue → Couleurs: the whole list; owner and managers add and edit. */
export function ColoursTab() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const { user } = useUser()
  const manager = user?.role === 'gerant' || user?.role === 'proprietaire'
  const { list, loading } = useCouleurs(true)
  const [editing, setEditing] = useState<Couleur | 'new' | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 min-w-0 text-sm text-ez-subtle">
          {L(`${list.filter(c => c.actif).length} couleurs. Les accessoires (Stock → Accessoires) et les photos du site choisissent leur couleur dans cette liste. Sur le site, chaque couleur s’affiche avec son point et son nom dans la langue du client.`,
             `${list.filter(c => c.actif).length} لون. الإكسسوارات وصور الموقع تختار لونها من هذه القائمة.`)}
        </p>
        {manager && <Btn onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> {L('Nouvelle couleur', 'لون جديد')}</Btn>}
      </div>
      {editing === 'new' && <ColourForm onDone={() => setEditing(null)} />}
      {loading ? <p className="text-sm text-ez-subtle">…</p> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {list.map(c => (
            editing !== 'new' && editing?.nom === c.nom
              ? <div key={c.nom} className="sm:col-span-2 lg:col-span-3"><ColourForm edit={c} onDone={() => setEditing(null)} /></div>
              : (
                <button key={c.nom} type="button" disabled={!manager} onClick={() => setEditing(c)}
                  className={`flex items-center gap-3 rounded-xl border border-ez-border bg-ez-card px-3 py-2.5 text-start transition-colors ${manager ? 'hover:border-gold' : ''} ${c.actif ? '' : 'opacity-50'}`}>
                  <ColourDot colour={c} size={26} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold truncate">{c.nom}{!c.actif && ` · ${L('retirée', 'محذوف')}`}</span>
                    <span className="block text-xs text-ez-subtle truncate">
                      {c.nom_en}{c.nom_en && c.nom_ar && ' · '}{c.nom_ar && <bdi dir="rtl">{c.nom_ar}</bdi>}
                    </span>
                  </span>
                  <span className="text-[11px] font-mono text-ez-faint">{c.hex}</span>
                </button>
              )
          ))}
        </div>
      )}
    </div>
  )
}
