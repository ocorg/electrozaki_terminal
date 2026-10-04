import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, requireFields, pickInput, columnsOf, HttpError, MANAGERS, isManager } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { payFromDrawer } from '@/lib/stockPurchase'

const EDITABLE = columnsOf('accessories', ['acc_id'])
// What staff may fill or change (owner's rules, 2026-10-01): details and
// quantity — never prices or supplier
const STAFF_EDITABLE = ['barcode', 'nom', 'categorie', 'marque', 'compatible_with', 'quantite', 'seuil_alerte', 'location', 'image_url']

// Same rule as the accessories_with_status view
const stockLevel = (a: { quantite: number; seuil_alerte: number }) =>
  a.quantite <= 0 ? 'epuise' : a.quantite <= a.seuil_alerte ? 'alerte' : 'disponible'

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id  = searchParams.get('store_id')
    const search    = searchParams.get('search')?.trim()
    const categorie = searchParams.get('categorie')
    const low_stock = searchParams.get('low_stock')
    if (!store_id) throw new HttpError(400, 'store_id requis')

    const where: Prisma.accessoriesWhereInput = {
      store_id,
      is_deleted: false,
      ...(categorie && { categorie }),
      ...(low_stock === 'true' && { quantite: { lte: prisma.accessories.fields.seuil_alerte } }),
      ...(search && { OR: ['nom', 'marque', 'barcode'].map(f => ({ [f]: { contains: search, mode: 'insensitive' } })) }),
    }
    const rows = await prisma.accessories.findMany({
      where,
      orderBy: { created_at: 'desc' },
      // Staff sell and look up stock, never see what it cost
      ...(!isManager(user.role) && { omit: { prix_achat: true } }),
    })

    const data = rows.map(a => ({ ...a, status_computed: stockLevel(a), is_low_stock: a.quantite <= a.seuil_alerte }))
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/accessories')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    requireFields(body, ['nom', 'categorie'])
    const manager = isManager(user.role)

    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.accessories.create({
        data: {
          ...(pickInput('accessories', body, manager ? EDITABLE : STAFF_EDITABLE) as Prisma.accessoriesUncheckedCreateInput),
          store_id:   body.store_id ?? user.store_id ?? null,
          created_by: user.id,
          updated_by: user.id,
        },
        ...(!manager && { omit: { prix_achat: true } }),
      })
      // Bought with the drawer's cash (managers): leaves the day's caisse
      if (manager) await payFromDrawer(tx, { amount: body.paye_caisse, label: `Achat ${created.acc_id} — ${created.nom}`, storeId: created.store_id, userId: user.id })
      return created
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'accessoires',
      record_id:   data.acc_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/accessories')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const acc_id = body.acc_id as string | undefined
    if (!acc_id) throw new HttpError(400, 'acc_id requis')
    const manager = isManager(user.role)

    const before = await prisma.accessories.findUniqueOrThrow({ where: { acc_id } })
    if (!manager && before.is_deleted) throw new HttpError(404, 'Accessoire introuvable')
    // Staff: prices and supplier are ignored
    const input = pickInput('accessories', body, manager ? EDITABLE : STAFF_EDITABLE)
    if (!manager && !Object.keys(input).length) throw new HttpError(403, 'Réservé aux gérants : les prix')
    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.accessories.update({
        where: { acc_id },
        data:  { ...input, updated_by: user.id },
        ...(!manager && { omit: { prix_achat: true } }),
      })
      // A restock paid with the drawer's cash
      if (manager) await payFromDrawer(tx, { amount: body.paye_caisse, label: `Réappro ${updated.acc_id} — ${updated.nom}`, storeId: updated.store_id, userId: user.id })
      return updated
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'accessoires',
      record_id:    acc_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/accessories')
  }
}

async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const acc_id = new URL(request.url).searchParams.get('acc_id')
    if (!acc_id) throw new HttpError(400, 'acc_id requis')

    const before = await prisma.accessories.findUnique({ where: { acc_id } })
    if (!before) throw new HttpError(404, 'Accessoire introuvable')

    await prisma.accessories.update({ where: { acc_id }, data: { is_deleted: true, updated_by: user.id } })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'accessoires',
      record_id:    acc_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/accessories')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
