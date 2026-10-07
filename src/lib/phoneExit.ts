import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'
import { codeLabel } from '@/lib/codes'

type Tx = Prisma.TransactionClient | typeof import('@/lib/db').prisma

// How a phone leaves the stock (owner's rules, 2026-10-04): only through a
// real operation — a POS sale, a credit file, a sale recorded after the fact
// with its true date, or "The Void" (no trace / taken apart). Never by
// picking "Vendu" in a list: that is what left sales out of the figures and
// counted others twice.

/** A sale still standing on this phone (not voided, and the phone is out). */
export async function liveSale(tx: Tx, phoneId: string, status: string) {
  if (status !== 'vendu' && status !== 'reserve') return null
  const txn = await tx.transactions.findFirst({
    where: { device_id: phoneId, device_type: 'telephone', voided: false, NOT: { type_operation: 'retour' } },
    orderBy: { created_at: 'desc' }, select: { txn_id: true },
  })
  if (txn) return { kind: 'vente' as const, ref: txn.txn_id }
  const file = await tx.phone_credit_sales.findFirst({
    where: { phone_id: phoneId, is_deleted: false, statut: { not: 'annule' } }, select: { credit_id: true },
  })
  return file ? { kind: 'dossier' as const, ref: file.credit_id } : null
}

/** Status changes typed by hand (PATCH /api/phones). */
export async function assertManualStatus(tx: Tx, phone: { phone_id: string; status: string }, next: string) {
  if (next === phone.status) return
  if (next === 'vendu') throw new HttpError(400, '« Vendu » ne se met pas à la main : vendez au POS, ou utilisez « Vente passée » / « The Void » dans le menu du téléphone')
  if (next === 'reserve') throw new HttpError(400, '« Réservé » vient d’une vente en plusieurs fois ou d’une commande du site')
  if (next === 'void') throw new HttpError(400, 'Utilisez « Envoyer dans The Void » dans le menu du téléphone')
  if (phone.status === 'void') throw new HttpError(400, 'Ce téléphone est dans The Void : utilisez « Sortir du Void »')
  const live = await liveSale(tx, phone.phone_id, phone.status)
  if (live) {
    throw new HttpError(400, live.kind === 'vente'
      ? `Ce téléphone a une vente (${live.ref}) : faites un Retour au POS ou annulez la vente, le statut suivra`
      : `Ce téléphone a un dossier (${live.ref}) : passez par le dossier (décharge ou annulation)`)
  }
}

// ── A phone that comes back (owner, 2026-10-08) ─────────────────────────
// A phone sold long ago and taken back starts a second life with a record of
// its own; the old one keeps its sale. One record "in the shop" per IMEI.
const GONE = ['vendu', 'void']
export const inShop = (status: string) => !GONE.includes(status)

/** The other records of this IMEI, newest first. */
export async function sameImei(tx: Tx, imei: string | null | undefined, exceptId?: string) {
  const value = (imei ?? '').trim()
  if (!value) return []
  return tx.phones.findMany({
    where:   { imei: value, is_deleted: false, ...(exceptId && { phone_id: { not: exceptId } }) },
    orderBy: { created_at: 'desc' },
  })
}

/**
 * Refuses to bring an old record back into the shop (return, cancelled sale,
 * out of The Void) when the phone has come back since under a new record.
 */
export async function assertNoLiveTwin(tx: Tx, phone: { phone_id: string; imei: string | null }) {
  const twin = (await sameImei(tx, phone.imei, phone.phone_id)).find(p => inShop(p.status))
  if (twin) throw new HttpError(409, `Ce téléphone est revenu au magasin depuis (fiche du ${twin.created_at?.toISOString().slice(0, 10) ?? '?'}, « ${codeLabel('device_status', twin.status, 'fr')} ») : l’opération se fait sur cette fiche`)
}
