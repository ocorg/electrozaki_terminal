import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api'
import { couleurFromList } from '@/lib/couleurs'
import { refOf } from '@/lib/storefront/listing'
import { storefrontDb, storefrontConfigured } from '@/lib/storefront/db'

// The colour of an accessory sold (owner, 2026-11-06). At the till, picking an
// accessory that comes in several colours opens a colour popup:
//  - a model split by colour in Stock → Accessoires (one article per colour,
//    "+ Couleur"): the popup picks the article, so its own stock goes down;
//  - a pochette family (one article, its colours and designs on the website
//    photos, Site web → Catalogue): the popup picks the design and colour,
//    written on the sale — stock is not counted per colour yet, but the sales
//    already say which colour went out.
// Shared by the sale (api/transactions), "Vente à livrer" (lib/deliveryOrders)
// and the till's popup (api/pos/couleurs).

export type SaleChoice = { couleur: string | null; design: string | null }

/** The colour / design sent with an accessory sale line: colour from the list, design short text. */
export async function saleChoice(deviceType: string, body: { couleur?: unknown; design?: unknown }): Promise<SaleChoice> {
  if (deviceType !== 'accessoire') return { couleur: null, design: null }
  const couleur = await couleurFromList(body.couleur)
  let design: string | null = null
  if (body.design !== undefined && body.design !== null && body.design !== '') {
    if (typeof body.design !== 'string') throw new HttpError(400, 'Design invalide')
    design = body.design.trim().slice(0, 40) || null
  }
  return { couleur, design }
}

export type FamilyChoice = { design: string | null; couleur: string }

/**
 * For each ERP accessory whose website product has photos with a colour
 * (pochette families): its design × colour choices, in photo order.
 * Empty when the website isn't configured or can't be reached (the till then
 * simply sells the article without a colour).
 */
export async function familyChoices(storeId: string | null): Promise<Record<string, FamilyChoice[]>> {
  if (!storefrontConfigured()) return {}
  try {
    const accs = await prisma.accessories.findMany({
      where: { is_deleted: false, ...(storeId && { store_id: storeId }) },
      select: { acc_id: true },
    })
    const byRef = new Map(accs.map(a => [refOf('acc', a.acc_id), a.acc_id]))
    const products = await storefrontDb().product.findMany({
      where: { isPhone: false, erpKey: { in: [...byRef.keys()] }, images: { some: { colorName: { not: null } } } },
      select: { erpKey: true, images: { where: { colorName: { not: null } }, select: { designName: true, colorName: true }, orderBy: { sortOrder: 'asc' } } },
    })
    const out: Record<string, FamilyChoice[]> = {}
    for (const p of products) {
      const accId = byRef.get(p.erpKey!)
      if (!accId) continue
      const seen = new Set<string>()
      out[accId] = p.images.flatMap(i => {
        const key = `${i.designName ?? ''}|${i.colorName}`
        if (seen.has(key)) return []
        seen.add(key)
        return [{ design: i.designName, couleur: i.colorName! }]
      })
    }
    return out
  } catch (err) {
    console.error('[saleColour] website colours unavailable:', err)
    return {}
  }
}
