import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const date     = searchParams.get('date') || new Date().toISOString().split('T')[0]

    if (!store_id) return NextResponse.json({ error: 'store_id requis' }, { status: 400 })

    // Fetch today's caisse record
    const { data: caisse } = await supabase
      .from('caisse')
      .select('*')
      .eq('store_id', store_id)
      .eq('date', date)
      .single() as { data: Record<string, unknown> | null }

    if (!caisse) {
      return NextResponse.json({ data: null })
    }

    // Live aggregation — sum transactions for today (exclude voided)
    const { data: txns } = await supabase
      .from('transactions')
      .select('prix_vente, type_operation, payment_method, avance, valeur_echange, montant_especes, montant_carte')
      .eq('store_id', store_id)
      .eq('date_vente', date)
      .eq('voided', false) as { data: Record<string, unknown>[] | null }

    // Sum repairs collected today
    const { data: reps } = await supabase
      .from('reparations')
      .select('cout_reparation, avance_rep, statut')
      .eq('store_id', store_id)
      .eq('date_livraison', date)
      .eq('statut', 'تم الاستلام') as { data: Record<string, unknown>[] | null }

    // Sum expenses today
    const { data: exps } = await supabase
      .from('expenses')
      .select('montant')
      .eq('store_id', store_id)
      .eq('date', date) as { data: Record<string, unknown>[] | null }

    // For credit/advance sales, only count the amount actually collected (avance), not the full prix_vente.
    // For exchange sales, the cash received is prix_vente - valeur_echange.
    const total_ventes = (txns || []).reduce((s, t) => {
      const pm = t.payment_method as string
      if (pm === 'تسبيق') return s + ((t.avance as number) || 0)
      if (pm === 'إستبدال') return s + (((t.prix_vente as number) || 0) - ((t.valeur_echange as number) || 0))
      return s + ((t.prix_vente as number) || 0)
    }, 0)
    const total_reparations = (reps || []).reduce((s, r) => s + ((r.cout_reparation as number) || 0), 0)
    const total_depenses   = (exps || []).reduce((s, e) => s + ((e.montant as number) || 0), 0)
    const ouverture        = (caisse.ouverture as number) || 0
    const solde_theorique  = ouverture + total_ventes + total_reparations - total_depenses

    // Payment breakdown — use actual amounts per method, including mixed payment split
    const payment_breakdown = {
      cash: (txns || []).reduce((s, t) => {
        const pm = t.payment_method as string
        if (pm === 'نقد')    return s + ((t.prix_vente as number) || 0)
        if (pm === 'مختلط')  return s + ((t.montant_especes as number) || 0)
        return s
      }, 0),
      transfer: (txns || []).reduce((s, t) => {
        const pm = t.payment_method as string
        if (pm === 'تحويل')  return s + ((t.prix_vente as number) || 0)
        if (pm === 'مختلط')  return s + ((t.montant_carte as number) || 0)
        return s
      }, 0),
      credit: (txns || []).filter(t => t.payment_method === 'تسبيق').reduce((s, t) => s + ((t.avance as number) || 0), 0),
    }

    return NextResponse.json({
      data: {
        ...caisse,
        total_ventes,
        total_reparations,
        total_depenses,
        solde_theorique,
        payment_breakdown,
        nb_transactions: (txns || []).length,
      }
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // BOD — open the drawer for today
  try {
    const supabase       = await createUntypedClient()
    const typedSupabase  = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body     = await request.json()
    const store_id = body.store_id ?? profile?.store_id
    const date     = new Date().toISOString().split('T')[0]

    if (!store_id) return NextResponse.json({ error: 'store_id manquant' }, { status: 400 })

    // Check not already open today
    const { data: existing } = await supabase
      .from('caisse')
      .select('caisse_id, status')
      .eq('store_id', store_id)
      .eq('date', date)
      .single() as { data: { caisse_id: string; status: string } | null }

    if (existing) {
      return NextResponse.json({ error: 'Caisse déjà ouverte pour aujourd\'hui', data: existing }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('caisse')
      .insert({
        date,
        store_id,
        ouverture:  body.ouverture ?? 0,
        status:     'open',
        created_by: user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'INSERT',
      module:      'caisse',
      record_id:   data.caisse_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `BOD — Ouverture: ${body.ouverture} MAD`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  // EOD — submit closure for approval
  try {
    const supabase       = await createUntypedClient()
    const typedSupabase  = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json()
    const { caisse_id, solde_reel, notes } = body

    if (!caisse_id) return NextResponse.json({ error: 'caisse_id requis' }, { status: 400 })
    if (solde_reel == null) return NextResponse.json({ error: 'solde_reel requis' }, { status: 400 })

    // Fetch current to compute ecart
    const { data: current } = await supabase
      .from('caisse')
      .select('*')
      .eq('caisse_id', caisse_id)
      .single() as { data: Record<string, unknown> | null }

    if (!current) return NextResponse.json({ error: 'Caisse introuvable' }, { status: 404 })
    if (current.status !== 'open') return NextResponse.json({ error: 'Caisse non ouverte' }, { status: 400 })

    // Re-compute live solde_theorique at EOD time (the stored column value is stale)
    const caisseDate = current.date as string
    const caisseStore = current.store_id as string

    const [txnRes, repRes, expRes] = await Promise.all([
      supabase.from('transactions').select('prix_vente, payment_method, avance, valeur_echange')
        .eq('store_id', caisseStore).eq('date_vente', caisseDate).eq('voided', false),
      supabase.from('reparations').select('cout_reparation')
        .eq('store_id', caisseStore).eq('date_livraison', caisseDate).eq('statut', 'تم الاستلام'),
      supabase.from('expenses').select('montant')
        .eq('store_id', caisseStore).eq('date', caisseDate),
    ])

    const live_ventes = ((txnRes.data || []) as Record<string, unknown>[]).reduce((s, t) => {
      const pm = t.payment_method as string
      if (pm === 'تسبيق')   return s + ((t.avance as number) || 0)
      if (pm === 'إستبدال') return s + (((t.prix_vente as number) || 0) - ((t.valeur_echange as number) || 0))
      return s + ((t.prix_vente as number) || 0)
    }, 0)
    const live_reps  = ((repRes.data  || []) as Record<string, unknown>[]).reduce((s, r) => s + ((r.cout_reparation as number) || 0), 0)
    const live_exps  = ((expRes.data  || []) as Record<string, unknown>[]).reduce((s, e) => s + ((e.montant as number) || 0), 0)
    const solde_theorique = ((current.ouverture as number) || 0) + live_ventes + live_reps - live_exps
    const ecart           = solde_reel - solde_theorique

    const { data, error } = await supabase
      .from('caisse')
      .update({
        solde_reel,
        ecart,
        status:           'pending_eod',
        eod_submitted_at: new Date().toISOString(),
        closed_by:        user.id,
        notes:            notes || null,
      })
      .eq('caisse_id', caisse_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     current.store_id as string,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'EOD_SUBMIT',
      module:       'caisse',
      record_id:    caisse_id,
      before_state: current,
      after_state:  data as Record<string, unknown>,
      ip_address:   getIpFromRequest(request),
      notes:        `EOD — Réel: ${solde_reel} MAD | Écart: ${ecart} MAD`,
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// PUT — owner approves EOD
export async function PUT(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; role: string } | null }

    if (!['owner', 'manager'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès réservé au propriétaire' }, { status: 403 })
    }

    const { caisse_id } = await request.json()
    if (!caisse_id) return NextResponse.json({ error: 'caisse_id requis' }, { status: 400 })

    const { data: before } = await supabase.from('caisse').select('*').eq('caisse_id', caisse_id).single() as { data: Record<string, unknown> | null }
    if (!before || before.status !== 'pending_eod') {
      return NextResponse.json({ error: 'Caisse non en attente d\'approbation' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('caisse')
      .update({ status: 'closed', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('caisse_id', caisse_id)
      .select().single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error

    await logActivity({
      store_id:    before.store_id as string,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'EOD_APPROVE',
      module:      'caisse',
      record_id:   caisse_id,
      before_state: before,
      after_state:  data ?? undefined,
      ip_address:  getIpFromRequest(request),
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}