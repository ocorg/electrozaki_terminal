import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth, getActiveUser } from '@/auth'
import type { AuthClaims } from '@/types/auth'
import type { UserRole } from '@/types/database'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const MANAGERS: UserRole[] = ['gerant', 'proprietaire']

// Screens were written against Supabase's JSON: numbers for money, 'YYYY-MM-DD'
// for date columns. Prisma returns Decimal objects (serialised as strings) and
// full Date objects, so every response goes through this.
// Midnight-UTC instants are treated as date-only values — a real timestamp
// landing on exactly 00:00:00.000Z is not a practical concern here.
export function toWire(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Prisma.Decimal) return value.toNumber()
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) {
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (Array.isArray(value)) return value.map(toWire)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toWire(v)
    return out
  }
  return value
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(toWire(data), init)
}

// Session check from the signed JWT — no database round-trip. Good for reads.
export async function requireUser(): Promise<AuthClaims> {
  const session = await auth()
  if (!session?.user?.id) throw new HttpError(401, 'Non autorisé')
  return session.user
}

// Re-checks the account in the database (deactivation / role change take
// effect immediately). Use for writes.
export async function requireActiveUser(roles?: UserRole[]): Promise<AuthClaims> {
  const user = await getActiveUser()
  if (!user) throw new HttpError(401, 'Non autorisé')
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'Accès refusé')
  return user
}

export function handleError(err: unknown, where: string) {
  if (err instanceof HttpError) return json({ error: err.message }, { status: err.status })
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return json({ error: 'Cet élément existe déjà' }, { status: 409 })
    if (err.code === 'P2003') return json({ error: 'Référence invalide ou élément encore utilisé' }, { status: 409 })
    if (err.code === 'P2025') return json({ error: 'Élément introuvable' }, { status: 404 })
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error(`[${where}]`, err.message)
    return json({ error: 'Données invalides' }, { status: 400 })
  }
  console.error(`[${where}]`, err)
  return json({ error: 'Erreur serveur' }, { status: 500 })
}

// 'YYYY-MM-DD' (what <input type="date"> sends) → Date for @db.Date columns.
export function dateOnly(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) throw new HttpError(400, 'Date invalide')
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
}

export function todayDate(): Date {
  return dateOnly(new Date().toISOString().slice(0, 10))!
}

export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length) throw new HttpError(400, `${missing.join(', ')} requis`)
}
