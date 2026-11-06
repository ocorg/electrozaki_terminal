import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// PATCH { action } — one line of an open inventory (owner, 2026-11-06):
//   found: a phone whose label can't be scanned is ticked found by hand;
//   undo:  a scan made by mistake is taken back (found → waiting again; an
//          unknown / not-expected line created by the scan is removed).
// Logged, so the report can be trusted.
async function PATCH_(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { action } = await req.json() as { action?: string }
    const session = await prisma.inventory_sessions.findFirst({
      where:  { session_id: params.id, ...(user.store_id && { store_id: user.store_id }) },
      select: { statut: true },
    })
    if (!session) throw new HttpError(404, 'Session introuvable')
    if (session.statut !== 'en_cours') throw new HttpError(409, 'Session déjà terminée')
    const item = await prisma.inventory_session_items.findFirst({ where: { item_id: params.itemId, session_id: params.id } })
    if (!item) throw new HttpError(404, 'Ligne introuvable')

    let result: unknown = null
    let note = ''
    if (action === 'found') {
      if (item.resultat !== 'en_attente') throw new HttpError(409, 'Ce téléphone n’est plus en attente')
      result = await prisma.inventory_session_items.update({ where: { item_id: item.item_id }, data: { resultat: 'trouve', scanned_at: new Date() } })
      note = `Inventaire : ${item.phone_label ?? item.imei} marqué trouvé à la main`
    } else if (action === 'undo') {
      if (item.resultat === 'trouve') {
        // a phone of the stock: waited for again (unless it is no longer expected, then the list's next sync settles it)
        result = await prisma.inventory_session_items.update({ where: { item_id: item.item_id }, data: { resultat: 'en_attente', scanned_at: null } })
      } else if (item.resultat === 'non_enregistre' || item.resultat === 'hors_perimetre') {
        await prisma.inventory_session_items.delete({ where: { item_id: item.item_id } })
        result = { item_id: item.item_id, removed: true }
      } else {
        throw new HttpError(409, 'Rien à annuler sur cette ligne')
      }
      note = `Inventaire : scan de ${item.phone_label ?? item.imei} annulé`
    } else {
      throw new HttpError(400, 'Action inconnue')
    }

    await logActivity({
      user_id: user.id, store_id: user.store_id, user_name: user.display_name, module: 'inventaire',
      action_type: 'modification', record_id: params.id, notes: note, ip_address: getIpFromRequest(req),
      before_state: { item_id: item.item_id, resultat: item.resultat },
    })
    return json({ item: result })
  } catch (err) {
    return handleError(err, 'PATCH /api/inventory/[id]/items/[itemId]')
  }
}

export const PATCH = withNotify(PATCH_)
