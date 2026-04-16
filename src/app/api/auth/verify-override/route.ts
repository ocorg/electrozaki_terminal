import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
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