import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// ── GET — list all stores ─────────────────────────────────────
export async function GET() {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')

    const data = await prisma.stores.findMany({
      select:  { store_id: true, name: true, theme_color: true, address: true, phone: true, is_active: true, created_at: true },
      orderBy: { created_at: 'asc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/stores')
  }
}

// ── PATCH — store details (manager/owner) or is_active (owner only) ──
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { store_id, is_active, name, theme_color, address, phone } = await request.json()
    if (!store_id) throw new HttpError(400, 'store_id requis')
    if (is_active !== undefined) {
      if (user.role !== 'proprietaire') throw new HttpError(403, 'Seul le propriétaire peut modifier le statut des boutiques')
      if (typeof is_active !== 'boolean') throw new HttpError(400, 'is_active invalide')
    }

    const before = await prisma.stores.findUniqueOrThrow({ where: { store_id } })
    const data   = await prisma.stores.update({
      where: { store_id },
      data: {
        ...(is_active   !== undefined && { is_active }),
        ...(name        !== undefined && { name }),
        ...(theme_color !== undefined && { theme_color }),
        ...(address     !== undefined && { address: address || null }),
        ...(phone       !== undefined && { phone: phone || null }),
      },
    })

    await logActivity({
      store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'parametres',
      record_id:    store_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
      notes:        is_active === undefined
        ? `Boutique ${store_id} modifiée`
        : `Boutique ${store_id} ${is_active ? 'activée' : 'désactivée'}`,
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/stores')
  }
}

export const PATCH = withNotify(PATCH_)
