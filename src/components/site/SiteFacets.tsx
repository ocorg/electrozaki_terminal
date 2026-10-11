'use client'
import { useState } from 'react'
import { Plus, Pencil, Trash2, Eye, EyeOff, ListChecks } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { Modal, Btn, EmptyState, SkeletonRow, Field, inputClass, selectClass, Select } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { confirmDialog } from '@/components/shared/ConfirmHost'
import { useSiteLang, Chip } from './common'

// The website's product checklist ("fiches"): what a customer chooses an
// accessory by (phone model, who for, style, protection…). Groups and their
// choices are edited in FacetsTab; FacetChecklist ticks them on one product.

export interface FacetOption { id: string; key: string; name: string; level: number | null; sortOrder: number; active: boolean; products: number }
export interface FacetGroup {
  id: string; key: string; name: string; question: string | null; multi: boolean
  display: 'CHIPS' | 'TILES' | 'METER'; sortOrder: number; active: boolean
  categoryIds: string[]; options: FacetOption[]
}
interface Category { id: string; name: string; parentId: string | null }

const FACETS = '/api/site/facets'

const DISPLAY: Record<FacetGroup['display'], { fr: string; ar: string }> = {
  CHIPS: { fr: 'Boutons simples',            ar: 'أزرار بسيطة' },
  TILES: { fr: 'Vignettes avec photo',       ar: 'مربعات بالصور' },
  METER: { fr: 'Échelle (niveau 1, 2, 3…)',  ar: 'سلّم (مستوى 1، 2، 3…)' },
}

// ── Groups and choices ───────────────────────────────────────────────────

export function FacetsTab({ categories, isManager }: { categories: Category[]; isManager: boolean }) {
  const { L, isAr } = useSiteLang()
  const q = useApi<FacetGroup[]>(FACETS)
  const [group, setGroup]   = useState<Partial<FacetGroup> | null>(null)
  const [option, setOption] = useState<(Partial<FacetOption> & { group: FacetGroup }) | null>(null)
  const [saving, setSaving] = useState(false)
  const groups = q.data ?? []

  async function write(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, done?: string) {
    setSaving(true)
    try {
      await apiWrite(FACETS, { method, body })
      if (done) showSuccess(done)
      q.refresh()
      return true
    } catch (e) { showError((e as Error).message); return false } finally { setSaving(false) }
  }

  async function saveGroup() {
    if (!group) return
    const body = {
      kind: 'group', id: group.id, name: group.name, question: group.question ?? '', multi: group.multi !== false,
      display: group.display ?? 'CHIPS', sortOrder: group.sortOrder ?? 0, categoryIds: group.categoryIds ?? [],
    }
    if (await write(group.id ? 'PATCH' : 'POST', body, L('Groupe enregistré', 'تم الحفظ'))) setGroup(null)
  }

  async function saveOption() {
    if (!option) return
    const body = { kind: 'option', id: option.id, groupId: option.group.id, name: option.name, level: option.level ?? null, sortOrder: option.sortOrder }
    if (await write(option.id ? 'PATCH' : 'POST', body, L('Choix enregistré', 'تم الحفظ'))) setOption(null)
  }

  async function remove(kind: 'group' | 'option', id: string, name: string) {
    if (!(await confirmDialog(L(`Supprimer « ${name} » ?`, `حذف « ${name} »؟`)))) return
    await write('DELETE', { kind, id })
  }

  if (q.isLoading) return <div className="bg-white rounded-2xl border border-ez-border">{[0, 1].map(i => <SkeletonRow key={i} />)}</div>

  const aisleNames = (g: FacetGroup) => g.categoryIds.map(id => categories.find(c => c.id === id)?.name).filter(Boolean).join(', ')

  return (
    <div className="space-y-4">
      <p className="text-sm text-ez-subtle">
        {L('Les questions que le site pose au client dans un rayon (son téléphone, son style, la protection…) et les choix possibles. Cochez ensuite ces choix sur chaque produit, dans sa fiche. Un groupe sans question devient un filtre supplémentaire.',
           'الأسئلة التي يطرحها الموقع على الزبون في القسم (هاتفه، ذوقه، الحماية…) والاختيارات الممكنة. ثم حدّد هذه الاختيارات على كل منتج.')}
      </p>
      {isManager && (
        <Btn onClick={() => setGroup({ name: '', question: '', multi: true, display: 'CHIPS', sortOrder: groups.length + 1, categoryIds: [] })}>
          <Plus className="w-4 h-4" />{L('Nouveau groupe', 'مجموعة جديدة')}
        </Btn>
      )}
      {groups.length === 0 && <EmptyState icon={<ListChecks className="w-6 h-6" />} title={L('Aucun groupe', 'لا توجد مجموعات')} />}

      {groups.map(g => (
        <div key={g.id} className={`bg-white border border-ez-border rounded-2xl ${g.active ? '' : 'opacity-60'}`}>
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-ez-border">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold text-ez-text">
                {g.name} {!g.active && <Chip tone="gray">{L('désactivé', 'معطّل')}</Chip>}
              </p>
              <p className="text-xs text-ez-subtle">
                {g.question ? `« ${g.question} »` : L('Filtre supplémentaire (pas de question)', 'فلتر إضافي')}
                {' · '}{isAr ? DISPLAY[g.display].ar : DISPLAY[g.display].fr}
                {' · '}{g.multi ? L('plusieurs choix par produit', 'عدة اختيارات') : L('un seul choix par produit', 'اختيار واحد')}
                {' · '}{aisleNames(g) || L('aucun rayon', 'بدون قسم')}
              </p>
            </div>
            <span className="text-xs text-ez-subtle">#{g.sortOrder}</span>
            {isManager && (
              <>
                <button onClick={() => write('PATCH', { kind: 'group', id: g.id, active: !g.active })} disabled={saving}
                  title={g.active ? L('Désactiver', 'تعطيل') : L('Réactiver', 'تفعيل')}
                  className={`p-2 rounded-lg ${g.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-ez-placeholder hover:bg-ez-muted'}`}>
                  {g.active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={() => setGroup(g)} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove('group', g.id, g.name)} className="p-2 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              </>
            )}
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {g.options.map(o => (
              <span key={o.id} className={`inline-flex items-center gap-1 ps-3 pe-1 py-1 rounded-full border text-sm ${o.active ? 'border-ez-border bg-ez-bg text-ez-text' : 'border-dashed border-ez-border text-ez-placeholder line-through'}`}>
                {g.display === 'METER' && o.level !== null && <b className="text-xs text-gold">{o.level}</b>}
                {o.name}
                <span className="text-xs text-ez-subtle">· {o.products}</span>
                {isManager && (
                  <>
                    <button onClick={() => setOption({ ...o, group: g })} className="p-1 rounded-full text-ez-subtle hover:bg-ez-muted" title={L('Modifier', 'تعديل')}><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => write('PATCH', { kind: 'option', id: o.id, active: !o.active })} disabled={saving}
                      className="p-1 rounded-full text-ez-subtle hover:bg-ez-muted" title={o.active ? L('Désactiver', 'تعطيل') : L('Réactiver', 'تفعيل')}>
                      {o.active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </button>
                    {o.products === 0 && (
                      <button onClick={() => remove('option', o.id, o.name)} className="p-1 rounded-full text-red-500 hover:bg-red-50" title={L('Supprimer', 'حذف')}><Trash2 className="w-3 h-3" /></button>
                    )}
                  </>
                )}
              </span>
            ))}
            {isManager && (
              <button onClick={() => setOption({ name: '', level: null, group: g })}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border-2 border-dashed border-ez-border text-sm text-ez-subtle hover:border-gold">
                <Plus className="w-3.5 h-3.5" />{L('Ajouter un choix', 'إضافة اختيار')}
              </button>
            )}
          </div>
        </div>
      ))}

      {group && (
        <Modal open onClose={() => setGroup(null)} size="md" title={group.id ? L('Modifier le groupe', 'تعديل المجموعة') : L('Nouveau groupe', 'مجموعة جديدة')}>
          <div className="space-y-3">
            <Field label={L('Nom', 'الاسم')} required hint={L('Ex. Style, Matière, Modèle', '')}>
              <input value={group.name ?? ''} onChange={e => setGroup({ ...group, name: e.target.value })} className={inputClass} maxLength={40} />
            </Field>
            <Field label={L('Question posée au client (optionnel)', 'السؤال المطروح على الزبون')}
              hint={L('Ex. « Votre style ? ». Vide : le groupe est un simple filtre.', '')}>
              <input value={group.question ?? ''} onChange={e => setGroup({ ...group, question: e.target.value })} className={inputClass} maxLength={60} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={L('Affichage sur le site', 'طريقة العرض')}>
                <Select value={group.display ?? 'CHIPS'} onChange={e => setGroup({ ...group, display: e.target.value as FacetGroup['display'] })} className={selectClass}>
                  {(Object.keys(DISPLAY) as FacetGroup['display'][]).map(d => <option key={d} value={d}>{isAr ? DISPLAY[d].ar : DISPLAY[d].fr}</option>)}
                </Select>
              </Field>
              <Field label={L('Ordre', 'الترتيب')}>
                <input type="number" value={group.sortOrder ?? 0} onChange={e => setGroup({ ...group, sortOrder: Number(e.target.value) })} className={inputClass} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={group.multi !== false} onChange={e => setGroup({ ...group, multi: e.target.checked })} className="w-4 h-4" />
              {L('Un produit peut avoir plusieurs choix de ce groupe', 'يمكن للمنتج أن يحمل عدة اختيارات')}
            </label>
            <Field label={L('Rayons concernés', 'الأقسام المعنية')} hint={L('Un rayon principal vaut aussi pour ses sous-rayons.', '')}>
              <div className="max-h-44 overflow-y-auto border border-ez-border rounded-lg divide-y divide-ez-border">
                {categories.filter(c => !c.parentId).flatMap(p => [p, ...categories.filter(c => c.parentId === p.id)]).map(c => {
                  const on = (group.categoryIds ?? []).includes(c.id)
                  return (
                    <label key={c.id} className={`flex items-center gap-2 p-2 text-sm ${c.parentId ? 'ps-8' : 'font-semibold'}`}>
                      <input type="checkbox" checked={on} className="w-4 h-4"
                        onChange={() => setGroup({ ...group, categoryIds: on ? (group.categoryIds ?? []).filter(id => id !== c.id) : [...(group.categoryIds ?? []), c.id] })} />
                      {c.name}
                    </label>
                  )
                })}
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setGroup(null)}>{L('Annuler', 'إلغاء')}</Btn>
              <Btn onClick={saveGroup} loading={saving}>{L('Enregistrer', 'حفظ')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {option && (
        <Modal open onClose={() => setOption(null)} size="sm" title={`${option.group.name} — ${option.id ? L('modifier le choix', 'تعديل الاختيار') : L('nouveau choix', 'اختيار جديد')}`}>
          <div className="space-y-3">
            <Field label={L('Nom', 'الاسم')} required>
              <input autoFocus value={option.name ?? ''} onChange={e => setOption({ ...option, name: e.target.value })} className={inputClass} maxLength={40}
                onKeyDown={e => { if (e.key === 'Enter') saveOption() }} />
            </Field>
            {option.group.display === 'METER' && (
              <Field label={L('Niveau sur l’échelle (1 = le plus léger)', 'المستوى (1 = الأخف)')}>
                <input type="number" min={1} max={5} value={option.level ?? ''} onChange={e => setOption({ ...option, level: e.target.value ? Number(e.target.value) : null })} className={inputClass} />
              </Field>
            )}
            {option.id && (
              <Field label={L('Ordre', 'الترتيب')}>
                <input type="number" value={option.sortOrder ?? 0} onChange={e => setOption({ ...option, sortOrder: Number(e.target.value) })} className={inputClass} />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setOption(null)}>{L('Annuler', 'إلغاء')}</Btn>
              <Btn onClick={saveOption} loading={saving}>{L('Enregistrer', 'حفظ')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── One product's checklist ──────────────────────────────────────────────

/** The checklist of a product: the groups attached to its aisle (or its parent aisle). */
export function FacetChecklist({ productId, categoryId, categories, ticked }: {
  productId: string; categoryId: string; categories: Category[]; ticked: string[]
}) {
  const { L } = useSiteLang()
  const q = useApi<FacetGroup[]>(FACETS)
  const [picked, setPicked] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  const parentId = categories.find(c => c.id === categoryId)?.parentId
  const groups = (q.data ?? []).filter(g => g.active && g.categoryIds.some(id => id === categoryId || id === parentId))
  if (groups.length === 0) return null
  const current = picked ?? ticked

  function toggle(group: FacetGroup, optionId: string) {
    const inGroup = new Set(group.options.map(o => o.id))
    if (current.includes(optionId)) setPicked(current.filter(id => id !== optionId))
    else setPicked([...(group.multi ? current : current.filter(id => !inGroup.has(id))), optionId])
  }

  async function save() {
    setSaving(true)
    try {
      await apiWrite(`/api/site/catalog/${productId}/facets`, { method: 'PUT', body: { optionIds: current } })
      showSuccess(L('Fiche enregistrée', 'تم حفظ البطاقة'))
      setPicked(null)
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border border-ez-border p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2"><ListChecks className="w-4 h-4 text-gold" />{L('Fiche : ce qui aide le client à choisir', 'البطاقة: ما يساعد الزبون على الاختيار')}</p>
      {groups.map(g => (
        <div key={g.id}>
          <p className="text-xs uppercase tracking-widest text-ez-subtle font-medium mb-1.5">
            {g.name} <span className="normal-case tracking-normal">· {g.multi ? L('plusieurs possibles', 'عدة اختيارات') : L('un seul', 'واحد فقط')}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.options.filter(o => o.active || current.includes(o.id)).map(o => {
              const on = current.includes(o.id)
              return (
                <button key={o.id} type="button" onClick={() => toggle(g, o.id)} aria-pressed={on}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${on ? 'bg-gold text-white border-gold' : 'bg-white text-ez-text border-ez-border hover:border-gold'}`}>
                  {o.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-end">
        <Btn size="sm" onClick={save} loading={saving} disabled={picked === null}>{L('Enregistrer la fiche', 'حفظ البطاقة')}</Btn>
      </div>
    </div>
  )
}
