import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

type Tx = Prisma.TransactionClient

// Accessories sold in several colours (owner, 2026-10-29): stock is counted per
// colour, so each colour is its own accessory. The colours of one model share
// `groupe_couleur` — the acc_id of the group's first accessory. Set here, in
// Stock → Accessoires; the website sync turns it into colour buttons.

/** Text typed for a colour: trimmed, 30 characters max, empty = none. */
export function cleanColour(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new HttpError(400, 'Couleur invalide')
  const v = value.trim()
  if (v.length > 30) throw new HttpError(400, 'Couleur : 30 caractères maximum')
  return v || null
}

/**
 * The group to join when an accessory is "the same model as" another one
 * (`colorWith` = that accessory's acc_id; null = leave the group). The other
 * accessory starts the group when it has none yet.
 */
export async function colourGroupWith(tx: Tx, colorWith: unknown, selfId: string | null, storeId: string | null): Promise<string | null> {
  if (colorWith === null || colorWith === '') return null
  const other = await tx.accessories.findUnique({
    where:  { acc_id: String(colorWith) },
    select: { acc_id: true, groupe_couleur: true, store_id: true, is_deleted: true },
  })
  if (!other || other.is_deleted || other.acc_id === selfId) throw new HttpError(400, 'Accessoire du même modèle introuvable')
  if (storeId && other.store_id && other.store_id !== storeId) throw new HttpError(400, 'Cet accessoire est dans un autre magasin')
  if (!other.groupe_couleur) {
    await tx.accessories.update({ where: { acc_id: other.acc_id }, data: { groupe_couleur: other.acc_id } })
    return other.acc_id
  }
  return other.groupe_couleur
}
