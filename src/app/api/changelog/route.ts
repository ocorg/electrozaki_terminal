import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'

export async function GET() {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')
    const data = await prisma.platform_changelog.findMany({ orderBy: [{ changed_at: 'desc' }, { created_at: 'desc' }] })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/changelog')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    if (!body.title || !body.author) throw new HttpError(400, 'title et author requis')

    const data = await prisma.platform_changelog.create({
      data: {
        title:           body.title,
        description:     body.description     || null,
        affected_module: body.affected_module || null,
        version_tag:     body.version_tag     || null,
        author:          body.author,
        changed_at:      dateOnly(body.changed_at) ?? todayDate(),
        created_by:      user.id,
      },
    })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/changelog')
  }
}

export const POST = withNotify(POST_)
