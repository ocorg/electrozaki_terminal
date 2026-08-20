import { NextResponse } from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

// ── POST /api/documents/confirm-sale ─────────────────────────────────────────
// Confirmation atomique depuis le mini-POS popup.
// Appelle confirm_document_sale() qui fait en une seule transaction :
//   1. Crée l'entrée transactions
//   2. Passe phones.status → مباع
//   3. Lie ez_documents.txn_id à la nouvelle transaction
//
// La caisse capte la nouvelle transaction automatiquement au prochain fetch.

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profileRaw } = await supabase
      .from('user_profiles')
      .select('display_name, store_id, role')
      .eq('id', user.id)
      .single()

    const profile = profileRaw as { display_name: string; store_id: string | null; role: string } | null
    const store_id = profile?.store_id ?? 'EZ-001'
    const db = await createUntypedClient()

    const body = await request.json()
    const {
      doc_id, phone_id, facture_ref, prix_vente, payment_method,
      date_vente, warranty_start, warranty_expiry, client_id, notes,
    } = body

    if (!doc_id || !phone_id || !facture_ref || !prix_vente || !payment_method) {
      return NextResponse.json(
        { error: 'Champs obligatoires manquants : doc_id, phone_id, facture_ref, prix_vente, payment_method' },
        { status: 400 }
      )
    }

    if (!['نقد', 'تحويل'].includes(payment_method)) {
      return NextResponse.json(
        { error: 'payment_method doit être نقد ou تحويل' },
        { status: 400 }
      )
    }

    const { data: rpcRaw, error: rpcError } = await db.rpc('confirm_document_sale', {
      p_doc_id:          doc_id,
      p_phone_id:        phone_id,
      p_facture_ref:     facture_ref,
      p_prix_vente:      prix_vente,
      p_payment_method:  payment_method,
      p_date_vente:      date_vente || new Date().toISOString().split('T')[0],
      p_warranty_start:  warranty_start  || null,
      p_warranty_expiry: warranty_expiry || null,
      p_client_id:       client_id       || null,
      p_store_id:        store_id,
      p_created_by:      user.id,
      p_notes:           notes           || null,
    })

    if (rpcError) throw rpcError

    const result = rpcRaw as { success: boolean; txn_id?: string; error?: string }

    if (!result?.success) {
      throw new Error(result?.error ?? 'La fonction confirm_document_sale a échoué')
    }

    return NextResponse.json({
      status: 'success',
      data: { txn_id: result.txn_id },
    })
  } catch (err: any) {
    console.error('[POST /api/documents/confirm-sale]', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}