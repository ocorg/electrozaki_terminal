import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { parseLanding } from '@/lib/storefront/landing'
import { deleteSitePhoto } from '@/lib/storefront/storage'

type Ctx = { params: { id: string } }

// PATCH — edit a page (managers). { active } alone just switches it on/off.
async function PATCH_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const db = site()
    const before = await db.landingPage.findUnique({ where: { id: params.id } })
    if (!before) throw new HttpError(404, 'Page introuvable')

    if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
      await db.landingPage.update({ where: { id: before.id }, data: { active: body.active } })
      await logSite(user, 'modification', `Page promo « ${before.title} » ${body.active ? 'activée' : 'désactivée'}`, { record_id: before.id })
      refreshSite()
      return json({ ok: true })
    }

    const { data, productIds } = await parseLanding(body, before.id)
    await db.$transaction([
      db.landingPageProduct.deleteMany({ where: { landingPageId: before.id } }),
      db.landingPage.update({
        where: { id: before.id },
        data:  { ...data, products: { create: productIds.map((productId, sortOrder) => ({ productId, sortOrder })) } },
      }),
    ])
    await logSite(user, 'modification', `Page promo « ${data.title} » modifiée`, { record_id: before.id, before_state: before })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/landing/[id]')
  }
}

// DELETE — a page that brought orders is only switched off (its results stay).
async function DELETE_(_request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const db = site()
    const page = await db.landingPage.findUnique({ where: { id: params.id }, include: { _count: { select: { orders: true } } } })
    if (!page) throw new HttpError(404, 'Page introuvable')
    if (page._count.orders > 0) {
      await db.landingPage.update({ where: { id: page.id }, data: { active: false } })
      await logSite(user, 'modification', `Page promo « ${page.title} » désactivée (commandes liées conservées)`, { record_id: page.id })
      refreshSite()
      return json({ ok: true, deactivated: true })
    }
    await db.landingPage.delete({ where: { id: page.id } })
    if (page.bannerUrl) await deleteSitePhoto(page.bannerUrl)
    await logSite(user, 'suppression', `Page promo « ${page.title} » supprimée`, { record_id: page.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/landing/[id]')
  }
}

export const PATCH  = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
