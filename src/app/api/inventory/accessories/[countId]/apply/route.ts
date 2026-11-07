import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, MANAGERS } from '@/lib/api'
import { waitUntil } from '@vercel/functions'
import { withNotify, notifyChange } from '@/lib/realtime'
import { scheduleSiteUpdate } from '@/lib/storefront/schedule'
import { logActivity } from '@/lib/utils/logger'
import { applyCount } from '@/lib/accessoryCount'

// POST — applies the counted lines to the stock (owner, 2026-11-07; lib/accessoryCount)
async function POST_(_req: NextRequest, { params }: { params: { countId: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const r = await prisma.$transaction(tx => applyCount(tx, params.countId, user.id), { timeout: 30000 })
    await logActivity({
      store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'inventaire',
      record_id: params.countId, after_state: r.changes,
      notes: `Comptage des accessoires appliqué : ${r.changes.length} ligne(s) corrigée(s)${r.changes.length ? ` (${r.changes.slice(0, 20).map(c => `${c.nom}${c.label ? ` · ${c.label}` : ''} ${c.before}→${c.after}`).join(', ')})` : ''}, ${r.notCounted} non comptée(s) gardée(s)`,
    })
    // the stock changed: the accessories screens and the website follow
    // (only here, not on every scan)
    if (r.changes.length) {
      await notifyChange(user.store_id ?? null, ['accessories'])
      waitUntil(scheduleSiteUpdate({ sync: true }))
    }
    return json({ ok: true, data: r })
  } catch (err) {
    return handleError(err, 'POST /api/inventory/accessories/[countId]/apply')
  }
}

export const POST = withNotify(POST_)
