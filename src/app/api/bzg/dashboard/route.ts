import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const STORE_MAP: Record<string, string> = {
  'EZ-001': 'Electro Zaki',
}

export async function GET(_request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const today      = new Date().toISOString().split('T')[0]
    const monthStart = today.slice(0, 7) + '-01'

    const [txnRes, repairRes, caisseRes, staffRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('store_id, prix_vente, date_vente')
        .eq('voided', false)
        .gte('date_vente', monthStart),

      supabase
        .from('reparations')
        .select('store_id, statut')
        .neq('statut', 'تم الاستلام'),

      supabase
        .from('caisse')
        .select('caisse_id, store_id, date, status, solde_reel, solde_theorique, ecart, created_by')
        .gte('date', monthStart)
        .order('date', { ascending: false }),

      supabase
        .from('staff_attendance')
        .select('user_name, store_id, punch_type, punched_at')
        .eq('date', today)
        .order('punched_at', { ascending: false }),
    ])

    const txns    = (txnRes.data    || []) as Record<string, unknown>[]
    const repairs = (repairRes.data || []) as Record<string, unknown>[]
    const caisses = (caisseRes.data || []) as Record<string, unknown>[]
    const staff   = (staffRes.data  || []) as Record<string, unknown>[]

    // Build per-store snapshots server-side
    const snapshots = Object.keys(STORE_MAP).map(storeId => {
      const storeTxns    = txns.filter(t => t.store_id === storeId)
      const todayTxns    = storeTxns.filter(t => t.date_vente === today)
      const storeRepairs = repairs.filter(r => r.store_id === storeId)
      const todayCaisse  = caisses.find(c => c.store_id === storeId && c.date === today)

      return {
        store_id:       storeId,
        ca_today:       todayTxns.reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
        ca_month:       storeTxns.reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
        nb_ventes:      storeTxns.length,
        active_repairs: storeRepairs.length,
        caisse_status:  todayCaisse ? todayCaisse.status : 'none',
        caisse_id:      todayCaisse?.caisse_id ?? null,
      }
    })

    // Pending EOD approvals
    const pendingEOD = caisses
      .filter(c => c.status === 'pending_eod')
      .map(c => ({
        caisse_id:       c.caisse_id,
        store_id:        c.store_id,
        store_name:      STORE_MAP[c.store_id as string] ?? c.store_id,
        date:            c.date,
        solde_reel:      c.solde_reel,
        solde_theorique: c.solde_theorique,
        ecart:           c.ecart,
        submitted_by:    c.created_by ?? '—',
      }))

    return NextResponse.json({ snapshots, pendingEOD, staffToday: staff })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}