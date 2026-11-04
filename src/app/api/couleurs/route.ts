import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { listCouleurs, cleanCouleurInput, copyCouleursToSite } from '@/lib/couleurs'
import { storefrontDb, storefrontConfigured } from '@/lib/storefront/db'
import { refreshSite } from '@/lib/storefront/access'

// The accessory colour list (owner, 2026-11-04; rules in lib/couleurs).
// Everyone reads it (the pickers); owner and managers add and edit.

// GET ?all=1 — also the colours taken out of the list
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const all = new URL(request.url).searchParams.get('all') === '1'
    return json({ data: await listCouleurs(all) })
  } catch (err) {
    return handleError(err, 'GET /api/couleurs')
  }
}

// POST { nom, hex, nom_en?, nom_ar?, motif? } — a new colour
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const input = cleanCouleurInput(await request.json(), false)
    const same = await prisma.couleurs.findFirst({ where: { nom: { equals: input.nom!, mode: 'insensitive' } }, select: { nom: true } })
    if (same) throw new HttpError(409, `« ${same.nom} » est déjà dans la liste`)
    const last = await prisma.couleurs.aggregate({ _max: { ordre: true } })
    const data = await prisma.couleurs.create({
      data: { nom: input.nom!, hex: input.hex!, nom_en: input.nom_en ?? null, nom_ar: input.nom_ar ?? null, motif: input.motif ?? null, ordre: (last._max.ordre ?? 0) + 1, created_by: user.id },
    })
    await copyCouleursToSite(data.nom).catch(e => console.error("couleurs → site", e))
    refreshSite()
    await logActivity({ store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name, action_type: 'creation', module: 'accessoires',
      record_id: data.nom, after_state: data, notes: `Couleur « ${data.nom} » (${data.hex}) ajoutée à la liste`, ip_address: getIpFromRequest(request) })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/couleurs')
  }
}

// PATCH { nom, newNom?, hex?, nom_en?, nom_ar?, motif?, actif? } — edit a colour.
// A new name follows everywhere: accessories (database link), website photos
// (renamed there in the same step) and the website's colour buttons.
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const before = await prisma.couleurs.findUnique({ where: { nom: String(body.nom ?? '') } })
    if (!before) throw new HttpError(404, 'Couleur introuvable')
    const { nom: _ignored, ...rest } = body
    const input = cleanCouleurInput({ ...rest, ...('newNom' in body && { nom: body.newNom }) }, true)
    if (input.nom && input.nom !== before.nom) {
      const same = await prisma.couleurs.findFirst({ where: { nom: { equals: input.nom, mode: 'insensitive' }, NOT: { nom: before.nom } }, select: { nom: true } })
      if (same) throw new HttpError(409, `« ${same.nom} » est déjà dans la liste`)
    }
    const data = await prisma.couleurs.update({ where: { nom: before.nom }, data: input })
    if (data.nom !== before.nom && storefrontConfigured()) {
      const db = storefrontDb()
      // the website's photos follow the colour's row (link with ON UPDATE CASCADE)
      const there = await db.color.findUnique({ where: { name: before.nom }, select: { name: true } })
      if (there) await db.color.update({ where: { name: before.nom }, data: { name: data.nom } })
      await db.product.updateMany({ where: { colorName: before.nom }, data: { colorName: data.nom } })
    }
    await copyCouleursToSite(data.nom).catch(e => console.error("couleurs → site", e))
    refreshSite()
    const said = data.nom !== before.nom ? `renommée « ${data.nom} »` : 'modifiée'
    await logActivity({ store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'accessoires',
      record_id: data.nom, before_state: before, after_state: data, notes: `Couleur « ${before.nom} » ${said}`, ip_address: getIpFromRequest(request) })
    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/couleurs')
  }
}

export const POST  = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
