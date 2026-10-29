'use client'
import { useMemo, useRef, useState } from 'react'
import { Globe, RefreshCw, Search, ImagePlus, Trash2, Eye, EyeOff, Pencil, Plus, ImageOff, Gift } from 'lucide-react'
import { useApi, apiWrite, refreshPrefixes } from '@/lib/data/api'
import { Modal, Btn, PageHeader, EmptyState, SkeletonRow, Field, inputClass, selectClass, Select } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { uploadResized } from '@/lib/utils/image'
import { useSiteLang, Tabs, Chip, AVAILABILITY, GRADE, mad, categoryOptions } from './common'
import { confirmDialog } from '@/components/shared/ConfirmHost'
import { FacetsTab, FacetChecklist } from './SiteFacets'

interface Product {
  id: string; slug: string; name: string; brand: string | null; isPhone: boolean; source: 'ERP' | 'MANUAL'
  published: boolean; availability: string; condition: string; recommendedSalePrice: number
  description: string | null; metaTitle: string | null; metaDescription: string | null
  modelKey: string | null; categoryId: string; category: { name: string }
  images: string[]; stock: number | null; giftCount: number; facetIds: string[]
  colorName: string | null; colorGroup: string | null; facetImages: Record<string, string>
}
interface Category {
  id: string; name: string; slug: string; parentId: string | null; sortOrder: number; erpCode: string | null
  _count: { products: number; children: number }
}
interface Photo { modelKey: string; model: string; brand: string; color: string; units: number; unpriced: number; photoId: string | null; url: string | null }

type Tab = 'products' | 'photos' | 'categories' | 'fiches'
const MAX_PHOTOS = 8   // same limit as /api/site/catalog/[id]/images
type Kind = 'phones' | 'accessories' | 'hidden'

export default function SiteCatalogModule() {
  const { L, isAr, isManager } = useSiteLang()
  const [tab, setTab]         = useState<Tab>('products')
  const [syncing, setSyncing] = useState(false)
  const catalogQ = useApi<{ data: Product[]; categories: Category[] }, { data: Product[]; categories: Category[] }>('/api/site/catalog', { select: j => j })
  const products   = useMemo(() => catalogQ.data?.data ?? [], [catalogQ.data])
  const categories = useMemo(() => catalogQ.data?.categories ?? [], [catalogQ.data])

  async function syncNow() {
    setSyncing(true)
    try {
      const r = await apiWrite<{ created: number; updated: number; removed: number }>('/api/site/sync', { method: 'POST' })
      showSuccess(L(`Site à jour : ${r.created} ajout(s), ${r.updated} mise(s) à jour, ${r.removed} retrait(s)`, 'تم تحديث الموقع'))
    } catch (e) {
      showError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 space-y-4">
        <PageHeader
          title={L('Catalogue du site', 'كتالوج الموقع')}
          subtitle={L('Prix, stock et état viennent de l’ERP automatiquement. Ici : photos, textes et visibilité.',
                      'السعر والمخزون والحالة تأتي تلقائياً من النظام. هنا: الصور والنصوص والظهور.')}
          actions={isManager && (
            <Btn onClick={syncNow} loading={syncing}><RefreshCw className="w-4 h-4" />{L('Synchroniser', 'مزامنة')}</Btn>
          )}
        />
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { key: 'products',   label: L('Produits', 'المنتجات'), count: products.length },
          { key: 'photos',     label: L('Photos téléphones', 'صور الهواتف') },
          { key: 'categories', label: L('Catégories', 'الفئات'), count: categories.length },
          { key: 'fiches',     label: L('Fiches & filtres', 'البطاقات والفلاتر') },
        ]} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
        {catalogQ.error ? (
          <EmptyState icon={<Globe className="w-6 h-6" />} title={L('Site web indisponible', 'الموقع غير متاح')} description={catalogQ.error.message} />
        ) : catalogQ.isLoading ? (
          <div className="bg-white rounded-2xl border border-ez-border">{[0, 1, 2].map(i => <SkeletonRow key={i} />)}</div>
        ) : tab === 'products' ? (
          <ProductsTab products={products} categories={categories} isManager={isManager} />
        ) : tab === 'photos' ? (
          <PhotosTab isManager={isManager} />
        ) : tab === 'fiches' ? (
          <FacetsTab categories={categories} isManager={isManager} />
        ) : (
          <CategoriesTab categories={categories} isManager={isManager} />
        )}
      </div>
    </div>
  )
}

// ── Products ─────────────────────────────────────────────────────────────

function ProductsTab({ products, categories, isManager }: { products: Product[]; categories: Category[]; isManager: boolean }) {
  const { L, isAr } = useSiteLang()
  const [kind, setKind]     = useState<Kind>('phones')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)

  const visible = products.filter(p => p.availability !== 'DISCONTINUED' || !p.published)
  const inKind  = visible.filter(p => kind === 'phones' ? p.isPhone : kind === 'accessories' ? !p.isPhone : !p.published)

  // Category filter: a parent (e.g. Accessoires) includes its sub-categories.
  const inCategory = (p: Product, id: string) =>
    p.categoryId === id || categories.some(c => c.id === p.categoryId && c.parentId === id)
  // Only categories that have products in the current tab, with their count.
  const countIn = (id: string) => inKind.filter(p => inCategory(p, id)).length
  // Only categories that have products in this tab (a parent stays when any child does).
  const filterCategories = categories.filter(c => countIn(c.id) > 0)
  const shown = inKind.filter(p =>
    (!categoryId || inCategory(p, categoryId)) &&
    (search.trim().length < 2 || `${p.name} ${p.brand ?? ''} ${p.category.name}`.toLowerCase().includes(search.trim().toLowerCase())))

  async function togglePublished(p: Product) {
    try {
      await apiWrite(`/api/site/catalog/${p.id}`, { method: 'PATCH', body: { published: !p.published } })
      showSuccess(p.published ? L('Masqué du site', 'تم الإخفاء') : L('Visible sur le site', 'ظاهر في الموقع'))
    } catch (e) { showError((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs<Kind> value={kind} onChange={k => { setKind(k); setCategoryId('') }} tabs={[
          { key: 'phones',      label: L('Téléphones', 'الهواتف'), count: visible.filter(p => p.isPhone).length },
          { key: 'accessories', label: L('Accessoires', 'الإكسسوارات'), count: visible.filter(p => !p.isPhone).length },
          { key: 'hidden',      label: L('Masqués', 'مخفية'), count: visible.filter(p => !p.published).length },
        ]} />
        {filterCategories.length > 1 && (
          <div className="w-full sm:w-60">
            <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              aria-label={L('Catégorie', 'الفئة')} className={selectClass}>
              <option value="">{L('Toutes les catégories', 'كل الفئات')} ({inKind.length})</option>
              {categoryOptions(filterCategories, { count: countIn, allLabel: name => `Tout — ${name}` })}
            </Select>
          </div>
        )}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-ez-placeholder" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Rechercher…', 'بحث…')} className={`${inputClass} ps-9`} />
        </div>
        {(categoryId || search) && (
          <span className="text-xs text-ez-subtle">{shown.length} {L('résultat(s)', 'نتيجة')}</span>
        )}
      </div>
      {kind === 'accessories' && (
        <p className="text-xs text-ez-subtle">{L('Les accessoires arrivent masqués : donnez-leur un nom clair pour les clients (et une photo), puis rendez-les visibles.',
          'تصل الإكسسوارات مخفية: أعطها اسماً واضحاً للزبائن وصورة ثم اجعلها ظاهرة.')}</p>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={<Globe className="w-6 h-6" />} title={L('Aucun produit', 'لا توجد منتجات')} />
      ) : (
        <div className="bg-white border border-ez-border rounded-2xl divide-y divide-ez-border">
          {shown.map(p => {
            const av = AVAILABILITY[p.availability]
            return (
              <div key={p.id} className="flex items-center gap-3 p-3">
                <div className="w-12 h-12 rounded-lg bg-ez-bg flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.images[0] ? <img src={p.images[0]} alt="" className="w-full h-full object-contain" /> : <ImageOff className="w-4 h-4 text-ez-placeholder" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ez-text truncate">{p.name}</p>
                  <p className="text-xs text-ez-subtle truncate">
                    {p.category.name}{p.isPhone ? ` · ${GRADE[p.condition] ?? p.condition}` : ''}{p.source === 'MANUAL' ? ` · ${L('ancien produit du site', 'منتج قديم')}` : ''}
                  </p>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1">
                  <span className="text-sm font-bold">{p.isPhone ? `${L('dès', 'من')} ` : ''}{mad(p.recommendedSalePrice)}</span>
                  <span className="text-xs text-ez-subtle">{p.stock !== null ? `${p.stock} ${L('en stock', 'في المخزون')}` : ''}</span>
                </div>
                <Chip tone={av.tone}>{isAr ? av.ar : av.fr}</Chip>
                {p.isPhone && p.giftCount > 0 && <span title={L('Accessoires / cadeaux liés', 'إكسسوارات مرتبطة')}><Gift className="w-4 h-4 text-gold" /></span>}
                {isManager && (
                  <>
                    <button onClick={() => togglePublished(p)} title={p.published ? L('Masquer', 'إخفاء') : L('Rendre visible', 'إظهار')}
                      className={`p-2 rounded-lg ${p.published ? 'text-emerald-600 hover:bg-emerald-50' : 'text-ez-placeholder hover:bg-ez-muted'}`}>
                      {p.published ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditing(p)} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Pencil className="w-4 h-4" /></button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      {editing && (
        <ProductModal product={products.find(p => p.id === editing.id) ?? editing} categories={categories}
          accessories={products.filter(p => !p.isPhone)} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function ProductModal({ product, categories, accessories, onClose }: {
  product: Product; categories: Category[]; accessories: Product[]; onClose: () => void
}) {
  const { L } = useSiteLang()
  const nameEditable = !(product.isPhone && product.source === 'ERP')
  const [form, setForm] = useState({
    name: product.name, brand: product.brand ?? '', categoryId: product.categoryId,
    description: product.description ?? '', metaTitle: product.metaTitle ?? '', metaDescription: product.metaDescription ?? '',
    published: product.published, colorName: product.colorName ?? '',
  })
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        categoryId: form.categoryId, description: form.description, metaTitle: form.metaTitle,
        metaDescription: form.metaDescription, published: form.published,
      }
      if (nameEditable) { body.name = form.name; body.brand = form.brand }
      if (!product.isPhone && product.source !== 'ERP') body.colorName = form.colorName
      await apiWrite(`/api/site/catalog/${product.id}`, { method: 'PATCH', body })
      showSuccess(L('Enregistré', 'تم الحفظ'))
      onClose()
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  // Several photos at once, picked or dropped (owner, 2026-10-28). One after
  // the other, in the order chosen: the first one is the cover on the site.
  async function addPhotos(list: FileList | File[]) {
    const files = Array.from(list).filter(f => f.type.startsWith('image/'))
    if (!files.length) { showError(L('Choisissez des images', 'اختر صوراً')); return }
    const room = MAX_PHOTOS - product.images.length
    if (room <= 0) { showError(L(`${MAX_PHOTOS} photos maximum`, `${MAX_PHOTOS} صور كحد أقصى`)); return }
    const todo = files.slice(0, room)
    setUploading(true)
    let done = 0
    try {
      for (const f of todo) {
        setProgress(`${done + 1}/${todo.length}`)
        await uploadResized(`/api/site/catalog/${product.id}/images`, f)
        done++
      }
      showSuccess(done > 1 ? L(`${done} photos ajoutées`, `تمت إضافة ${done} صور`) : L('Photo ajoutée', 'تمت إضافة الصورة'))
      if (files.length > todo.length) showError(L(`${files.length - todo.length} photo(s) non ajoutée(s) : ${MAX_PHOTOS} maximum`, `${MAX_PHOTOS} صور كحد أقصى`))
    } catch (e) {
      showError(`${done ? L(`${done} ajoutée(s), puis : `, '') : ''}${(e as Error).message}`)
    } finally {
      refreshPrefixes(['/api/site'])
      setUploading(false); setProgress('')
    }
  }

  async function removePhoto(url: string) {
    if (!(await confirmDialog(L('Retirer cette photo ?', 'حذف هذه الصورة؟')))) return
    try {
      await apiWrite(`/api/site/catalog/${product.id}/images`, { method: 'DELETE', body: { url } })
    } catch (e) { showError((e as Error).message) }
  }

  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal open onClose={onClose} size="lg" title={product.name}>
      <div className="space-y-4">
        <p className="text-xs text-ez-subtle">
          {L('Prix', 'السعر')} : <b>{mad(product.recommendedSalePrice)}</b> · {L('stock et prix mis à jour automatiquement depuis l’ERP', 'يتم تحديث السعر والمخزون تلقائياً')}
          {' · '}<a href={`${process.env.NEXT_PUBLIC_STOREFRONT_URL ?? ''}/products/${product.slug}`} target="_blank" rel="noopener noreferrer" className="underline">{L('voir sur le site', 'عرض في الموقع')}</a>
        </p>
        {nameEditable && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={L('Nom affiché aux clients', 'الاسم المعروض')} required>
              <input value={form.name} onChange={e => set('name', e.target.value)} className={inputClass} maxLength={120} />
            </Field>
            <Field label={L('Marque', 'العلامة')}>
              <input value={form.brand} onChange={e => set('brand', e.target.value)} className={inputClass} maxLength={60} />
            </Field>
          </div>
        )}
        <Field label={L('Catégorie du site', 'فئة الموقع')}>
          <Select value={form.categoryId} onChange={e => set('categoryId', e.target.value)} className={selectClass}>
            {categoryOptions(categories, { allLabel: name => name })}
          </Select>
        </Field>
        <Field label={L('Description', 'الوصف')} hint={product.isPhone ? L('Commune à ce modèle/stockage/état.', '') : undefined}>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={4} className={inputClass} maxLength={3000} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={L('Titre Google (optionnel)', 'عنوان جوجل')}>
            <input value={form.metaTitle} onChange={e => set('metaTitle', e.target.value)} className={inputClass} maxLength={120} />
          </Field>
          <Field label={L('Description Google (optionnel)', 'وصف جوجل')}>
            <input value={form.metaDescription} onChange={e => set('metaDescription', e.target.value)} className={inputClass} maxLength={300} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.published} onChange={e => set('published', e.target.checked)} className="w-4 h-4" />
          {L('Visible sur le site', 'ظاهر في الموقع')}
        </label>

        {!product.isPhone && <ColorGroupEditor product={product} accessories={accessories} colorName={form.colorName} onColorName={v => set('colorName', v)} />}

        <FacetChecklist productId={product.id} categoryId={form.categoryId} categories={categories} ticked={product.facetIds}
          photos={product.isPhone ? undefined : product.facetImages} />

        {nameEditable ? (
          <div className="space-y-2"
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading && e.dataTransfer.files.length) addPhotos(e.dataTransfer.files) }}>
            <p className="text-xs uppercase tracking-widest text-ez-subtle font-medium">
              {L('Photos', 'الصور')} <span className="normal-case tracking-normal">· {product.images.length}/{MAX_PHOTOS} · {L('la 1re est la photo principale', 'الأولى هي الصورة الرئيسية')}</span>
            </p>
            <div className={`flex flex-wrap gap-2 rounded-xl p-2 -m-2 border-2 border-dashed transition-colors ${dragOver ? 'border-gold bg-gold/5' : 'border-transparent'}`}>
              {product.images.map((url, i) => (
                <div key={url} className="relative w-20 h-20 rounded-lg border border-ez-border overflow-hidden bg-ez-bg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-contain" />
                  {i === 0 && <span className="absolute bottom-0 inset-x-0 text-[9px] font-bold text-center bg-gold text-white">{L('Principale', 'رئيسية')}</span>}
                  <button onClick={() => removePhoto(url)} className="absolute top-1 end-1 p-1 rounded bg-white/90 text-red-600"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              {product.images.length < MAX_PHOTOS && (
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-ez-border flex flex-col items-center justify-center gap-0.5 text-ez-subtle hover:border-gold">
                  {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                  <span className="text-[10px] font-bold">{uploading ? progress : L('Ajouter', 'إضافة')}</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) addPhotos(files) }} />
            </div>
            <p className="text-xs text-ez-faint">{L('Choisissez plusieurs photos d’un coup, ou glissez-les ici. Sur le site, elles défilent en carrousel.', 'اختر عدة صور دفعة واحدة أو اسحبها هنا.')}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-ez-subtle">{L('Les photos des téléphones se gèrent par modèle et couleur dans l’onglet « Photos téléphones ».', 'صور الهواتف تدار حسب الطراز واللون في تبويب الصور.')}</p>
            <CompatEditor phone={product} accessories={accessories} />
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-ez-border">
          <Btn variant="ghost" onClick={onClose}>{L('Fermer', 'إغلاق')}</Btn>
          <Btn onClick={save} loading={saving}>{L('Enregistrer', 'حفظ')}</Btn>
        </div>
      </div>
    </Modal>
  )
}

/** Colours of one accessory model (owner, 2026-10-29): each colour is its own
 *  product with its own stock; linked ones show colour buttons on the site. */
function ColorGroupEditor({ product, accessories, colorName, onColorName }: {
  product: Product; accessories: Product[]; colorName: string; onColorName: (v: string) => void
}) {
  const { L } = useSiteLang()
  // From the ERP: colour and model come from Stock → Accessoires (shown only)
  if (product.source === 'ERP') {
    const others = product.colorGroup ? accessories.filter(a => a.colorGroup === product.colorGroup && a.id !== product.id) : []
    return (
      <div className="rounded-xl border border-ez-border p-4 space-y-2">
        <p className="text-sm font-semibold">{L('Couleur', 'اللون')} : {product.colorName ?? <span className="text-ez-subtle font-normal">{L('aucune', 'لا يوجد')}</span>}</p>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-ez-subtle self-center">{L('Autres couleurs :', 'ألوان أخرى:')}</span>
            {others.map(a => (
              <span key={a.id} title={a.name} className={`px-2.5 py-1 rounded-full text-xs border ${a.published ? 'border-ez-border' : 'border-dashed border-ez-border text-ez-subtle'}`}>
                {a.colorName || '?'}{!a.published && ` · ${L('masqué', 'مخفي')}`}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-ez-faint">{L('La couleur et les autres couleurs du modèle se règlent dans Stock → Accessoires (synchronisé).', 'يضبط اللون في المخزون ← الإكسسوارات.')}</p>
      </div>
    )
  }
  return <ColorGroupManual product={product} accessories={accessories} colorName={colorName} onColorName={onColorName} />
}

/** A hand-made (non-ERP) product: colour set here. */
function ColorGroupManual({ product, accessories, colorName, onColorName }: {
  product: Product; accessories: Product[]; colorName: string; onColorName: (v: string) => void
}) {
  const { L } = useSiteLang()
  const [search, setSearch] = useState('')
  const [busy, setBusy]     = useState(false)
  const siblings = product.colorGroup ? accessories.filter(a => a.colorGroup === product.colorGroup && a.id !== product.id) : []
  const q = search.trim().toLowerCase()
  const choices = q.length < 2 ? [] : accessories
    .filter(a => a.id !== product.id && (!product.colorGroup || a.colorGroup !== product.colorGroup)
      && `${a.name} ${a.brand ?? ''} ${a.colorName ?? ''}`.toLowerCase().includes(q))
    .slice(0, 8)

  async function link(colorWith: string | null) {
    setBusy(true)
    try {
      await apiWrite(`/api/site/catalog/${product.id}`, { method: 'PATCH', body: { colorWith } })
      showSuccess(colorWith ? L('Couleurs liées', 'تم الربط') : L('Retiré des couleurs du modèle', 'تمت الإزالة'))
      setSearch('')
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-ez-border p-4 space-y-3">
      <p className="text-sm font-semibold">{L('Couleur & autres couleurs du même modèle', 'اللون والألوان الأخرى')}</p>
      <Field label={L('Couleur de cet article (affichée au client)', 'لون هذا المنتج')} hint={L('Ex. : Rouge, Noir mat, Bleu nuit. Enregistrez en bas.', '')}>
        <input value={colorName} onChange={e => onColorName(e.target.value)} className={inputClass} maxLength={30} placeholder="Rouge" />
      </Field>
      {siblings.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-ez-subtle">{L('Sur le site, des boutons mènent vers ces couleurs :', 'في الموقع تظهر أزرار لهذه الألوان:')}</p>
          <div className="flex flex-wrap gap-1.5">
            {siblings.map(a => (
              <span key={a.id} className={`px-2.5 py-1 rounded-full text-xs border ${a.published ? 'border-ez-border' : 'border-dashed border-ez-border text-ez-subtle'}`}
                title={a.name}>
                {a.colorName || L('couleur ?', 'لون؟')}{!a.published && ` · ${L('masqué', 'مخفي')}`}
              </span>
            ))}
          </div>
          {siblings.some(a => !a.colorName) && <p className="text-xs text-amber-700">{L('Donnez une couleur à chaque article du groupe.', 'أعط لوناً لكل منتج.')}</p>}
          <Btn size="sm" variant="ghost" loading={busy} onClick={() => link(null)}>{L('Retirer cet article du groupe', 'إزالة من المجموعة')}</Btn>
        </div>
      ) : (
        <p className="text-xs text-ez-subtle">{L('Pas encore lié à d’autres couleurs.', 'غير مرتبط بألوان أخرى.')}</p>
      )}
      <div className="space-y-1.5">
        <input value={search} onChange={e => setSearch(e.target.value)} className={inputClass}
          placeholder={L('Même modèle dans une autre couleur : chercher l’accessoire…', 'ابحث عن نفس الطراز بلون آخر…')} />
        {choices.length > 0 && (
          <div className="border border-ez-border rounded-lg divide-y divide-ez-border">
            {choices.map(a => (
              <button key={a.id} type="button" disabled={busy} onClick={() => link(a.id)}
                className="w-full flex items-center gap-2 p-2 text-sm text-start hover:bg-ez-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.images[0] ? <img src={a.images[0]} alt="" className="w-8 h-8 rounded object-contain bg-ez-bg" /> : <ImageOff className="w-4 h-4 text-ez-placeholder" />}
                <span className="flex-1 truncate">{a.name}{a.colorName ? ` · ${a.colorName}` : ''}</span>
                <span className="text-xs font-bold text-gold">{L('Lier', 'ربط')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Accessories that fit this phone, and which ones are free-gift choices. */
function CompatEditor({ phone, accessories }: { phone: Product; accessories: Product[] }) {
  const { L } = useSiteLang()
  const q = useApi<{ productId: string; isGiftOption: boolean }[]>(`/api/site/catalog/${phone.id}/compat`)
  const [links, setLinks]   = useState<Record<string, boolean> | null>(null) // productId → isGift
  const [wholeModel, setWholeModel] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const current = links ?? Object.fromEntries((q.data ?? []).map(l => [l.productId, l.isGiftOption]))
  const choices = accessories
    .filter(a => a.published && (search.trim().length < 2 || a.name.toLowerCase().includes(search.trim().toLowerCase())))
    .slice(0, 40)

  const toggle = (id: string) => setLinks(() => {
    const next = { ...current }
    if (id in next) delete next[id]; else next[id] = false
    return next
  })
  const toggleGift = (id: string) => setLinks(() => ({ ...current, [id]: !current[id] }))

  async function save() {
    setSaving(true)
    try {
      await apiWrite(`/api/site/catalog/${phone.id}/compat`, {
        method: 'PUT',
        body: { wholeModel, links: Object.entries(current).map(([productId, isGiftOption]) => ({ productId, isGiftOption })) },
      })
      showSuccess(L('Accessoires enregistrés', 'تم الحفظ'))
      setLinks(null)
      q.refresh()
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border border-ez-border p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2"><Gift className="w-4 h-4 text-gold" />{L('Accessoires compatibles & cadeaux offerts', 'الإكسسوارات المتوافقة والهدايا')}</p>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Chercher un accessoire visible…', 'ابحث عن إكسسوار…')} className={inputClass} />
      <div className="max-h-60 overflow-y-auto divide-y divide-ez-border border border-ez-border rounded-lg">
        {choices.length === 0 && <p className="p-3 text-xs text-ez-subtle">{L('Aucun accessoire visible sur le site.', 'لا توجد إكسسوارات ظاهرة.')}</p>}
        {choices.map(a => (
          <div key={a.id} className="flex items-center gap-2 p-2 text-sm">
            <input type="checkbox" checked={a.id in current} onChange={() => toggle(a.id)} className="w-4 h-4" />
            <span className="flex-1 truncate">{a.name} <span className="text-ez-subtle text-xs">· {a.category.name}</span></span>
            {a.id in current && (
              <label className="flex items-center gap-1 text-xs text-ez-subtle">
                <input type="checkbox" checked={current[a.id]} onChange={() => toggleGift(a.id)} />{L('cadeau', 'هدية')}
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-ez-subtle">
          <input type="checkbox" checked={wholeModel} onChange={e => setWholeModel(e.target.checked)} />
          {L('Appliquer à toutes les versions de ce modèle', 'تطبيق على كل نسخ هذا الطراز')}
        </label>
        <Btn size="sm" onClick={save} loading={saving} disabled={links === null}>{L('Enregistrer les accessoires', 'حفظ')}</Btn>
      </div>
    </div>
  )
}

// ── Model photos ─────────────────────────────────────────────────────────

function PhotosTab({ isManager }: { isManager: boolean }) {
  const { L } = useSiteLang()
  const q = useApi<Photo[]>('/api/site/photos')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const target  = useRef<Photo | null>(null)

  async function upload(file: File) {
    const p = target.current
    if (!p) return
    setBusy(`${p.modelKey}|${p.color}`)
    try {
      await uploadResized('/api/site/photos', file, { modelKey: p.modelKey, color: p.color })
      refreshPrefixes(['/api/site'])
      showSuccess(L('Photo enregistrée — le site se met à jour', 'تم حفظ الصورة'))
    } catch (e) { showError((e as Error).message) } finally { setBusy(null) }
  }

  async function remove(p: Photo) {
    if (!p.photoId || !(await confirmDialog(L('Retirer cette photo ?', 'حذف هذه الصورة؟')))) return
    try { await apiWrite('/api/site/photos', { method: 'DELETE', body: { id: p.photoId } }) } catch (e) { showError((e as Error).message) }
  }

  if (q.isLoading) return <div className="bg-white rounded-2xl border border-ez-border">{[0, 1].map(i => <SkeletonRow key={i} />)}</div>
  const photos  = q.data ?? []
  const missing = photos.filter(p => !p.url).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-ez-subtle">
        {L('Une photo par modèle et couleur suffit : elle s’affiche pour chaque téléphone de ce modèle et couleur, quel que soit le stockage ou l’état.',
           'صورة واحدة لكل طراز ولون تكفي لكل الهواتف من نفس الطراز واللون.')}
        {missing > 0 && <b className="text-amber-700"> {missing} {L('sans photo.', 'بدون صورة.')}</b>}
      </p>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {photos.map(p => {
          const key = `${p.modelKey}|${p.color}`
          return (
            <div key={key} className={`bg-white border rounded-2xl p-3 space-y-2 ${p.url ? 'border-ez-border' : 'border-amber-300'}`}>
              <div className="aspect-square rounded-xl bg-ez-bg overflow-hidden flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url ? <img src={p.url} alt="" className="w-full h-full object-contain" /> : <ImageOff className="w-6 h-6 text-ez-placeholder" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-ez-text truncate">{p.model}</p>
                <p className="text-xs text-ez-subtle truncate">{p.color}{p.units > 0 && <> · {p.units} {L('en stock', 'في المخزون')}</>}</p>
                {p.unpriced > 0 && <p className="text-[11px] font-bold text-amber-700 truncate">{p.unpriced} {L('sans prix : pas encore sur le site', 'بدون ثمن')}</p>}
              </div>
              {isManager && (
                <div className="flex gap-1">
                  <Btn size="sm" variant={p.url ? 'secondary' : 'primary'} className="flex-1" loading={busy === key}
                    onClick={() => { target.current = p; fileRef.current?.click() }}>
                    <ImagePlus className="w-3.5 h-3.5" />{p.url ? L('Changer', 'تغيير') : L('Ajouter', 'إضافة')}
                  </Btn>
                  {p.url && <Btn size="sm" variant="danger" onClick={() => remove(p)}><Trash2 className="w-3.5 h-3.5" /></Btn>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
    </div>
  )
}

// ── Categories ───────────────────────────────────────────────────────────

function CategoriesTab({ categories, isManager }: { categories: Category[]; isManager: boolean }) {
  const { L } = useSiteLang()
  const [editing, setEditing] = useState<Partial<Category> | null>(null)
  const [saving, setSaving]   = useState(false)
  const parents = categories.filter(c => !c.parentId)

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await apiWrite('/api/site/categories', {
        method: editing.id ? 'PATCH' : 'POST',
        body: { id: editing.id, name: editing.name, parentId: editing.parentId ?? null, sortOrder: editing.sortOrder ?? 0 },
      })
      showSuccess(L('Catégorie enregistrée', 'تم الحفظ'))
      setEditing(null)
    } catch (e) { showError((e as Error).message) } finally { setSaving(false) }
  }

  async function remove(c: Category) {
    if (!(await confirmDialog(L(`Supprimer « ${c.name} » ?`, `حذف « ${c.name} »؟`)))) return
    try { await apiWrite('/api/site/categories', { method: 'DELETE', body: { id: c.id } }) } catch (e) { showError((e as Error).message) }
  }

  const rows = parents.flatMap(p => [p, ...categories.filter(c => c.parentId === p.id)])

  return (
    <div className="space-y-3">
      {isManager && <Btn onClick={() => setEditing({ name: '', parentId: null, sortOrder: 0 })}><Plus className="w-4 h-4" />{L('Nouvelle catégorie', 'فئة جديدة')}</Btn>}
      <div className="bg-white border border-ez-border rounded-2xl divide-y divide-ez-border">
        {rows.map(c => (
          <div key={c.id} className={`flex items-center gap-3 p-3 ${c.parentId ? 'ps-10' : ''}`}>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${c.parentId ? '' : 'font-semibold'} text-ez-text`}>{c.name}</p>
              <p className="text-xs text-ez-subtle">/{c.slug} · {c._count.products} {L('produit(s)', 'منتج')}{c.erpCode ? ` · ${L('liée à l’ERP', 'مرتبطة بالنظام')} (${c.erpCode})` : ''}</p>
            </div>
            <span className="text-xs text-ez-subtle">#{c.sortOrder}</span>
            {isManager && (
              <>
                <button onClick={() => setEditing(c)} className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(c)} className="p-2 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              </>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm" title={editing.id ? L('Modifier la catégorie', 'تعديل الفئة') : L('Nouvelle catégorie', 'فئة جديدة')}>
          <div className="space-y-3">
            <Field label={L('Nom', 'الاسم')} required>
              <input value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className={inputClass} maxLength={60} />
            </Field>
            <Field label={L('Dans', 'ضمن')}>
              <Select value={editing.parentId ?? ''} onChange={e => setEditing({ ...editing, parentId: e.target.value || null })} className={selectClass}>
                <option value="">{L('— Menu principal —', '— القائمة الرئيسية —')}</option>
                {parents.filter(p => p.id !== editing.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={L('Ordre d’affichage', 'الترتيب')}>
              <input type="number" value={editing.sortOrder ?? 0} onChange={e => setEditing({ ...editing, sortOrder: Number(e.target.value) })} className={inputClass} />
            </Field>
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
