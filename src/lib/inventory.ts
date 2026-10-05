import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

// "Apple iPhone 13 Pro 128GB" → "iPhone 13 Pro": drops the storage suffix and
// avoids repeating the brand when the model already starts with it.
export function phoneLabel(marque: string | null, model: string | null) {
  const brand      = (marque ?? '').trim()
  const cleanModel = (model ?? '').trim().replace(/\s*\d+(GB|TB)\s*$/i, '').trim()
  return cleanModel.toLowerCase().startsWith(brand.toLowerCase()) ? cleanModel : `${brand} ${cleanModel}`.trim()
}

export function countByResult(items: { resultat: string }[]) {
  return items.reduce((acc: Record<string, number>, i) => {
    acc[i.resultat] = (acc[i.resultat] ?? 0) + 1
    return acc
  }, {})
}

/** Phones the shop is expected to hold: everything that did not leave. */
export const EXPECTED_PHONES = (storeId: string) => ({
  store_id: storeId, is_deleted: false, status: { notIn: ['vendu', 'void', 'en_livraison'] },
} satisfies Prisma.phonesWhereInput)

/**
 * Keeps an open inventory in step with the live stock (owner, 2026-10-05):
 * the shop keeps selling, adding and correcting phones while it counts, often
 * from a second device, and the list must not have to be started again.
 *   • a phone that left since (sold, The Void, deleted) and was not scanned
 *     yet is no longer waited for;
 *   • a phone that came in since (added, returned) is waited for;
 *   • a phone scanned as unknown / not expected that has since been
 *     registered or put back in stock counts as found;
 *   • a corrected IMEI, model or status shows as it is now.
 * What was scanned stays scanned. Returns true when something changed.
 */
export async function syncInventoryWithStock(sessionId: string, storeId: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    // One sync at a time per session: two devices refresh the same list
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`
    const session = await tx.inventory_sessions.findUnique({ where: { session_id: sessionId }, select: { statut: true, snapshot_count: true } })
    if (!session || session.statut !== 'en_cours') return false

    const [phones, items] = await Promise.all([
      tx.phones.findMany({ where: EXPECTED_PHONES(storeId), select: { phone_id: true, imei: true, marque: true, model: true, status: true } }),
      tx.inventory_session_items.findMany({ where: { session_id: sessionId } }),
    ])
    const expected = phones.filter(p => p.imei?.trim())
    const expectedIds = new Set(expected.map(p => p.phone_id))
    const byPhone = new Map(items.filter(i => i.phone_id).map(i => [i.phone_id!, i]))
    const orphans = new Map(items.filter(i => !i.phone_id).map(i => [i.imei, i]))   // scanned, IMEI unknown then
    let changed = false

    for (const p of expected) {
      const imei   = p.imei!.trim()
      const label  = phoneLabel(p.marque, p.model)
      const item   = byPhone.get(p.phone_id)
      const orphan = orphans.get(imei)
      if (item) {
        const data: Prisma.inventory_session_itemsUpdateInput = {}
        if (item.imei !== imei) data.imei = imei
        if (item.phone_label !== label) data.phone_label = label
        if (item.phone_status !== p.status) data.phone_status = p.status
        // scanned while it was not expected (e.g. sold by mistake, since put back)
        if (item.resultat === 'hors_perimetre') data.resultat = 'trouve'
        // scanned under its real IMEI before the record was corrected
        if (orphan) {
          if (item.resultat === 'en_attente') { data.resultat = 'trouve'; data.scanned_at = orphan.scanned_at ?? new Date() }
          await tx.inventory_session_items.delete({ where: { item_id: orphan.item_id } })
          orphans.delete(imei); changed = true
        }
        if (Object.keys(data).length) { await tx.inventory_session_items.update({ where: { item_id: item.item_id }, data }); changed = true }
      } else if (orphan) {
        // scanned as unknown, registered since: it is there
        await tx.inventory_session_items.update({
          where: { item_id: orphan.item_id },
          data:  { phone_id: p.phone_id, phone_label: label, phone_status: p.status, resultat: 'trouve' },
        })
        orphans.delete(imei); changed = true
      } else {
        await tx.inventory_session_items.create({
          data: { session_id: sessionId, phone_id: p.phone_id, imei, phone_label: label, phone_status: p.status, resultat: 'en_attente' },
        })
        changed = true
      }
    }

    // Not scanned yet and no longer expected: nothing to look for
    const gone = items.filter(i => i.resultat === 'en_attente' && i.phone_id && !expectedIds.has(i.phone_id)).map(i => i.item_id)
    if (gone.length) { await tx.inventory_session_items.deleteMany({ where: { item_id: { in: gone } } }); changed = true }

    if (changed) {
      const inScope = await tx.inventory_session_items.count({ where: { session_id: sessionId, resultat: { in: ['en_attente', 'trouve', 'manquant'] } } })
      if (inScope !== session.snapshot_count) await tx.inventory_sessions.update({ where: { session_id: sessionId }, data: { snapshot_count: inScope } })
    }
    return changed
  }, { timeout: 20_000 })
}
