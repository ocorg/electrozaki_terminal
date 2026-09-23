import type { Prisma, log_action, log_module } from '@prisma/client'
import { prisma } from '@/lib/db'
import { toWire } from '@/lib/api'

export interface LogPayload {
  store_id?:     string | null
  user_id:       string
  user_name:     string
  action_type:   log_action
  module:        log_module
  record_id?:    string | null
  before_state?: unknown
  after_state?:  unknown
  ip_address?:   string | null
  notes?:        string | null
}

const snapshot = (state: unknown) =>
  state === null || state === undefined ? undefined : (toWire(state) as Prisma.InputJsonValue)

export async function logActivity(payload: LogPayload): Promise<void> {
  try {
    await prisma.activity_log.create({
      data: {
        store_id:     payload.store_id  ?? null,
        user_id:      payload.user_id,
        user_name:    payload.user_name,
        action_type:  payload.action_type,
        module:       payload.module,
        record_id:    payload.record_id ?? null,
        before_state: snapshot(payload.before_state),
        after_state:  snapshot(payload.after_state),
        ip_address:   payload.ip_address ?? null,
        notes:        payload.notes      ?? null,
      },
    })
  } catch (err) {
    // Log failures must NEVER crash the main operation
    console.error('[logActivity] failed silently:', err)
  }
}

export function getIpFromRequest(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  )
}
