import { createClient, createUntypedClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET() {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: self } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single() as { data: { role: string } | null }

    if (!['manager', 'owner'].includes(self?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, display_name, role, store_id, store_locked, is_active, avatar_url, created_at, updated_at')
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: self } = await supabase
      .from('user_profiles')
      .select('role, display_name')
      .eq('id', user.id)
      .single() as { data: { role: string; display_name: string } | null }

    if (!['manager', 'owner'].includes(self?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()

    // Allowlist — only extract known fields
    const {
      email, password, full_name, role,
      store_id, store_locked, is_active,
    } = body as {
      email: string; password: string; full_name: string; role: string
      store_id: string | null; store_locked: boolean; is_active: boolean
    }

    // Presence validation
    if (!email || !password || !full_name || !role) {
      return NextResponse.json({ error: 'email, password, full_name et role sont requis' }, { status: 400 })
    }

    // Email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Format email invalide' }, { status: 400 })
    }

    // Password length
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe: 8 caractères minimum' }, { status: 400 })
    }

    // Role allowlist
    const ALLOWED_ROLES = ['staff', 'manager', 'owner']
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 })
    }

    // Manager cannot create owner accounts
    if (self?.role === 'manager' && role === 'owner') {
      return NextResponse.json({ error: 'Accès refusé: un manager ne peut pas créer un compte owner' }, { status: 403 })
    }

    // Length limits
    if (full_name.length > 100) return NextResponse.json({ error: 'Nom trop long (max 100)' }, { status: 400 })
    if (email.length > 200)     return NextResponse.json({ error: 'Email trop long (max 200)' }, { status: 400 })

    // Use admin client for auth.admin operations
    const adminSupabase = createAdminClient()

    // Step 1 — Create auth user
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email:          email.trim().toLowerCase(),
      password,
      email_confirm:  true,
    })

    if (authError || !authData?.user) {
      const msg = authError?.message ?? 'Échec création compte auth'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const newUserId = authData.user.id

    // Step 2 — Insert user_profiles row
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id:           newUserId,
        display_name: full_name.trim(),
        role,
        store_id:     store_id || null,
        store_locked: Boolean(store_locked),
        is_active:    is_active !== false,
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (profileError || !profile) {
      // Rollback: delete the auth user to prevent orphaned records
      await adminSupabase.auth.admin.deleteUser(newUserId).catch(() => {})
      const msg = profileError ? (profileError as Error).message : 'Échec création profil'
      return NextResponse.json({ error: `Profil non créé — compte auth supprimé: ${msg}` }, { status: 500 })
    }

    await logActivity({
      store_id:    store_id ?? null,
      user_id:     user.id,
      user_name:   self?.display_name ?? '—',
      action_type: 'USER_CREATE',
      module:      'users',
      record_id:   newUserId,
      after_state: profile,
      ip_address:  getIpFromRequest(request),
      notes:       `Nouveau compte: ${full_name} (${role})`,
    })

    return NextResponse.json({ status: 'success', data: profile }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: self } = await supabase
      .from('user_profiles')
      .select('role, display_name')
      .eq('id', user.id)
      .single() as { data: { role: string; display_name: string } | null }

    if (!['manager', 'owner'].includes(self?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    // Prevent non-owner from editing owner accounts
    if (self?.role === 'manager') {
      const { data: target } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', id)
        .single() as { data: { role: string } | null }
      if (target?.role === 'owner') {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
    }

    const { data: before } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      user_id:      user.id,
      user_name:    self?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'users',
      record_id:    id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}