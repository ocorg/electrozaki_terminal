import { site } from './access'

// ─────────────────────────────────────────────────────────────────────────
// Phone promo pages (website /offres/<model>, e.g. /offres/iphone-14).
// The website builds one per phone model with units on promo in stock
// (electrozaki-storefront lib/offers/phone-offers.ts): nothing to create by
// hand. Each one is backed by a promo-page row with the same slug, so it
// shows in "Pages promo" with its on/off switch, visits and orders.
//
// Those rows have no category and no hand-picked products, which a page
// made by hand always has (parseLanding requires one or the other): that is
// how the two kinds are told apart.
// ─────────────────────────────────────────────────────────────────────────

/** Same rule as the website: "apple|iphone 13 pro" → "iphone-13-pro", "samsung|samsung galaxy s24 ultra" → "galaxy-s24-ultra". */
export function offerSlug(modelKey: string): string {
  const [brand = '', model = modelKey] = modelKey.split('|')
  const name = model.startsWith(`${brand} `) ? model.slice(brand.length + 1) : model
  return name
    .toLowerCase()
    .replace(/\+/g, ' plus')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** "Samsung Galaxy S24 Ultra 256GB" → "Galaxy S24 Ultra". */
function modelName(listingName: string, brand: string | null): string {
  const noStorage = listingName.replace(/\s*\b\d+\s?(?:GB|TB|Go|To)\b.*$/i, '').trim()
  return brand && noStorage.toLowerCase().startsWith(`${brand.toLowerCase()} `) ? noStorage.slice(brand.length + 1) : noStorage
}

export type PhoneOfferSummary = {
  slug: string
  name: string
  /** promo units in stock */
  units: number
  fromPrice: number
  /** biggest saving on one unit, DH */
  bestSaving: number
}

/** Phone models with units on promo in stock right now (what the website shows). */
export async function currentPhoneOffers(): Promise<PhoneOfferSummary[]> {
  const listings = await site().product.findMany({
    where: {
      isPhone: true, published: true, availability: 'IN_STOCK', modelKey: { not: null },
      variants: { some: { stockQuantity: { gt: 0 }, compareAtPrice: { not: null } } },
    },
    select: {
      name: true, brand: true, modelKey: true, recommendedSalePrice: true,
      variants: { where: { stockQuantity: { gt: 0 }, compareAtPrice: { not: null } }, select: { priceOverride: true, compareAtPrice: true } },
    },
  })
  const bySlug = new Map<string, PhoneOfferSummary>()
  for (const l of listings) {
    const slug = offerSlug(l.modelKey!)
    const offer = bySlug.get(slug) ?? { slug, name: modelName(l.name, l.brand), units: 0, fromPrice: Infinity, bestSaving: 0 }
    for (const v of l.variants) {
      const price = Number(v.priceOverride ?? l.recommendedSalePrice)
      offer.units++
      offer.fromPrice = Math.min(offer.fromPrice, price)
      offer.bestSaving = Math.max(offer.bestSaving, Number(v.compareAtPrice) - price)
    }
    bySlug.set(slug, offer)
  }
  return [...bySlug.values()].sort((a, b) => b.bestSaving - a.bestSaving || a.name.localeCompare(b.name))
}

/**
 * Gives each current phone offer its promo-page row (visits, orders, on/off
 * switch). A new row starts switched on: the offer is already on the site.
 */
export async function ensurePhoneOfferPages(offers: PhoneOfferSummary[]): Promise<void> {
  if (!offers.length) return
  const db = site()
  const existing = new Set((await db.landingPage.findMany({ where: { slug: { in: offers.map(o => o.slug) } }, select: { slug: true } })).map(p => p.slug))
  const missing = offers.filter(o => !existing.has(o.slug))
  if (missing.length) {
    await db.landingPage.createMany({
      data: missing.map(o => ({ slug: o.slug, title: `Promo ${o.name}`, active: true })),
      skipDuplicates: true,
    })
  }
}
