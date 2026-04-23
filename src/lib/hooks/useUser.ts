'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/types/database'

// Extended profile type with new columns
export interface ExtendedUserProfile extends UserProfile {
  store_id:     string | null
  avatar_url:   string | null
  store_locked: boolean
}

export function useUser() {
  const [user, setUser]       = useState<ExtendedUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase              = createClient()

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, display_name, role, is_active, store_id, avatar_url, store_locked, created_at, updated_at')
        .eq('id', authUser.id)
        .single()

      setUser(profile as ExtendedUserProfile | null)
      setLoading(false)
    }

    fetchUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchUser()
    })

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}