'use client'

// Uploads a file to R2 through a signed URL and returns its public URL.
export async function uploadFile(file: File, folder: 'avatars' | 'receipts'): Promise<string> {
  const res  = await fetch('/api/uploads', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ folder, contentType: file.type, size: file.size }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Téléversement refusé')

  const put = await fetch(json.uploadUrl, {
    method:  'PUT',
    headers: { 'Content-Type': file.type },
    body:    file,
  })
  if (!put.ok) throw new Error('Échec du téléversement')
  return json.publicUrl as string
}
