import { json, handleError, requireUser, requireActiveUser, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { installFacetTemplates } from '@/lib/storefront/facetTemplates'

// The fiche of each accessory type (owner, 2026-11-06; lib/storefront/facetTemplates):
// GET = what installing would add, POST = add it. Only adds what is missing.

export async function GET() {
  try {
    await requireUser(MANAGERS)
    return json({ data: await installFacetTemplates(site(), false) })
  } catch (err) {
    return handleError(err, 'GET /api/site/facets/templates')
  }
}

async function POST_() {
  try {
    const user = await requireActiveUser(MANAGERS)
    const plan = await site().$transaction(tx => installFacetTemplates(tx, true))
    const added = plan.newGroups.length + plan.newOptions.length + plan.newLinks.length
    if (added) {
      await logSite(user, 'creation', `Fiches par type installées : ${plan.newGroups.map(g => g.name).join(', ') || 'compléments'}`, { after_state: plan })
      refreshSite()
    }
    return json({ ok: true, data: plan })
  } catch (err) {
    return handleError(err, 'POST /api/site/facets/templates')
  }
}

export const POST = withNotify(POST_)
