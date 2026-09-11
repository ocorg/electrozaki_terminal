import { createAdminClient } from '@/lib/supabase/server'
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

    const supabase = createAdminClient()

    // Call the DB function that checks bcrypt hash
    const { data, error } = await supabase
      .rpc('verify_override_pin', { p_pin: pin } as any)

    if (error) throw error

    return NextResponse.json({ authorized: !!data, user_id: data || null })
  } catch (err: unknown) {
    return NextResponse.json({ authorized: false, error: (err as Error).message }, { status: 500 })
  }
}