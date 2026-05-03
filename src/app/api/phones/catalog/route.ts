import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createUntypedClient()
  const { data, error } = await supabase
    .from('phone_catalog')
    .select('*')
    .order('marque')
    .order('model')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createUntypedClient()
  const typedSupabase = createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  if (!body.marque || !body.model || !body.couleur) {
    return NextResponse.json(
      { error: 'marque, model et couleur obligatoires' }, 
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('phone_catalog')
    .insert({ 
      marque: body.marque, 
      serie: body.serie || '', 
      type: body.type || 'Normal', 
      model: body.model, 
      couleur: body.couleur 
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const supabase = createUntypedClient()
  const typedSupabase = createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { catalog_id } = await request.json()
  if (!catalog_id) {
    return NextResponse.json({ error: 'catalog_id requis' }, { status: 400 })
  }

  const { error } = await supabase
    .from('phone_catalog')
    .delete()
    .eq('catalog_id', catalog_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ message: 'deleted' })
}