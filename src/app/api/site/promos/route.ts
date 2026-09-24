import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite } from '@/lib/storefront/access'

// Website promo codes. Managers only for changes.

export async function GET() {
  try {
    await requireUser(MANAGERS)
    const data = await site().promoCode.findMany({ orderBy: { createdAt: 'desc' } })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/site/promos')
  }
}

function parse(body: Record<string, unknown>) {
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new HttpError(400, 'Code : 3 à 30 lettres, chiffres, - ou _')
  const type = body.type === 'PERCENTAGE' ? 'PERCENTAGE' as const : body.type === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' as const : null
  if (!type) throw new HttpError(400, 'Type invalide')
  const value = Number(body.value)
  if (!Number.isFinite(value) || value <= 0) throw new HttpError(400, 'La valeur doit être positive')
  if (type === 'PERCENTAGE' && value > 90) throw new HttpError(400, 'Pourcentage trop élevé (90 % maximum)')
  const date = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null
    const d = new Date(String(v))
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date invalide')
    return d
  }
  const optInt = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.floor(Number(v))))
  const optNum = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Number(v)))
  const startsAt  = date(body.startsAt)
  const expiresAt = date(body.expiresAt)
  if (startsAt && expiresAt && expiresAt <= startsAt) throw new HttpError(400, "La date de fin doit suivre la date de début")
  return {
    code, type, value, active: body.active !== false, startsAt, expiresAt,
    maxRedemptions: optInt(body.maxRedemptions), minOrderAmount: optNum(body.minOrderAmount),
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const data = parse(await request.json())
    const created = await site().promoCode.create({ data })
    await logSite(user, 'creation', `Code promo ${data.code} créé`, { record_id: created.id, after_state: data })
    return json({ ok: true, data: created }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/promos')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const id   = String(body.id ?? '')
    const before = await site().promoCode.findUnique({ where: { id } })
    if (!before) throw new HttpError(404, 'Code introuvable')
    const data = parse(body)
    const after = await site().promoCode.update({ where: { id }, data })
    await logSite(user, 'modification', `Code promo ${after.code} modifié`, { record_id: id, before_state: before, after_state: after })
    return json({ ok: true, data: after })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/promos')
  }
}

// DELETE { id } — a code already used on orders is deactivated instead, so
// those orders keep their record of it.
async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { id } = await request.json()
    const promo = await site().promoCode.findUnique({ where: { id: String(id) }, include: { _count: { select: { orderRequests: true } } } })
    if (!promo) throw new HttpError(404, 'Code introuvable')
    if (promo._count.orderRequests) {
      await site().promoCode.update({ where: { id: promo.id }, data: { active: false } })
      await logSite(user, 'modification', `Code promo ${promo.code} désactivé (déjà utilisé)`, { record_id: promo.id })
      return json({ ok: true, deactivated: true })
    }
    await site().promoCode.delete({ where: { id: promo.id } })
    await logSite(user, 'suppression', `Code promo ${promo.code} supprimé`, { record_id: promo.id })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/promos')
  }
}

export const POST   = withNotify(POST_)
export const PATCH  = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
