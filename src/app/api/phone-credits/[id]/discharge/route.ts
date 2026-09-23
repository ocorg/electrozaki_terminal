import { NextRequest } from 'next/server'
import type { device_condition } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { notifyCaisseChange } from '@/lib/realtime'

// Trade-in state → condition of the phone entering stock
const CONDITION_FOR_ETAT: Record<string, device_condition> = { bon: 'occasion', moyen: 'occasion', mauvais: 'defectueux' }

// POST /api/phone-credits/[id]/discharge
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user     = await requireActiveUser()
    const creditId = params.id
    const body     = await req.json().catch(() => ({})) as Record<string, unknown>
    const storeId  = user.store_id ?? (body.store_id as string) ?? 'EZ-001'

    const result = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ credit_id: string }[]>`
        SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${creditId} FOR UPDATE`
      if (!locked) throw new HttpError(404, 'Crédit introuvable')

      // phone_credits_summary (view) carries montant_restant and the phone's marque/model
      const [credit] = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM phone_credits_summary WHERE credit_id = ${creditId}`
      if (!credit) throw new HttpError(404, 'Crédit introuvable')
      if (Number(credit.montant_restant) > 0.01) {
        throw new HttpError(400, `Décharge impossible — reste ${Number(credit.montant_restant).toFixed(2)} DH à payer`)
      }
      if (credit.discharged_at) throw new HttpError(400, 'Ce crédit a déjà été déchargé')

      const hasReprise     = Boolean(credit.has_reprise)
      const repriseWarning = hasReprise && !credit.reprise_remise ? 'reprise_not_previously_confirmed' as const : null

      await tx.phone_credit_sales.update({
        where: { credit_id: creditId },
        data:  { discharged_at: new Date(), discharged_by: user.id, statut: 'solde' },
      })

      // Trade-in phone enters stock — unless it was already entered at credit creation
      let reprisePhoneId = (credit.reprise_phone_id as string | null) ?? null
      if (hasReprise && !reprisePhoneId) {
        const phone = await tx.phones.create({
          data: {
            source:      'reprise',
            status:      'disponible',
            marque:      credit.reprise_marque as string,
            serie:       (credit.reprise_serie as string | null) ?? (credit.reprise_marque as string),
            model:       credit.reprise_model as string,
            imei:        (credit.reprise_imei as string | null) ?? null,
            condition:   CONDITION_FOR_ETAT[credit.reprise_etat as string] ?? 'occasion',
            prix_achat:  Number(credit.reprise_valeur),
            store_id:    storeId,
            description: `Reprise crédit ${creditId} — ${credit.client_name as string}`,
            created_by:  user.id,
            updated_by:  user.id,
          },
          select: { phone_id: true },
        })
        reprisePhoneId = phone.phone_id
        await tx.phone_credit_sales.update({
          where: { credit_id: creditId },
          data:  { reprise_phone_id: reprisePhoneId, reprise_remise: true, reprise_remise_at: new Date() },
        })
      }

      // A reserved phone leaves the shop now
      if (!credit.phone_remis) {
        await tx.phones.update({ where: { phone_id: credit.phone_id as string }, data: { status: 'vendu', updated_by: user.id } })
      }

      const phone = await tx.phones.findUnique({ where: { phone_id: credit.phone_id as string }, select: { imei: true, serie: true } })
      return { credit, hasReprise, reprisePhoneId, repriseWarning, phone }
    })

    const { credit, hasReprise, reprisePhoneId, repriseWarning, phone } = result
    await logActivity({
      user_id:     user.id,
      store_id:    storeId,
      user_name:   user.display_name,
      module:      'telephones',
      action_type: 'modification',
      record_id:   creditId,
      ip_address:  getIpFromRequest(req),
      after_state: {
        credit_id: creditId, phone_id: credit.phone_id, action: 'decharge', phone_remis: credit.phone_remis,
        montant_total: credit.montant_total, has_reprise: hasReprise, reprise_phone_id: reprisePhoneId,
        ...(repriseWarning ? { warning: repriseWarning } : {}),
      },
    })
    if (hasReprise) await notifyCaisseChange(storeId)

    return json({
      data: {
        discharged:       true,
        credit_id:        creditId,
        reprise_phone_id: reprisePhoneId,
        ...(repriseWarning ? { warning: repriseWarning } : {}),
        fac_prefill: {
          phone_id:     credit.phone_id as string,
          client_name:  credit.client_name as string,
          client_tel:   (credit.client_tel as string | null) ?? '',
          client_cin:   (credit.client_cin as string | null) ?? '',
          montant:      Number(credit.montant_total),
          device_label: `${credit.marque as string} ${credit.model as string}`,
          imei:         phone?.imei ?? phone?.serie ?? '',
        },
      },
    })
  } catch (err) {
    return handleError(err, 'POST /api/phone-credits/[id]/discharge')
  }
}
