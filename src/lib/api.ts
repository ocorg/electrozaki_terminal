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
  // Decimals from the storefront database's client (a separate generated client)
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber()
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

// Supabase coerced text into numbers/dates itself; Prisma rejects "85" for an Int.
// Picks `fields` from `body` (absent keys stay absent, so updates stay partial) and
// converts each value to the column's type, read from Prisma's data model.
const fieldTypes = new Map<string, Map<string, string>>()
function typesOf(model: string) {
  let types = fieldTypes.get(model)
  if (!types) {
    const m = Prisma.dmmf.datamodel.models.find(x => x.name === model)
    if (!m) throw new Error(`unknown model ${model}`)
    types = new Map(m.fields.filter(f => f.kind !== 'object').map(f => [f.name, f.kind === 'enum' ? 'enum' : f.type]))
    fieldTypes.set(model, types)
  }
  return types
}

const SYSTEM_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted']

// All writable business columns of a model: everything except `exclude`
// (typically the id) and the audit/soft-delete columns set by the server.
export function columnsOf(model: Prisma.ModelName, exclude: string[] = []) {
  return Array.from(typesOf(model).keys()).filter(c => !exclude.includes(c) && !SYSTEM_COLUMNS.includes(c))
}

export function pickInput(model: Prisma.ModelName, body: Record<string, unknown>, fields: readonly string[]) {
  const types = typesOf(model)
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (!(f in body) || body[f] === undefined) continue
    const type = types.get(f)
    if (!type) throw new Error(`${model}.${f} is not a column`)
    const v = body[f]
    if (type === 'String' || type === 'Json') { out[f] = v; continue }
    if (v === null || v === '') { out[f] = null; continue }
    switch (type) {
      case 'Int':
      case 'Decimal': {
        const n = Number(v)
        if (!Number.isFinite(n)) throw new HttpError(400, `Champ "${f}" doit être un nombre valide`)
        out[f] = type === 'Int' ? Math.trunc(n) : n
        break
      }
      case 'Boolean':
        out[f] = v === true || v === 'true'
        break
      case 'DateTime': {
        const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dateOnly(v)! : new Date(v as string)
        if (Number.isNaN(d.getTime())) throw new HttpError(400, `Date invalide : ${f}`)
        out[f] = d
        break
      }
      default:
        out[f] = v // enums: Prisma validates the value
    }
  }
  return out
}

export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length) throw new HttpError(400, `${missing.join(', ')} requis`)
}
