import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const client_id      = searchParams.get('client_id')
    const store_id       = searchParams.get('store_id')
    const limit          = searchParams.get('limit') || '50'
    const date_from      = searchParams.get('date_from')
    const date_to        = searchParams.get('date_to')
    const type_operation = searchParams.get('type_operation')

    const include_voided = searchParams.get('include_voided') === 'true'

    let query = supabase
      .from('transactions')
      .select('*, clients(nom, telephone)')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (client_id)       query = query.eq('client_id', client_id)
    if (store_id)        query = query.eq('store_id', store_id)
    if (!include_voided) query = query.eq('voided', false)
    if (date_from)       query = query.gte('date_vente', date_from)
    if (date_to)         query = query.lte('date_vente', date_to)
    if (type_operation)  query = query.eq('type_operation', type_operation)

    const { data, error } = await query
    if (error) throw error

    const enriched = (data || []).map((t: Record<string, unknown>) => {
      const avance        = (t.avance as number) || 0
      const paymentMethod = t.payment_method as string
      const fariq =
        paymentMethod === 'إستبدال'
          ? 0
          : paymentMethod === 'آجل'
            ? Math.max(0, (t.prix_vente as number) - ((t.valeur_echange as number) || 0))
            : avance > 0
              ? Math.max(0, (t.prix_vente as number) - avance - ((t.valeur_echange as number) || 0))
              : 0
      return {
        ...t,
        fariq,
        statut_paiement:
          fariq === 0 ? '✅ مسدد' :
          fariq > 0   ? '🔵 متبقي' :
                        '⚠️ زيادة دفع',
      }
    })

    return NextResponse.json({ data: enriched })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase        = await createUntypedClient()
    const typedSupabase   = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json()

    // Fetch device's actual warranty_months
    const deviceTable = body.device_type === 'هاتف' ? 'phones'
                      : body.device_type === 'لابتوب' ? 'laptops'
                      : null
    const deviceIdCol = body.device_type === 'هاتف' ? 'phone_id' : 'laptop_id'
    let warrantyMonths = 6

    if (deviceTable) {
      const { data: device } = await supabase
        .from(deviceTable)
        .select('warranty_months')
        .eq(deviceIdCol, body.device_id)
        .single() as { data: { warranty_months: number } | null }
      if (device?.warranty_months) warrantyMonths = device.warranty_months
    }

    const warrantyStart  = body.warranty_start || new Date().toISOString().split('T')[0]
    const warrantyExpiry = new Date(warrantyStart)
    warrantyExpiry.setMonth(warrantyExpiry.getMonth() + warrantyMonths)

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        ...body,
        store_id:        body.store_id ?? profile?.store_id ?? null,
        warranty_start:  warrantyStart,
        warranty_expiry: warrantyExpiry.toISOString().split('T')[0],
        created_by:      user.id,
        updated_by:      user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    // Flip device status to مباع (phones/laptops) or decrement quantity (accessories)
    if (deviceTable) {
      await supabase
        .from(deviceTable)
        .update({ status: 'مباع', updated_by: user.id })
        .eq(deviceIdCol, body.device_id)
    } else if (body.device_type === 'إكسسوار') {
      // Decrement accessory quantity — floor at 0
      const { data: acc } = await supabase
        .from('accessories')
        .select('quantite')
        .eq('acc_id', body.device_id)
        .single() as { data: { quantite: number } | null }

      const newQty = Math.max(0, (acc?.quantite ?? 1) - 1)
      await supabase
        .from('accessories')
        .update({ quantite: newQty, updated_by: user.id })
        .eq('acc_id', body.device_id)
    }

    await logActivity({
      store_id:    data.store_id as string ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? user.email ?? '—',
      action_type: 'INSERT',
      module:      'transactions',
      record_id:   data.txn_id as string ?? null,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.type_operation} — ${body.device_type} ${body.device_id}`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}