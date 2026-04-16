import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')

    let query = supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (search) query = query.or(`nom.ilike.%${search}%,telephone.ilike.%${search}%`)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ data })
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

    // Check if client with this phone already exists
    if (body.telephone) {
      const { data: existing } = await supabase
        .from('clients')
        .select('client_id, nom, telephone')
        .eq('telephone', body.telephone)
        .single()

      if (existing) return NextResponse.json({ data: existing, existing: true })
    }

    const { data, error } = await supabase
      .from('clients')
      .insert({ ...body, created_by: user.id, updated_by: user.id })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}