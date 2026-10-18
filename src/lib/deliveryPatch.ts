// Updates of an order to deliver (rules: lib/deliveryOrders.ts), from
// PATCH /api/deliveries. One body = one step:
//   { action: 'avance', montant, ref, date }   the advance came in (bank transfer)
//   { action: 'modifier', adresse, ville, transporteur, frais_livraison, frais_charge, notes }
//   { action: 'versement', recu: true|false }  the company paid the shop
//   { statut: 'prepare' | 'en_transit' }        on its way (a phone needs its advance)
//   { statut: 'livre', date }                   delivered: the sale is recorded
//   { statut: 'retour' | 'annule', motif, avance_decision }  back to stock, no sale
import type { NextRequest } from 'next/server'
import type { delivery_status } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, HttpError, dateOnly, todayDate } from '@/lib/api'
import type { AuthClaims } from '@/types/auth'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { codeLabel } from '@/lib/codes'
import { alertLater, deviceName, money } from '@/lib/reports'
import { syncDeliveryToOrders } from '@/lib/storefront/shipping'
import { workingDay } from '@/lib/catchUp'
import { AVANCE_MIN, orderMoney, recordSales, releaseItems } from '@/lib/deliveryOrders'

const TERMINAL: delivery_status[] = ['livre', 'annule', 'retour']
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (v == null ? 0 : Number(v))
const round2 = (n: number) => Math.round(n * 100) / 100

export async function patchOrder(request: NextRequest, user: AuthClaims, deliveryId: string, body: Record<string, unknown>) {
  const action = body.action as string | undefined
  const statut = body.statut as delivery_status | undefined
  // the date a delivery happened: today, or a forgotten day being caught up on
  const day = statut === 'livre' ? await workingDay(user, body.date, null) : null

  const { before, updated, txnIds, what } = await prisma.$transaction(async tx => {
    const [locked] = await tx.$queryRaw<{ delivery_id: string }[]>`SELECT delivery_id FROM deliveries WHERE delivery_id = ${deliveryId} FOR UPDATE`
    if (!locked) throw new HttpError(404, 'Livraison introuvable')
    const before = await tx.deliveries.findUniqueOrThrow({ where: { delivery_id: deliveryId }, include: { delivery_items: true } })
    const withPhone = before.delivery_items.some(i => i.device_type === 'telephone')
    const closed = TERMINAL.includes(before.statut)
    let txnIds: string[] = []
    let what = ''
    let data: Record<string, unknown> = {}

    if (action === 'avance') {
      if (closed) throw new HttpError(400, 'Commande terminée')
      const montant = round2(Number(body.montant))
      if (!(montant >= 0) || montant > num(before.montant_total)) throw new HttpError(400, 'Montant d’avance invalide')
      data = {
        montant_avance: montant, avance_ref: str(body.ref) ?? before.avance_ref, avance_date: montant > 0 ? (dateOnly(body.date) ?? todayDate()) : null,
        payment_method: montant > 0 ? 'virement' : null,
        payment_scenario: montant <= 0 ? 'paiement_livraison' : montant >= num(before.montant_total) ? 'avance_totale' : 'avance_partielle',
        ...(before.statut === 'attente_avance' && (!withPhone || montant >= AVANCE_MIN) && { statut: 'prepare' }),
      }
      what = `Avance ${montant} DH`
    } else if (action === 'modifier') {
      if (closed) throw new HttpError(400, 'Commande terminée')
      const frais = body.frais_livraison == null ? num(before.frais_livraison) : round2(Number(body.frais_livraison))
      if (!(frais >= 0)) throw new HttpError(400, 'Frais invalides')
      data = {
        client_address: str(body.adresse) ?? before.client_address, ville: str(body.ville) ?? before.ville,
        transporteur: 'transporteur' in body ? str(body.transporteur) : before.transporteur,
        frais_livraison: frais, frais_charge: body.frais_charge === 'boutique' ? 'boutique' : body.frais_charge === 'client' ? 'client' : before.frais_charge,
        notes: 'notes' in body ? str(body.notes) : before.notes,
      }
      what = 'Commande modifiée'
    } else if (action === 'versement') {
      if (before.statut !== 'livre') throw new HttpError(400, 'Le versement suit la livraison')
      data = { versement_recu_at: body.recu === false ? null : new Date() }
      what = body.recu === false ? 'Versement annulé' : 'Versement du transporteur reçu'
    } else if (statut === 'prepare' || statut === 'en_transit' || statut === 'confirmation_en_cours' || statut === 'attente_avance') {
      if (closed) throw new HttpError(400, 'Commande terminée')
      if ((statut === 'prepare' || statut === 'en_transit') && withPhone && num(before.montant_avance) < AVANCE_MIN) {
        throw new HttpError(400, `Un téléphone part après son avance : ${AVANCE_MIN} DH au moins (enregistrez-la d’abord)`)
      }
      data = { statut }
      what = `Statut : ${codeLabel('delivery_status', statut, 'fr')}`
    } else if (statut === 'livre') {
      if (before.statut !== 'prepare' && before.statut !== 'en_transit') throw new HttpError(400, 'Seule une commande préparée ou en route peut être livrée')
      txnIds = await recordSales(tx, before, day!.date, user.id)
      data = { statut, date_livraison: day!.date, caisse_entry_created: true }
      what = `Livrée le ${day!.date.toISOString().slice(0, 10)} — ventes ${txnIds.join(', ')}${day!.note}`
      if (before.lead_id) {
        await tx.leads.updateMany({
          where: { lead_id: before.lead_id, is_deleted: false },
          data:  { etape: 'gagne', txn_id: txnIds[0] ?? null, montant: num(before.montant_total), motif_perte: null, closed_at: new Date(), updated_by: user.id, updated_at: new Date() },
        })
      }
    } else if (statut === 'retour' || statut === 'annule') {
      if (closed) throw new HttpError(400, 'Commande terminée')
      const motif = str(body.motif)
      if (!motif || motif.length < 3) throw new HttpError(400, 'Motif obligatoire')
      const decision = body.avance_decision === 'gardee' ? 'gardee' : body.avance_decision === 'remboursee' ? 'remboursee' : null
      if (num(before.montant_avance) > 0 && !decision) throw new HttpError(400, 'L’avance : remboursée ou gardée ?')
      await releaseItems(tx, before.delivery_items, user.id)
      data = { statut, motif_retour: motif, avance_decision: num(before.montant_avance) > 0 ? decision : null }
      what = `${codeLabel('delivery_status', statut, 'fr')} — ${motif}${decision ? ` — avance ${decision === 'gardee' ? 'gardée' : 'remboursée'}` : ''}`
      if (before.lead_id) {
        await tx.leads.updateMany({
          where: { lead_id: before.lead_id, is_deleted: false },
          // refused at the door: lost; cancelled before it left: the conversation goes on
          data: statut === 'retour'
            ? { etape: 'perdu', motif_perte: 'refus_livraison', closed_at: new Date(), updated_by: user.id, updated_at: new Date() }
            : { etape: 'en_discussion', delivery_id: null, updated_by: user.id, updated_at: new Date() },
        })
      }
    } else {
      throw new HttpError(400, 'Action inconnue')
    }

    const updated = await tx.deliveries.update({ where: { delivery_id: deliveryId }, data: { ...data, updated_by: user.id, updated_at: new Date() } })
    return { before, updated, txnIds, what }
  })

  await logActivity({
    store_id: before.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'transactions',
    record_id: deliveryId, before_state: before, after_state: updated, ip_address: getIpFromRequest(request),
    notes: `Commande ${deliveryId} — ${what}`,
  })
  if (updated.statut !== before.statut) await syncDeliveryToOrders(deliveryId, updated.statut)
  if (updated.statut !== before.statut && (updated.statut === 'livre' || updated.statut === 'retour')) {
    alertLater(async () => {
      const names = await Promise.all(before.delivery_items.map(i => deviceName(i.device_type, i.device_id)))
      const m = orderMoney(updated)
      return updated.statut === 'livre'
        ? `✅ Livrée ${deliveryId} — ${before.client_name}, ${before.ville ?? ''}\n${names.join(', ')} · ${money(before.montant_total)} (ventes ${txnIds.join(', ')})\nLe transporteur doit verser ${money(m.verse)}`
        : `↩️ Refusée ${deliveryId} — ${before.client_name} : ${updated.motif_retour}\n${names.join(', ')} remis en stock${num(before.montant_avance) > 0 ? ` · avance ${money(before.montant_avance)} ${updated.avance_decision === 'gardee' ? 'gardée' : 'remboursée'}` : ''}`
    })
  }
  return json({ data: updated })
}
