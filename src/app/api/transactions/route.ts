import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const client_id = searchParams.get('client_id')
    const limit = searchParams.get('limit') || '50'

    let query = supabase
      .from('transactions')
      .select('*, clients(nom, telephone)')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (client_id) query = query.eq('client_id', client_id)

    const { data, error } = await query
    if (error) throw error

    // Compute FARIQ + STATUT_PAIEMENT
    const enriched = (data || []).map((t: Record<string, unknown>) => {
      const fariq = (t.prix_vente as number) - (t.avance as number || 0) - (t.valeur_echange as number || 0)
      return {
        ...t,
        fariq,
        statut_paiement: fariq === 0 ? '✅ مسدد' : fariq > 0 ? '🔵 متبقي' : '⚠️ زيادة دفع',
        warranty_expiry: t.warranty_start
          ? new Date(new Date(t.warranty_start as string).getTime() + 6 * 30 * 86400000).toISOString()
          : null,
      }
    })

    return NextResponse.json({ data: enriched })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const body = await request.json()

    // Set device status to مباع
    const deviceTable = body.device_type === 'هاتف' ? 'phones' : body.device_type === 'لابتوب' ? 'laptops' : null
    const deviceIdCol = body.device_type === 'هاتف' ? 'phone_id' : 'laptop_id'

    const { data, error } = await supabase
      .from('transactions')
      .insert({ ...body, created_by: user.id, updated_by: user.id })
      .select()
      .single()

    if (error) throw error

    // Update device status to مباع
    if (deviceTable) {
      await supabase
        .from(deviceTable)
        .update({ status: 'مباع', updated_by: user.id })
        .eq(deviceIdCol, body.device_id)
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}