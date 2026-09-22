import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, todayDate, HttpError } from '@/lib/api'
import { notifyCaisseChange } from '@/lib/realtime'

// POST /api/documents/confirm-sale — confirmation from the mini-POS popup.
// confirm_document_sale() does, in one database transaction:
//   1. creates the transactions row
//   2. sets phones.status → vendu
//   3. links ez_documents.txn_id to the new transaction
export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    const store_id = user.store_id ?? 'EZ-001'
    const { doc_id, phone_id, facture_ref, prix_vente, payment_method, date_vente, warranty_start, warranty_expiry, client_id, notes } = await request.json()

    if (!doc_id || !phone_id || !facture_ref || !prix_vente || !payment_method) {
      throw new HttpError(400, 'Champs obligatoires manquants : doc_id, phone_id, facture_ref, prix_vente, payment_method')
    }
    if (payment_method !== 'especes' && payment_method !== 'virement') {
      throw new HttpError(400, 'payment_method doit être especes ou virement')
    }

    const [{ result }] = await prisma.$queryRaw<{ result: { success: boolean; txn_id?: string; error?: string } }[]>`
      SELECT confirm_document_sale(
        ${doc_id}, ${phone_id}, ${facture_ref}, ${Number(prix_vente)}::numeric, ${payment_method},
        ${dateOnly(date_vente) ?? todayDate()}::date, ${dateOnly(warranty_start) ?? null}::date,
        ${dateOnly(warranty_expiry) ?? null}::date, ${client_id || null}, ${store_id},
        ${user.id}::uuid, ${notes || null}
      ) AS result`

    if (!result?.success) throw new Error(result?.error ?? 'La fonction confirm_document_sale a échoué')
    await notifyCaisseChange(store_id)

    return json({ status: 'success', data: { txn_id: result.txn_id } })
  } catch (err) {
    return handleError(err, 'POST /api/documents/confirm-sale')
  }
}
