'use client'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  Megaphone, Plus, Pencil, Trash2, Link2, QrCode, ExternalLink, ImagePlus, Search, Eye, ShoppingBag, RefreshCw,
} from 'lucide-react'
import { useApi, apiWrite, refreshPrefixes } from '@/lib/data/api'
import { Modal, Btn, PageHeader, EmptyState, SkeletonRow, Field, inputClass, selectClass } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { uploadResized } from '@/lib/utils/image'
import { useSiteLang, Chip, mad } from './common'

const SITE = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'https://electrozaki-storefront.vercel.app'

type Theme = 'GOLD' | 'INK' | 'OCEAN' | 'CORAL'
const THEMES: { key: Theme; label: string; bg: string; accent: string }[] = [
  { key: 'GOLD',  label: 'Or',     bg: '#15171c', accent: '#b8912f' },
  { key: 'INK',   label: 'Clair',  bg: '#f4f2ec', accent: '#15171c' },
  { key: 'OCEAN', label: 'Océan',  bg: '#123a57', accent: '#1f6fa8' },
  { key: 'CORAL', label: 'Corail', bg: '#7a2418', accent: '#d9573f' },
]

interface Landing {
  id: string; slug: string; title: string; subtitle: string | null; body: string | null; bannerUrl: string | null
  theme: Theme; categoryId: string | null; category: { name: string } | null; productIds: string[]
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | null; discountValue: number | null
  promoCodeId: string | null; promoCode: { code: string } | null
  startsAt: string | null; endsAt: string | null; active: boolean; views: number
  status: 'live' | 'scheduled' | 'ended' | 'off'; orders: number; revenue: number
}
interface CatalogProduct { id: string; name: string; isPhone: boolean; published: boolean; availability: string; stock: number | null; categoryId: string; category: { name: string } }
interface Category { id: string; name: string; parentId: string | null }
interface Promo { id: string; code: string; active: boolean }

const STATUS: Record<Landing['status'], { fr: string; ar: string; tone: 'green' | 'blue' | 'gray' | 'amber' }> = {
  live:      { fr: 'En cours',    ar: 'جارية',     tone: 'green' },
  scheduled: { fr: 'Programmée',  ar: 'مبرمجة',    tone: 'blue' },
  ended:     { fr: 'Terminée',    ar: 'منتهية',    tone: 'gray' },
  off:       { fr: 'Désactivée',  ar: 'معطلة',     tone: 'amber' },
}

// Store clock is GMT+0 (src/lib/time.ts): a datetime-local value is a UTC time.
const toInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '')
const fromInput = (v: string) => (v ? `${v}:00Z` : null)
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Etc/GMT', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const EMPTY = {
  title: '', slug: '', subtitle: '', body: '', theme: 'GOLD' as Theme, categoryId: '', productIds: [] as string[],
  discountType: '' as '' | 'PERCENTAGE' | 'FIXED_AMOUNT', discountValue: '', promoCodeId: '',
  startsAt: '', endsAt: '', active: true,
}

export default function SiteLandingModule() {
  const { L, isAr, isManager } = useSiteLang()
  const q        = useApi<Landing[]>('/api/site/landing')
  const pages    = q.data ?? []
  const [editing, setEditing] = useState<{ id?: string; bannerUrl?: string | null; form: typeof EMPTY } | null>(null)
  const [qrFor, setQrFor]     = useState<Landing | null>(null)

  const urlOf = (p: { slug: string }) => `${SITE}/offres/${p.slug}`

  async function copy(p: Landing) {
    try { await navigator.clipboard.writeText(urlOf(p)); showSuccess(L('Lien copié', 'تم نسخ الرابط')) }
    catch { showError(urlOf(p)) }
  }
  async function toggle(p: Landing) {
    try { await apiWrite(`/api/site/landing/${p.id}`, { method: 'PATCH', body: { active: !p.active } }) }
    catch (e) { showError((e as Error).message) }
  }
  async function remove(p: Landing) {
    if (!window.confirm(L(`Supprimer la page « ${p.title} » ?`, `حذف الصفحة « ${p.title} »؟`))) return
    try {
      const r = await apiWrite<{ deactivated?: boolean }>(`/api/site/landing/${p.id}`, { method: 'DELETE' })
      showSuccess(r.deactivated ? L('Page désactivée (elle a déjà des commandes)', 'تم تعطيل الصفحة') : L('Page supprimée', 'تم حذف الصفحة'))
    } catch (e) { showError((e as Error).message) }
  }
  function edit(p?: Landing) {
    setEditing(p ? {
      id: p.id, bannerUrl: p.bannerUrl,
      form: {
        title: p.title, slug: p.slug, subtitle: p.subtitle ?? '', body: p.body ?? '', theme: p.theme,
        categoryId: p.categoryId ?? '', productIds: p.productIds, discountType: p.discountType ?? '',
        discountValue: p.discountValue ? String(p.discountValue) : '', promoCodeId: p.promoCodeId ?? '',
        startsAt: toInput(p.startsAt), endsAt: toInput(p.endsAt), active: p.active,
      },
    } : { form: { ...EMPTY } })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <PageHeader
          title={L('Pages promo', 'صفحات العروض')}
          subtitle={L('Une page par offre, pour les pubs, flyers et QR codes. Seuls les articles en stock y apparaissent.', 'صفحة لكل عرض للإعلانات والملصقات.')}
          actions={isManager && <Btn onClick={() => edit()}><Plus className="w-4 h-4" />{L('Nouvelle page', 'صفحة جديدة')}</Btn>}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {q.isLoading ? <SkeletonRow /> : q.error ? (
          <EmptyState icon={<Megaphone className="w-6 h-6" />} title={L('Site web indisponible', 'الموقع غير متاح')} description={q.error.message} />
        ) : pages.length === 0 ? (
          <EmptyState icon={<Megaphone className="w-6 h-6" />} title={L('Aucune page promo', 'لا توجد صفحات')}
            description={L('Créez votre première offre, par exemple les coques.', 'أنشئ أول عرض.')} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pages.map(p => {
              const st = STATUS[p.status]
              const theme = THEMES.find(t => t.key === p.theme) ?? THEMES[0]
              const conv = p.views > 0 ? Math.round((p.orders / p.views) * 1000) / 10 : 0
              return (
                <div key={p.id} className="bg-white border border-ez-border rounded-2xl overflow-hidden flex flex-col">
                  <div className="h-20 relative" style={{ background: theme.bg }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.bannerUrl && <img src={p.bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />}
                    <span className="absolute top-2 start-2"><Chip tone={st.tone}>{isAr ? st.ar : st.fr}</Chip></span>
                  </div>
                  <div className="p-4 space-y-2 flex-1">
                    <p className="font-bold text-ez-text">{p.title}</p>
                    <p className="text-xs font-mono text-ez-subtle truncate">/offres/{p.slug}</p>
                    <p className="text-xs text-ez-subtle">
                      {shortDate(p.startsAt)} → {shortDate(p.endsAt)}
                      {' · '}{p.discountType ? (p.discountType === 'PERCENTAGE' ? `-${p.discountValue} %` : `-${p.discountValue} DH`) : L('prix normaux', 'أسعار عادية')}
                      {p.promoCode && ` · ${L('code', 'رمز')} ${p.promoCode.code}`}
                    </p>
                    <p className="text-xs text-ez-subtle">
                      {[p.category?.name, p.productIds.length ? `${p.productIds.length} ${L('produit(s) choisi(s)', 'منتج')}` : null].filter(Boolean).join(' + ')}
                    </p>
                    <div className="grid grid-cols-4 gap-2 pt-2 border-t border-ez-border text-center">
                      <div><p className="text-lg font-bold tabular-nums">{p.views}</p><p className="text-[10px] uppercase text-ez-subtle flex items-center justify-center gap-1"><Eye className="w-3 h-3" />{L('visites', 'زيارات')}</p></div>
                      <div><p className="text-lg font-bold tabular-nums">{p.orders}</p><p className="text-[10px] uppercase text-ez-subtle flex items-center justify-center gap-1"><ShoppingBag className="w-3 h-3" />{L('commandes', 'طلبات')}</p></div>
                      <div><p className="text-lg font-bold tabular-nums">{conv}%</p><p className="text-[10px] uppercase text-ez-subtle">{L('conversion', 'تحويل')}</p></div>
                      <div><p className="text-sm font-bold tabular-nums pt-1">{mad(p.revenue)}</p><p className="text-[10px] uppercase text-ez-subtle">{L('ventes', 'مبيعات')}</p></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 px-3 py-2 border-t border-ez-border">
                    <button onClick={() => copy(p)} title={L('Copier le lien', 'نسخ الرابط')} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Link2 className="w-4 h-4" /></button>
                    <button onClick={() => setQrFor(p)} title="QR code" className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><QrCode className="w-4 h-4" /></button>
                    <a href={urlOf(p)} target="_blank" rel="noopener noreferrer" title={L('Ouvrir la page', 'فتح الصفحة')} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><ExternalLink className="w-4 h-4" /></a>
                    {isManager && (
                      <>
                        <label className="ms-auto flex items-center gap-1.5 text-xs text-ez-subtle">
                          <input type="checkbox" checked={p.active} onChange={() => toggle(p)} />{L('Active', 'مفعلة')}
                        </label>
                        <button onClick={() => edit(p)} title={L('Modifier', 'تعديل')} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => remove(p)} title={L('Supprimer', 'حذف')} className="p-2 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing && <LandingEditor initial={editing} onClose={() => setEditing(null)} />}
      {qrFor && <QrModal url={urlOf(qrFor)} title={qrFor.title} slug={qrFor.slug} onClose={() => setQrFor(null)} />}
    </div>
  )
}

function QrModal({ url, title, slug, onClose }: { url: string; title: string; slug: string; onClose: () => void }) {
  const { L } = useSiteLang()
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(url, { width: 640, margin: 2 }).then(d => { if (alive) setSrc(d) }).catch(() => {})
    return () => { alive = false }
  }, [url])
  return (
    <Modal open onClose={onClose} size="sm" title={`QR — ${title}`}>
      <div className="space-y-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={url} className="mx-auto w-64 h-64" /> : <RefreshCw className="w-6 h-6 mx-auto animate-spin" />}
        <p className="text-xs font-mono break-all text-ez-subtle select-all">{url}</p>
        {src && <a href={src} download={`qr-${slug}.png`} className="inline-flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-ez-muted text-sm font-medium">{L('Télécharger le QR code (PNG)', 'تحميل رمز QR')}</a>}
        <p className="text-[11px] text-ez-subtle">{L('À imprimer sur les flyers, l’étiquette de vitrine ou à poster en story.', 'للطباعة على الملصقات أو نشره.')}</p>
      </div>
    </Modal>
  )
}

function LandingEditor({ initial, onClose }: { initial: { id?: string; bannerUrl?: string | null; form: typeof EMPTY }; onClose: () => void }) {
  const { L } = useSiteLang()
  const [form, setForm]     = useState(initial.form)
  const [banner, setBanner] = useState(initial.bannerUrl ?? null)
  const [pageId, setPageId] = useState(initial.id)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const catalogQ = useApi<{ data: CatalogProduct[]; categories: Category[] }, { data: CatalogProduct[]; categories: Category[] }>('/api/site/catalog', { select: j => j })
  const promosQ  = useApi<Promo[]>('/api/site/promos')
  const products   = (catalogQ.data?.data ?? []).filter(p => !p.isPhone)
  const categories = catalogQ.data?.categories ?? []
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm(f => ({ ...f, [k]: v }))

  const inCategory = (p: CatalogProduct) => {
    if (!form.categoryId) return false
    const childIds = categories.filter(c => c.parentId === form.categoryId).map(c => c.id)
    return p.categoryId === form.categoryId || childIds.includes(p.categoryId)
  }
  const shown = products
    .filter(p => search.trim().length < 2 || p.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 60)
  const onPage = products.filter(p => (inCategory(p) || form.productIds.includes(p.id)))
  const liveCount = onPage.filter(p => p.published && p.availability === 'IN_STOCK').length
  const hiddenCount = onPage.filter(p => !p.published).length

  async function save() {
    setSaving(true)
    try {
      const body = {
        ...form,
        discountType: form.discountType || null,
        discountValue: form.discountType ? Number(form.discountValue) : null,
        categoryId: form.categoryId || null,
        promoCodeId: form.promoCodeId || null,
        startsAt: fromInput(form.startsAt), endsAt: fromInput(form.endsAt),
      }
      if (pageId) {
        await apiWrite(`/api/site/landing/${pageId}`, { method: 'PATCH', body })
      } else {
        const r = await apiWrite<{ data: { id: string } }>('/api/site/landing', { method: 'POST', body })
        setPageId(r.data.id)
      }
      showSuccess(L('Page enregistrée', 'تم الحفظ'))
      onClose()
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  async function uploadBanner(file: File) {
    if (!pageId) { showError(L('Enregistrez la page une première fois avant d’ajouter la bannière', 'احفظ الصفحة أولاً')); return }
    setUploading(true)
    try {
      const r = await uploadResized(`/api/site/landing/${pageId}/banner`, file) as { url: string }
      setBanner(r.url)
      refreshPrefixes(['/api/site'])
    } catch (e) { showError((e as Error).message) } finally { setUploading(false) }
  }

  const example = 120
  const exPrice = form.discountType === 'PERCENTAGE' ? Math.round(example * (1 - Number(form.discountValue || 0) / 100))
    : form.discountType === 'FIXED_AMOUNT' ? Math.max(1, example - Number(form.discountValue || 0)) : example

  return (
    <Modal open onClose={onClose} size="xl" title={pageId ? L('Modifier la page promo', 'تعديل الصفحة') : L('Nouvelle page promo', 'صفحة جديدة')}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={L('Titre', 'العنوان')} required>
            <input className={inputClass} maxLength={90} value={form.title} placeholder="Coques -30 % cette semaine"
              onChange={e => set('title', e.target.value)} />
          </Field>
          <Field label={L('Adresse de la page', 'رابط الصفحة')} hint={`${SITE}/offres/${form.slug || '…'}`}>
            <input className={`${inputClass} font-mono`} maxLength={80} value={form.slug} placeholder="coques"
              onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} />
          </Field>
        </div>
        <Field label={L('Sous-titre', 'العنوان الفرعي')}>
          <input className={inputClass} maxLength={160} value={form.subtitle} placeholder="Protégez votre téléphone à petit prix"
            onChange={e => set('subtitle', e.target.value)} />
        </Field>
        <Field label={L('Texte (facultatif)', 'نص')}>
          <textarea className={inputClass} rows={3} maxLength={1500} value={form.body} onChange={e => set('body', e.target.value)} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={L('Couleurs', 'الألوان')}>
            <div className="flex gap-2">
              {THEMES.map(t => (
                <button key={t.key} type="button" onClick={() => set('theme', t.key)} title={t.label}
                  className={`flex-1 h-11 rounded-xl border-2 ${form.theme === t.key ? 'border-gold' : 'border-transparent'}`}
                  style={{ background: `linear-gradient(135deg, ${t.bg} 60%, ${t.accent} 60%)` }}>
                  <span className="sr-only">{t.label}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={L('Bannière', 'صورة الغلاف')}>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {banner && <img src={banner} alt="" className="h-11 w-20 object-cover rounded-lg border border-ez-border" />}
              <Btn variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="w-4 h-4" />{banner ? L('Changer', 'تغيير') : L('Ajouter', 'إضافة')}
              </Btn>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadBanner(f) }} />
            </div>
          </Field>
        </div>

        <div className="rounded-xl border border-ez-border p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ez-subtle">{L('Articles de l’offre', 'منتجات العرض')}</p>
          <Field label={L('Toute une catégorie', 'فئة كاملة')} hint={L('Tous ses articles en stock, y compris les futurs arrivages.', 'كل منتجاتها المتوفرة.')}>
            <select className={selectClass} value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
              <option value="">{L('— Aucune —', '— لا شيء —')}</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
            </select>
          </Field>
          <p className="text-xs text-ez-subtle">{L('Et / ou des articles choisis :', 'و / أو منتجات محددة :')}</p>
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-ez-placeholder" />
            <input className={`${inputClass} ps-9`} placeholder={L('Chercher un accessoire…', 'ابحث…')} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-ez-border border border-ez-border rounded-lg">
            {shown.map(p => {
              const on = form.productIds.includes(p.id)
              return (
                <label key={p.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-ez-bg">
                  <input type="checkbox" checked={on}
                    onChange={() => set('productIds', on ? form.productIds.filter(x => x !== p.id) : [...form.productIds, p.id])} />
                  <span className="flex-1 truncate">{p.name} <span className="text-xs text-ez-subtle">· {p.category.name}</span></span>
                  {!p.published && <Chip tone="amber">{L('masqué', 'مخفي')}</Chip>}
                  <span className="text-xs text-ez-subtle tabular-nums">{p.stock ?? 0} {L('en stock', 'متوفر')}</span>
                </label>
              )
            })}
          </div>
          <p className="text-xs text-ez-text">
            {L(`${liveCount} article(s) affiché(s) aujourd'hui.`, `${liveCount} منتج معروض.`)}
            {hiddenCount > 0 && <span className="text-amber-700"> {L(`${hiddenCount} masqué(s) : donnez-leur un nom public dans « Catalogue du site » pour qu'ils apparaissent.`, `${hiddenCount} مخفي.`)}</span>}
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label={L('Prix promo', 'سعر العرض')}>
            <select className={selectClass} value={form.discountType} onChange={e => set('discountType', e.target.value as typeof form.discountType)}>
              <option value="">{L('Prix normaux', 'أسعار عادية')}</option>
              <option value="PERCENTAGE">{L('Réduction en %', 'تخفيض %')}</option>
              <option value="FIXED_AMOUNT">{L('Réduction en DH', 'تخفيض بالدرهم')}</option>
            </select>
          </Field>
          <Field label={L('Valeur', 'القيمة')} hint={form.discountType ? L(`Ex. : 120 DH → ${exPrice} DH`, `مثال : 120 → ${exPrice}`) : undefined}>
            <input type="number" min={1} className={inputClass} disabled={!form.discountType} value={form.discountValue}
              onChange={e => set('discountValue', e.target.value)} />
          </Field>
          <Field label={L('Code promo affiché', 'رمز التخفيض')} hint={L('À créer dans « Promos & packs »', 'يُنشأ في العروض')}>
            <select className={selectClass} value={form.promoCodeId} onChange={e => set('promoCodeId', e.target.value)}>
              <option value="">{L('— Aucun —', '— لا شيء —')}</option>
              {(promosQ.data ?? []).map(c => <option key={c.id} value={c.id}>{c.code}{c.active ? '' : ` (${L('inactif', 'غير نشط')})`}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <Field label={L('Début', 'البداية')} hint={L('Vide = dès maintenant', 'فارغ = الآن')}>
            <input type="datetime-local" className={inputClass} value={form.startsAt} onChange={e => set('startsAt', e.target.value)} />
          </Field>
          <Field label={L('Fin', 'النهاية')} hint={L('Vide = sans fin (pas de compte à rebours)', 'فارغ = بدون نهاية')}>
            <input type="datetime-local" className={inputClass} value={form.endsAt} onChange={e => set('endsAt', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm pb-3">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />{L('Page active', 'الصفحة مفعلة')}
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ez-border">
          <Btn variant="ghost" onClick={onClose}>{L('Fermer', 'إغلاق')}</Btn>
          <Btn onClick={save} loading={saving}>{L('Enregistrer', 'حفظ')}</Btn>
        </div>
      </div>
    </Modal>
  )
}
