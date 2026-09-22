import { prisma } from '@/lib/db'
import { requireUser, HttpError } from '@/lib/api'
import { NextRequest, NextResponse } from 'next/server'

// In-process rate limit: 5 attempts per IP per 60 seconds.
// Resets on cold start — sufficient to block manual and scripted brute-force
// within a running instance.
const _pinAttempts = new Map<string, { count: number; resetAt: number }>()

function checkPinRateLimit(ip: string): boolean {
  const now   = Date.now()
  const entry = _pinAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    _pinAttempts.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 5) return false
  entry.count++
  return true
}

export async function POST(request: NextRequest) {
  try {
    await requireUser()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0'
    if (!checkPinRateLimit(ip)) {
      return NextResponse.json(
        { authorized: false, error: 'Trop de tentatives — réessayez dans 1 minute' },
        { status: 429 }
      )
    }

    const { pin } = await request.json()
    if (!pin || pin.length !== 4) {
      return NextResponse.json({ authorized: false, error: 'PIN invalide' }, { status: 400 })
    }

    // Database function: bcrypt-compares the PIN with active managers'/owners' override_pin
    const [{ user_id }] = await prisma.$queryRaw<{ user_id: string | null }[]>`SELECT verify_override_pin(${String(pin)}) AS user_id`

    return NextResponse.json({ authorized: !!user_id, user_id })
  } catch (err: unknown) {
    if (err instanceof HttpError) return NextResponse.json({ authorized: false, error: err.message }, { status: err.status })
    console.error('[POST /api/auth/verify-override]', err)
    return NextResponse.json({ authorized: false, error: 'Erreur serveur' }, { status: 500 })
  }
}