import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { HttpError } from '@/lib/api'

// The website's Cloudflare R2 buckets, reached with their own access key
// (not the ERP's): the public photo bucket, and the PRIVATE receipts bucket
// where customers' bank receipts are stored.
function client() {
  return new S3Client({
    region:   'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.STOREFRONT_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STOREFRONT_R2_SECRET_ACCESS_KEY!,
    },
  })
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024

// The browser resizes photos to WebP/JPEG before sending them; the server
// still checks the real file signature, not the declared type.
function detectImage(buf: Buffer): { type: string; ext: string } | null {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' }
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' }
  }
  if (buf.length > 8 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return { type: 'image/png', ext: 'png' }
  }
  return null
}

/** Stores a product photo in the public website bucket and returns its URL. */
export async function uploadSitePhoto(buf: Buffer): Promise<string> {
  if (buf.length === 0) throw new HttpError(400, 'Fichier vide')
  if (buf.length > MAX_PHOTO_BYTES) throw new HttpError(400, 'Photo trop lourde (2 Mo maximum)')
  const kind = detectImage(buf)
  if (!kind) throw new HttpError(400, 'Format non pris en charge (JPG, PNG ou WebP)')

  const bucket    = process.env.STOREFRONT_R2_BUCKET
  const publicUrl = process.env.STOREFRONT_R2_PUBLIC_URL
  if (!bucket || !publicUrl) throw new HttpError(500, 'Stockage du site non configuré')

  const key = `products/${Date.now()}-${crypto.randomUUID()}.${kind.ext}`
  await client().send(new PutObjectCommand({
    Bucket:       bucket,
    Key:          key,
    Body:         buf,
    ContentType:  kind.type,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return `${publicUrl.replace(/\/$/, '')}/${key}`
}

/** Removes a photo previously stored by uploadSitePhoto (ignores foreign URLs). */
export async function deleteSitePhoto(url: string): Promise<void> {
  const publicUrl = process.env.STOREFRONT_R2_PUBLIC_URL?.replace(/\/$/, '')
  const bucket    = process.env.STOREFRONT_R2_BUCKET
  if (!publicUrl || !bucket || !url.startsWith(`${publicUrl}/products/`)) return
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: url.slice(publicUrl.length + 1) }))
  } catch (err) {
    console.error('[deleteSitePhoto] failed silently:', err)
  }
}

/** A 5-minute link to view a customer's receipt (the bucket itself is private). */
export async function receiptViewUrl(key: string): Promise<string | null> {
  const bucket = process.env.STOREFRONT_R2_RECEIPTS_BUCKET
  if (!bucket || !/^receipts\/[\w-]+\.(webp|pdf)$/.test(key)) return null
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 })
}
