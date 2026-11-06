import { json, handleError, requireUser } from '@/lib/api'
import { listCompatModels } from '@/lib/compatModels'

// GET — the phone models an accessory can fit, from the ERP phone list (lib/compatModels)
export async function GET() {
  try {
    await requireUser()
    return json({ data: await listCompatModels() })
  } catch (err) {
    return handleError(err, 'GET /api/site/compat-models')
  }
}
