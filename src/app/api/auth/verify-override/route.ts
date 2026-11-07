import { prisma } from '@/lib/db'
import { requireActiveUser, HttpError } from '@/lib/api'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity } from '@/lib/utils/logger'
import { issueOverride, recentPinFailures } from '@/lib/overridePin'

// A manager's PIN to sell under the minimum price (lib/overridePin).
// Wrong PINs are counted in the database for this user: 5 in 15 minutes and
// the PIN is refused until it calms down, whatever server answers (security
// review 2026-11-07; the old in-memory count reset on every cold start).
// A right PIN gives a signed permission for this employé, valid 30 minutes.
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    if (await recentPinFailures(prisma, user.id) >= 5) {
      return NextResponse.json({ authorized: false, error: 'Trop de codes faux : réessayez dans 15 minutes' }, { status: 429 })
    }
    const { pin } = await request.json()
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ authorized: false, error: 'PIN invalide' }, { status: 400 })
    }

    // Database function: bcrypt-compares the PIN with active managers'/owners' override_pin
    const [{ user_id }] = await prisma.$queryRaw<{ user_id: string | null }[]>`SELECT verify_override_pin(${pin}) AS user_id`
    if (!user_id) {
      await logActivity({ store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name, action_type: 'derogation', module: 'transactions', notes: 'PIN gérant incorrect' })
      return NextResponse.json({ authorized: false })
    }
    return NextResponse.json({ authorized: true, user_id, token: issueOverride(user_id, user.id) })
  } catch (err: unknown) {
    if (err instanceof HttpError) return NextResponse.json({ authorized: false, error: err.message }, { status: err.status })
    console.error('[POST /api/auth/verify-override]', err)
    return NextResponse.json({ authorized: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
