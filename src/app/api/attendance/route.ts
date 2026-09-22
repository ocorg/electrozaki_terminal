import { NextRequest } from 'next/server'
import type { punch_type } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const date     = dateOnly(searchParams.get('date')) ?? todayDate()
    const all      = searchParams.get('all') // BZG view: every store

    const data = await prisma.staff_attendance.findMany({
      where:   { date, ...(store_id && !all && { store_id }) },
      orderBy: { punched_at: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/attendance')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const store_id = body.store_id ?? user.store_id
    const punch    = body.punch_type as punch_type
    if (!store_id) throw new HttpError(400, 'store_id manquant')
    if (punch !== 'entree' && punch !== 'sortie') throw new HttpError(400, 'punch_type invalide')

    const data = await prisma.staff_attendance.create({
      data: {
        store_id,
        user_id:    user.id,
        user_name:  user.display_name,
        punch_type: punch,
        punched_at: new Date(),
        date:       todayDate(),
        notes:      body.notes || null,
      },
    })

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: punch === 'entree' ? 'pointage_entree' : 'pointage_sortie',
      module:      'pointage',
      record_id:   data.attendance_id,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/attendance')
  }
}
