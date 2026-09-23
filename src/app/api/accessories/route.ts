import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, requireFields, pickInput, columnsOf, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

const EDITABLE = columnsOf('accessories', ['acc_id'])

// Same rule as the accessories_with_status view
const stockLevel = (a: { quantite: number; seuil_alerte: number }) =>
  a.quantite <= 0 ? 'epuise' : a.quantite <= a.seuil_alerte ? 'alerte' : 'disponible'

export async function GET(request: NextRequest) {
  try {
    await requireUser()
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
    const rows = await prisma.accessories.findMany({ where, orderBy: { created_at: 'desc' } })

    const data = rows.map(a => ({ ...a, status_computed: stockLevel(a), is_low_stock: a.quantite <= a.seuil_alerte }))
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/accessories')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    requireFields(body, ['nom', 'categorie'])

    const data = await prisma.accessories.create({
      data: {
        ...(pickInput('accessories', body, EDITABLE) as Prisma.accessoriesUncheckedCreateInput),
        store_id:   body.store_id ?? user.store_id ?? null,
        created_by: user.id,
        updated_by: user.id,
      },
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

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const acc_id = body.acc_id as string | undefined
    if (!acc_id) throw new HttpError(400, 'acc_id requis')

    const before = await prisma.accessories.findUniqueOrThrow({ where: { acc_id } })
    const data = await prisma.accessories.update({
      where: { acc_id },
      data:  { ...pickInput('accessories', body, EDITABLE), updated_by: user.id },
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

export async function DELETE(request: NextRequest) {
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
