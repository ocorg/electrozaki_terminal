// ─────────────────────────────────────────────────────────────────────────
// The store's clock. Every screen that shows a time or works out "today"
// goes through here instead of the device's own time zone.
//
// Why not 'Africa/Casablanca'? Morocco moved to GMT+0 for good in September
// 2026, but browsers, Node (Vercel) and Postgres ship their own copy of the
// world time-zone database, and theirs (2026a) still says GMT+1 — so the
// ERP showed 1 AM at midnight. A fixed offset can't go stale that way.
// If the legal time ever changes again, change STORE_UTC_OFFSET_HOURS only.
// ─────────────────────────────────────────────────────────────────────────

export const STORE_UTC_OFFSET_HOURS = 0

/** IANA fixed-offset zone for Intl / toLocale* (note: Etc/GMT signs are inverted). */
export const STORE_TIME_ZONE =
  STORE_UTC_OFFSET_HOURS === 0 ? 'Etc/GMT'
  : `Etc/GMT${STORE_UTC_OFFSET_HOURS > 0 ? '-' : '+'}${Math.abs(STORE_UTC_OFFSET_HOURS)}`

/** Calendar fields of an instant, as read on the store's wall clock. */
export function storeParts(date: Date | string | number = new Date()) {
  const d = new Date(new Date(date).getTime() + STORE_UTC_OFFSET_HOURS * 3_600_000)
  return {
    year:    d.getUTCFullYear(),
    month:   d.getUTCMonth() + 1,
    day:     d.getUTCDate(),
    weekday: d.getUTCDay(), // 0 = Sunday
    hours:   d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' of the store's current (or given) day. */
export function storeDate(date: Date | string | number = new Date()): string {
  const p = storeParts(date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** 'HH:MM' on the store's wall clock. */
export function storeTime(date: Date | string | number = new Date()): string {
  const p = storeParts(date)
  return `${pad(p.hours)}:${pad(p.minutes)}`
}
