import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, columnsOf, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

const EDITABLE = columnsOf('laptops', ['laptop_id'])

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const status   = searchParams.get('status') as Prisma.laptopsWhereInput['status']
    const search   = searchParams.get('search')?.trim()
    const location = searchParams.get('location') as Prisma.laptopsWhereInput['location']
    const store_id = searchParams.get('store_id')

    const data = await prisma.laptops.findMany({
      where: {
        is_deleted: false,
        ...(store_id && { store_id }),
        ...(status   && { status }),
        ...(location && { location }),
        ...(search   && { OR: ['serial', 'model', 'marque'].map(f => ({ [f]: { contains: search, mode: 'insensitive' } })) }),
      },
      orderBy: { created_at: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/laptops')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()

    const data = await prisma.laptops.create({
      data: {
        ...(pickInput('laptops', body, EDITABLE) as Prisma.laptopsUncheckedCreateInput),
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
      module:      'laptops',
      record_id:   data.laptop_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/laptops')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const laptop_id = body.laptop_id as string | undefined
    if (!laptop_id) throw new HttpError(400, 'laptop_id requis')

    const before = await prisma.laptops.findUniqueOrThrow({ where: { laptop_id } })
    const data = await prisma.laptops.update({
      where: { laptop_id },
      data:  { ...pickInput('laptops', body, EDITABLE), updated_by: user.id },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'laptops',
      record_id:    laptop_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/laptops')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const laptop_id = new URL(request.url).searchParams.get('laptop_id')
    if (!laptop_id) throw new HttpError(400, 'laptop_id requis')

    const before = await prisma.laptops.findUnique({ where: { laptop_id } })
    if (!before) throw new HttpError(404, 'Laptop introuvable')

    await prisma.laptops.update({ where: { laptop_id }, data: { is_deleted: true, updated_by: user.id } })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'laptops',
      record_id:    laptop_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/laptops')
  }
}
