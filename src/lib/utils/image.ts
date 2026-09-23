'use client'

/**
 * Shrinks a photo in the browser before upload (phone photos are often
 * 5–10 MB): longest side ≤ maxSide, re-encoded as WebP (JPEG fallback).
 * The server re-checks the file itself.
 */
export async function resizeImage(file: File, maxSide = 1200, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Image illisible') })
  const scale  = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
  const blob = (await encode('image/webp')) ?? (await encode('image/jpeg'))
  if (!blob) throw new Error("Impossible de préparer l'image")
  return blob
}

/** POST a resized image (plus extra form fields) to an API route. */
export async function uploadResized(url: string, file: File, fields: Record<string, string> = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('file', await resizeImage(file), 'photo')
  const res  = await fetch(url, { method: 'POST', body: form })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`)
  return json
}
