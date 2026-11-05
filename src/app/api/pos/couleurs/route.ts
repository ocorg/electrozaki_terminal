import { NextRequest } from 'next/server'
import { json, handleError, requireUser } from '@/lib/api'
import { familyChoices } from '@/lib/saleColour'

// GET ?store_id= — the till's colour popup for pochette families: each
// accessory's design × colour choices, from its website photos (lib/saleColour).
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const storeId = new URL(request.url).searchParams.get('store_id') || user.store_id || null
    return json({ data: await familyChoices(storeId) })
  } catch (err) {
    return handleError(err, 'GET /api/pos/couleurs')
  }
}
