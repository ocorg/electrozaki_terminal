import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite } from '@/lib/storefront/access'
import { uploadSitePhoto, deleteSitePhoto } from '@/lib/storefront/storage'

type Ctx = { params: { id: string } }

// POST (multipart, field "file") — the page's banner photo (managers).
async function POST_(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const page = await site().landingPage.findUnique({ where: { id: params.id }, select: { id: true, title: true, bannerUrl: true } })
    if (!page) throw new HttpError(404, 'Page introuvable')
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob)) throw new HttpError(400, 'Aucun fichier')

    const url = await uploadSitePhoto(Buffer.from(await file.arrayBuffer()))
    await site().landingPage.update({ where: { id: page.id }, data: { bannerUrl: url } })
    if (page.bannerUrl) await deleteSitePhoto(page.bannerUrl)
    await logSite(user, 'modification', `Bannière de la page promo « ${page.title} »`, { record_id: page.id })
    refreshSite()
    return json({ ok: true, url }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/landing/[id]/banner')
  }
}

export const POST = withNotify(POST_)
