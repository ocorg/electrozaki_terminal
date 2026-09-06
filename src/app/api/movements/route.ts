import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id   = searchParams.get('store_id')
    const device_type = searchParams.get('device_type')
    const limit      = searchParams.get('limit') || '50'

    let query = supabase
      .from('stock_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (store_id)    query = query.eq('store_id', store_id)
    if (device_type) query = query.eq('device_type', device_type)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null; role: string } | null }

    // Only manager/owner can move stock
    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    if (!body.device_id || !body.device_type || !body.from_location || !body.to_location) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
    }

    if (body.from_location === body.to_location) {
      return NextResponse.json({ error: 'Source et destination identiques' }, { status: 400 })
    }

    // Create movement record
    const { data, error } = await supabase
      .from('stock_movements')
      .insert({
        device_type:   body.device_type,
        device_id:     body.device_id,
        quantity:      body.quantity ?? 1,
        from_location: body.from_location,
        to_location:   body.to_location,
        external_name: body.external_name ?? null,
        reason:        body.reason ?? 'Transfert',
        store_id:      body.store_id ?? profile?.store_id ?? null,
        notes:         body.notes ?? null,
        moved_by:      user.id,
        moved_at:      new Date().toISOString(),
        created_by:    user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    // Update device location
    const deviceTable = body.device_type === 'هاتف' ? 'phones'
      : body.device_type === 'لابتوب' ? 'laptops'
      : body.device_type === 'إكسسوار' ? 'accessories'
      : null

    const deviceIdCol = body.device_type === 'هاتف' ? 'phone_id'
      : body.device_type === 'لابتوب' ? 'laptop_id'
      : 'acc_id'

    if (deviceTable) {
      const reason      = (body.reason      as string) ?? 'Transfert'
      const toLocation  = body.to_location  as string
      const toStoreId   = (body.to_store_id as string | null) ?? null

      const deviceUpdate: Record<string, unknown> = {
        location:   toLocation,
        updated_by: user.id,
      }

      // Statut — uniquement pour les téléphones (ENUM device_status)
      if (body.device_type === 'هاتف') {
        if      (reason === 'Retour')              deviceUpdate.status = 'متوفر'
        else if (reason === 'Réparation Externe')  deviceUpdate.status = 'إصلاح'
        else if (reason === 'Prêt' || toLocation === 'Externe' || toStoreId !== null)
                                                   deviceUpdate.status = 'en_transfert'
        else                                       deviceUpdate.status = 'متوفر'
      }

      // Inter-magasin → transférer la propriété au magasin destination
      if (toStoreId) {
        deviceUpdate.store_id = toStoreId
      }

      await supabase
        .from(deviceTable)
        .update(deviceUpdate)
        .eq(deviceIdCol, body.device_id)
    }

    await logActivity({
      store_id:    data.store_id as string ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'UPDATE',
      module:      'stock_movements',
      record_id:   data.movement_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.device_id} : ${body.from_location} → ${body.to_location}`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}