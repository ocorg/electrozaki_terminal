// Server side of the CRM leads (API routes only): input checks.
import type { lead_canal } from '@prisma/client'
import { pickInput, columnsOf, HttpError } from '@/lib/api'
import { CANAUX, TYPES } from '@/lib/leads'

export const LEAD_FIELDS = columnsOf('leads', [
  'lead_id', 'etape', 'motif_perte', 'txn_id', 'delivery_id', 'phone_id', 'montant', 'closed_at', 'client_id',
])

/** Common checks of a lead's details; returns the cleaned input. */
export function leadInput(body: Record<string, unknown>) {
  const input = pickInput('leads', body, LEAD_FIELDS) as Record<string, unknown>
  if ('canal' in input && !CANAUX.includes(input.canal as lead_canal)) throw new HttpError(400, 'Canal inconnu')
  if ('type_demande' in input && !TYPES.includes(input.type_demande as never)) throw new HttpError(400, 'Type de demande inconnu')
  if (typeof input.pseudo === 'string') input.pseudo = input.pseudo.trim().replace(/^@+/, '') || null
  if (typeof input.telephone === 'string') {
    const digits = input.telephone.replace(/\D/g, '')
    input.telephone = digits ? (digits.length === 9 ? `0${digits}` : digits.startsWith('212') ? `0${digits.slice(3)}` : digits) : null
  }
  for (const k of ['budget_min', 'budget_max', 'prix_demande', 'prix_propose'] as const) {
    if (input[k] != null && !(Number(input[k]) >= 0)) throw new HttpError(400, 'Montant invalide')
  }
  return input
}

