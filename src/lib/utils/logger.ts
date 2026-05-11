import { createUntypedClient } from '@/lib/supabase/server'

export interface LogPayload {
  store_id?:     string | null
  user_id:       string
  user_name:     string
  action_type:   'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'OVERRIDE' | 'EOD_SUBMIT' | 'EOD_APPROVE' | 'EOD_REJECT' | 'PUNCH_IN' | 'PUNCH_OUT' | 'USER_CREATE' | 'VOID'
  module:        'phones' | 'laptops' | 'accessories' | 'transactions' | 'reparations' | 'clients' | 'suppliers' | 'supplier_payments' | 'expenses' | 'caisse' | 'stock_movements' | 'users' | 'settings' | 'auth' | 'attendance' | 'changelog' | 'repairs/parts' | 'cash_drops'
  record_id?:    string | null
  before_state?: Record<string, unknown> | null
  after_state?:  Record<string, unknown> | null
  ip_address?:   string | null
  notes?:        string | null
}

export async function logActivity(payload: LogPayload): Promise<void> {
  try {
    const supabase = await createUntypedClient()
    await supabase.from('activity_log').insert({
      store_id:     payload.store_id     ?? null,
      user_id:      payload.user_id,
      user_name:    payload.user_name,
      action_type:  payload.action_type,
      module:       payload.module,
      record_id:    payload.record_id    ?? null,
      before_state: payload.before_state ?? null,
      after_state:  payload.after_state  ?? null,
      ip_address:   payload.ip_address   ?? null,
      notes:        payload.notes        ?? null,
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