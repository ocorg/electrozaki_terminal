import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const status   = searchParams.get('status')
    const search   = searchParams.get('search')
    const location = searchParams.get('location')

    let query = supabase
      .from('laptops')
      .select('*, suppliers(nom)')
      .order('created_at', { ascending: false })

    if (status)   query = query.eq('status', status)
    if (location) query = query.eq('location', location)
    if (search)   query = query.or(`serial.ilike.%${search}%,model.ilike.%${search}%,marque.ilike.%${search}%`)

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
    const { data, error } = await supabase
      .from('laptops')
      .insert({ ...body, created_by: user.id, updated_by: user.id })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    const body = await request.json() as Record<string, unknown>
    const { laptop_id, ...updates } = body
    if (!laptop_id) return NextResponse.json({ error: 'laptop_id requis' }, { status: 400 })
    const { data, error } = await supabase
      .from('laptops')
      .update({ ...updates, updated_by: user.id } as any)
      .eq('laptop_id', laptop_id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}