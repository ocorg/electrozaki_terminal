import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getBusinessDate } from '@/lib/utils'

// Catching up on a forgotten day (owner, 2026-10-10): while a manager enters
// a past day's sales, every screen that records something uses that day
// instead of today. Kept across page changes; it lapses by itself once the
// day is out of reach (server rule: lib/catchUp.ts).
export const CATCH_UP_DAYS = 7

interface WorkDayStore {
  catchUp: string | null            // 'YYYY-MM-DD' being caught up on
  start:   (date: string) => void
  stop:    () => void
}

const useStore = create<WorkDayStore>()(
  persist(
    (set) => ({
      catchUp: null,
      start:   (date) => set({ catchUp: date }),
      stop:    () => set({ catchUp: null }),
    }),
    { name: 'ez-work-day' },
  ),
)

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** The earliest day that can still be caught up on. */
export const earliestCatchUp = () => addDays(getBusinessDate(), -CATCH_UP_DAYS)
export const yesterday = () => addDays(getBusinessDate(), -1)

/** The day entries belong to: today, or the forgotten day being caught up on. */
export function useWorkDay() {
  const { catchUp, start, stop } = useStore()
  const today = getBusinessDate()
  const valid = !!catchUp && catchUp < today && catchUp >= earliestCatchUp()
  return { date: valid ? catchUp! : today, late: valid, start, stop }
}

export const frDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit' })
