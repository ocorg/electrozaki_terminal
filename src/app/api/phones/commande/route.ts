import { NextRequest } from 'next/server'
import type { device_condition } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS, todayDate } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { modelNameProblem, colourLooksEnglish } from '@/lib/phoneNaming'

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null)

// POST — a phone ordered for a client (lib/phoneOrder): created "en commande",
// no IMEI, then sold "Plusieurs fois" at the POS. Managers (owner, 2026-10-30).
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json() as Record<string, unknown>
    const marque = clean(body.marque), model = clean(body.model), couleur = clean(body.couleur)
    const prix = Math.round(Number(body.prix) * 100) / 100
    if (!marque || !model) throw new HttpError(400, 'Marque et modèle obligatoires')
    const problem = modelNameProblem(marque, model)
    if (problem) throw new HttpError(400, problem)
    if (colourLooksEnglish(couleur)) throw new HttpError(400, 'Couleur : tapez-la en français (ex. Noir, Bleu Ciel, Argent)')
    if (!(prix > 0)) throw new HttpError(400, 'Prix convenu obligatoire')
    const condition: device_condition = body.condition === 'occasion' ? 'occasion' : 'neuf'

    const data = await prisma.phones.create({
      data: {
        marque, model, couleur, serie: clean(body.serie) ?? marque, stockage: clean(body.stockage), ram: clean(body.ram),
        condition, status: 'disponible', source: 'fournisseur', en_commande: true, imei: null,
        prix_vente_recommande: prix, date_entree: todayDate(),
        description: `Commandé pour un client (acompte) le ${todayDate().toISOString().slice(0, 10)}`,
        store_id: (body.store_id as string | undefined) ?? user.store_id ?? null, created_by: user.id, updated_by: user.id,
      },
    })
    await logActivity({
      store_id: data.store_id, user_id: user.id, user_name: user.display_name, action_type: 'creation', module: 'telephones',
      record_id: data.phone_id, after_state: data, notes: 'Téléphone commandé pour un client (pas encore arrivé)', ip_address: getIpFromRequest(request),
    })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phones/commande')
  }
}

// DELETE ?phone_id= — an ordered phone whose sale was not made (POS abandoned):
// removed, it never existed. Refused once a sale or a file points to it.
async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const phone_id = new URL(request.url).searchParams.get('phone_id') ?? ''
    const phone = await prisma.phones.findUnique({ where: { phone_id } })
    if (!phone || !phone.en_commande || phone.is_deleted) throw new HttpError(404, 'Téléphone commandé introuvable')
    const sale = await prisma.transactions.findFirst({ where: { device_id: phone_id, device_type: 'telephone', voided: false }, select: { txn_id: true } })
    const file = await prisma.phone_credit_sales.findFirst({ where: { phone_id, is_deleted: false, statut: { not: 'annule' } }, select: { credit_id: true } })
    if (sale || file) throw new HttpError(409, `Ce téléphone commandé a déjà une vente (${sale?.txn_id ?? file?.credit_id}) : annulez le dossier`)
    await prisma.phones.update({ where: { phone_id }, data: { is_deleted: true, updated_by: user.id } })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/phones/commande')
  }
}

export const POST = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
