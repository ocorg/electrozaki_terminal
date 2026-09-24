import { HttpError } from '@/lib/api'
import { site, text } from './access'
import { slugify } from './listing'

// Promo pages (website /offres/[slug]) — validation shared by the ERP routes.

export const LANDING_THEMES = ['GOLD', 'INK', 'OCEAN', 'CORAL'] as const
type Theme = (typeof LANDING_THEMES)[number]

export function landingStatus(p: { active: boolean; startsAt: Date | null; endsAt: Date | null }, now = new Date()) {
  if (!p.active) return 'off' as const
  if (p.startsAt && now < p.startsAt) return 'scheduled' as const
  if (p.endsAt && now > p.endsAt) return 'ended' as const
  return 'live' as const
}

function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date invalide')
  return d
}

/** Checks and normalises a page form. `id` = the page being edited, if any. */
export async function parseLanding(body: Record<string, unknown>, id?: string) {
  const db = site()
  const title = text(body.title, 90)
  if (!title) throw new HttpError(400, 'Le titre est obligatoire')

  const slug = slugify(typeof body.slug === 'string' && body.slug.trim() ? body.slug : title)
  const clash = await db.landingPage.findUnique({ where: { slug }, select: { id: true } })
  if (clash && clash.id !== id) throw new HttpError(409, `L'adresse /offres/${slug} est déjà utilisée par une autre page`)

  const theme = (LANDING_THEMES as readonly string[]).includes(body.theme as string) ? body.theme as Theme : 'GOLD'

  let discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | null = null
  let discountValue: number | null = null
  if (body.discountType === 'PERCENTAGE' || body.discountType === 'FIXED_AMOUNT') {
    discountType = body.discountType
    discountValue = Number(body.discountValue)
    if (!Number.isFinite(discountValue) || discountValue <= 0) throw new HttpError(400, 'Indiquez la réduction (nombre positif)')
    if (discountType === 'PERCENTAGE' && discountValue > 90) throw new HttpError(400, 'Réduction trop élevée (90 % maximum)')
  }

  const startsAt = date(body.startsAt)
  const endsAt   = date(body.endsAt)
  if (startsAt && endsAt && endsAt <= startsAt) throw new HttpError(400, 'La fin doit être après le début')

  const categoryId = body.categoryId ? String(body.categoryId) : null
  if (categoryId && !(await db.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    throw new HttpError(400, 'Catégorie introuvable')
  }

  const productIds = Array.isArray(body.productIds) ? Array.from(new Set(body.productIds.map(String))) : []
  if (productIds.length > 100) throw new HttpError(400, '100 produits maximum')
  if (productIds.length) {
    const found = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, _count: { select: { variants: true } } } })
    if (found.length !== productIds.length) throw new HttpError(400, 'Un des produits est introuvable')
    if (found.some(p => p._count.variants > 0)) {
      throw new HttpError(400, 'Une page promo ne peut contenir que des produits sans choix de modèle (accessoires)')
    }
  }
  if (!categoryId && productIds.length === 0) throw new HttpError(400, 'Choisissez une catégorie ou des produits')

  const promoCodeId = body.promoCodeId ? String(body.promoCodeId) : null
  if (promoCodeId && !(await db.promoCode.findUnique({ where: { id: promoCodeId }, select: { id: true } }))) {
    throw new HttpError(400, 'Code promo introuvable')
  }

  return {
    data: {
      title, slug, theme, categoryId, discountType, discountValue, promoCodeId, startsAt, endsAt,
      subtitle: text(body.subtitle, 160),
      body:     text(body.body, 1500),
      active:   body.active !== false,
    },
    productIds,
  }
}
