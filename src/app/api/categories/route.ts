import { createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export interface CategoryItem { fr: string; ar: string }
type CatType = 'accessories' | 'expenses' | 'suppliers'
const VALID_TYPES: CatType[] = ['accessories', 'expenses', 'suppliers']

function parse(value: string | null | undefined): CategoryItem[] {
  try {
    const parsed = JSON.parse(value ?? '')
    if (!Array.isArray(parsed) || parsed.length === 0) return []
    if (typeof parsed[0] === 'string') return (parsed as string[]).map(s => ({ fr: s, ar: s }))
    return parsed as CategoryItem[]
  } catch { return [] }
}

export async function GET() {
  try {
    const supabase = await createUntypedClient()
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['categories_accessories', 'categories_expenses', 'categories_suppliers'])
      .is('store_id', null) as { data: { key: string; value: string }[] | null; error: unknown }

    if (error) throw error

    const get = (key: string) => data?.find(r => r.key === key)?.value
    return NextResponse.json({
      accessories: parse(get('categories_accessories')),
      expenses:    parse(get('categories_expenses')),
      suppliers:   parse(get('categories_suppliers')),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const body: { type: CatType; categories: CategoryItem[] } = await request.json()

    if (!VALID_TYPES.includes(body.type))
      return NextResponse.json({ error: 'Type invalide' }, { status: 400 })

    if (!Array.isArray(body.categories) || body.categories.length === 0)
      return NextResponse.json({ error: 'Au moins une catégorie requise' }, { status: 400 })

    if (body.categories.some(c => !c.fr?.trim() || !c.ar?.trim()))
      return NextResponse.json({ error: 'Chaque catégorie doit avoir un nom FR et AR' }, { status: 400 })

    const key = `categories_${body.type}`

    await supabase.from('settings').delete().eq('key', key).is('store_id', null)

    const { error } = await supabase.from('settings').insert({
      key,
      value:      JSON.stringify(body.categories),
      store_id:   null,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error

    return NextResponse.json({ status: 'success', categories: body.categories })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}