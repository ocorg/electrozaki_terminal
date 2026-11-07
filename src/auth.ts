import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { AUTH_CLAIMS_SELECT, toClaims } from '@/types/auth'
import { authConfig } from './auth.config'

class InactiveAccount extends CredentialsSignin {
  code = 'inactive'
}
class TooManyAttempts extends CredentialsSignin {
  code = 'too_many'
}

// Wrong passwords are counted per email in the activity log: 8 in 15 minutes
// and that account's sign-in waits (security review 2026-11-07: the ERP is on
// the internet and had no limit). Counted in the database, so every server
// sees the same count.
const MAX_FAILURES = 8
const FAILURE_NOTE = 'Échec de connexion'
async function recentFailures(email: string) {
  return prisma.activity_log.count({
    where: { action_type: 'connexion', record_id: email, notes: FAILURE_NOTE, created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
  })
}
// kept by email only: a user can still be deleted later
async function recordFailure(email: string) {
  try {
    await prisma.activity_log.create({ data: { user_id: null, user_name: email.slice(0, 120), action_type: 'connexion', module: 'authentification', record_id: email.slice(0, 120), notes: FAILURE_NOTE } })
  } catch (err) { console.error('[auth] failure not recorded', err) }
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
        if (!email || !password || email.length > 120) return null
        if (await recentFailures(email) >= MAX_FAILURES) throw new TooManyAttempts()

        const profile = await prisma.user_profiles.findUnique({
          where:  { email },
          select: { ...AUTH_CLAIMS_SELECT, password_hash: true },
        })
        if (!profile?.password_hash) { await recordFailure(email); return null }
        if (!(await bcrypt.compare(password, profile.password_hash))) { await recordFailure(email); return null }
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
