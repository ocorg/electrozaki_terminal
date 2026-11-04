import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { uploadSitePhoto, deleteSitePhoto } from '@/lib/storefront/storage'
import { cleanColour } from '@/lib/accessoryColors'
import { couleurFromList, copyCouleursToSite } from '@/lib/couleurs'
import { isPhoneShape, PHONE_SHAPE_LABELS, type PhoneShape } from '@/lib/codes'

type Ctx = { params: { id: string } }
// 30 (owner, 2026-11-02/03): one product per pochette family, photos per
// design × colour × phone shape (a strap case = 3 photos).
const MAX_IMAGES = 30

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

// PATCH { url, colorName?, designName?, phoneShape? } — what this photo shows
// (owner, 2026-11-02/03): on the site the customer picks a design, then a colour,
// then a phone model among those the photo's shape fits. French, like all data.
// Only the fields sent change.
async function PATCH_(request: NextRequest, { params }: Ctx) {
  try {
    const user    = await requireActiveUser(MANAGERS)
    const product = await productFor(params.id)
    const body    = await request.json()
    const image   = await site().productImage.findFirst({ where: { productId: product.id, url: String(body.url ?? '') } })
    if (!image) throw new HttpError(404, 'Photo introuvable')
    const others  = await site().productImage.findMany({ where: { productId: product.id }, select: { colorName: true, designName: true } })
    // same spelling for the same word on one product ("rose" → the "Rose" already used)
    const tidy = (typed: string | null, used: (string | null)[]) => {
      if (!typed) return null
      return used.find(u => u && u.toLowerCase() === typed.toLowerCase()) ?? typed[0].toUpperCase() + typed.slice(1)
    }
    const data: { colorName?: string | null; designName?: string | null; phoneShape?: PhoneShape | null } = {}
    if ('colorName' in body) {
      // from the colour list (owner, 2026-11-04); the website keeps a copy of it
      data.colorName = await couleurFromList(body.colorName)
      if (data.colorName) await copyCouleursToSite(data.colorName)
    }
    if ('designName' in body) {
      const typed = cleanColour(body.designName)   // same rules: text, 30 characters
      data.designName = tidy(typed, others.map(o => o.designName))
    }
    if ('phoneShape' in body) {
      const v = body.phoneShape === '' || body.phoneShape === null ? null : String(body.phoneShape)
      if (v !== null && !isPhoneShape(v)) throw new HttpError(400, 'Forme de téléphone inconnue')
      data.phoneShape = v as PhoneShape | null
    }
    await site().productImage.update({ where: { id: image.id }, data })

    const said = [
      'colorName' in data && `couleur « ${data.colorName ?? 'aucune'} »`,
      'designName' in data && `design « ${data.designName ?? 'aucun'} »`,
      'phoneShape' in data && `forme « ${data.phoneShape ? PHONE_SHAPE_LABELS[data.phoneShape] : 'toutes'} »`,
    ].filter(Boolean).join(', ')
    await logSite(user, 'modification', `Photo du produit du site « ${product.name} » : ${said}`, { record_id: product.id })
    refreshSite()
    return json({ ok: true, ...data })
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
