import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite, text } from '@/lib/storefront/access'

type Ctx = { params: { id: string } }

// PATCH — how a product is presented on the website (managers). Price,
// stock and condition come from the ERP and can't be set here; a synced
// phone's name also comes from the ERP.
async function PATCH_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body: Record<string, unknown> = await request.json()
    const db   = site()
    const product = await db.product.findUnique({
      where:  { id: params.id },
      select: { id: true, name: true, isPhone: true, source: true, published: true, recommendedSalePrice: true, description: true, categoryId: true, brand: true },
    })
    if (!product) throw new HttpError(404, 'Produit introuvable')

    const data: Record<string, unknown> = {}
    if ('description' in body)     data.description     = text(body.description, 3000)
    if ('metaTitle' in body)       data.metaTitle       = text(body.metaTitle, 120)
    if ('metaDescription' in body) data.metaDescription = text(body.metaDescription, 300)
    if ('published' in body)       data.published       = body.published === true

    const nameEditable = !(product.isPhone && product.source === 'ERP')
    if ('name' in body) {
      if (!nameEditable) throw new HttpError(400, "Le nom d'un téléphone vient du stock ERP")
      const name = text(body.name, 120)
      if (!name) throw new HttpError(400, 'Le nom est obligatoire')
      data.name = name
    }
    if ('brand' in body && nameEditable) data.brand = text(body.brand, 60)
    if ('categoryId' in body) {
      const category = await db.category.findUnique({ where: { id: String(body.categoryId) }, select: { id: true } })
      if (!category) throw new HttpError(400, 'Catégorie invalide')
      data.categoryId = category.id
    }
    if (data.published === true && Number(product.recommendedSalePrice) <= 0) {
      throw new HttpError(400, "Ce produit n'a pas de prix de vente dans l'ERP")
    }
    if (!Object.keys(data).length) throw new HttpError(400, 'Rien à modifier')

    const updated = await db.product.update({
      where:  { id: product.id },
      data,
      select: { name: true, published: true, description: true, categoryId: true, brand: true },
    })
    await logSite(user, 'modification', `Produit du site « ${updated.name} » modifié`, {
      record_id: product.id, before_state: product, after_state: updated,
    })
    refreshSite()
    return json({ ok: true, data: updated })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/catalog/[id]')
  }
}

export const PATCH = withNotify(PATCH_)
