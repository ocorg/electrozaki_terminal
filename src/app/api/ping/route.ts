import { prisma } from '@/lib/db'
import { json, handleError, requireUser } from '@/lib/api'

// Heartbeat from open screens: keeps the database (which sleeps after 5 idle
// minutes on Neon's free plan) and the server functions warm during opening hours.
export async function GET() {
  try {
    await requireUser()
    await prisma.$queryRaw`SELECT 1`
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'GET /api/ping')
  }
}
