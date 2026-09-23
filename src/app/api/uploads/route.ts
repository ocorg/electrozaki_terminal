import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError } from '@/lib/api'
import { MAX_UPLOAD_BYTES, UPLOAD_FOLDERS, UPLOAD_TYPES, presignUpload, publicUrl, type UploadFolder } from '@/lib/storage'

// POST /api/uploads { folder, contentType, size } → { uploadUrl, publicUrl }
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { folder, contentType, size } = await request.json()

    if (!UPLOAD_FOLDERS.includes(folder)) throw new HttpError(400, 'Dossier invalide')
    const ext = UPLOAD_TYPES[contentType]
    if (!ext) throw new HttpError(400, 'Type de fichier non accepté (JPG, PNG, WEBP, HEIC ou PDF)')
    if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
      throw new HttpError(400, 'Fichier trop volumineux (10 Mo maximum)')
    }

    const owner = (folder as UploadFolder) === 'avatars' ? user.id : (user.store_id ?? 'global')
    const key = `${folder}/${owner}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`

    return json({ uploadUrl: await presignUpload(key, contentType, size), publicUrl: publicUrl(key) })
  } catch (err) {
    return handleError(err, 'POST /api/uploads')
  }
}
