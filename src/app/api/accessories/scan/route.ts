import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser } from '@/lib/api'
import { resolveCodeAll } from '@/lib/accessoryCodes'

// GET ?code= — what a scanned code designates (owner, 2026-11-07; lib/accessoryCodes):
// data: the first { acc_id, variant_id } or null when unknown (the screen then
// asks « C'est quel article ? »); matches: all of them when the code is shared.
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const code = new URL(request.url).searchParams.get('code') ?? ''
    const matches = code.trim() ? await resolveCodeAll(prisma, code) : []
    return json({ data: matches[0] ?? null, matches })
  } catch (err) {
    return handleError(err, 'GET /api/accessories/scan')
  }
}
