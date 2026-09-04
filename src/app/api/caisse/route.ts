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

    // Réparations livrées aujourd'hui — encaisser le RESTE (cout - avance déjà perçue au dépôt)
    const { data: repsDelivered } = await supabase
      .from('reparations')
      .select('cout_reparation, avance_rep')
      .eq('store_id', store_id)
      .eq('date_livraison', date)
      .eq('statut', 'تم الاستلام') as { data: Record<string, unknown>[] | null }

    // Réparations déposées aujourd'hui avec avance — encaisser l'avance reçue AU DÉPÔT
    const { data: repsDepot } = await supabase
      .from('reparations')
      .select('avance_rep')
      .eq('store_id', store_id)
      .eq('date_depot', date)
      .gt('avance_rep', 0) as { data: Record<string, unknown>[] | null }

    // Sum expenses today (exclude soft-deleted)
    const { data: exps } = await supabase
      .from('expenses')
      .select('montant')
      .eq('store_id', store_id)
      .eq('date', date)
      .eq('is_deleted', false) as { data: Record<string, unknown>[] | null }

    // Sum cash drops today
    const { data: drops } = await supabase
      .from('cash_drops')
      .select('amount')
      .eq('store_id', store_id)
      .eq('date', date) as { data: Record<string, unknown>[] | null }

    // Sum phone credit versements today (avances & tranches reçus)
    const { data: creditPmts } = await supabase
      .from('phone_credit_payments')
      .select('montant, payment_method')
      .eq('store_id', store_id)
      .eq('date_paiement', date) as { data: Record<string, unknown>[] | null }

    const total_ventes = (txns || []).reduce((s, t) => {
      const pv = (t.prix_vente     as number) || 0
      const av = (t.avance         as number) || 0
      const ve = (t.valeur_echange as number) || 0
      const pm =  t.payment_method as string
      if (pm === 'إستبدال') return s + (pv - ve)
      if (pm === 'آجل')    return s + av            // credit sale: add avance only (usually 0)
      const isPartial = av > 0 && (pv - av - ve) > 0
      return s + (isPartial ? av : pv - ve)          // partial تسبيق → avance; fully paid → full
    }, 0)
    const total_reparations =
      // Reste encaissé à la livraison (cout − avance déjà perçue au dépôt)
      (repsDelivered || []).reduce((s, r) => {
        const cout  = (r.cout_reparation as number) || 0
        const avance = (r.avance_rep    as number) || 0
        return s + Math.max(cout - avance, 0)
      }, 0)
      // + Avances encaissées au dépôt aujourd'hui
      + (repsDepot || []).reduce((s, r) => s + ((r.avance_rep as number) || 0), 0)
    const total_depenses          = (exps       || []).reduce((s, e) => s + ((e.montant          as number) || 0), 0)
    const total_cash_drops        = (drops      || []).reduce((s, d) => s + ((d.amount           as number) || 0), 0)
    const total_credit_versements = (creditPmts || []).reduce((s, p) => s + ((p.montant          as number) || 0), 0)
    const ouverture               = (caisse.ouverture as number) || 0
    const solde_theorique         = ouverture + total_ventes + total_reparations + total_cash_drops + total_credit_versements - total_depenses

    // Payment breakdown — use actual amounts per method, including mixed payment split
    const credit_cash     = (creditPmts || []).filter(p => (p.payment_method as string) === 'نقد').reduce((s, p) => s + ((p.montant as number) || 0), 0)
    const credit_transfer = (creditPmts || []).filter(p => (p.payment_method as string) === 'تحويل').reduce((s, p) => s + ((p.montant as number) || 0), 0)

    const payment_breakdown = {
      // Cash physique réel : ventes نقد + portion espèces مختلط + échanges net + drops + versements crédit نقد
      cash: (txns || []).reduce((s, t) => {
        const pm = t.payment_method as string
        const pv = (t.prix_vente      as number) || 0
        const av = (t.avance          as number) || 0
        const ve = (t.valeur_echange  as number) || 0
        if (pm === 'نقد') {
          const isPartial = av > 0 && (pv - av - ve) > 0
          return s + (isPartial ? av : Math.max(pv - ve, 0))
        }
        if (pm === 'مختلط')   return s + ((t.montant_especes as number) || 0)
        if (pm === 'إستبدال') return s + Math.max(pv - ve, 0)
        return s
      }, 0) + total_cash_drops + credit_cash,
      // Virements : ventes تحويل + portion virement مختلط + versements crédit تحويل
      transfer: (txns || []).reduce((s, t) => {
        const pm = t.payment_method as string
        const pv = (t.prix_vente as number) || 0
        const av = (t.avance    as number) || 0
        if (pm === 'تحويل') {
          const isPartial = av > 0 && (pv - av) > 0
          return s + (isPartial ? av : pv)
        }
        if (pm === 'مختلط') return s + ((t.montant_carte as number) || 0)
        return s
      }, 0) + credit_transfer,
      // Créances : montant RESTANT DÛ sur ventes آجل (non encore encaissé)
      credit: (txns || []).reduce((s, t) => {
        const pm = t.payment_method as string
        const pv = (t.prix_vente     as number) || 0
        const av = (t.avance         as number) || 0
        const ve = (t.valeur_echange as number) || 0
        if (pm === 'آجل') return s + Math.max(pv - av - ve, 0)
        return s
      }, 0),
    }

    return NextResponse.json({
      data: {
        ...caisse,
        total_ventes,
        total_reparations,
        total_depenses,
        total_cash_drops,
        solde_theorique,
        payment_breakdown,
        total_credit_versements,
        nb_transactions:      (txns       || []).length,
        nb_cash_drops:        (drops      || []).length,
        nb_credit_versements: (creditPmts || []).length,
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

    const [txnRes, repDeliveredRes, repDepotRes, expRes, dropRes, creditRes] = await Promise.all([
      supabase.from('transactions').select('prix_vente, payment_method, avance, valeur_echange')
        .eq('store_id', caisseStore).eq('date_vente', caisseDate).eq('voided', false),
      supabase.from('reparations').select('cout_reparation, avance_rep')
        .eq('store_id', caisseStore).eq('date_livraison', caisseDate).eq('statut', 'تم الاستلام'),
      supabase.from('reparations').select('avance_rep')
        .eq('store_id', caisseStore).eq('date_depot', caisseDate).gt('avance_rep', 0),
      supabase.from('expenses').select('montant')
        .eq('store_id', caisseStore).eq('date', caisseDate),
      supabase.from('cash_drops').select('amount')
        .eq('store_id', caisseStore).eq('date', caisseDate),
      supabase.from('phone_credit_payments').select('montant')
        .eq('store_id', caisseStore).eq('date_paiement', caisseDate),
    ])

    const live_ventes = ((txnRes.data || []) as Record<string, unknown>[]).reduce((s, t) => {
      const pv = (t.prix_vente     as number) || 0
      const av = (t.avance         as number) || 0
      const ve = (t.valeur_echange as number) || 0
      const pm =  t.payment_method as string
      if (pm === 'إستبدال') return s + (pv - ve)
      if (pm === 'آجل')    return s + av
      const isPartial = av > 0 && (pv - av - ve) > 0
      return s + (isPartial ? av : pv - ve)
    }, 0)
    const live_reps =
      ((repDeliveredRes.data || []) as Record<string, unknown>[]).reduce((s, r) => {
        const cout  = (r.cout_reparation as number) || 0
        const avance = (r.avance_rep    as number) || 0
        return s + Math.max(cout - avance, 0)
      }, 0)
      + ((repDepotRes.data || []) as Record<string, unknown>[]).reduce((s, r) => s + ((r.avance_rep as number) || 0), 0)
    const live_exps              = ((expRes.data    || []) as Record<string, unknown>[]).reduce((s, e) => s + ((e.montant          as number) || 0), 0)
    const live_drops             = ((dropRes.data   || []) as Record<string, unknown>[]).reduce((s, d) => s + ((d.amount           as number) || 0), 0)
    const live_credit_versements = ((creditRes.data || []) as Record<string, unknown>[]).reduce((s, p) => s + ((p.montant          as number) || 0), 0)
    const solde_theorique        = ((current.ouverture as number) || 0) + live_ventes + live_reps + live_drops + live_credit_versements - live_exps
    const ecart           = solde_reel - solde_theorique

    const { data, error } = await supabase
      .from('caisse')
      .update({
        solde_reel,
        ecart,
        // Persist computed totals so BZG cross-store view reads real figures
        total_ventes:      live_ventes,
        total_reparations: live_reps,
        total_depenses:    live_exps,
        total_cash_drops:  live_drops,
        solde_theorique,
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