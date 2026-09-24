import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Cloudflare R2 (S3-compatible). Browsers upload straight to R2 with a
// short-lived signed URL; the bucket's CORS policy must allow the app origin.
const r2 = new S3Client({
  region:   'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export const UPLOAD_FOLDERS = ['avatars', 'receipts', 'repairs'] as const
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number]

export const UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
  'image/heic':      'heic',
  'application/pdf': 'pdf',
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function publicUrl(key: string) {
  return `${process.env.R2_PUBLIC_URL}/${key}`
}

// Signing ContentType + ContentLength means the browser can only upload
// exactly the file it declared.
export async function presignUpload(key: string, contentType: string, size: number) {
  const command = new PutObjectCommand({
    Bucket:        process.env.R2_BUCKET!,
    Key:           key,
    ContentType:   contentType,
    ContentLength: size,
  })
  return getSignedUrl(r2, command, { expiresIn: 300 })
}
