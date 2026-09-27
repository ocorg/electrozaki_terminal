import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// POST — change the prices of many phones at once (managers), e.g. "+200 DH on
// every new phone in stock". `apply: false` only previews (before / after);
// `apply: true` saves, one activity-log entry per phone, then the website is
// refreshed by the usual sync (this path is a /api/phones write).
//
// Body: { store_id, condition: 'neuf'|'occasion'|'tous', status: 'disponible'|'tous', marque?,
//         field: 'vente'|'minimum'|'les_deux', mode: 'montant'|'pourcentage', amount, round?: 0|10|50|100, apply }

type Field = 'vente' | 'minimum' | 'les_deux'
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v))

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const b = await request.json()
    const store_id  = String(b.store_id ?? '')
    const condition = b.condition === 'neuf' || b.condition === 'occasion' ? b.condition : null
    const status    = b.status === 'tous' ? null : 'disponible'
    const marque    = typeof b.marque === 'string' && b.marque.trim() ? b.marque.trim() : null
    const field: Field = b.field === 'minimum' || b.field === 'les_deux' ? b.field : 'vente'
    const mode      = b.mode === 'pourcentage' ? 'pourcentage' : 'montant'
    const amount    = Number(b.amount)
    const roundTo   = [10, 50, 100].includes(Number(b.round)) ? Number(b.round) : 0
    if (!store_id) throw new HttpError(400, 'store_id requis')
    if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, 'Indiquez une hausse ou une baisse (différente de 0)')
    if (mode === 'pourcentage' && Math.abs(amount) > 90) throw new HttpError(400, 'Pourcentage trop grand (90 % maximum)')
    if (mode === 'montant' && Math.abs(amount) > 20000) throw new HttpError(400, 'Montant trop grand')

    const phones = await prisma.phones.findMany({
      where: {
        store_id, is_deleted: false,
        ...(condition && { condition }),
        ...(status && { status }),
        ...(marque && { marque: { equals: marque, mode: 'insensitive' } }),
      },
      select: { phone_id: true, marque: true, serie: true, model: true, stockage: true, couleur: true, condition: true, status: true,
                prix_vente_recommande: true, prix_vente_minimum: true },
      orderBy: [{ marque: 'asc' }, { model: 'asc' }, { stockage: 'asc' }],
    })

    const change = (v: number | null) => {
      if (v === null) return null
      let next = mode === 'montant' ? v + amount : v * (1 + amount / 100)
      if (roundTo) next = Math.round(next / roundTo) * roundTo
      return Math.max(0, Math.round(next * 100) / 100)
    }
    const rows = phones.map(p => {
      const pv = num(p.prix_vente_recommande), pm = num(p.prix_vente_minimum)
      const newPv = field === 'minimum' ? pv : change(pv)
      const newPm = field === 'vente' ? pm : change(pm)
      return {
        phone_id: p.phone_id,
        name: `${p.model.toLowerCase().startsWith(p.marque.toLowerCase()) ? p.model : `${(p.serie ?? '').split(' ')[0] || p.marque} ${p.model}`}${p.stockage ? ` ${p.stockage}` : ''}${p.couleur ? ` · ${p.couleur}` : ''}`,
        condition: p.condition, status: p.status,
        pv, newPv, pm, newPm,
        // the negotiation floor must never end up above the sale price
        warning: newPv !== null && newPm !== null && newPm > newPv ? 'Dernier prix au-dessus du prix de vente' : pv === null && field !== 'minimum' ? 'Pas de prix de vente' : null,
      }
    })
    const changed = rows.filter(r => r.newPv !== r.pv || r.newPm !== r.pm)

    if (!b.apply) return json({ data: { rows, count: changed.length } })
    if (changed.some(r => r.warning === 'Dernier prix au-dessus du prix de vente')) {
      throw new HttpError(400, 'Certains derniers prix dépasseraient le prix de vente : ajustez la hausse ou choisissez « les deux prix ».')
    }

    await prisma.$transaction(changed.map(r => prisma.phones.update({
      where: { phone_id: r.phone_id },
      data:  { prix_vente_recommande: r.newPv, prix_vente_minimum: r.newPm, updated_by: user.id, updated_at: new Date() },
    })))

    const label = `${amount > 0 ? '+' : ''}${amount}${mode === 'pourcentage' ? ' %' : ' DH'} sur ${field === 'vente' ? 'le prix de vente' : field === 'minimum' ? 'le dernier prix' : 'le prix de vente et le dernier prix'}`
    await Promise.all(changed.map(r => logActivity({
      store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'telephones',
      record_id: r.phone_id,
      before_state: { prix_vente_recommande: r.pv, prix_vente_minimum: r.pm },
      after_state:  { prix_vente_recommande: r.newPv, prix_vente_minimum: r.newPm },
      ip_address: getIpFromRequest(request),
      notes: `Modification des prix en masse : ${label}`,
    })))

    return json({ data: { count: changed.length, label } })
  } catch (err) {
    return handleError(err, 'POST /api/phones/bulk-price')
  }
}

export const POST = withNotify(POST_)
