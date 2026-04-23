import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('store_id')
      .eq('id', user.id)
      .single() as { data: { store_id: string | null } | null }

    const storeId = profile?.store_id
    const prefix  = storeId === 'HP-001' ? 'HP-ACC-' : 'EZ-ACC-'

    // Find the highest existing sequence number for this prefix
    const { data: rows } = await supabase
      .from('accessories')
      .select('acc_id')
      .ilike('acc_id', `${prefix}%`)
      .order('acc_id', { ascending: false })
      .limit(1) as { data: { acc_id: string }[] | null }

    let nextSeq = 1
    if (rows && rows.length > 0) {
      const lastId = rows[0].acc_id  // e.g. "EZ-ACC-000042"
      const lastNum = parseInt(lastId.replace(prefix, ''), 10)
      if (!isNaN(lastNum)) nextSeq = lastNum + 1
    }

    const barcode = `${prefix}${String(nextSeq).padStart(6, '0')}`
    return NextResponse.json({ status: 'success', barcode })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}