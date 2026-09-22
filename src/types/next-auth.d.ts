import type { DefaultSession } from 'next-auth'
import type { AuthClaims } from '@/types/auth'

declare module 'next-auth' {
  interface User extends Omit<AuthClaims, 'id' | 'email'> {}

  interface Session {
    user: AuthClaims & DefaultSession['user']
  }
}

declare module '@auth/core/jwt' {
  interface JWT extends Partial<AuthClaims> {
    claimsRefreshedAt?: number
  }
}
