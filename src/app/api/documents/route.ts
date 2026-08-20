import { NextResponse } from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

const TYPE_MAP: Record<string, { prefix: string; seq: string }> = {
  FAC: { prefix: 'EZ',  seq: 'ez_fac_seq' },
  RCH: { prefix: 'RCH', seq: 'ez_rch_seq' },
  ECH: { prefix: 'ECH', seq: 'ez_ech_seq' },
  PEC: { prefix: 'SAV', seq: 'ez_sav_seq' },
  RST: { prefix: 'RST', seq: 'ez_rst_seq' },
}

// ── GET /api/documents ────────────────────────────────────────────────────────
// Mode 1 : ?lookup_imei=XXXXXXX  → retourne les données du téléphone (autocomplete)
// Mode 2 : archive filtrée (type, search, from, to, limit)

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const lookup_imei = searchParams.get('lookup_imei')

    // ── Mode 1 : IMEI lookup ─────────────────────────────────────────────────
    if (lookup_imei) {
      const { data: phone, error: phoneError } = await supabase
        .from('phones')
        .select(
          'phone_id, imei, marque, model, stockage, ram, couleur, condition, ' +
          'prix_vente_recommande, prix_vente_minimum, warranty_months, ' +
          'status, source, description, is_damaged, damage_notes, serie, type'
        )
        .eq('imei', lookup_imei.trim())
        .eq('store_id', 'EZ-001')
        .eq('is_deleted', false)
        .neq('status', 'مباع' as any)
        .maybeSingle()

      if (phoneError) throw phoneError
      return NextResponse.json({ status: 'success', data: phone })
    }

    // ── Mode 2 : archive list ────────────────────────────────────────────────
    const type   = searchParams.get('type')
    const search = searchParams.get('search')
    const from   = searchParams.get('from')
    const to     = searchParams.get('to')
    const limit  = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    let query = db
      .from('ez_documents')
      .select(
        'doc_id, doc_type, doc_ref, doc_date, client_name, client_tel, ' +
        'device_label, imei, montant, warranty_end, warranty_months, ' +
        'txn_id, phone_id, created_at, printed_at'
      )
      .eq('store_id', 'EZ-001')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (type)   query = query.eq('doc_type', type)
    if (from)   query = query.gte('doc_date', from)
    if (to)     query = query.lte('doc_date', to)
    if (search) {
      query = query.or(
        `doc_ref.ilike.%${search}%,` +
        `client_name.ilike.%${search}%,` +
        `imei.ilike.%${search}%,` +
        `device_label.ilike.%${search}%`
      )
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ status: 'success', data: data ?? [] })
  } catch (err) {
    console.error('[GET /api/documents]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── POST /api/documents ───────────────────────────────────────────────────────
// Crée le document et génère la référence. Appelé quand l'utilisateur clique
// "Imprimer". txn_id est null à ce stade — rempli ensuite par /confirm-sale.

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await createUntypedClient()
    const body = await request.json()
    const {
      doc_type, phone_id, client_id, client_name, client_tel, client_cin,
      device_label, imei, montant, warranty_months, warranty_start,
      warranty_end, linked_doc_ref, doc_data,
    } = body

    if (!doc_type || !TYPE_MAP[doc_type]) {
      return NextResponse.json({ error: 'doc_type invalide' }, { status: 400 })
    }

    const { prefix, seq } = TYPE_MAP[doc_type]

    // Génère la référence via la fonction SQL
    const { data: refData, error: refError } = await db
      .rpc('next_doc_ref', { prefix, seq_name: seq })

    if (refError || !refData) {
      throw new Error(refError?.message ?? 'Impossible de générer la référence')
    }

    const doc_ref = refData as string

    const { data, error } = await db
      .from('ez_documents')
      .insert({
        store_id:        'EZ-001',
        doc_type,
        doc_ref,
        doc_date:        new Date().toISOString().split('T')[0],
        phone_id:        phone_id        || null,
        client_id:       client_id       || null,
        client_name:     client_name     || null,
        client_tel:      client_tel      || null,
        client_cin:      client_cin      || null,
        device_label:    device_label    || null,
        imei:            imei            || null,
        montant:         montant         ?? null,
        warranty_months: warranty_months ?? null,
        warranty_start:  warranty_start  || null,
        warranty_end:    warranty_end    || null,
        linked_doc_ref:  linked_doc_ref  || null,
        doc_data:        doc_data        ?? {},
        created_by:      user.id,
      })
      .select('doc_id, doc_ref')
      .single()

    if (error) throw error

    return NextResponse.json({ status: 'success', data })
  } catch (err) {
    console.error('[POST /api/documents]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}