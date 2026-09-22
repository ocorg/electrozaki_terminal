import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { AUTH_CLAIMS_SELECT, toClaims } from '@/types/auth'
import { authConfig } from './auth.config'

class InactiveAccount extends CredentialsSignin {
  code = 'inactive'
}

// Role / store / active-flag changes reach an existing session within this window.
const CLAIMS_TTL_MS = 5 * 60 * 1000

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email    = String(credentials?.email ?? '').trim().toLowerCase()
        const password = String(credentials?.password ?? '')
        if (!email || !password) return null

        const profile = await prisma.user_profiles.findUnique({
          where:  { email },
          select: { ...AUTH_CLAIMS_SELECT, password_hash: true },
        })
        if (!profile?.password_hash) return null
        if (!(await bcrypt.compare(password, profile.password_hash))) return null
        if (!profile.is_active) throw new InactiveAccount()

        return toClaims(profile)
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = authConfig.callbacks.jwt(params)
      const stale = Date.now() - (token.claimsRefreshedAt ?? 0) > CLAIMS_TTL_MS
      if (params.user || !token.id || !stale) return token

      const profile = await prisma.user_profiles.findUnique({
        where:  { id: token.id },
        select: AUTH_CLAIMS_SELECT,
      })
      if (!profile) return null
      return Object.assign(token, toClaims(profile), { claimsRefreshedAt: Date.now() })
    },
  },
})

// For API routes: the session's user, re-checked against the database so a
// deactivated account is refused immediately rather than after the JWT refresh.
export async function getActiveUser() {
  const session = await auth()
  if (!session?.user?.id) return null
  const profile = await prisma.user_profiles.findUnique({
    where:  { id: session.user.id },
    select: AUTH_CLAIMS_SELECT,
  })
  return profile?.is_active ? toClaims(profile) : null
}
