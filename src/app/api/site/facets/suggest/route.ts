import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { suggestFacetTicks, applyFacetTicks } from '@/lib/storefront/facetSuggest'

// Fiche ticks guessed from the article names (owner, 2026-11-06;
// lib/storefront/facetSuggest): GET = the suggestions, POST = add the ones
// staff kept. Managers only.

export async function GET() {
  try {
    await requireUser(MANAGERS)
    return json({ data: await suggestFacetTicks(site()) })
  } catch (err) {
    return handleError(err, 'GET /api/site/facets/suggest')
  }
}

// POST { items: [{ productId, optionIds }] }
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    if (!Array.isArray(body.items) || body.items.length > 1000) throw new HttpError(400, 'Liste invalide')
    const items = body.items.map((i: { productId?: unknown; optionIds?: unknown }) => ({
      productId: String(i.productId ?? ''),
      optionIds: Array.isArray(i.optionIds) ? i.optionIds.slice(0, 30).map(String) : [],
    })).filter((i: { optionIds: string[] }) => i.optionIds.length)
    const db = site()
    const ids: string[] = Array.from(new Set(items.map((i: { productId: string }) => i.productId)))
    const found = await db.product.count({ where: { id: { in: ids }, isPhone: false } })
    if (found !== ids.length) throw new HttpError(400, 'Un des produits est introuvable')
    // one insert: all the kept ticks are added together, or none
    const added = await applyFacetTicks(db, items)
    if (added) {
      await logSite(user, 'modification', `Fiches : ${added} case(s) cochée(s) d'après les noms des articles (${ids.length} produit(s))`)
      refreshSite(ids)
    }
    return json({ ok: true, added })
  } catch (err) {
    return handleError(err, 'POST /api/site/facets/suggest')
  }
}

export const POST = withNotify(POST_)
