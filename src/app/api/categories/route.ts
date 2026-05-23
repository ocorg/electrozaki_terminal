import { createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULTS = {
  accessories: ['كفر', 'شاحن', 'سماعة', 'واقي', 'سيم', 'أخرى'],
  expenses:    ['إيجار', 'فاتورة', 'نقل', 'صيانة', 'أجور', 'تسويق', 'معدات', 'أخرى'],
  suppliers:   ['هواتف', 'لابتوبات', 'إكسسوارات', 'كل شيء'],
}

type CatType = keyof typeof DEFAULTS

function parseOrDefault(value: string | null | undefined, type: CatType): string[] {
  try {
    const parsed = JSON.parse(value ?? '')
    return Array.isArray(parsed) ? parsed : DEFAULTS[type]
  } catch {
    return DEFAULTS[type]
  }
}

export async function GET() {
  try {
    const supabase = await createUntypedClient()
    const { data } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['categories_accessories', 'categories_expenses', 'categories_suppliers'])
      .is('store_id', null) as { data: { key: string; value: string }[] | null }

    const row = (key: string) => data?.find(r => r.key === key)?.value

    return NextResponse.json({
      accessories: parseOrDefault(row('categories_accessories'), 'accessories'),
      expenses:    parseOrDefault(row('categories_expenses'),    'expenses'),
      suppliers:   parseOrDefault(row('categories_suppliers'),   'suppliers'),
    })
  } catch {
    return NextResponse.json(DEFAULTS)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { type, categories }: { type: CatType; categories: string[] } = await request.json()

    if (!type || !['accessories', 'expenses', 'suppliers'].includes(type)) {
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      return NextResponse.json({ error: 'Au moins une catégorie requise' }, { status: 400 })
    }

    const key = `categories_${type}`

    // Delete existing, then insert — avoids NULL unique constraint issues
    await supabase.from('settings').delete()
      .eq('key', key)
      .is('store_id', null)

    const { error } = await supabase.from('settings').insert({
      key,
      value:      JSON.stringify(categories),
      store_id:   null,
      notes:      `Catégories ${type} — mis à jour`,
      updated_at: new Date().toISOString(),
    })

    if (error) throw error
    return NextResponse.json({ status: 'success', categories })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}