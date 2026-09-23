import { waitUntil } from '@vercel/functions'
import type { log_action } from '@prisma/client'
import { HttpError } from '@/lib/api'
import { prisma } from '@/lib/db'
import { logActivity } from '@/lib/utils/logger'
import type { AuthClaims } from '@/types/auth'
import { revalidateStorefront } from './revalidate'
import { storefrontDb, storefrontConfigured } from './db'
import { PHONE_SAFE_SELECT, buildPhoneListings, refOf, type ErpPhone } from './listing'

/** The website database, or a clear 503 while it isn't configured. */
export function site() {
  if (!storefrontConfigured()) throw new HttpError(503, "Site web non configuré (variables d'environnement manquantes)")
  return storefrontDb()
}

/** Short reference shown to staff and quoted in the customer's WhatsApp message. */
export const orderRef = (id: string) => id.slice(0, 8).toUpperCase()

/**
 * The ERP phones an order line points to. A used-phone line names one unit;
 * a new-phone line names a lot (colour + price), resolved to the units of
 * that lot that are still available. Once staff reserve, the line keeps the
 * reserved units' own references (comma-separated).
 */
export async function phonesForRef(unitRef: string): Promise<string[]> {
  const refs = unitRef.split(',').filter(Boolean)
  const available = await prisma.phones.findMany({
    where:  { status: 'disponible', is_deleted: false },
    select: PHONE_SAFE_SELECT,
  })
  const found: string[] = []
  const variants = buildPhoneListings(available as unknown as ErpPhone[]).flatMap(l => l.variants)
  const missing: string[] = []
  for (const ref of refs) {
    const variant = variants.find(v => v.erpRef === ref)
    if (variant) found.push(...variant.unitIds)
    else missing.push(ref)
  }
  if (missing.length) {
    // Unit references, whatever the phone's status now (reserved, sold…).
    const all = await prisma.phones.findMany({ where: { is_deleted: false }, select: { phone_id: true } })
    for (const p of all) if (missing.includes(refOf('tel-unit', p.phone_id))) found.push(p.phone_id)
  }
  return Array.from(new Set(found))
}

/** Activity-log entry for a "Site web" change. */
export async function logSite(
  user: AuthClaims,
  action: log_action,
  notes: string,
  extra: { record_id?: string; before_state?: unknown; after_state?: unknown } = {},
) {
  await logActivity({
    store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
    action_type: action, module: 'site_web', notes, ...extra,
  })
}

/** Refresh the website's pages after a presentation change (in the background). */
export function refreshSite() {
  waitUntil(revalidateStorefront())
}

export function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new HttpError(400, 'Texte invalide')
  const t = value.trim()
  if (t.length > max) throw new HttpError(400, `Texte trop long (${max} caractères maximum)`)
  return t || null
}
