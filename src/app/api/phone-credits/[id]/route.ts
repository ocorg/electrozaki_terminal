import { NextRequest } from 'next/server'
import type { reprise_etat } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { recomputeCredit, requireMotif } from '@/lib/phoneCredits'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const ETATS: reprise_etat[] = ['bon', 'moyen', 'mauvais']

// PATCH /api/phone-credits/[id] — correct a credit (owner's request, 2026-10-02).
// Client details and notes: anytime (managers). Money (total agreed,
// trade-in): with a reason, not once discharged (the FAC is out), and the
// trade-in only while it hasn't entered the stock.
async function PATCH_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await req.json() as Record<string, unknown>
    const creditId = params.id

    const { before, data } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${creditId} FOR UPDATE`
      const before = await tx.phone_credit_sales.findFirst({ where: { credit_id: creditId, is_deleted: false } })
      if (!before) throw new HttpError(404, 'Crédit introuvable')
      if (before.statut === 'annule') throw new HttpError(400, 'Ce dossier est annulé')

      const update: Record<string, unknown> = {}
      if ('client_name' in body) {
        const name = str(body.client_name)
        if (!name) throw new HttpError(400, 'Le nom du client est obligatoire')
        update.client_name = name
      }
      if ('client_tel' in body) update.client_tel = str(body.client_tel)
      if ('client_cin' in body) update.client_cin = str(body.client_cin)
      if ('notes' in body)      update.notes      = str(body.notes)

      // ── Money: total agreed and trade-in ──────────────────────────
      const total = 'montant_total' in body ? Number(body.montant_total) : Number(before.montant_total)
      const repriseTouched = ['has_reprise', 'reprise_marque', 'reprise_serie', 'reprise_model', 'reprise_valeur', 'reprise_imei', 'reprise_etat']
        .some(k => k in body)
      const hasReprise = 'has_reprise' in body ? body.has_reprise === true : before.has_reprise
      const repriseValeur = hasReprise ? ('reprise_valeur' in body ? Number(body.reprise_valeur) : Number(before.reprise_valeur ?? 0)) : 0
      const moneyChanged = total !== Number(before.montant_total) || (repriseTouched && (
        hasReprise !== before.has_reprise || repriseValeur !== Number(before.reprise_valeur ?? 0) ||
        ['reprise_marque', 'reprise_serie', 'reprise_model', 'reprise_imei', 'reprise_etat']
          .some(k => k in body && (str(body[k]) ?? null) !== ((before as Record<string, unknown>)[k] ?? null))))

      let motif: string | null = null
      if (moneyChanged) {
        motif = requireMotif(body.motif)
        if (before.discharged_at) throw new HttpError(400, 'Dossier déjà déchargé (facture émise) : le montant et la reprise ne peuvent plus changer')
        if (!Number.isFinite(total) || total <= 0) throw new HttpError(400, 'Montant total invalide')
        if (repriseTouched && (before.reprise_remise || before.reprise_phone_id)) {
          throw new HttpError(400, 'Le téléphone repris est déjà reçu : la reprise ne peut plus être modifiée')
        }
        if (hasReprise) {
          const marque = 'reprise_marque' in body ? str(body.reprise_marque) : before.reprise_marque
          const model  = 'reprise_model'  in body ? str(body.reprise_model)  : before.reprise_model
          if (!marque || !model) throw new HttpError(400, 'Reprise : marque et modèle sont obligatoires')
          if (!(repriseValeur > 0)) throw new HttpError(400, 'Reprise : la valeur doit être supérieure à 0')
          if (repriseValeur >= total) throw new HttpError(400, 'La valeur de reprise ne peut pas égaler ou dépasser le prix total')
          const etat = 'reprise_etat' in body ? body.reprise_etat as reprise_etat : before.reprise_etat
          Object.assign(update, {
            has_reprise: true, reprise_marque: marque, reprise_model: model, reprise_valeur: repriseValeur,
            reprise_serie: 'reprise_serie' in body ? str(body.reprise_serie) : before.reprise_serie,
            reprise_imei:  'reprise_imei'  in body ? str(body.reprise_imei)  : before.reprise_imei,
            reprise_etat:  ETATS.includes(etat) ? etat : 'bon',
          })
        } else if (before.has_reprise) {
          Object.assign(update, { has_reprise: false, reprise_marque: null, reprise_serie: null, reprise_model: null, reprise_valeur: null, reprise_imei: null, reprise_etat: 'bon' })
        }
        const paid = Number(before.montant_paye)
        if (total - repriseValeur < paid - 0.01) {
          throw new HttpError(400, `Déjà versé ${paid} DH : le total (moins la reprise) ne peut pas être inférieur`)
        }
        update.montant_total = total
      }

      if (!Object.keys(update).length) throw new HttpError(400, 'Aucune modification')
      await tx.phone_credit_sales.update({ where: { credit_id: creditId }, data: update })
      // The file follows a POS sale: the agreed total is that sale's price
      if (before.txn_id && update.montant_total !== undefined) {
        await tx.transactions.update({ where: { txn_id: before.txn_id }, data: { prix_vente: total, updated_by: user.id } })
      }
      const data = await recomputeCredit(tx, creditId)
      return { before, data: { ...data, motif } }
    })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'telephones',
      record_id:    creditId,
      before_state: before,
      after_state:  data,
      notes:        data.motif ? `Crédit modifié : ${data.motif}` : 'Crédit modifié (infos client)',
      ip_address:   getIpFromRequest(req),
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/phone-credits/[id]')
  }
}

export const PATCH = withNotify(PATCH_)
