// An IMEI is exactly 15 digits (owner, 2026-11-06: PHO-0523 had been saved
// with 18 digits, so no scan could ever find it). Checked on every screen
// where an IMEI is typed or scanned, and again by the server before saving.
// Client-safe: no server import here.

/** Digits only (spaces, dashes and "IMEI:" prefixes from a scan removed). */
export function imeiDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

/** What is wrong with a typed IMEI, or null when it is fine (or left empty). */
export function imeiProblem(value: unknown, label = 'IMEI'): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const d = imeiDigits(raw)
  if (d.length !== 15 || d.length !== raw.replace(/[\s-]/g, '').length) {
    return `${label} : 15 chiffres exactement (${d.length} saisi${d.length > 1 ? 's' : ''})`
  }
  return null
}

/** The IMEI to save: 15 digits, or null when empty. Throws the message otherwise. */
export function cleanImeiOrThrow(value: unknown, makeError: (message: string) => Error, label = 'IMEI'): string | null {
  const problem = imeiProblem(value, label)
  if (problem) throw makeError(problem)
  const d = imeiDigits(value)
  return d || null
}
