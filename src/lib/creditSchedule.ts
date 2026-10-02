// Payment schedule (échéancier) of a credit sale — shared by the API, the
// credit panel and the reminders list so all three agree.
//
// The plan lists dates + amounts. Payments cover the lines in date order;
// only what was paid AFTER the plan was built counts (paid − base), so a
// down payment made before the plan doesn't tick its first lines.
import { storeDate } from '@/lib/time'

export interface Echeance { echeance_id?: string; date_echeance: string; montant: number }

export type EcheanceState = 'payee' | 'partielle' | 'en_retard' | 'a_venir'

export interface EcheanceLine extends Echeance {
  covered: number        // part of this line already paid
  state:   EcheanceState
}

export interface ScheduleStatus {
  lines:       EcheanceLine[]
  planTotal:   number
  next:        EcheanceLine | null   // first line not fully paid
  lateAmount:  number                // due by today and not paid
  daysLate:    number                // since the oldest unpaid due date
}

const day = (d: string) => d.slice(0, 10)

export function scheduleStatus(echeances: Echeance[], montantPaye: number, base: number, today = storeDate()): ScheduleStatus {
  let coverage = Math.max(0, Number(montantPaye) - Number(base))
  const sorted = [...echeances]
    .map(e => ({ ...e, date_echeance: day(String(e.date_echeance)), montant: Number(e.montant) }))
    .sort((a, b) => a.date_echeance.localeCompare(b.date_echeance))

  let lateAmount = 0
  let oldestLate: string | null = null
  const lines: EcheanceLine[] = sorted.map(e => {
    const covered = Math.min(e.montant, coverage)
    coverage -= covered
    const left = e.montant - covered
    const due = e.date_echeance < today          // due today is not late yet
    const state: EcheanceState = left <= 0.01 ? 'payee' : due ? 'en_retard' : covered > 0 ? 'partielle' : 'a_venir'
    if (left > 0.01 && due) { lateAmount += left; oldestLate ??= e.date_echeance }
    return { ...e, covered, state }
  })

  const daysLate = oldestLate
    ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(oldestLate + 'T00:00:00Z')) / 86_400_000)
    : 0
  return {
    lines,
    planTotal: sorted.reduce((s, e) => s + e.montant, 0),
    next: lines.find(l => l.state !== 'payee') ?? null,
    lateAmount: Math.round(lateAmount * 100) / 100,
    daysLate,
  }
}

/** N equal monthly lines for `amount`, from `first` (YYYY-MM-DD); the last
 *  line takes the rounding so the plan adds up exactly. */
export function monthlyPlan(amount: number, count: number, first: string): Echeance[] {
  const n = Math.max(1, Math.min(60, Math.floor(count)))
  const each = Math.floor((amount / n) * 100) / 100
  const [y, m, d] = first.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1 + i, 1))
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(d, last))
    const montant = i === n - 1 ? Math.round((amount - each * (n - 1)) * 100) / 100 : each
    return { date_echeance: date.toISOString().slice(0, 10), montant }
  })
}
