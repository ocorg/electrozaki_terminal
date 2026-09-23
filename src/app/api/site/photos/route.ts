import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite } from '@/lib/storefront/access'
import { buildPhoneListings } from '@/lib/storefront/listing'
import { readErpStock } from '@/lib/storefront/sync'
import { uploadSitePhoto, deleteSitePhoto } from '@/lib/storefront/storage'

// GET — every phone model + colour currently for sale, with its photo (or
// none yet), so staff see at a glance what still needs a picture.
export async function GET() {
  try {
    await requireUser()
    const [{ phones }, photos] = await Promise.all([
      readErpStock(),
      site().modelPhoto.findMany({ select: { id: true, modelKey: true, color: true, url: true } }),
    ])
    const combos = new Map<string, { modelKey: string; model: string; brand: string; color: string; units: number }>()
    for (const listing of buildPhoneListings(phones)) {
      for (const v of listing.variants) {
        const color = v.photoColor ?? ''
        if (!color) continue
        const key   = `${listing.modelKey}|${color.toLowerCase()}`
        const combo = combos.get(key) ?? { modelKey: listing.modelKey, model: listing.modelName, brand: listing.brand, color, units: 0 }
        combo.units += v.stockQuantity
        combos.set(key, combo)
      }
    }
    const data = Array.from(combos.values())
      .map(c => {
        const photo = photos.find(p => p.modelKey === c.modelKey && p.color.toLowerCase() === c.color.toLowerCase())
        return { ...c, photoId: photo?.id ?? null, url: photo?.url ?? null }
      })
      .sort((a, b) => Number(!!a.url) - Number(!!b.url) || b.units - a.units || a.model.localeCompare(b.model))
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/site/photos')
  }
}

// POST (multipart: modelKey, color, file) — set the photo of one model + colour.
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const form = await request.formData()
    const modelKey = String(form.get('modelKey') ?? '').trim()
    const color    = String(form.get('color') ?? '').trim()
    const file     = form.get('file')
    if (!modelKey || !color || modelKey.length > 120 || color.length > 60) throw new HttpError(400, 'Modèle ou couleur invalide')
    if (!(file instanceof Blob)) throw new HttpError(400, 'Aucun fichier')

    const url = await uploadSitePhoto(Buffer.from(await file.arrayBuffer()))
    const db  = site()
    const old = await db.modelPhoto.findUnique({ where: { modelKey_color: { modelKey, color } } })
    await db.modelPhoto.upsert({
      where:  { modelKey_color: { modelKey, color } },
      create: { modelKey, color, url },
      update: { url },
    })
    if (old) await deleteSitePhoto(old.url)

    await logSite(user, old ? 'modification' : 'creation', `Photo du site : ${modelKey.split('|')[1] ?? modelKey} — ${color}`)
    // withNotify → the sync puts the photo on every matching product.
    return json({ ok: true, url }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/photos')
  }
}

// DELETE { id }
async function DELETE_(request: NextRequest) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const { id } = await request.json()
    const photo = await site().modelPhoto.findUnique({ where: { id: String(id) } })
    if (!photo) throw new HttpError(404, 'Photo introuvable')
    await site().modelPhoto.delete({ where: { id: photo.id } })
    await deleteSitePhoto(photo.url)
    await logSite(user, 'suppression', `Photo du site retirée : ${photo.modelKey.split('|')[1] ?? photo.modelKey} — ${photo.color}`)
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/photos')
  }
}

export const POST   = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
