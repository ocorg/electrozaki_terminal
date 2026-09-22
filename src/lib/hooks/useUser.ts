'use client'
import { useSession } from 'next-auth/react'
import type { AuthClaims } from '@/types/auth'

export function useUser(): { user: AuthClaims | null; loading: boolean } {
  const { data, status } = useSession()
  return { user: data?.user ?? null, loading: status === 'loading' }
}
