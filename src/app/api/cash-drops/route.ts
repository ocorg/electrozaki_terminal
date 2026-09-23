import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json() as { amount: number; reason: string; store_id: string }
    const amount = Number(body.amount)
    if (!(amount > 0)) throw new HttpError(400, 'Montant invalide')
    if (!body.reason?.trim()) throw new HttpError(400, 'Motif requis')

    const data = await prisma.cash_drops.create({
      data: {
        store_id:   body.store_id,
        amount,
        reason:     body.reason.trim(),
        date:       todayDate(),
        created_by: user.id,
      },
    })

    await logActivity({
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'encaissements_manuels',
      record_id:   data.drop_id,
      store_id:    body.store_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'POST /api/cash-drops')
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const date     = searchParams.get('date')

    const data = await prisma.cash_drops.findMany({
      where:   { ...(store_id && { store_id }), ...(date && { date: dateOnly(date) }) },
      orderBy: { created_at: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/cash-drops')
  }
}

export const POST = withNotify(POST_)
