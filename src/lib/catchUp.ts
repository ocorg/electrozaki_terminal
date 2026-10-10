// Catching up on a forgotten day (owner, 2026-10-10): the shop sold without
// the ERP, so the day has no caisse and no sales. A manager can open that
// day's caisse after the fact and enter its sales, money in, returns and
// payments at their true date, then close it.
//   • managers and owner only
//   • at most CATCH_UP_DAYS days back, never today or later
//   • never on a day whose caisse is closed (a closed caisse does not move)
//   • the day's caisse must be open first (Caisse → "Rattraper une journée")
import { prisma } from '@/lib/db'
import { dateOnly, todayDate, HttpError, isManager } from '@/lib/api'

export const CATCH_UP_DAYS = 7

const fr = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/')

/** Checks a past date typed for catching up; returns it (rules above, the caisse aside). */
export function pastDay(user: { role: string }, raw: unknown): Date | null {
  const date = dateOnly(raw)
  const today = todayDate()
  if (!date || date.getTime() === today.getTime()) return null
  if (!isManager(user.role as never)) throw new HttpError(403, 'Saisie à une date passée : réservée aux gérants')
  if (date > today) throw new HttpError(400, 'La date est dans le futur')
  if (today.getTime() - date.getTime() > CATCH_UP_DAYS * 86_400_000) {
    throw new HttpError(400, `Rattrapage possible sur les ${CATCH_UP_DAYS} derniers jours seulement`)
  }
  return date
}

/**
 * The day an entry belongs to: today, or — when the screen is catching up on
 * a forgotten day — that day, once its caisse has been opened and while it
 * is not closed. `late` tells the caller to say so in the activity log.
 */
export async function workingDay(user: { role: string }, raw: unknown, storeId: string | null | undefined) {
  const date = pastDay(user, raw)
  if (!date) return { date: todayDate(), late: false, note: '' }
  const caisse = await prisma.caisse.findFirst({ where: { date, ...(storeId && { store_id: storeId }) }, select: { status: true } })
  if (!caisse) throw new HttpError(409, `Ouvrez d’abord la caisse du ${fr(date)} : Caisse du jour → Rattraper une journée oubliée`)
  if (caisse.status !== 'ouverte') throw new HttpError(409, `La caisse du ${fr(date)} est clôturée : elle ne bouge plus`)
  return { date, late: true, note: ` — saisi après coup pour le ${fr(date)}` }
}
