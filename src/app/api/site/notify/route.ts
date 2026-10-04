import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { json, handleError, HttpError } from '@/lib/api'
import { announceNewSiteItems } from '@/lib/siteNotify'

// POST — the website calls this right after a customer places an order or
// sends a request. It carries no data: the ERP reads the website itself.
// Protected by the secret both apps share (x-site-secret).
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.STOREFRONT_REVALIDATE_SECRET
    const given  = request.headers.get('x-site-secret') ?? ''
    if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
      throw new HttpError(401, 'Non autorisé')
    }
    return json({ announced: await announceNewSiteItems() })
  } catch (err) {
    return handleError(err, 'POST /api/site/notify')
  }
}
