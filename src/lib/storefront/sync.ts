import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@/generated/storefront/client'
import { storefrontDb, storefrontConfigured } from './db'
import { revalidateStorefront } from './revalidate'
import {
  PHONE_SAFE_SELECT, ACCESSORY_SAFE_SELECT, buildPhoneListings, buildAccessoryListings,
  refOf, slugify, type PhoneListing, type AccessoryListing, type ErpPhone, type ErpAccessory,
} from './listing'

// ─────────────────────────────────────────────────────────────────────────
// Keeps the website's catalogue equal to the ERP's sellable stock.
// Idempotent full reconcile: safe to run any time, as often as needed —
// after every stock-changing write (see withNotify), once a day by cron, and
// from the "Synchroniser" button.
//
// Built to need only a handful of database round trips: everything is read
// up front, compared in memory, and written back in bulk (only what
// differs), inside one transaction guarded by an advisory lock.
//
// The sync owns: price, stock, availability, condition, variants and (for
// phones) name and photos. Staff own, from "Site web → Catalogue": name /
// category of accessories, descriptions, published flag and model photos.
// ─────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  phones: number
  accessories: number
  created: number
  updated: number
  removed: number
  ms: number
}

const PHONE_CATEGORY_CODE = 'telephone'
/** ERP accessory categories never published on the website. */
const NOT_ON_WEBSITE = ['service']
const LOCK_KEY = 7_345_001 // pg advisory lock: one sync at a time

/** The ERP rows that may appear on the site: sellable, priced, active store, not damaged. */
export async function readErpStock(): Promise<{ phones: ErpPhone[]; accessories: ErpAccessory[] }> {
  const activeStores = { OR: [{ store_id: null }, { stores: { is_active: true } }] }
  const [phones, accessories] = await Promise.all([
    prisma.phones.findMany({
      where: {
        status:                'disponible',
        is_deleted:            false,
        NOT:                   { is_damaged: true },
        prix_vente_recommande: { not: null },
        condition:             { in: ['neuf', 'occasion'] },
        ...activeStores,
      },
      select: PHONE_SAFE_SELECT,
    }),
    prisma.accessories.findMany({
      // Services (flash, unlocking…) aren't goods to ship: the website's
      // Réparation pages cover them. (Owner's decision, 2026-09-24.)
      where:  { is_deleted: false, category: { type: 'accessoire' }, categorie: { notIn: NOT_ON_WEBSITE }, ...activeStores },
      select: ACCESSORY_SAFE_SELECT,
    }),
  ])
  return { phones: phones as unknown as ErpPhone[], accessories: accessories as unknown as ErpAccessory[] }
}

type Tx = Parameters<Parameters<ReturnType<typeof storefrontDb>['$transaction']>[0]>[0]

// Order-insensitive comparison (Postgres jsonb doesn't keep key order).
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as Record<string, unknown>)[k])]))
  }
  return v
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
/** True when any field of `want` differs from `cur`. */
const differs = (cur: Record<string, unknown>, want: Record<string, unknown>) =>
  Object.keys(want).some(k => !same(cur[k] ?? null, want[k] ?? null))
const num   = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()))
const newId = () => `c${randomUUID().replace(/-/g, '').slice(0, 24)}`

async function reconcile(tx: Tx, phones: PhoneListing[], accessories: AccessoryListing[], labels: Map<string, string>, stats: SyncResult) {
  // ── Read everything once ───────────────────────────────────────────────
  const products = await tx.product.findMany({
    select: {
      id: true, slug: true, source: true, erpKey: true, modelKey: true, isPhone: true, name: true, condition: true,
      brand: true, recommendedSalePrice: true, compareAtPrice: true, availability: true, tags: true, specs: true,
    },
  })
  const categories = await tx.category.findMany({ select: { id: true, slug: true, erpCode: true } })
  const photos     = await tx.modelPhoto.findMany({ select: { modelKey: true, color: true, url: true } })
  const variants   = await tx.productVariant.findMany({
    where:  { product: { source: 'ERP', isPhone: true } },
    select: {
      id: true, productId: true, erpRef: true, name: true, color: true, storageLabel: true, priceOverride: true,
      compareAtPrice: true, stockQuantity: true, imageUrl: true, batteryHealthPercent: true, screenGenuine: true, batteryGenuine: true,
      cameraGenuine: true, chargingPortGenuine: true, speakerGenuine: true, hasDefects: true, transparencyNotes: true,
    },
  })
  const images    = await tx.productImage.findMany({
    where:   { product: { source: 'ERP', isPhone: true } },
    select:  { productId: true, url: true },
    orderBy: { sortOrder: 'asc' },
  })
  const internals = await tx.productInternal.findMany({
    where:  { product: { source: 'ERP', isPhone: false } },
    select: { productId: true, stockQuantity: true },
  })
  const compat    = await tx.productCompatibility.findMany({
    where:  { compatibleWith: { source: 'ERP', isPhone: true } },
    select: { productId: true, compatibleWithId: true, isGiftOption: true },
  })

  const byKey     = new Map(products.filter(p => p.erpKey).map(p => [p.erpKey!, p]))
  const slugs     = new Set(products.map(p => p.slug))
  const claimSlug = (base: string) => {
    let slug = base
    for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`
    slugs.add(slug)
    return slug
  }

  // ── Categories (rarely more than a create or two) ──────────────────────
  const categoryFor = new Map(categories.filter(c => c.erpCode).map(c => [c.erpCode!, c.id]))
  async function ensureCategory(code: string): Promise<string> {
    const known = categoryFor.get(code)
    if (known) return known
    let id: string
    const phonesCat = categories.find(c => c.slug === 'telephones' && !c.erpCode)
    if (code === PHONE_CATEGORY_CODE && phonesCat) {
      // Adopt the site's existing "Téléphones" category.
      await tx.category.update({ where: { id: phonesCat.id }, data: { erpCode: code } })
      id = phonesCat.id
    } else {
      const parent = code === PHONE_CATEGORY_CODE ? null : categories.find(c => c.slug === 'accessoires')?.id ?? null
      const name   = code === PHONE_CATEGORY_CODE ? 'Téléphones' : labels.get(code) ?? code
      let slug     = slugify(name)
      if (categories.some(c => c.slug === slug)) slug = `${slug}-${code.replace(/_/g, '-')}`
      const created = await tx.category.create({ data: { name, slug, erpCode: code, parentId: parent, sortOrder: 100 } })
      categories.push({ id: created.id, slug, erpCode: code })
      id = created.id
    }
    categoryFor.set(code, id)
    return id
  }

  const photoFor = (model: string, color: string | null) =>
    color ? photos.find(p => p.modelKey === model && p.color.toLowerCase() === color.toLowerCase())?.url ?? null : null

  // ── Plan the writes ────────────────────────────────────────────────────
  const productCreates: Prisma.ProductCreateManyInput[] = []
  const productUpdates: { id: string; data: Record<string, unknown> }[] = []
  const variantCreates: Record<string, unknown>[] = []
  const variantUpdates: { id: string; data: Record<string, unknown> }[] = []
  const variantDeletes: string[] = []
  const imageResets: string[] = []
  const imageCreates: { productId: string; url: string; sortOrder: number; altText: string }[] = []
  const internalCreates: { productId: string; stockQuantity: number }[] = []
  const internalUpdates: { productId: string; stockQuantity: number }[] = []
  const compatCreates: { productId: string; compatibleWithId: string; isGiftOption: boolean }[] = []

  const variantByRef = new Map(variants.filter(v => v.erpRef).map(v => [v.erpRef!, v]))
  const keptVariants = new Set<string>()

  // Phones
  const phoneCategory = phones.length ? await ensureCategory(PHONE_CATEGORY_CODE) : ''
  const wanted = new Set<string>()
  for (const l of phones) {
    wanted.add(l.erpKey)
    const core = {
      name: l.name, modelKey: l.modelKey, brand: l.brand, condition: l.grade, recommendedSalePrice: l.price,
      compareAtPrice: l.compareAtPrice, availability: 'IN_STOCK' as const, tags: l.tags, specs: l.specs,
    }
    let product = byKey.get(l.erpKey)
    let productId: string
    if (!product) {
      productId = newId()
      productCreates.push({
        id: productId, ...core, isPhone: true, slug: claimSlug(l.slugBase),
        categoryId: phoneCategory, source: 'ERP', erpKey: l.erpKey, published: true,
      })
      stats.created++
      // A new storage/grade of a known model inherits its accessories and gifts.
      const sibling = products.find(p => p.modelKey === l.modelKey && p.isPhone && compat.some(c => c.compatibleWithId === p.id))
      if (sibling) {
        for (const c of compat.filter(c => c.compatibleWithId === sibling.id)) {
          compatCreates.push({ productId: c.productId, compatibleWithId: productId, isGiftOption: c.isGiftOption })
        }
      }
      product = undefined
    } else {
      productId = product.id
      if (differs({ ...product, recommendedSalePrice: num(product.recommendedSalePrice), compareAtPrice: num(product.compareAtPrice) }, core)) {
        productUpdates.push({ id: productId, data: core }) // category only set on creation: staff may move it
        stats.updated++
      }
    }

    for (const v of l.variants) {
      const data = {
        name: v.name, color: v.color, storageLabel: v.storageLabel, priceOverride: v.price, compareAtPrice: v.compareAtPrice,
        stockQuantity: v.stockQuantity,
        imageUrl: photoFor(l.modelKey, v.photoColor), batteryHealthPercent: v.batteryHealthPercent,
        screenGenuine: v.screenGenuine, batteryGenuine: v.batteryGenuine, cameraGenuine: v.cameraGenuine,
        chargingPortGenuine: v.chargingPortGenuine, speakerGenuine: v.speakerGenuine,
        hasDefects: v.hasDefects, transparencyNotes: v.transparencyNotes,
      }
      const had = variantByRef.get(v.erpRef)
      if (!had) {
        variantCreates.push({ id: newId(), productId, erpRef: v.erpRef, ...data })
      } else {
        keptVariants.add(had.id)
        // A unit can move between groups (e.g. a part got replaced): move it.
        if (had.productId !== productId || differs({ ...had, priceOverride: num(had.priceOverride), compareAtPrice: num(had.compareAtPrice) }, data)) {
          variantUpdates.push({ id: had.id, data: { ...data, productId } })
        }
      }
    }

    // Gallery: the model's photos, colours in stock first.
    const gallery = [
      ...l.colors.map(c => photoFor(l.modelKey, c)),
      ...photos.filter(p => p.modelKey === l.modelKey).map(p => p.url),
    ].filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
    const current = product ? images.filter(i => i.productId === productId).map(i => i.url) : []
    if (!same(current, gallery)) {
      if (product) imageResets.push(productId)
      gallery.forEach((url, sortOrder) => imageCreates.push({ productId, url, sortOrder, altText: l.name }))
    }
  }
  for (const v of variants) if (!keptVariants.has(v.id)) variantDeletes.push(v.id)

  // Sold-out groups: hidden (DISCONTINUED) but kept, so photos / texts come
  // back by themselves when the same model is in stock again.
  for (const p of products) {
    if (p.source !== 'ERP' || !p.isPhone || wanted.has(p.erpKey ?? '') || p.availability === 'DISCONTINUED') continue
    productUpdates.push({ id: p.id, data: { availability: 'DISCONTINUED' } })
    stats.removed++
  }

  // Accessories
  const wantedAcc = new Set<string>()
  const stockOf   = new Map(internals.map(i => [i.productId, i.stockQuantity]))
  for (const l of accessories) {
    wantedAcc.add(l.erpKey)
    const availability = l.price !== null && l.stock > 0 ? 'IN_STOCK' as const : 'OUT_OF_STOCK' as const
    const price        = l.price ?? 0
    const product      = byKey.get(l.erpKey)
    if (!product) {
      const id = newId()
      // Hidden until staff give it a public name (and ideally a photo).
      productCreates.push({
        id, slug: claimSlug(l.slugBase), name: l.name, brand: l.brand, condition: 'NEUF', isPhone: false,
        recommendedSalePrice: price, availability, categoryId: await ensureCategory(l.categoryCode),
        source: 'ERP', erpKey: l.erpKey, published: false,
      })
      internalCreates.push({ productId: id, stockQuantity: l.stock })
      stats.created++
      continue
    }
    if (num(product.recommendedSalePrice) !== price || product.availability !== availability) {
      productUpdates.push({ id: product.id, data: { recommendedSalePrice: price, availability } })
      stats.updated++
    }
    if (!stockOf.has(product.id)) internalCreates.push({ productId: product.id, stockQuantity: l.stock })
    else if (stockOf.get(product.id) !== l.stock) internalUpdates.push({ productId: product.id, stockQuantity: l.stock })
  }
  for (const p of products) {
    if (p.source !== 'ERP' || p.isPhone || wantedAcc.has(p.erpKey ?? '') || p.availability === 'DISCONTINUED') continue
    productUpdates.push({ id: p.id, data: { availability: 'DISCONTINUED' } })
    if ((stockOf.get(p.id) ?? 0) !== 0) internalUpdates.push({ productId: p.id, stockQuantity: 0 })
    stats.removed++
  }

  // ── Write (bulk where possible) ────────────────────────────────────────
  if (productCreates.length)  await tx.product.createMany({ data: productCreates })
  if (variantDeletes.length)  await tx.productVariant.deleteMany({ where: { id: { in: variantDeletes } } })
  for (const u of variantUpdates) await tx.productVariant.update({ where: { id: u.id }, data: u.data })
  if (variantCreates.length)  await tx.productVariant.createMany({ data: variantCreates as never })
  for (const u of productUpdates) await tx.product.update({ where: { id: u.id }, data: u.data })
  if (imageResets.length)     await tx.productImage.deleteMany({ where: { productId: { in: imageResets } } })
  if (imageCreates.length)    await tx.productImage.createMany({ data: imageCreates })
  if (internalCreates.length) await tx.productInternal.createMany({ data: internalCreates, skipDuplicates: true })
  for (const u of internalUpdates) {
    await tx.productInternal.update({ where: { productId: u.productId }, data: { stockQuantity: u.stockQuantity } })
  }
  if (compatCreates.length)   await tx.productCompatibility.createMany({ data: compatCreates, skipDuplicates: true })
}

export async function syncStorefront(): Promise<SyncResult> {
  const started = Date.now()
  const stats: SyncResult = { phones: 0, accessories: 0, created: 0, updated: 0, removed: 0, ms: 0 }

  const [{ phones: stock, accessories }, categories, held] = await Promise.all([
    readErpStock(),
    prisma.categories.findMany({ where: { type: 'accessoire' }, select: { code: true, label_fr: true } }),
    // Units of confirmed web orders stay off the site even when staff put
    // them back to "disponible" to ring them up at the till.
    storefrontDb().orderRequestItem.findMany({
      where:  { orderRequest: { status: 'CONFIRMED' }, unitRef: { not: null } },
      select: { unitRef: true },
    }),
  ])
  const heldRefs = new Set(held.flatMap(h => h.unitRef!.split(',')))
  const phones   = stock.filter(p => !heldRefs.has(refOf('tel-unit', p.phone_id)))
  stats.phones      = phones.length
  stats.accessories = accessories.length

  await storefrontDb().$transaction(async tx => {
    await tx.$executeRaw`select pg_advisory_xact_lock(${LOCK_KEY})`
    await reconcile(tx, buildPhoneListings(phones), buildAccessoryListings(accessories),
      new Map(categories.map(c => [c.code, c.label_fr])), stats)
  }, { timeout: 60_000, maxWait: 20_000 })

  stats.ms = Date.now() - started
  if (stats.created || stats.updated || stats.removed) await revalidateStorefront()
  return stats
}

/** Fire-and-forget variant for write hooks: never throws, never blocks the caller's result. */
export async function syncStorefrontQuietly(reason: string): Promise<void> {
  if (!storefrontConfigured()) return
  try {
    const r = await syncStorefront()
    if (r.created || r.updated || r.removed) console.log(`[storefront-sync] ${reason}`, r)
  } catch (err) {
    console.error(`[storefront-sync] ${reason} failed:`, err)
  }
}
