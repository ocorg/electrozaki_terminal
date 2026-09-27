import { NextRequest } from 'next/server'
import { json, handleError, requireUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { financials } from '@/lib/analytics'

// GET ?store_id=&from=YYYY-MM-DD&to=YYYY-MM-DD — EZ → Analyse (managers only).
export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const { searchParams } = new URL(request.url)
    const store = searchParams.get('store_id')
    const from  = dateOnly(searchParams.get('from'))
    const to    = dateOnly(searchParams.get('to'))
    if (!store || !from || !to) throw new HttpError(400, 'store_id, from et to requis')
    if (to < from) throw new HttpError(400, 'La date de fin est avant la date de début')
    if ((to.getTime() - from.getTime()) / 86_400_000 > 800) throw new HttpError(400, 'Période trop longue (2 ans maximum)')
    return json({ data: await financials(store, from, to) })
  } catch (err) {
    return handleError(err, 'GET /api/analytics')
  }
}
