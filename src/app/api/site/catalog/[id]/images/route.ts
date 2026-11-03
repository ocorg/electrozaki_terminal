import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { uploadSitePhoto, deleteSitePhoto } from '@/lib/storefront/storage'
import { cleanColour } from '@/lib/accessoryColors'
import { colourLooksEnglish } from '@/lib/phoneNaming'

type Ctx = { params: { id: string } }
// 24 (owner, 2026-11-02): one product per pochette family, one photo per colour.
const MAX_IMAGES = 24

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
    const url = await uploadSitePhoto(Buffer.from(await file.arrayBuffer()), 'accessoires')
    await site().productImage.create({ data: { productId: product.id, url, sortOrder: count, altText: product.name } })

    await logSite(user, 'creation', `Photo ajoutée au produit du site « ${product.name} »`, { record_id: product.id })
    refreshSite()
    return json({ ok: true, url }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/catalog/[id]/images')
  }
}

// PATCH { url, colorName } — the colour this photo shows (owner, 2026-11-02):
// on the site the customer picks one of the photos' colours before ordering.
// French names, like everywhere in the data.
async function PATCH_(request: NextRequest, { params }: Ctx) {
  try {
    const user    = await requireActiveUser(MANAGERS)
    const product = await productFor(params.id)
    const body    = await request.json()
    const colorName = cleanColour(body.colorName)
    if (colorName && colourLooksEnglish(colorName)) throw new HttpError(400, `« ${colorName} » : écrivez la couleur en français (Noir, Rose, Bleu…)`)
    const image   = await site().productImage.findFirst({ where: { productId: product.id, url: String(body.url ?? '') } })
    if (!image) throw new HttpError(404, 'Photo introuvable')
    // same spelling for the same colour on one product ("rose" → the "Rose" already used)
    const others = await site().productImage.findMany({ where: { productId: product.id, colorName: { not: null } }, select: { colorName: true } })
    const same   = colorName ? others.find(o => o.colorName!.toLowerCase() === colorName.toLowerCase())?.colorName : null
    const value  = same ?? (colorName ? colorName[0].toUpperCase() + colorName.slice(1) : null)
    await site().productImage.update({ where: { id: image.id }, data: { colorName: value } })

    await logSite(user, 'modification', `Couleur de photo « ${value ?? 'aucune'} » sur le produit du site « ${product.name} »`, { record_id: product.id })
    refreshSite()
    return json({ ok: true, colorName: value })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/catalog/[id]/images')
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
export const PATCH  = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
