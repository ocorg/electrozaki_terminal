import { NextRequest } from 'next/server'
import { Prisma, type credit_status, type payment_method, type reprise_etat } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, todayDate, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// ─────────────────────────────────────────────
// GET /api/phone-credits
// ?phone_id=PHO-XXXX  → crédit actif + historique paiements
// ?store_id=EZ-001    → tous les crédits du magasin
// ?statut=en_cours    → filtre optionnel
// phone_credits_summary is a database view
// ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(req.url)
    const phoneId = searchParams.get('phone_id')
    const storeId = searchParams.get('store_id')
    const statut  = searchParams.get('statut') as credit_status | null
    if (!phoneId && !storeId) throw new HttpError(400, 'phone_id ou store_id requis')

    const conds = [Prisma.sql`TRUE`]
    if (phoneId) conds.push(Prisma.sql`phone_id = ${phoneId}`)
    if (storeId) conds.push(Prisma.sql`store_id = ${storeId}`)
    if (statut)  conds.push(Prisma.sql`statut = ${statut}::credit_status`)
    const credits = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM phone_credits_summary WHERE ${Prisma.join(conds, ' AND ')} ORDER BY created_at DESC`

    if (phoneId && credits.length > 0) {
      const payments = await prisma.phone_credit_payments.findMany({
        where:   { credit_id: credits[0].credit_id as string },
        orderBy: { created_at: 'asc' },
      })
      return json({ data: { credit: credits[0], payments } })
    }
    return json({ data: credits })
  } catch (err) {
    return handleError(err, 'GET /api/phone-credits')
  }
}

// ─────────────────────────────────────────────
// POST /api/phone-credits — créer une vente à crédit
// ─────────────────────────────────────────────
async function POST_(req: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await req.json() as Record<string, unknown>

    const phone_id        = body.phone_id    as string
    const client_name     = body.client_name as string
    const montant_total   = Number(body.montant_total)
    const avance_initiale = body.avance_initiale ? Number(body.avance_initiale) : 0
    const method          = (body.payment_method as payment_method | undefined) ?? 'especes'
    const phone_remis     = Boolean(body.phone_remis)

    const has_reprise       = body.has_reprise === true
    const reprise_valeur    = has_reprise && body.reprise_valeur ? Number(body.reprise_valeur) : 0
    const reprise_remis_now = has_reprise && body.reprise_remis_now === true
    const storeId = user.store_id ?? (body.store_id as string) ?? 'EZ-001'

    if (has_reprise) {
      if (!body.reprise_marque || !body.reprise_model) throw new HttpError(400, 'Reprise : marque et modèle sont obligatoires')
      if (reprise_valeur <= 0) throw new HttpError(400, 'Reprise : la valeur doit être supérieure à 0')
      if (reprise_valeur >= montant_total) throw new HttpError(400, 'La valeur de reprise ne peut pas égaler ou dépasser le prix total')
    }
    if (!phone_id || !client_name || !montant_total) throw new HttpError(400, 'phone_id, client_name et montant_total sont obligatoires')
    if (montant_total <= 0) throw new HttpError(400, 'Montant total invalide')
    if (avance_initiale > montant_total) throw new HttpError(400, "L'avance ne peut pas dépasser le montant total")

    // Credit, down payment and phone status commit together
    const { credit, firstPayment, newStatus } = await prisma.$transaction(async (tx) => {
      const phone = await tx.phones.findFirst({ where: { phone_id, is_deleted: false }, select: { status: true } })
      if (!phone) throw new HttpError(404, 'Téléphone introuvable')
      if (phone.status !== 'disponible') throw new HttpError(400, 'Ce téléphone n\'est pas disponible')

      const existing = await tx.phone_credit_sales.findFirst({ where: { phone_id, statut: 'en_cours', is_deleted: false } })
      if (existing) throw new HttpError(400, 'Ce téléphone a déjà un crédit en cours')

      let credit = await tx.phone_credit_sales.create({
        data: {
          phone_id,
          client_name,
          client_tel:        (body.client_tel as string | undefined) ?? null,
          client_cin:        (body.client_cin as string | undefined) ?? null,
          montant_total,
          montant_paye:      0,
          statut:            'en_cours',
          phone_remis,
          notes:             (body.notes as string | undefined) ?? null,
          store_id:          storeId,
          created_by:        user.id,
          has_reprise,
          reprise_marque:    has_reprise ? (body.reprise_marque as string) : null,
          reprise_serie:     has_reprise ? ((body.reprise_serie as string | undefined) ?? null) : null,
          reprise_model:     has_reprise ? (body.reprise_model as string) : null,
          reprise_valeur:    has_reprise ? reprise_valeur : null,
          reprise_imei:      has_reprise ? ((body.reprise_imei as string | undefined) ?? null) : null,
          reprise_etat:      has_reprise ? ((body.reprise_etat as reprise_etat | undefined) ?? 'bon') : 'bon',
          reprise_remise:    reprise_remis_now,
          reprise_remise_at: reprise_remis_now ? new Date() : null,
        },
      })

      let firstPayment = null
      if (avance_initiale > 0) {
        firstPayment = await tx.phone_credit_payments.create({
          data: { credit_id: credit.credit_id, montant: avance_initiale, payment_method: method, date_paiement: todayDate(), store_id: storeId, created_by: user.id },
        })
        const cashObligation = montant_total - (has_reprise ? reprise_valeur : 0)
        credit = await tx.phone_credit_sales.update({
          where: { credit_id: credit.credit_id },
          data:  { montant_paye: avance_initiale, ...(avance_initiale >= cashObligation && { statut: 'solde' }) },
        })
      }

      // Phone handed over → sold; otherwise reserved until the credit is paid
      const newStatus = phone_remis ? 'vendu' : 'reserve'
      await tx.phones.update({ where: { phone_id }, data: { status: newStatus, updated_by: user.id } })
      return { credit, firstPayment, newStatus }
    })

    await logActivity({
      user_id:     user.id,
      store_id:    storeId,
      user_name:   user.display_name,
      module:      'telephones',
      action_type: 'creation',
      record_id:   credit.credit_id,
      ip_address:  getIpFromRequest(req),
      after_state: {
        credit_id: credit.credit_id, phone_id, client_name, montant_total, avance_initiale,
        phone_remis, new_phone_status: newStatus, has_reprise,
        ...(has_reprise ? { reprise_model: credit.reprise_model, reprise_valeur } : {}),
      },
    })

    return json({ data: { credit, firstPayment } }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phone-credits')
  }
}

export const POST = withNotify(POST_)
