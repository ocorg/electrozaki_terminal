import { NextRequest } from 'next/server'
import type { Prisma, repair_status } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, columnsOf, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { codeLabel } from '@/lib/codes'
import { withNotify } from '@/lib/realtime'

const EDITABLE = columnsOf('reparations', ['rep_id'])

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id  = searchParams.get('store_id')
    const statut    = searchParams.get('statut') as repair_status | null
    const search    = searchParams.get('search')?.trim()
    const client_id = searchParams.get('client_id')
    if (!store_id && !client_id) throw new HttpError(400, 'store_id ou client_id requis')

    const rows = await prisma.reparations.findMany({
      where: {
        is_deleted: false,
        ...(store_id  && { store_id }),
        ...(client_id && { client_id }),
        ...(statut    && { statut }),
        ...(search    && { OR: ['model', 'marque', 'device_serial'].map(f => ({ [f]: { contains: search, mode: 'insensitive' } })) }),
      },
      include: { clients: { select: { nom: true, telephone: true } }, reparations_parts: true },
      orderBy: { created_at: 'desc' },
    })

    const data = rows.map(r => ({
      ...r,
      fariq_rep:  Number(r.cout_reparation ?? 0) - Number(r.avance_rep ?? 0),
      parts_cost: r.reparations_parts.reduce((s, p) => s + Number(p.cout ?? 0), 0),
    }))
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/repairs')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()

    const data = await prisma.reparations.create({
      data: {
        ...(pickInput('reparations', body, EDITABLE) as Prisma.reparationsUncheckedCreateInput),
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
      module:      'reparations',
      record_id:   data.rep_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${data.marque ?? ''} ${data.model} — ${data.probleme}`.trim(),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/repairs')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const rep_id = body.rep_id as string | undefined
    if (!rep_id) throw new HttpError(400, 'rep_id requis')

    const before = await prisma.reparations.findUniqueOrThrow({ where: { rep_id } })
    const data = await prisma.reparations.update({
      where: { rep_id },
      data:  { ...pickInput('reparations', body, EDITABLE), updated_by: user.id },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'reparations',
      record_id:    rep_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
      notes:        body.statut ? `Statut → ${codeLabel('repair_status', data.statut, 'fr')}` : undefined,
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/repairs')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
