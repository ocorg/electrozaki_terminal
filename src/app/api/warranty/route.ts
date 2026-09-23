import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError } from '@/lib/api'

// GET /api/warranty — full warranty status of a sale.
// Params (at least one): ?txn_id= | ?facture_ref= | ?imei=
export async function GET(request: Request) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const txn_id      = searchParams.get('txn_id')
    const facture_ref = searchParams.get('facture_ref')
    const imei        = searchParams.get('imei')?.trim()
    if (!txn_id && !facture_ref && !imei) throw new HttpError(400, 'txn_id, facture_ref ou imei requis')

    let resolvedTxnId = txn_id
    if (imei && !resolvedTxnId) {
      // IMEI is unique per physical device — no store filter needed
      const phone = await prisma.phones.findFirst({ where: { imei }, select: { phone_id: true } })
      if (!phone) throw new HttpError(404, 'Aucun téléphone trouvé pour cet IMEI')
      const lastSale = await prisma.transactions.findFirst({
        where: { device_id: phone.phone_id, voided: false }, orderBy: { created_at: 'desc' }, select: { txn_id: true },
      })
      if (!lastSale) throw new HttpError(404, 'Aucune vente trouvée pour cet IMEI')
      resolvedTxnId = lastSale.txn_id
    }

    const txn = await prisma.transactions.findFirst({
      where:  { voided: false, ...(resolvedTxnId ? { txn_id: resolvedTxnId } : { facture_ref: facture_ref! }) },
      select: { txn_id: true, warranty_start: true, warranty_expiry: true, facture_ref: true, device_id: true, prix_vente: true, date_vente: true, payment_method: true, voided: true },
    })
    if (!txn) throw new HttpError(404, 'Transaction introuvable')

    // Effective expiry = base + days spent in SAV (SQL function)
    const [{ expiry }] = await prisma.$queryRaw<{ expiry: Date | null }[]>`SELECT get_effective_warranty_expiry(${txn.txn_id}) AS expiry`
    const events = await prisma.warranty_events.findMany({
      where:   { txn_id: txn.txn_id },
      select:  { event_id: true, event_type: true, event_date: true, sav_ref: true, notes: true, created_at: true },
      orderBy: { event_date: 'asc' },
    })

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const daysRemaining = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000) : null
    const warranty_status: 'active' | 'expired' | 'no_warranty' =
      !expiry ? 'no_warranty' : daysRemaining! > 0 ? 'active' : 'expired'
    const openSav = events.reduce((acc, ev) => acc + (ev.event_type === 'ouverture_sav' ? 1 : -1), 0) > 0

    return json({
      status: 'success',
      data: {
        txn_id:                    txn.txn_id,
        facture_ref:               txn.facture_ref,
        device_id:                 txn.device_id,
        prix_vente:                txn.prix_vente,
        date_vente:                txn.date_vente,
        warranty_start:            txn.warranty_start,
        warranty_expiry_base:      txn.warranty_expiry,
        warranty_expiry_effective: expiry,
        days_remaining:            daysRemaining,
        warranty_status,
        sav_currently_open:        openSav,
        sav_events:                events,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/warranty')
  }
}
