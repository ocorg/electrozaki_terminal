import { prisma } from '@/lib/db'
import { json, handleError, requireUser } from '@/lib/api'

// Suggests the next EZ-ACC-###### code after the highest existing one.
export async function GET() {
  try {
    await requireUser()
    const prefix = 'EZ-ACC-'
    const last = await prisma.accessories.findFirst({
      where:   { acc_id: { startsWith: prefix } },
      orderBy: { acc_id: 'desc' },
      select:  { acc_id: true },
    })
    const lastNum = last ? parseInt(last.acc_id.slice(prefix.length), 10) : 0
    const barcode = `${prefix}${String((Number.isNaN(lastNum) ? 0 : lastNum) + 1).padStart(6, '0')}`
    return json({ status: 'success', barcode })
  } catch (err) {
    return handleError(err, 'GET /api/accessories/generate-barcode')
  }
}
