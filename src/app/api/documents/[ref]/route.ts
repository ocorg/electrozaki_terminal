import { NextResponse } from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

// ── GET /api/documents/[ref] ──────────────────────────────────────────────────
// Retourne un document unique par sa doc_ref (ex: EZ-2025-000001).

export async function GET(
  _request: Request,
  { params }: { params: { ref: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await createUntypedClient()
    const { data, error } = await db
      .from('ez_documents')
      .select('*')
      .eq('doc_ref', params.ref)
      .eq('store_id', 'EZ-001')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Document introuvable' }, { status: 404 })
    }

    return NextResponse.json({ status: 'success', data })
  } catch (err) {
    console.error('[GET /api/documents/[ref]]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}