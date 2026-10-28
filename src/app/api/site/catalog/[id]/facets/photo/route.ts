import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { uploadSitePhoto, deleteSitePhoto } from '@/lib/storefront/storage'

type Ctx = { params: { id: string } }
// Same list as the ERP screen (SiteFacets): only "Extras" take a photo
const PHOTO_GROUPS = ['extras']

// A product's own photo of one of its ticked features (owner, 2026-10-29):
// "Extras" of a pochette — its card holder, its stand, its strap. The feature
// must be ticked and saved on the product's fiche first.
async function tick(productId: string, optionId: string) {
  const row = await site().productFacet.findUnique({
    where:  { productId_optionId: { productId, optionId } },
    select: { imageUrl: true, product: { select: { name: true } }, option: { select: { name: true, group: { select: { key: true } } } } },
  })
  if (!row) throw new HttpError(400, 'Cochez et enregistrez d’abord ce choix dans la fiche')
  if (!PHOTO_GROUPS.includes(row.option.group.key)) throw new HttpError(400, 'Photo possible seulement pour les « Extras »')
  return row
}

// POST (multipart: optionId, file) — adds or replaces the feature's photo.
async function POST_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const form = await request.formData()
    const optionId = String(form.get('optionId') ?? '')
    const file = form.get('file')
    if (!optionId) throw new HttpError(400, 'Choix manquant')
    if (!(file instanceof Blob)) throw new HttpError(400, 'Aucun fichier')
    const row = await tick(params.id, optionId)
    const url = await uploadSitePhoto(Buffer.from(await file.arrayBuffer()))
    await site().productFacet.update({ where: { productId_optionId: { productId: params.id, optionId } }, data: { imageUrl: url } })
    if (row.imageUrl) await deleteSitePhoto(row.imageUrl).catch(() => {})
    await logSite(user, 'modification', `Photo « ${row.option.name} » du produit du site « ${row.product.name} »`, { record_id: params.id })
    refreshSite()
    return json({ ok: true, url }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/catalog/[id]/facets/photo')
  }
}

// DELETE { optionId } — removes the feature's photo (the tick stays).
async function DELETE_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const optionId = String((await request.json()).optionId ?? '')
    const row = await tick(params.id, optionId)
    if (!row.imageUrl) return json({ ok: true })
    await site().productFacet.update({ where: { productId_optionId: { productId: params.id, optionId } }, data: { imageUrl: null } })
    await deleteSitePhoto(row.imageUrl).catch(() => {})
    await logSite(user, 'suppression', `Photo « ${row.option.name} » retirée du produit du site « ${row.product.name} »`, { record_id: params.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/catalog/[id]/facets/photo')
  }
}

export const POST   = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
