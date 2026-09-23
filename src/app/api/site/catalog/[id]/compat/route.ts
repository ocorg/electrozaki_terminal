import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'

type Ctx = { params: { id: string } }

async function phoneFor(id: string) {
  const phone = await site().product.findUnique({ where: { id }, select: { id: true, name: true, isPhone: true, modelKey: true } })
  if (!phone) throw new HttpError(404, 'Produit introuvable')
  if (!phone.isPhone) throw new HttpError(400, 'Réservé aux téléphones')
  return phone
}

// GET — the accessories that fit this phone, and which are free-gift choices.
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireUser()
    const phone = await phoneFor(params.id)
    const links = await site().productCompatibility.findMany({
      where:  { compatibleWithId: phone.id },
      select: { productId: true, isGiftOption: true },
    })
    return json({ data: links })
  } catch (err) {
    return handleError(err, 'GET /api/site/catalog/[id]/compat')
  }
}

// PUT { links: [{ productId, isGiftOption }], wholeModel } — replaces the
// list. wholeModel applies it to every storage/grade of the same phone model.
async function PUT_(request: NextRequest, { params }: Ctx) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const phone = await phoneFor(params.id)
    const body: { links?: { productId: string; isGiftOption?: boolean }[]; wholeModel?: boolean } = await request.json()
    if (!Array.isArray(body.links) || body.links.length > 60) throw new HttpError(400, 'Liste invalide')

    const db  = site()
    const ids = Array.from(new Set(body.links.map(l => String(l.productId))))
    const accessories = await db.product.findMany({ where: { id: { in: ids }, isPhone: false }, select: { id: true } })
    if (accessories.length !== ids.length) throw new HttpError(400, 'Un des accessoires est introuvable')

    const targets = body.wholeModel && phone.modelKey
      ? (await db.product.findMany({ where: { modelKey: phone.modelKey, isPhone: true }, select: { id: true } })).map(p => p.id)
      : [phone.id]

    await db.$transaction(async tx => {
      await tx.productCompatibility.deleteMany({ where: { compatibleWithId: { in: targets } } })
      if (ids.length) {
        await tx.productCompatibility.createMany({
          data: targets.flatMap(target => ids.map(productId => ({
            productId,
            compatibleWithId: target,
            isGiftOption: body.links!.some(l => l.productId === productId && l.isGiftOption === true),
          }))),
        })
      }
    })

    await logSite(user, 'modification', `Accessoires compatibles / cadeaux de « ${phone.name} » modifiés (${targets.length} fiche(s))`, { record_id: phone.id })
    refreshSite()
    return json({ ok: true, products: targets.length })
  } catch (err) {
    return handleError(err, 'PUT /api/site/catalog/[id]/compat')
  }
}

export const PUT = withNotify(PUT_)
