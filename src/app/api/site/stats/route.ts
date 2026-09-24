import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, MANAGERS } from '@/lib/api'
import { site } from '@/lib/storefront/access'
import { siteStats } from '@/lib/storefront/stats'

// GET ?days=7|30|90|365 — "Site web → Statistiques" (managers only).
export async function GET(request: NextRequest) {
  try {
    await requireActiveUser(MANAGERS)
    const days = Number(new URL(request.url).searchParams.get('days'))
    return json(await siteStats(site(), days))
  } catch (err) {
    return handleError(err, 'GET /api/site/stats')
  }
}
