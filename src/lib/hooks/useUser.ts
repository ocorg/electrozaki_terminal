'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/types/database'

// Module-level cache — persists for the lifetime of the browser tab.
// Cleared on sign-out or when a different user signs in.
let _cachedUid:     string      | null = null
let _cachedProfile: UserProfile | null = null

export function useUser() {
  const [user, setUser]       = useState<UserProfile | null>(_cachedProfile)
  const [loading, setLoading] = useState(!_cachedProfile)
  const supabase              = createClient()

  useEffect(() => {
    const fetchProfile = async (uid: string) => {
      // Same user, profile already in cache — skip the DB call
      if (_cachedUid === uid && _cachedProfile) {
        setUser(_cachedProfile)
        setLoading(false)
        return
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, display_name, role, is_active, store_id, avatar_url, store_locked, created_at, updated_at')
        .eq('id', uid)
        .single()

      _cachedUid     = uid
      _cachedProfile = profile as UserProfile | null
      setUser(_cachedProfile)
      setLoading(false)
    }

    const clearCache = () => {
      _cachedUid     = null
      _cachedProfile = null
      setUser(null)
      setLoading(false)
    }

    // Initial load
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (!authUser) { clearCache(); return }
      fetchProfile(authUser.id)
    })

    // Auth state changes — only re-fetch when user ID actually changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      if (!uid) { clearCache(); return }
      if (uid !== _cachedUid) {
        // Different user (new sign-in) — fetch fresh
        fetchProfile(uid)
      }
      // Same UID + token refresh → cache hit, no DB call
    })

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}