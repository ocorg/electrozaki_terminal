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

// Correcting an earlier day (owner, 2026-10-13): a manager can fix the opening
// or counted amount of a day's caisse, or reopen a closed day to fix what was
// entered in it, CORRECTION_DAYS back at most. A reopened day takes entries at
// its date like a forgotten one, until it is closed again. Days stand alone:
// the cash goes to the vault each evening, so no day carries into the next.
export const CORRECTION_DAYS = 30

const fr = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/')

/** True when the day is today or at most CORRECTION_DAYS back. */
export const canCorrect = (date: Date) => {
  const age = todayDate().getTime() - date.getTime()
  return age >= 0 && age <= CORRECTION_DAYS * 86_400_000
}

/** Checks a past date typed for catching up; returns it (rules above, the caisse aside). */
export function pastDay(user: { role: string }, raw: unknown, maxDays = CATCH_UP_DAYS): Date | null {
  const date = dateOnly(raw)
  const today = todayDate()
  if (!date || date.getTime() === today.getTime()) return null
  if (!isManager(user.role as never)) throw new HttpError(403, 'Saisie à une date passée : réservée aux gérants')
  if (date > today) throw new HttpError(400, 'La date est dans le futur')
  if (today.getTime() - date.getTime() > maxDays * 86_400_000) {
    throw new HttpError(400, `Saisie possible sur les ${maxDays} derniers jours seulement`)
  }
  return date
}

/**
 * The day an entry belongs to: today, or — when the screen is catching up on
 * a forgotten day — that day, once its caisse has been opened and while it
 * is not closed. `late` tells the caller to say so in the activity log.
 */
export async function workingDay(user: { role: string }, raw: unknown, storeId: string | null | undefined) {
  // Beyond CATCH_UP_DAYS a day only has an open caisse when it was reopened for a correction
  const date = pastDay(user, raw, CORRECTION_DAYS)
  if (!date) return { date: todayDate(), late: false, note: '' }
  const caisse = await prisma.caisse.findFirst({ where: { date, ...(storeId && { store_id: storeId }) }, select: { status: true } })
  if (!caisse) throw new HttpError(409, `Ouvrez d’abord la caisse du ${fr(date)} : Caisse du jour → Rattraper une journée oubliée`)
  if (caisse.status !== 'ouverte') throw new HttpError(409, `La caisse du ${fr(date)} est clôturée : pour y ajouter quelque chose, rouvrez-la (Caisse du jour → Journées précédentes)`)
  return { date, late: true, note: ` — saisi après coup pour le ${fr(date)}` }
}
