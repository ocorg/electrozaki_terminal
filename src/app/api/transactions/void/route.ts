import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function PATCH(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()

    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; role: string } | null }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json(
        { error: 'Seul un manager ou propriétaire peut effectuer un retour' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { txn_id, voided_reason } = body

    if (!txn_id || !voided_reason) {
      return NextResponse.json(
        { error: 'txn_id et voided_reason requis' },
        { status: 400 }
      )
    }

    // 1. Fetch the transaction
    const { data: txn, error: fetchErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .eq('voided', false)
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (fetchErr || !txn) {
      return NextResponse.json(
        { error: 'Transaction introuvable ou déjà annulée' },
        { status: 404 }
      )
    }

    // 2. Void the transaction
    const { data: voidedTxn, error: voidErr } = await supabase
      .from('transactions')
      .update({
        voided:        true,
        voided_by:     user.id,
        voided_at:     new Date().toISOString(),
        voided_reason: voided_reason,
        updated_at:    new Date().toISOString(),
        updated_by:    user.id,
      })
      .eq('txn_id', txn_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (voidErr) throw voidErr

    // 3. Revert device status to متوفر
    const deviceType = txn.device_type as string
    const deviceId   = txn.device_id   as string

    if (deviceType === 'هاتف') {
      await supabase
        .from('phones')
        .update({
          status:     'متوفر',
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('phone_id', deviceId)
    } else if (deviceType === 'لابتوب') {
      await supabase
        .from('laptops')
        .update({
          status:     'متوفر',
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('laptop_id', deviceId)
    }

    // 4. Log to activity_log
    // Note: caisse total auto-corrects because it aggregates live
    // from transactions WHERE voided = false — no manual caisse
    // mutation needed.
    await logActivity({
      store_id:     (txn.store_id as string) ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'VOID',
      module:       'transactions',
      record_id:    txn_id,
      before_state: txn,
      after_state:  voidedTxn ?? null,
      ip_address:   getIpFromRequest(request),
      notes:        `RETOUR — Motif: ${voided_reason}`,
    })

    return NextResponse.json({ data: voidedTxn, status: 'voided' })

  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}