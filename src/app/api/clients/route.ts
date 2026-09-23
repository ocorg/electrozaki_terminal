import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, columnsOf, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { escapeLike } from '@/lib/utils/validation'
import { withNotify } from '@/lib/realtime'

const EDITABLE = columnsOf('clients', ['client_id'])

// client_summary is a database view (client + purchase/credit aggregates)
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const search   = searchParams.get('search')?.trim()
    const store_id = searchParams.get('store_id')

    const conds = [Prisma.sql`is_deleted = false`]
    if (store_id) conds.push(Prisma.sql`store_id = ${store_id}`)
    if (search) {
      const like = `%${escapeLike(search)}%`
      conds.push(Prisma.sql`(nom ILIKE ${like} OR telephone ILIKE ${like} OR telephone_2 ILIKE ${like})`)
    }
    const data = await prisma.$queryRaw`
      SELECT * FROM client_summary WHERE ${Prisma.join(conds, ' AND ')} ORDER BY created_at DESC`
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/clients')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()

    // Return existing client if the phone number is already known
    if (body.telephone) {
      const existing = await prisma.clients.findFirst({ where: { telephone: body.telephone } })
      if (existing) return json({ data: existing, existing: true })
    }

    const data = await prisma.clients.create({
      data: {
        ...(pickInput('clients', body, EDITABLE) as Prisma.clientsUncheckedCreateInput),
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
      module:      'clients',
      record_id:   data.client_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/clients')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const client_id = body.client_id as string | undefined
    if (!client_id) throw new HttpError(400, 'client_id requis')

    const before = await prisma.clients.findUniqueOrThrow({ where: { client_id } })
    const data = await prisma.clients.update({
      where: { client_id },
      data:  { ...pickInput('clients', body, EDITABLE), updated_by: user.id },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'clients',
      record_id:    client_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/clients')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
