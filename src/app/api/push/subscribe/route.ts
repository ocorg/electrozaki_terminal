import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'

// POST { endpoint, keys: { p256dh, auth } } — this device wants the website
// notifications (managers and owner). DELETE { endpoint } — it no longer does.
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const endpoint = String(body?.endpoint ?? ''), p256dh = String(body?.keys?.p256dh ?? ''), auth = String(body?.keys?.auth ?? '')
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new HttpError(400, 'Abonnement invalide')
    const user_agent = request.headers.get('user-agent')?.slice(0, 200) ?? null
    await prisma.push_subscriptions.upsert({
      where:  { endpoint },
      create: { user_id: user.id, endpoint, p256dh, auth, user_agent },
      update: { user_id: user.id, p256dh, auth, user_agent },
    })
    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'POST /api/push/subscribe')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { endpoint } = await request.json()
    await prisma.push_subscriptions.deleteMany({ where: { endpoint: String(endpoint ?? ''), user_id: user.id } })
    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/push/subscribe')
  }
}
