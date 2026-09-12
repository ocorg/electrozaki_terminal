import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json() as Record<string, unknown>
    const { import_id, montant, payment_method, payment_ref, notes, store_id } = body

    if (!import_id) return NextResponse.json({ error: 'import_id requis' }, { status: 400 })
    if (!montant || (montant as number) <= 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    }

    // Validate against current balance
    const { data: imp } = await supabase
      .from('credit_imports')
      .select('import_id, montant_du, montant_paye, statut')
      .eq('import_id', import_id)
      .single() as { data: Record<string, unknown> | null }

    if (!imp) return NextResponse.json({ error: 'Import introuvable' }, { status: 404 })
    if (imp.statut === 'soldé') {
      return NextResponse.json({ error: 'Ce crédit est déjà soldé' }, { status: 400 })
    }

    const remaining = (imp.montant_du as number) - ((imp.montant_paye as number) ?? 0)
    if ((montant as number) > remaining + 0.01) {
      return NextResponse.json(
        { error: `Montant dépasse le restant dû (${remaining.toFixed(2)} MAD)` },
        { status: 400 }
      )
    }

    const resolvedStoreId = (store_id as string | null) ?? profile?.store_id ?? null

    const { data: payment, error: payErr } = await supabase
      .from('credit_import_payments')
      .insert({
        import_id,
        store_id:       resolvedStoreId,
        montant,
        payment_method: payment_method ?? 'نقد',
        payment_ref:    payment_ref    ?? null,
        notes:          notes          ?? null,
        date_paiement:  new Date().toISOString().split('T')[0],
        created_by:     user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (payErr) throw payErr

    // Trigger handles updating montant_paye + statut on credit_imports automatically.
    // Fetch the updated row for the activity log.
    const { data: updated } = await supabase
      .from('credit_imports')
      .select('montant_du, montant_paye, statut')
      .eq('import_id', import_id)
      .single() as { data: Record<string, unknown> | null }

    await logActivity({
      user_id:     user.id,
      store_id:    resolvedStoreId ?? '',
      user_name:   profile?.display_name ?? '—',
      module:      'credit_imports',
      action_type: 'UPDATE',
      record_id:   import_id as string,
      after_state: {
        import_id,
        montant_paye: updated?.montant_paye,
        montant_du:   updated?.montant_du,
        statut:       updated?.statut,
      },
      ip_address: getIpFromRequest(request),
      notes:      `Paiement de ${(montant as number).toFixed(2)} MAD`,
    })

    return NextResponse.json({ data: payment }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}