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

// Since stock is counted per variant (2026-11-06, lib/accessoryVariants), the
// popup also asks the phone model, and the sale takes from that variant.
export type SaleChoice = { couleur: string | null; design: string | null; modele: string | null; variant_id: string | null }

const shortText = (v: unknown, what: string): string | null => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw new HttpError(400, `${what} invalide`)
  return v.trim().replace(/\s+/g, ' ').slice(0, 40) || null
}

/** The colour / design / phone model sent with an accessory sale line: colour from the list, the others short text. */
export async function saleChoice(deviceType: string, body: { couleur?: unknown; design?: unknown; modele?: unknown; variant_id?: unknown }): Promise<SaleChoice> {
  if (deviceType !== 'accessoire') return { couleur: null, design: null, modele: null, variant_id: null }
  // the variant picked at the till (a group of phones): checked when the stock is taken
  const variant_id = typeof body.variant_id === 'string' && /^VAR-\d{1,9}$/.test(body.variant_id) ? body.variant_id : null
  return { couleur: await couleurFromList(body.couleur), design: shortText(body.design, 'Design'), modele: shortText(body.modele, 'Modèle'), variant_id }
}

// photos: the website photos of that design × colour (the till shows one on the design buttons, owner 2026-11-07)
export type FamilyChoice = { design: string | null; couleur: string; photos: string[] }

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
      select: { erpKey: true, images: { where: { colorName: { not: null } }, select: { designName: true, colorName: true, url: true }, orderBy: { sortOrder: 'asc' } } },
    })
    const out: Record<string, FamilyChoice[]> = {}
    for (const p of products) {
      const accId = byRef.get(p.erpKey!)
      if (!accId) continue
      const byKey = new Map<string, FamilyChoice>()
      for (const i of p.images) {
        const key = `${i.designName ?? ''}|${i.colorName}`
        const known = byKey.get(key)
        if (known) known.photos.push(i.url)
        else byKey.set(key, { design: i.designName, couleur: i.colorName!, photos: [i.url] })
      }
      out[accId] = [...byKey.values()]
    }
    return out
  } catch (err) {
    console.error('[saleColour] website colours unavailable:', err)
    return {}
  }
}
