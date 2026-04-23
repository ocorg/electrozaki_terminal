// ============================================================
//  BZG Group Terminal — Input Validation Utilities
//  Import in API routes before touching any database.
// ============================================================

/**
 * Throws a descriptive error if any required field is missing/empty.
 */
export function validateRequired(
  fields: Record<string, unknown>,
  required: string[]
): void {
  for (const key of required) {
    const val = fields[key]
    if (val === null || val === undefined || val === '') {
      throw new Error(`Champ requis manquant: ${key}`)
    }
  }
}

/**
 * Throws if any string field exceeds its max character limit.
 */
export function validateMaxLength(
  fields: Record<string, string | null | undefined>,
  limits: Record<string, number>
): void {
  for (const [key, max] of Object.entries(limits)) {
    const val = fields[key]
    if (val && val.length > max) {
      throw new Error(`Champ "${key}" dépasse la limite de ${max} caractères`)
    }
  }
}

/**
 * Trims whitespace and strips null bytes from a string.
 */
export function sanitizeText(input: string): string {
  return input.trim().replace(/\0/g, '')
}

/**
 * Parses and validates a numeric field. Throws if not a valid finite number.
 */
export function validateNumeric(value: unknown, fieldName: string): number {
  const parsed = Number(value)
  if (!isFinite(parsed) || isNaN(parsed)) {
    throw new Error(`Champ "${fieldName}" doit être un nombre valide`)
  }
  return parsed
}

/**
 * Checks the request Content-Length header and throws a descriptive error
 * if the payload exceeds maxBytes. Call at the very top of a POST/PATCH handler.
 */
export function validatePayloadSize(req: Request, maxBytes: number = 51200): void {
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw Object.assign(new Error('Payload trop volumineux'), { status: 413 })
  }
}

/**
 * Escapes SQL LIKE wildcard characters in a search string.
 * Use before inserting user input into .ilike() queries.
 */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&')
}