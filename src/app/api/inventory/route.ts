import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { phoneLabel, countByResult } from '@/lib/inventory'
import { withNotify } from '@/lib/realtime'

// ── GET /api/inventory — liste des sessions avec compteurs ──
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')
    const storeId = user.store_id ?? new URL(req.url).searchParams.get('store_id')
    if (!storeId) throw new HttpError(400, 'store_id introuvable')

    const sessions = await prisma.inventory_sessions.findMany({
      where:   { store_id: storeId },
      include: { inventory_session_items: { select: { resultat: true } } },
      orderBy: { started_at: 'desc' },
      take:    30,
    })
    return json({
      sessions: sessions.map(({ inventory_session_items, ...s }) => ({ ...s, counts: countByResult(inventory_session_items) })),
    })
  } catch (err) {
    return handleError(err, 'GET /api/inventory')
  }
}

// ── POST /api/inventory — démarrer une nouvelle session ──
async function POST_(req: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await req.json().catch(() => ({}))
    const storeId = user.store_id ?? body.store_id ?? null
    if (!storeId) throw new HttpError(400, 'store_id introuvable')

    const session = await prisma.$transaction(async (tx) => {
      const existing = await tx.inventory_sessions.findFirst({ where: { store_id: storeId, statut: 'en_cours' }, select: { session_id: true } })
      if (existing) throw new HttpError(409, 'Une vérification est déjà en cours')

      // Snapshot of the phones expected in the shop
      const phones = (await tx.phones.findMany({
        where:  { store_id: storeId, is_deleted: false, status: { notIn: ['vendu', 'en_livraison'] } },
        select: { phone_id: true, imei: true, marque: true, model: true, status: true },
      })).filter(p => p.imei)

      const session = await tx.inventory_sessions.create({
        data: { store_id: storeId, created_by: user.id, snapshot_count: phones.length, statut: 'en_cours' },
      })
      if (phones.length) {
        await tx.inventory_session_items.createMany({
          data: phones.map(p => ({
            session_id:   session.session_id,
            phone_id:     p.phone_id,
            imei:         p.imei!,
            phone_label:  phoneLabel(p.marque, p.model),
            phone_status: p.status,
            resultat:     'en_attente' as const,
          })),
        })
      }
      return session
    })

    await logActivity({
      user_id:     user.id,
      store_id:    storeId,
      user_name:   user.display_name,
      module:      'inventaire',
      action_type: 'creation',
      record_id:   session.session_id,
      ip_address:  getIpFromRequest(req),
      after_state: { session_id: session.session_id, snapshot_count: session.snapshot_count },
    })

    return json({ session })
  } catch (err) {
    return handleError(err, 'POST /api/inventory')
  }
}

export const POST = withNotify(POST_)
