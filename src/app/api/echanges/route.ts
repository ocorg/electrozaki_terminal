import { NextRequest } from 'next/server'
import type { retour_destination } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, requireUser, HttpError, MANAGERS } from '@/lib/api'
import { deviceLabels } from '@/lib/device-labels'
import { saleFile } from '@/lib/phoneSwap'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { codeLabel } from '@/lib/codes'
import { alertLater, money } from '@/lib/reports'
import { workingDay } from '@/lib/catchUp'
import { swapPhone, SWAP_PAY_BACK, type SwapSettlement } from '@/lib/phoneSwap'

const DESTINATIONS: retour_destination[] = ['stock', 'reparation', 'defectueux']
const name = (p: { marque: string; model: string; imei: string | null }) => `${p.model.toLowerCase().startsWith(p.marque.toLowerCase()) || p.marque === 'Apple' ? '' : p.marque + ' '}${p.model}${p.imei ? ` (${p.imei.slice(-4)})` : ''}`

// GET ?phone_id= — the sale a sold / reserved phone left with, ready for an
// exchange (Téléphones → menu → Échanger)
export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const phoneId = new URL(request.url).searchParams.get('phone_id') ?? ''
    const phone = await prisma.phones.findUnique({ where: { phone_id: phoneId }, select: { status: true } })
    if (!phone || !['vendu', 'reserve'].includes(phone.status)) throw new HttpError(404, "Ce téléphone n'est pas vendu ni réservé")
    const sale = await prisma.transactions.findFirst({
      where: { device_id: phoneId, device_type: 'telephone', voided: false, NOT: { type_operation: 'retour' } },
      orderBy: { created_at: 'desc' },
    })
    if (!sale) throw new HttpError(404, 'Aucune vente au POS pour ce téléphone (vendu autrement) : pas d’échange possible ici')
    const file = await saleFile(prisma as never, sale.txn_id)
    const label = (await deviceLabels([sale])).get(sale.device_id) ?? sale.device_id
    return json({ data: {
      txn_id: sale.txn_id, device_label: label, prix_vente: Number(sale.prix_vente),
      file: file ? { credit_id: file.credit_id, open: file.statut === 'en_cours', discharged: !!file.discharged_at } : null,
    } })
  } catch (err) {
    return handleError(err, 'GET /api/echanges')
  }
}

// POST — exchange the phone of a sale (SAV): { txn_id, new_phone_id,
// nouveau_prix, reglement?, payment_ref?, destination, motif, date? }.
// Managers only (owner, 2026-10-30). Rules in lib/phoneSwap.
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const motif = String(body.motif ?? '').trim()
    const destination = body.destination as retour_destination
    if (!body.txn_id || !body.new_phone_id) throw new HttpError(400, 'Vente et nouveau téléphone obligatoires')
    if (!DESTINATIONS.includes(destination)) throw new HttpError(400, 'Destination du téléphone rendu invalide')
    if (motif.length < 3) throw new HttpError(400, "Motif de l'échange obligatoire")
    const settlement = body.reglement ? String(body.reglement) as SwapSettlement : null
    if (settlement && !SWAP_PAY_BACK.includes(settlement as never) && settlement !== 'especes') throw new HttpError(400, 'Règlement invalide')
    const day = await workingDay(user, body.date, user.store_id)

    const r = await prisma.$transaction(tx => swapPhone(tx, {
      txnId: String(body.txn_id), newPhoneId: String(body.new_phone_id), newPrice: Number(body.nouveau_prix),
      settlement, paymentRef: body.payment_ref ? String(body.payment_ref) : null,
      destination, motif, date: day.date, late: day.late, userId: user.id,
    }), { timeout: 20_000, maxWait: 10_000 })   // many checks and writes in one go

    const where = codeLabel('retour_destination', destination, 'fr')
    const summary = `Échange SAV de ${r.sale.txn_id} : ${name(r.oldPhone)} rendu (${where.toLowerCase()}) → ${name(r.newPhone)} remis au client`
      + (r.settledHow ? ` · ${r.settledHow}` : ' · même prix') + ` · motif : ${motif}`
    // One line on each phone (their history), and on the sale
    for (const record_id of [r.oldPhone.phone_id, r.newPhone.phone_id, r.sale.txn_id]) {
      await logActivity({
        store_id: r.sale.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification',
        module: 'transactions', record_id, notes: summary, ip_address: getIpFromRequest(request),
        before_state: { device_id: r.oldPhone.phone_id, prix_vente: r.oldPrice }, after_state: { device_id: r.newPhone.phone_id, prix_vente: r.newPrice },
      })
    }
    alertLater(async () => `🔁 ${summary}${r.diff ? ` (${r.diff > 0 ? '+' : ''}${money(r.diff)})` : ''} · par ${user.display_name}`)
    return json({ data: { txn_id: r.sale.txn_id, old_phone_id: r.oldPhone.phone_id, new_phone_id: r.newPhone.phone_id, diff: r.diff, settled: r.settledHow } }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/echanges')
  }
}

export const POST = withNotify(POST_)
