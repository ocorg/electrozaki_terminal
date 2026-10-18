import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { alertLater, deviceName, money } from '@/lib/reports'
import { autoLinkDelivery } from '@/lib/storefront/shipping'
import { AVANCE_MIN, orderMoney, reserveItems, type OrderItem } from '@/lib/deliveryOrders'
import { phoneKey } from '@/lib/leads'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// POST — a sale to deliver, taken at the POS (rules: lib/deliveryOrders.ts).
// { store_id, client: { client_id?, nom, telephone }, adresse, ville, transporteur,
//   frais_livraison, frais_charge, avance, avance_ref, avance_date, notes, lead_id,
//   items: [{ device_type, device_id, qty, prix_vente, override_by?, override_reason? }] }
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json() as Record<string, unknown>
    const storeId  = String(body.store_id ?? user.store_id ?? 'EZ-001')
    const client   = (body.client ?? {}) as Record<string, unknown>
    const nom      = str(client.nom)
    const tel      = String(client.telephone ?? '').replace(/\D/g, '')
    const adresse  = str(body.adresse)
    const ville    = str(body.ville)
    if (!nom || phoneKey(tel).length !== 9) throw new HttpError(400, 'Nom et numéro du client obligatoires')
    if (!adresse || !ville) throw new HttpError(400, 'Adresse et ville obligatoires')
    const items = (Array.isArray(body.items) ? body.items : []).map((i: Record<string, unknown>) => ({
      device_type: i.device_type, device_id: String(i.device_id ?? ''), qty: Number(i.qty ?? 1),
      prix_vente: Math.round(Number(i.prix_vente) * 100) / 100,
      override_by: str(i.override_by), override_reason: str(i.override_reason),
    })) as OrderItem[]
    const frais       = Math.round(Number(body.frais_livraison ?? 0) * 100) / 100
    const fraisCharge = body.frais_charge === 'boutique' ? 'boutique' : 'client'
    const avance      = Math.round(Number(body.avance ?? 0) * 100) / 100
    if (!(frais >= 0) || !(avance >= 0)) throw new HttpError(400, 'Montant invalide')
    const total = Math.round(items.reduce((s, i) => s + i.prix_vente, 0) * 100) / 100
    if (avance > total) throw new HttpError(400, "L'avance dépasse le total de la commande")
    const withPhone = items.some(i => i.device_type === 'telephone')
    // A phone ships once its advance is in (accessories alone: none required)
    const statut = withPhone && avance < AVANCE_MIN ? 'attente_avance' : 'prepare'
    const leadId = str(body.lead_id)

    const delivery = await prisma.$transaction(async tx => {
      await reserveItems(tx, items, user.id)
      // The client: the one picked, or the one with this number, or a new one
      let clientId = str(client.client_id)
      if (!clientId) {
        const known = await tx.clients.findFirst({ where: { is_deleted: false, telephone: { endsWith: phoneKey(tel) } }, select: { client_id: true } })
        clientId = known?.client_id
          ?? (await tx.clients.create({ data: { nom, telephone: `0${phoneKey(tel)}`, adresse, store_id: storeId, created_by: user.id }, select: { client_id: true } })).client_id
      }
      const delivery = await tx.deliveries.create({
        data: {
          store_id: storeId, client_id: clientId, client_name: nom, client_phone: `0${phoneKey(tel)}`, client_address: adresse,
          ville, transporteur: str(body.transporteur), frais_livraison: frais, frais_charge: fraisCharge,
          payment_scenario: avance <= 0 ? 'paiement_livraison' : avance >= total ? 'avance_totale' : 'avance_partielle',
          montant_total: total, montant_avance: avance, payment_method: avance > 0 ? 'virement' : null,
          avance_ref: str(body.avance_ref), avance_date: avance > 0 ? (dateOnly(body.avance_date) ?? todayDate()) : null,
          statut, notes: str(body.notes), lead_id: leadId, commande: true,
          created_by: user.id, updated_by: user.id,
          delivery_items: { create: items.map(i => ({ device_type: i.device_type, device_id: i.device_id, qty: i.qty, prix_vente: i.prix_vente, override_by: i.override_by, override_reason: i.override_reason })) },
        },
      })
      if (leadId) {
        const lead = await tx.leads.findFirst({ where: { lead_id: leadId, is_deleted: false }, select: { etape: true } })
        if (!lead) throw new HttpError(400, `Lead ${leadId} introuvable`)
        if (lead.etape === 'gagne' || lead.etape === 'perdu') throw new HttpError(400, `Le lead ${leadId} est déjà clôturé`)
        await tx.leads.update({ where: { lead_id: leadId }, data: { delivery_id: delivery.delivery_id, client_id: clientId, etape: 'proposition', updated_by: user.id, updated_at: new Date() } })
      }
      return delivery
    })

    await logActivity({
      store_id: storeId, user_id: user.id, user_name: user.display_name, action_type: 'creation', module: 'transactions',
      record_id: delivery.delivery_id, after_state: delivery, ip_address: getIpFromRequest(request),
      notes: `Commande à livrer ${delivery.delivery_id} — ${total} DH, avance ${avance} DH${leadId ? ` — lead ${leadId}` : ''}`,
    })
    // A confirmed web order for this number follows this delivery
    await autoLinkDelivery(delivery)
    alertLater(async () => {
      const names = await Promise.all(items.map(i => deviceName(i.device_type, i.device_id)))
      const m = orderMoney(delivery)
      return `📦 Commande à livrer ${delivery.delivery_id} — ${nom}, ${ville}\n${names.join(', ')} · ${money(total)}\n`
        + (avance > 0 ? `Avance reçue ${money(avance)} · ` : withPhone ? `⏳ En attente de l'avance (${AVANCE_MIN} DH min.) · ` : '')
        + `à encaisser par le livreur ${money(m.aEncaisser)} · par ${user.display_name}`
    })

    return json({ data: delivery }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/deliveries/order')
  }
}

export const POST = withNotify(POST_)
