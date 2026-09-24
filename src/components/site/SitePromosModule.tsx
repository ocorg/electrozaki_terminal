'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Tag, Package, Plus, Pencil, Trash2, Smartphone } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { Modal, Btn, PageHeader, EmptyState, SkeletonRow, Field, inputClass, selectClass, Select } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { useSiteLang, Tabs, Chip, mad } from './common'
import { computePromoPrice } from '@/lib/utils'
import { codeLabel } from '@/lib/codes'
import type { Phone } from '@/types/database'

interface Promo {
  id: string; code: string; type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; active: boolean
  startsAt: string | null; expiresAt: string | null; maxRedemptions: number | null; redemptionCount: number; minOrderAmount: number | null
}
interface Bundle {
  id: string; name: string; description: string | null; bundlePrice: number; active: boolean
  items: { productId: string; quantity: number; product: { id: string; name: string; recommendedSalePrice: number; published: boolean; availability: string } }[]
}
interface CatalogProduct { id: string; name: string; isPhone: boolean; published: boolean; availability: string; recommendedSalePrice: number }

type Tab = 'phones' | 'promos' | 'bundles'

// Phones with a promo set on their own sheet (Téléphones → Modifier). Same
// list the website shows struck-through prices for.
const PROMO_PHONES = '/api/phones?status=disponible&promo=1&limit=500'

export default function SitePromosModule() {
  const { L, isAr, isManager } = useSiteLang()
  const [tab, setTab] = useState<Tab>('phones')
  const promoPhones = useApi<Phone[]>(PROMO_PHONES).data
  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader title={L('Promos & packs', 'العروض والباقات')} subtitle={L('Téléphones en promo, codes promo et packs proposés sur le site', 'الهواتف المخفضة، رموز التخفيض والباقات في الموقع')} />
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { key: 'phones',  label: L('Téléphones en promo', 'هواتف مخفضة'), count: promoPhones?.length },
          { key: 'promos',  label: L('Codes promo', 'رموز التخفيض') },
          { key: 'bundles', label: L('Packs', 'الباقات') },
        ]} />
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {tab === 'phones' ? <PromoPhonesTab /> : tab === 'promos' ? <PromosTab isManager={isManager} /> : <BundlesTab isManager={isManager} />}
      </div>
    </div>
  )
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

function PromoPhonesTab() {
  const { L, isAr } = useSiteLang()
  const q = useApi<Phone[]>(PROMO_PHONES)
  if (q.isLoading) return <SkeletonRow />
  const phones = [...(q.data ?? [])].sort((a, b) => `${a.marque} ${a.model}`.localeCompare(`${b.marque} ${b.model}`))
  return (
    <div className="space-y-3">
      <p className="text-xs text-ez-subtle">
        {L(
          'La promo se règle sur la fiche du téléphone (Téléphones → Modifier → Promo). Le site affiche l’ancien prix barré et la réduction.',
          'يتم ضبط التخفيض من بطاقة الهاتف (الهواتف ← تعديل ← تخفيض). يعرض الموقع السعر القديم مشطوبًا.',
        )}
      </p>
      {phones.length === 0 ? <EmptyState icon={<Smartphone className="w-6 h-6" />} title={L('Aucun téléphone en promo', 'لا توجد هواتف مخفضة')} /> : (
        <div className="bg-white border border-ez-border rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ez-subtle border-b border-ez-border">
                <th className="px-3 py-2">{L('Téléphone', 'الهاتف')}</th>
                <th className="px-3 py-2">{L('État', 'الحالة')}</th>
                <th className="px-3 py-2 text-right">{L('Prix normal', 'السعر العادي')}</th>
                <th className="px-3 py-2 text-right">{L('Réduction', 'التخفيض')}</th>
                <th className="px-3 py-2 text-right">{L('Prix promo', 'سعر التخفيض')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ez-border">
              {phones.map(ph => {
                const base  = Number(ph.prix_vente_recommande ?? 0)
                const final = computePromoPrice(base, ph.promo_type, Number(ph.promo_montant ?? 0))
                return (
                  <tr key={ph.phone_id}>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-ez-text">{[ph.marque, ph.model, ph.stockage].filter(Boolean).join(' ')}</p>
                      <p className="text-[11px] text-ez-subtle">
                        <span className="font-mono">{ph.phone_id}</span>
                        {ph.couleur ? ` · ${ph.couleur}` : ''}
                        {ph.battery_level != null ? ` · ${ph.battery_level} %` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-xs">{codeLabel('device_condition', ph.condition, isAr ? 'ar' : 'fr')}</td>
                    <td className="px-3 py-2 text-right text-ez-subtle line-through tabular-nums">{mad(base)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Chip tone="red">{ph.promo_type === 'pourcentage' ? `−${ph.promo_montant}%` : `−${mad(Number(ph.promo_montant))}`}</Chip>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{mad(final === null ? base : Math.round(final))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PromosTab({ isManager }: { isManager: boolean }) {
  const { L } = useSiteLang()
  const q = useApi<Promo[]>('/api/site/promos')
  const [editing, setEditing] = useState<Partial<Promo> | null>(null)
  const [saving, setSaving]   = useState(false)

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await apiWrite('/api/site/promos', { method: editing.id ? 'PATCH' : 'POST', body: editing })
      showSuccess(L('Code enregistré', 'تم الحفظ'))
      setEditing(null)
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }
  async function remove(p: Promo) {
    if (!window.confirm(L(`Supprimer le code ${p.code} ?`, `حذف الرمز ${p.code}؟`))) return
    try { await apiWrite('/api/site/promos', { method: 'DELETE', body: { id: p.id } }) } catch (e) { showError((e as Error).message) }
  }

  if (q.isLoading) return <SkeletonRow />
  const promos = q.data ?? []
  return (
    <div className="space-y-3">
      {isManager && <Btn onClick={() => setEditing({ code: '', type: 'PERCENTAGE', value: 10, active: true })}><Plus className="w-4 h-4" />{L('Nouveau code', 'رمز جديد')}</Btn>}
      {promos.length === 0 ? <EmptyState icon={<Tag className="w-6 h-6" />} title={L('Aucun code promo', 'لا توجد رموز')} /> : (
        <div className="bg-white border border-ez-border rounded-2xl divide-y divide-ez-border">
          {promos.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3">
              <span className="font-mono font-bold text-ez-text">{p.code}</span>
              <span className="text-sm">{p.type === 'PERCENTAGE' ? `−${p.value}%` : `−${mad(p.value)}`}</span>
              <span className="flex-1 text-xs text-ez-subtle">
                {p.redemptionCount}{p.maxRedemptions !== null ? `/${p.maxRedemptions}` : ''} {L('utilisation(s)', 'استعمال')}
                {p.minOrderAmount ? ` · ${L('min.', 'حد أدنى')} ${mad(p.minOrderAmount)}` : ''}
                {p.expiresAt ? ` · ${L('jusqu’au', 'حتى')} ${day(p.expiresAt)}` : ''}
              </span>
              <Chip tone={p.active ? 'green' : 'gray'}>{p.active ? L('Actif', 'نشط') : L('Inactif', 'غير نشط')}</Chip>
              {isManager && <>
                <button onClick={() => setEditing({ ...p, startsAt: day(p.startsAt), expiresAt: day(p.expiresAt) })} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(p)} className="p-2 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              </>}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm" title={editing.id ? L('Modifier le code', 'تعديل الرمز') : L('Nouveau code', 'رمز جديد')}>
          <div className="space-y-3">
            <Field label={L('Code', 'الرمز')} required>
              <input value={editing.code ?? ''} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className={`${inputClass} font-mono uppercase`} maxLength={30} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={L('Type', 'النوع')}>
                <Select value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value as Promo['type'] })} className={selectClass}>
                  <option value="PERCENTAGE">%</option>
                  <option value="FIXED_AMOUNT">DH</option>
                </Select>
              </Field>
              <Field label={L('Valeur', 'القيمة')} required>
                <input type="number" min={1} value={editing.value ?? ''} onChange={e => setEditing({ ...editing, value: Number(e.target.value) })} className={inputClass} />
              </Field>
              <Field label={L('Début', 'البداية')}>
                <input type="date" value={editing.startsAt ?? ''} onChange={e => setEditing({ ...editing, startsAt: e.target.value || null })} className={inputClass} />
              </Field>
              <Field label={L('Fin', 'النهاية')}>
                <input type="date" value={editing.expiresAt ?? ''} onChange={e => setEditing({ ...editing, expiresAt: e.target.value || null })} className={inputClass} />
              </Field>
              <Field label={L('Utilisations max.', 'أقصى استعمال')}>
                <input type="number" min={0} value={editing.maxRedemptions ?? ''} onChange={e => setEditing({ ...editing, maxRedemptions: e.target.value === '' ? null : Number(e.target.value) })} className={inputClass} />
              </Field>
              <Field label={L('Panier minimum (DH)', 'أقل مبلغ')}>
                <input type="number" min={0} value={editing.minOrderAmount ?? ''} onChange={e => setEditing({ ...editing, minOrderAmount: e.target.value === '' ? null : Number(e.target.value) })} className={inputClass} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active !== false} onChange={e => setEditing({ ...editing, active: e.target.checked })} />{L('Actif', 'نشط')}
            </label>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setEditing(null)}>{L('Annuler', 'إلغاء')}</Btn>
              <Btn onClick={save} loading={saving}>{L('Enregistrer', 'حفظ')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BundlesTab({ isManager }: { isManager: boolean }) {
  const { L } = useSiteLang()
  const q        = useApi<Bundle[]>('/api/site/bundles')
  const catalogQ = useApi<CatalogProduct[]>('/api/site/catalog')
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string; bundlePrice: number; active: boolean; items: { productId: string; quantity: number }[] } | null>(null)
  const [saving, setSaving]   = useState(false)

  // Packs can't pick a unit/colour, so only accessories (and simple products).
  const choices = (catalogQ.data ?? []).filter(p => !p.isPhone && p.published && p.availability !== 'DISCONTINUED')
  // Synced accessories stay hidden until staff give them a public name.
  const hidden  = (catalogQ.data ?? []).filter(p => !p.isPhone && !p.published && p.availability !== 'DISCONTINUED').length
  const normal  = editing?.items.reduce((sum, i) => sum + (choices.find(c => c.id === i.productId)?.recommendedSalePrice ?? 0) * i.quantity, 0) ?? 0

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await apiWrite('/api/site/bundles', { method: editing.id ? 'PATCH' : 'POST', body: editing })
      showSuccess(L('Pack enregistré', 'تم الحفظ'))
      setEditing(null)
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }
  async function remove(b: Bundle) {
    if (!window.confirm(L(`Supprimer le pack « ${b.name} » ?`, `حذف الباقة؟`))) return
    try { await apiWrite('/api/site/bundles', { method: 'DELETE', body: { id: b.id } }) } catch (e) { showError((e as Error).message) }
  }

  if (q.isLoading) return <SkeletonRow />
  const bundles = q.data ?? []
  return (
    <div className="space-y-3">
      {isManager && <Btn onClick={() => setEditing({ name: '', description: '', bundlePrice: 0, active: true, items: [] })}><Plus className="w-4 h-4" />{L('Nouveau pack', 'باقة جديدة')}</Btn>}
      {bundles.length === 0 ? <EmptyState icon={<Package className="w-6 h-6" />} title={L('Aucun pack', 'لا توجد باقات')} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {bundles.map(b => (
            <div key={b.id} className="bg-white border border-ez-border rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-ez-text">{b.name}</p>
                <Chip tone={b.active ? 'green' : 'gray'}>{b.active ? L('Actif', 'نشط') : L('Inactif', 'غير نشط')}</Chip>
              </div>
              <p className="text-xs text-ez-subtle">{b.items.map(i => `${i.quantity}× ${i.product.name}`).join(' + ')}</p>
              <div className="flex items-center justify-between">
                <span className="font-bold">{mad(b.bundlePrice)}</span>
                {isManager && <div className="flex gap-1">
                  <button onClick={() => setEditing({ id: b.id, name: b.name, description: b.description ?? '', bundlePrice: b.bundlePrice, active: b.active, items: b.items.map(i => ({ productId: i.productId, quantity: i.quantity })) })} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(b)} className="p-2 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                </div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="md" title={editing.id ? L('Modifier le pack', 'تعديل الباقة') : L('Nouveau pack', 'باقة جديدة')}>
          <div className="space-y-3">
            <Field label={L('Nom', 'الاسم')} required>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={inputClass} maxLength={100} />
            </Field>
            <Field label={L('Description', 'الوصف')}>
              <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} className={inputClass} maxLength={500} />
            </Field>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-ez-subtle font-medium">{L('Produits (2 minimum)', 'المنتجات')}</p>
              {!catalogQ.isLoading && choices.length < 2 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1.5">
                  <p className="font-semibold">
                    {L(`Seuls les accessoires publiés sur le site peuvent entrer dans un pack — il y en a ${choices.length}.`,
                      `فقط الإكسسوارات المنشورة يمكن إضافتها — العدد: ${choices.length}`)}
                  </p>
                  {hidden > 0 && (
                    <p>
                      {L(`${hidden} accessoires attendent un nom public : dans « Catalogue du site », donnez-leur un nom (et si possible une photo), puis cochez « Publié ».`,
                        `${hidden} إكسسوار بدون اسم عمومي: أضف الاسم في كتالوج الموقع ثم انشره`)}
                    </p>
                  )}
                  <Link href="/ez/site/catalog" className="inline-block font-bold underline">{L('Ouvrir le Catalogue du site →', 'فتح كتالوج الموقع ←')}</Link>
                </div>
              )}
              {editing.items.map((it, idx) => (
                <div key={idx} className="flex gap-2">
                  <Select value={it.productId} onChange={e => setEditing({ ...editing, items: editing.items.map((x, j) => j === idx ? { ...x, productId: e.target.value } : x) })} className={selectClass}>
                    <option value="">—</option>
                    {choices.map(c => <option key={c.id} value={c.id}>{c.name} ({mad(c.recommendedSalePrice)})</option>)}
                  </Select>
                  <input type="number" min={1} max={10} value={it.quantity} onChange={e => setEditing({ ...editing, items: editing.items.map((x, j) => j === idx ? { ...x, quantity: Number(e.target.value) } : x) })} className={`${inputClass} w-20`} />
                  <button onClick={() => setEditing({ ...editing, items: editing.items.filter((_, j) => j !== idx) })} className="p-2 text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <Btn size="sm" variant="secondary" disabled={choices.length === 0} onClick={() => setEditing({ ...editing, items: [...editing.items, { productId: '', quantity: 1 }] })}><Plus className="w-3.5 h-3.5" />{L('Ajouter un produit', 'إضافة منتج')}</Btn>
            </div>
            <Field label={L('Prix du pack (DH)', 'سعر الباقة')} required hint={normal ? `${L('Prix normal', 'السعر العادي')} : ${mad(normal)}` : undefined}>
              <input type="number" min={1} value={editing.bundlePrice || ''} onChange={e => setEditing({ ...editing, bundlePrice: Number(e.target.value) })} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} />{L('Actif', 'نشط')}
            </label>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setEditing(null)}>{L('Annuler', 'إلغاء')}</Btn>
              <Btn onClick={save} loading={saving}>{L('Enregistrer', 'حفظ')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
