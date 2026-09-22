import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, columnsOf, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { escapeLike } from '@/lib/utils/validation'

const EDITABLE = columnsOf('suppliers', ['supplier_id'])

// categorie references categories.code — an empty choice means "no category"
function supplierInput(body: Record<string, unknown>) {
  const input = pickInput('suppliers', body, EDITABLE)
  if (input.categorie === '') input.categorie = null
  return input
}

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const search   = searchParams.get('search')?.trim()

    if (searchParams.get('mode') === 'dropdown') {
      const data = await prisma.suppliers.findMany({
        where:   { is_deleted: false },
        select:  { supplier_id: true, nom: true, type_fournisseur: true },
        orderBy: { nom: 'asc' },
      })
      return json({ data })
    }

    // suppliers_summary is a database view (stock / sales / balance per supplier)
    const conds = [Prisma.sql`TRUE`]
    if (store_id) conds.push(Prisma.sql`store_id = ${store_id}`)
    if (search) {
      const like = `%${escapeLike(search)}%`
      conds.push(Prisma.sql`(nom ILIKE ${like} OR telephone ILIKE ${like} OR ville ILIKE ${like})`)
    }
    const data = await prisma.$queryRaw`
      SELECT * FROM suppliers_summary WHERE ${Prisma.join(conds, ' AND ')} ORDER BY created_at DESC`
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/suppliers')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    if (!body.nom) throw new HttpError(400, 'nom requis')

    const data = await prisma.suppliers.create({
      data: {
        ...(supplierInput(body) as Prisma.suppliersUncheckedCreateInput),
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
      module:      'fournisseurs',
      record_id:   data.supplier_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/suppliers')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const supplier_id = body.supplier_id as string | undefined
    if (!supplier_id) throw new HttpError(400, 'supplier_id requis')

    const before = await prisma.suppliers.findUniqueOrThrow({ where: { supplier_id } })
    const data = await prisma.suppliers.update({
      where: { supplier_id },
      data:  { ...supplierInput(body), updated_by: user.id },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'fournisseurs',
      record_id:    supplier_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/suppliers')
  }
}
