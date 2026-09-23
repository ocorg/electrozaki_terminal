import type { UserRole } from '@/types/database'

// Profile fields carried in the session JWT, so middleware and client
// components can make routing decisions without a database round-trip.
export interface AuthClaims {
  id:           string
  email:        string
  display_name: string
  role:         UserRole
  store_id:     string | null
  store_locked: boolean
  is_active:    boolean
  avatar_url:   string | null
}

export const AUTH_CLAIMS_SELECT = {
  id:           true,
  email:        true,
  display_name: true,
  role:         true,
  store_id:     true,
  store_locked: true,
  is_active:    true,
  avatar_url:   true,
} as const

export function toClaims(source: AuthClaims): AuthClaims {
  return {
    id:           source.id,
    email:        source.email,
    display_name: source.display_name,
    role:         source.role,
    store_id:     source.store_id,
    store_locked: source.store_locked,
    is_active:    source.is_active,
    avatar_url:   source.avatar_url,
  }
}
