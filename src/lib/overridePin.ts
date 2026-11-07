import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

// Selling under the minimum price (owner's rule: an employé needs a manager's
// PIN). Security review 2026-11-07: the PIN used to be checked by the screen
// only, so a sale sent straight to the server skipped it. Now:
//  - a right PIN gives a signed permission (this manager → this employé,
//    30 minutes), never the PIN itself;
//  - the sale checks the minimum on the server and, under it, takes the
//    manager's name from that permission, not from what the screen says;
//  - wrong PINs are counted in the database (5 in 15 minutes = blocked),
//    whatever server answers.

type Tx = Prisma.TransactionClient
const TTL_MS = 30 * 60 * 1000
const key = () => {
  const s = process.env.AUTH_SECRET
  if (!s) throw new HttpError(500, 'AUTH_SECRET manquant')
  return s
}
const sign = (payload: string) => createHmac('sha256', key()).update(`override:${payload}`).digest('base64url')

/** The permission given after a right PIN: "<managerId>.<staffId>.<expiry>.<signature>" */
export function issueOverride(managerId: string, staffId: string): string {
  const payload = `${managerId}.${staffId}.${Date.now() + TTL_MS}`
  return `${payload}.${sign(payload)}`
}

/** The manager behind a still-valid permission given to this employé, else null. */
export function managerOf(token: unknown, staffId: string): string | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [managerId, forStaff, exp, sig] = parts
  const payload = `${managerId}.${forStaff}.${exp}`
  const want = Buffer.from(sign(payload)), given = Buffer.from(sig)
  if (want.length !== given.length || !timingSafeEqual(want, given)) return null
  if (forStaff !== staffId || !(Number(exp) > Date.now())) return null
  return managerId
}

/** Wrong PINs of this user in the last 15 minutes (kept in the activity log). */
export async function recentPinFailures(db: Tx, userId: string): Promise<number> {
  return db.activity_log.count({
    where: { user_id: userId, action_type: 'derogation', notes: 'PIN gérant incorrect', created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
  })
}

/**
 * An employé's sale under the minimum needs a valid permission; returns what
 * the sale records (override_required / override_by). Managers and owners
 * sell at the price they choose, as before.
 */
export async function minimumPriceCheck(tx: Tx, user: { id: string; role: string }, sale: {
  device_type: string; device_id: string; prix_vente: number; qty: number; override_token?: unknown; override_by?: string | null; override_required?: boolean | null
}): Promise<{ override_required: boolean | null; override_by: string | null }> {
  if (user.role !== 'employe') return { override_required: sale.override_required ?? null, override_by: sale.override_by ?? null }
  let min: number | null = null
  if (sale.device_type === 'telephone') {
    const p = await tx.phones.findUnique({ where: { phone_id: sale.device_id }, select: { prix_vente_minimum: true } })
    min = p?.prix_vente_minimum != null ? Number(p.prix_vente_minimum) : null
  } else if (sale.device_type === 'accessoire') {
    const a = await tx.accessories.findUnique({ where: { acc_id: sale.device_id }, select: { prix_vente_minimum: true } })
    min = a?.prix_vente_minimum != null ? Number(a.prix_vente_minimum) * Math.max(1, sale.qty) : null
  } else if (sale.device_type === 'laptop') {
    const l = await tx.laptops.findUnique({ where: { laptop_id: sale.device_id }, select: { prix_vente_minimum: true } })
    min = l?.prix_vente_minimum != null ? Number(l.prix_vente_minimum) : null
  }
  if (!min || sale.prix_vente >= min - 0.01) return { override_required: null, override_by: null }
  const manager = managerOf(sale.override_token, user.id)
  if (!manager) throw new HttpError(403, 'Prix sous le minimum : il faut le code PIN d’un gérant.')
  return { override_required: true, override_by: manager }
}
