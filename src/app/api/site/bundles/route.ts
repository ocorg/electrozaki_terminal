import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite, text } from '@/lib/storefront/access'
import { slugify } from '@/lib/storefront/listing'

// Website packs ("iPhone + coque + verre" at one price). Managers only for changes.

export async function GET() {
  try {
    await requireUser(MANAGERS)
    const data = await site().bundle.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { select: { id: true, name: true, recommendedSalePrice: true, published: true, availability: true } } } } },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/site/bundles')
  }
}

async function parse(body: Record<string, unknown>, exceptId?: string) {
  const name = text(body.name, 100)
  if (!name) throw new HttpError(400, 'Le nom est obligatoire')
  const bundlePrice = Number(body.bundlePrice)
  if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) throw new HttpError(400, 'Le prix du pack doit être positif')
  const raw = Array.isArray(body.items) ? body.items as { productId: string; quantity: number }[] : []
  const items = raw.map(i => ({ productId: String(i.productId), quantity: Math.max(1, Math.min(10, Math.floor(Number(i.quantity) || 1))) }))
  if (items.length < 2 || items.length > 10) throw new HttpError(400, 'Un pack contient de 2 à 10 produits')
  if (new Set(items.map(i => i.productId)).size !== items.length) throw new HttpError(400, 'Produit en double dans le pack')

  const products = await site().product.findMany({
    where:  { id: { in: items.map(i => i.productId) } },
    select: { id: true, _count: { select: { variants: true } } },
  })
  if (products.length !== items.length) throw new HttpError(400, 'Un des produits est introuvable')
  // A pack line can't pick a specific unit/colour on the website.
  if (products.some(p => p._count.variants > 0)) {
    throw new HttpError(400, 'Un pack ne peut contenir que des produits sans choix de modèle/couleur (accessoires)')
  }

  let slug = slugify(name)
  for (let n = 2; ; n++) {
    const taken = await site().bundle.findUnique({ where: { slug }, select: { id: true } })
    if (!taken || taken.id === exceptId) break
    slug = `${slugify(name)}-${n}`
  }
  return { name, slug, description: text(body.description, 500), bundlePrice, active: body.active !== false, items }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { items, ...data } = await parse(await request.json())
    const created = await site().bundle.create({ data: { ...data, items: { create: items } } })
    await logSite(user, 'creation', `Pack du site « ${data.name} » créé`, { record_id: created.id })
    refreshSite()
    return json({ ok: true, data: created }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/bundles')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const id   = String(body.id ?? '')
    if (!(await site().bundle.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, 'Pack introuvable')
    const { items, ...data } = await parse(body, id)
    await site().$transaction([
      site().bundleItem.deleteMany({ where: { bundleId: id } }),
      site().bundle.update({ where: { id }, data: { ...data, items: { create: items } } }),
    ])
    await logSite(user, 'modification', `Pack du site « ${data.name} » modifié`, { record_id: id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/bundles')
  }
}

async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { id } = await request.json()
    const bundle = await site().bundle.findUnique({ where: { id: String(id) }, select: { id: true, name: true } })
    if (!bundle) throw new HttpError(404, 'Pack introuvable')
    await site().bundle.delete({ where: { id: bundle.id } })
    await logSite(user, 'suppression', `Pack du site « ${bundle.name} » supprimé`, { record_id: bundle.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/bundles')
  }
}

export const POST   = withNotify(POST_)
export const PATCH  = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
