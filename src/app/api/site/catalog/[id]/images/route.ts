import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { uploadSitePhoto, deleteSitePhoto } from '@/lib/storefront/storage'

type Ctx = { params: { id: string } }
const MAX_IMAGES = 8

async function productFor(id: string) {
  const product = await site().product.findUnique({ where: { id }, select: { id: true, name: true, isPhone: true, source: true } })
  if (!product) throw new HttpError(404, 'Produit introuvable')
  if (product.isPhone && product.source === 'ERP') {
    throw new HttpError(400, 'Les photos des téléphones se gèrent par modèle et couleur (onglet Photos)')
  }
  return product
}

// POST (multipart, field "file") — add a photo to an accessory / hand-made product.
async function POST_(request: NextRequest, { params }: Ctx) {
  try {
    const user    = await requireActiveUser(MANAGERS)
    const product = await productFor(params.id)
    const count   = await site().productImage.count({ where: { productId: product.id } })
    if (count >= MAX_IMAGES) throw new HttpError(400, `${MAX_IMAGES} photos maximum`)

    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob)) throw new HttpError(400, 'Aucun fichier')
    const url = await uploadSitePhoto(Buffer.from(await file.arrayBuffer()))
    await site().productImage.create({ data: { productId: product.id, url, sortOrder: count, altText: product.name } })

    await logSite(user, 'creation', `Photo ajoutée au produit du site « ${product.name} »`, { record_id: product.id })
    refreshSite()
    return json({ ok: true, url }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/catalog/[id]/images')
  }
}

// DELETE { url } — remove one of the product's photos.
async function DELETE_(request: NextRequest, { params }: Ctx) {
  try {
    const user    = await requireActiveUser(MANAGERS)
    const product = await productFor(params.id)
    const { url } = await request.json()
    const image   = await site().productImage.findFirst({ where: { productId: product.id, url: String(url) } })
    if (!image) throw new HttpError(404, 'Photo introuvable')
    await site().productImage.delete({ where: { id: image.id } })
    await deleteSitePhoto(image.url)

    await logSite(user, 'suppression', `Photo retirée du produit du site « ${product.name} »`, { record_id: product.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/catalog/[id]/images')
  }
}

export const POST   = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
