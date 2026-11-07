import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser } from '@/lib/api'
import { resolveCode } from '@/lib/accessoryCodes'

// GET ?code= — what a scanned code designates (owner, 2026-11-07; lib/accessoryCodes):
// { acc_id, variant_id } or null when the code is unknown (the screen then asks
// « C'est quel article ? »).
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const code = new URL(request.url).searchParams.get('code') ?? ''
    return json({ data: code.trim() ? await resolveCode(prisma, code) : null })
  } catch (err) {
    return handleError(err, 'GET /api/accessories/scan')
  }
}
