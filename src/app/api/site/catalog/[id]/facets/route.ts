import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { deleteSitePhoto } from '@/lib/storefront/storage'

type Ctx = { params: { id: string } }

// PUT { optionIds } — replaces the product's checklist (its "fiche"): the
// options ticked in the groups defined by /api/site/facets.
async function PUT_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body: { optionIds?: unknown } = await request.json()
    if (!Array.isArray(body.optionIds) || body.optionIds.length > 120) throw new HttpError(400, 'Liste invalide')
    const ids = Array.from(new Set(body.optionIds.map(String)))

    const db = site()
    const product = await db.product.findUnique({ where: { id: params.id }, select: { id: true, name: true } })
    if (!product) throw new HttpError(404, 'Produit introuvable')
    const options = await db.facetOption.findMany({
      where:  { id: { in: ids } },
      select: { id: true, groupId: true, group: { select: { name: true, multi: true } } },
    })
    if (options.length !== ids.length) throw new HttpError(400, 'Un des choix est introuvable')
    // A single-choice group (its material, its protection) takes one tick.
    const perGroup = new Map<string, number>()
    for (const o of options) {
      const n = (perGroup.get(o.groupId) ?? 0) + 1
      perGroup.set(o.groupId, n)
      if (n > 1 && !o.group.multi) throw new HttpError(400, `Un seul choix possible pour « ${o.group.name} »`)
    }

    // A ticked feature keeps its photo (owner, 2026-10-29); an unticked one's
    // photo is deleted from storage once the new checklist is saved.
    const before   = await db.productFacet.findMany({ where: { productId: product.id }, select: { optionId: true, imageUrl: true } })
    const photoOf  = new Map(before.filter(f => f.imageUrl).map(f => [f.optionId, f.imageUrl!]))
    const dropped  = Array.from(photoOf.entries()).filter(([optionId]) => !ids.includes(optionId)).map(([, url]) => url)
    await db.$transaction(async tx => {
      await tx.productFacet.deleteMany({ where: { productId: product.id } })
      if (ids.length) await tx.productFacet.createMany({ data: ids.map(optionId => ({ productId: product.id, optionId, imageUrl: photoOf.get(optionId) ?? null })) })
    })
    for (const url of dropped) await deleteSitePhoto(url).catch(() => {})
    await logSite(user, 'modification', `Fiche de « ${product.name} » modifiée (${ids.length} choix)`, { record_id: product.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'PUT /api/site/catalog/[id]/facets')
  }
}

export const PUT = withNotify(PUT_)
