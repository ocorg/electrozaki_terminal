import { redirect }         from 'next/navigation'
import type { Metadata }    from 'next'
import { createClient, createUntypedClient } from '@/lib/supabase/server'
import InventoryModule      from '@/components/inventory/InventoryModule'

export const metadata: Metadata = { title: 'Inventaire — BZG Terminal' }

export default async function InventoryPage() {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, store_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = profileRaw as { role: string; store_id: string } | null

  if (profile?.role !== 'manager' && profile?.role !== 'owner') {
    redirect('/ez/dashboard')
  }

  return <InventoryModule role={profile?.role ?? 'staff'} />
}