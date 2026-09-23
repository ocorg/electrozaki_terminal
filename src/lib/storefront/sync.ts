import { prisma } from '@/lib/db'
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
// from the "Synchroniser" button. Only differences are written.
//
// The sync owns: price, stock, availability, condition, variants and (for
// phones) photos. Staff own, from "Site web → Catalogue": name/category of
// accessories, descriptions, published flag and model photos.
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
      where:  { is_deleted: false, category: { type: 'accessoire' }, ...activeStores },
      select: ACCESSORY_SAFE_SELECT,
    }),
  ])
  return { phones: phones as unknown as ErpPhone[], accessories: accessories as unknown as ErpAccessory[] }
}

type Tx = Parameters<Parameters<ReturnType<typeof storefrontDb>['$transaction']>[0]>[0]

async function uniqueSlug(tx: Tx, base: string, erpKey: string): Promise<string> {
  for (let n = 1; ; n++) {
    const slug  = n === 1 ? base : `${base}-${n}`
    const taken = await tx.product.findUnique({ where: { slug }, select: { erpKey: true } })
    if (!taken || taken.erpKey === erpKey) return slug
  }
}

async function ensureCategory(tx: Tx, code: string, labels: Map<string, string>): Promise<string> {
  const existing = await tx.category.findUnique({ where: { erpCode: code }, select: { id: true } })
  if (existing) return existing.id

  if (code === PHONE_CATEGORY_CODE) {
    // Adopt the site's existing "Téléphones" category when there is one.
    const phones = await tx.category.findUnique({ where: { slug: 'telephones' } })
    if (phones && !phones.erpCode) {
      await tx.category.update({ where: { id: phones.id }, data: { erpCode: code } })
      return phones.id
    }
    const created = await tx.category.create({ data: { name: 'Téléphones', slug: `telephones-${Date.now()}`, erpCode: code } })
    return created.id
  }

  // A new ERP accessory category: file it under "Accessoires".
  const parent = await tx.category.findUnique({ where: { slug: 'accessoires' }, select: { id: true } })
  const name   = labels.get(code) ?? code
  let slug     = slugify(name)
  if (await tx.category.findUnique({ where: { slug } })) slug = `${slug}-${code.replace(/_/g, '-')}`
  const created = await tx.category.create({
    data: { name, slug, erpCode: code, parentId: parent?.id ?? null, sortOrder: 100 },
  })
  return created.id
}

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
const num  = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()))

async function syncPhones(tx: Tx, listings: PhoneListing[], stats: SyncResult) {
  const categoryId = await ensureCategory(tx, PHONE_CATEGORY_CODE, new Map())
  const photos     = await tx.modelPhoto.findMany({ select: { modelKey: true, color: true, url: true } })
  const photoFor   = (model: string, color: string | null) =>
    color ? photos.find(p => p.modelKey === model && p.color.toLowerCase() === color.toLowerCase())?.url ?? null : null

  const existing = await tx.product.findMany({
    where:  { source: 'ERP', isPhone: true },
    select: {
      id: true, erpKey: true, modelKey: true, name: true, condition: true, brand: true, recommendedSalePrice: true,
      availability: true, tags: true, specs: true, categoryId: true,
      images:   { select: { id: true, url: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
      variants: { select: {
        id: true, erpRef: true, name: true, color: true, storageLabel: true, priceOverride: true, stockQuantity: true, imageUrl: true,
        batteryHealthPercent: true, screenGenuine: true, batteryGenuine: true, cameraGenuine: true,
        chargingPortGenuine: true, speakerGenuine: true, hasDefects: true, transparencyNotes: true,
      } },
    },
  })
  const byKey = new Map(existing.map(p => [p.erpKey, p]))
  const wanted = new Set(listings.map(l => l.erpKey))

  for (const l of listings) {
    const core = {
      name:                 l.name,
      modelKey:             l.modelKey,
      brand:                l.brand,
      condition:            l.grade,
      isPhone:              true,
      recommendedSalePrice: l.price,
      compareAtPrice:       null,
      availability:         'IN_STOCK' as const,
      tags:                 l.tags,
      specs:                l.specs,
      categoryId,
    }
    let product = byKey.get(l.erpKey)
    if (!product) {
      const created = await tx.product.create({
        data:   { ...core, slug: await uniqueSlug(tx, l.slugBase, l.erpKey), source: 'ERP', erpKey: l.erpKey, published: true },
        select: { id: true },
      })
      stats.created++
      // A new storage/grade of a known model inherits its accessories and gifts.
      const sibling = await tx.product.findFirst({
        where:  { modelKey: l.modelKey, isPhone: true, id: { not: created.id }, compatibleAccessories: { some: {} } },
        select: { compatibleAccessories: { select: { productId: true, isGiftOption: true } } },
      })
      if (sibling) {
        await tx.productCompatibility.createMany({
          data: sibling.compatibleAccessories.map(c => ({ ...c, compatibleWithId: created.id })),
          skipDuplicates: true,
        })
      }
      product = { ...created, erpKey: l.erpKey, modelKey: l.modelKey, name: '', condition: l.grade, brand: null, recommendedSalePrice: null as never,
        availability: 'IN_STOCK', tags: [], specs: null, categoryId, images: [], variants: [] }
    } else if (
      product.name !== core.name || product.modelKey !== core.modelKey || product.condition !== core.condition || product.brand !== core.brand ||
      num(product.recommendedSalePrice) !== core.recommendedSalePrice || product.availability !== core.availability ||
      !same(product.tags, core.tags) || !same(product.specs, core.specs)
    ) {
      // categoryId is only set on creation: staff may move a product.
      const { categoryId: _c, ...update } = core
      void _c
      await tx.product.update({ where: { id: product.id }, data: update })
      stats.updated++
    }

    // Variants
    const current = new Map(product.variants.map(v => [v.erpRef, v]))
    for (const v of l.variants) {
      const data = {
        name:                 v.name,
        color:                v.color,
        storageLabel:         v.storageLabel,
        priceOverride:        v.price,
        stockQuantity:        v.stockQuantity,
        imageUrl:             photoFor(l.modelKey, v.photoColor),
        batteryHealthPercent: v.batteryHealthPercent,
        screenGenuine:        v.screenGenuine,
        batteryGenuine:       v.batteryGenuine,
        cameraGenuine:        v.cameraGenuine,
        chargingPortGenuine:  v.chargingPortGenuine,
        speakerGenuine:       v.speakerGenuine,
        hasDefects:           v.hasDefects,
        transparencyNotes:    v.transparencyNotes,
      }
      const had = current.get(v.erpRef)
      if (!had) {
        // A unit can move between groups (e.g. a part gets replaced): take it over.
        await tx.productVariant.deleteMany({ where: { erpRef: v.erpRef } })
        await tx.productVariant.create({ data: { ...data, productId: product.id, erpRef: v.erpRef } })
      } else {
        if (differs({ ...had, priceOverride: num(had.priceOverride) }, data)) {
          await tx.productVariant.update({ where: { id: had.id }, data })
        }
      }
    }
    const stale = product.variants.filter(v => !l.variants.some(w => w.erpRef === v.erpRef))
    if (stale.length) await tx.productVariant.deleteMany({ where: { id: { in: stale.map(v => v.id) } } })

    // Gallery: the model's photos, colours in stock first.
    const gallery = [
      ...l.colors.map(c => photoFor(l.modelKey, c)),
      ...photos.filter(p => p.modelKey === l.modelKey).map(p => p.url),
    ].filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
    if (!same(product.images.map(i => i.url), gallery)) {
      await tx.productImage.deleteMany({ where: { productId: product.id } })
      if (gallery.length) {
        await tx.productImage.createMany({
          data: gallery.map((url, sortOrder) => ({ productId: product!.id, url, sortOrder, altText: l.name })),
        })
      }
    }
  }

  // Sold out groups: hidden (DISCONTINUED) but kept, so photos/descriptions
  // come back by themselves when the same model is in stock again.
  for (const p of existing) {
    if (wanted.has(p.erpKey ?? '') || (p.availability === 'DISCONTINUED' && p.variants.length === 0)) continue
    await tx.productVariant.deleteMany({ where: { productId: p.id } })
    await tx.product.update({ where: { id: p.id }, data: { availability: 'DISCONTINUED' } })
    stats.removed++
  }
}

async function syncAccessories(tx: Tx, listings: AccessoryListing[], labels: Map<string, string>, stats: SyncResult) {
  const existing = await tx.product.findMany({
    where:  { source: 'ERP', isPhone: false },
    select: { id: true, erpKey: true, recommendedSalePrice: true, availability: true, internal: { select: { stockQuantity: true } } },
  })
  const byKey    = new Map(existing.map(p => [p.erpKey, p]))
  const wanted   = new Set(listings.map(l => l.erpKey))
  const catCache = new Map<string, string>()

  for (const l of listings) {
    const availability = l.price !== null && l.stock > 0 ? 'IN_STOCK' as const : 'OUT_OF_STOCK' as const
    const price        = l.price ?? 0
    const product      = byKey.get(l.erpKey)
    if (!product) {
      let categoryId = catCache.get(l.categoryCode)
      if (!categoryId) {
        categoryId = await ensureCategory(tx, l.categoryCode, labels)
        catCache.set(l.categoryCode, categoryId)
      }
      // Hidden until staff give it a public name (and ideally a photo).
      await tx.product.create({
        data: {
          slug: await uniqueSlug(tx, l.slugBase, l.erpKey), name: l.name, brand: l.brand, condition: 'NEUF',
          isPhone: false, recommendedSalePrice: price, availability, categoryId,
          source: 'ERP', erpKey: l.erpKey, published: false,
          internal: { create: { stockQuantity: l.stock } },
        },
      })
      stats.created++
      continue
    }
    if (num(product.recommendedSalePrice) !== price || product.availability !== availability) {
      await tx.product.update({ where: { id: product.id }, data: { recommendedSalePrice: price, availability } })
      stats.updated++
    }
    if (product.internal?.stockQuantity !== l.stock) {
      await tx.productInternal.upsert({
        where:  { productId: product.id },
        create: { productId: product.id, stockQuantity: l.stock },
        update: { stockQuantity: l.stock },
      })
    }
  }

  for (const p of existing) {
    if (wanted.has(p.erpKey ?? '') || p.availability === 'DISCONTINUED') continue
    await tx.product.update({ where: { id: p.id }, data: { availability: 'DISCONTINUED' } })
    await tx.productInternal.updateMany({ where: { productId: p.id }, data: { stockQuantity: 0 } })
    stats.removed++
  }
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
  const heldRefs          = new Set(held.flatMap(h => h.unitRef!.split(',')))
  const phones            = stock.filter(p => !heldRefs.has(refOf('tel-unit', p.phone_id)))
  const phoneListings     = buildPhoneListings(phones)
  const accessoryListings = buildAccessoryListings(accessories)
  stats.phones      = phones.length
  stats.accessories = accessories.length

  await storefrontDb().$transaction(async tx => {
    await tx.$executeRaw`select pg_advisory_xact_lock(${LOCK_KEY})`
    await syncPhones(tx, phoneListings, stats)
    await syncAccessories(tx, accessoryListings, new Map(categories.map(c => [c.code, c.label_fr])), stats)
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
