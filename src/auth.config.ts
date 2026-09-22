import type { NextAuthConfig } from 'next-auth'
import { toClaims, type AuthClaims } from '@/types/auth'

// Edge-safe half of the Auth.js config (no Prisma): used as-is by middleware,
// and extended with the Credentials provider + DB refresh in src/auth.ts.
export const authConfig = {
  pages:     { signIn: '/login' },
  session:   { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) Object.assign(token, toClaims(user as AuthClaims), { claimsRefreshedAt: Date.now() })
      return token
    },
    session({ session, token }) {
      const claims = toClaims(token as unknown as AuthClaims)
      session.user = { ...session.user, ...claims, name: claims.display_name, image: claims.avatar_url }
      return session
    },
  },
} satisfies NextAuthConfig
