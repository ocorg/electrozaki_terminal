import { NextRequest } from 'next/server'
import type { Prisma, prospect_demand, prospect_source, prospect_status } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, columnsOf, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

const EDITABLE = columnsOf('prospects', ['prospect_id'])

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id    = searchParams.get('store_id')
    const statut      = searchParams.get('statut') as prospect_status | null
    const source      = searchParams.get('source') as prospect_source | null
    const demand_type = searchParams.get('demand_type') as prospect_demand | null
    const search      = searchParams.get('search')?.trim()
    const open        = searchParams.get('open')

    const data = await prisma.prospects.findMany({
      where: {
        is_deleted: false,
        ...(store_id    && { store_id }),
        ...(open === '1' ? { statut: { in: ['nouveau', 'contacte'] } } : statut ? { statut } : {}),
        ...(source      && { source }),
        ...(demand_type && { demand_type }),
        ...(search && { OR: ['nom', 'telephone', 'model', 'marque'].map(f => ({ [f]: { contains: search, mode: 'insensitive' } })) }),
      },
      orderBy: { created_at: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/prospects')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()

    const data = await prisma.prospects.create({
      data: {
        ...(pickInput('prospects', body, EDITABLE) as Prisma.prospectsUncheckedCreateInput),
        created_by: user.id,
        updated_by: user.id,
      },
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'prospects',
      record_id:   data.prospect_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/prospects')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const prospect_id = body.prospect_id as string | undefined
    if (!prospect_id) throw new HttpError(400, 'prospect_id requis')

    const before = await prisma.prospects.findUniqueOrThrow({ where: { prospect_id } })
    const data = await prisma.prospects.update({
      where: { prospect_id },
      data:  { ...pickInput('prospects', body, EDITABLE), updated_by: user.id, updated_at: new Date() },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'prospects',
      record_id:    prospect_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/prospects')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const prospect_id = new URL(request.url).searchParams.get('prospect_id')
    if (!prospect_id) throw new HttpError(400, 'prospect_id requis')

    const data = await prisma.prospects.update({
      where: { prospect_id },
      data:  { is_deleted: true, updated_by: user.id },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'prospects',
      record_id:    prospect_id,
      before_state: data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'DELETE /api/prospects')
  }
}
