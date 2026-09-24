import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { authConfig } from '@/auth.config'

const { auth } = NextAuth(authConfig)

// Paths that never need auth. /api/cron/* checks CRON_SECRET itself.
const PUBLIC_PATHS = ['/login', '/select-store', '/api/cron/']

// Paths that are portal roots — require auth + correct store access
const PORTAL_PATHS = ['/ez', '/bzg']

const STORE_PORTAL_MAP: Record<string, string> = { 'EZ-001': '/ez' }
const PORTAL_STORE_MAP: Record<string, string> = { '/ez': 'EZ-001' }

const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token']

// Screens an employee may open inside a store portal (owner's decision,
// 2026-09-25). Everything else is for managers — the APIs refuse it too.
const STAFF_PAGES = ['/dashboard', '/pos', '/caisse', '/stock/phones', '/stock/accessories', '/repairs', '/clients']

// Auth.js's own endpoints must work while signed out. verify-override lives
// under the same prefix but has no session check of its own, so it stays gated.
function isAuthJsRoute(pathname: string) {
  return pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/auth/verify-override')
}

function signOutAndRedirect(url: URL) {
  const response = NextResponse.redirect(url)
  SESSION_COOKIES.forEach(name => response.cookies.delete(name))
  return response
}

// Store availability rarely changes: cache per edge instance so page
// navigation doesn't wait on the database.
const storeActiveCache = new Map<string, { active: boolean; expires: number }>()

async function isStoreActive(storeId: string) {
  const cached = storeActiveCache.get(storeId)
  if (cached && cached.expires > Date.now()) return cached.active

  const sql  = neon(process.env.DATABASE_URL!)
  const rows = await sql`select is_active from stores where store_id = ${storeId}`
  const active = rows[0]?.is_active !== false
  storeActiveCache.set(storeId, { active, expires: Date.now() + 60_000 })
  return active
}

export default auth(async (request) => {
  const { pathname } = request.nextUrl
  const user = request.auth?.user
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p)) || isAuthJsRoute(pathname)

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/select-store', request.url))
  }

  if (user && PORTAL_PATHS.some(p => pathname.startsWith(p))) {
    if (!user.is_active) {
      return signOutAndRedirect(new URL('/login?reason=inactive', request.url))
    }

    if (user.store_locked && user.store_id) {
      const storePortal = STORE_PORTAL_MAP[user.store_id]
      if (!storePortal) {
        return signOutAndRedirect(new URL('/login?reason=store_not_found', request.url))
      }
      if (!pathname.startsWith(storePortal)) {
        return NextResponse.redirect(new URL(`${storePortal}/dashboard`, request.url))
      }
    }

    if (pathname.startsWith('/bzg') && !['gerant', 'proprietaire'].includes(user.role)) {
      return NextResponse.redirect(new URL('/select-store', request.url))
    }

    // Employees: only their screens; any other page (typed or bookmarked) → POS
    if (!['gerant', 'proprietaire'].includes(user.role)) {
      const portal = Object.keys(PORTAL_STORE_MAP).find(p => pathname === p || pathname.startsWith(`${p}/`))
      const rest   = portal ? pathname.slice(portal.length) : ''
      if (portal && rest && rest !== '/' && !STAFF_PAGES.some(page => rest === page || rest.startsWith(`${page}/`))) {
        return NextResponse.redirect(new URL(`${portal}/pos`, request.url))
      }
    }

    // Store is_active guard — /bzg is always exempt
    const matchedPortal = Object.keys(PORTAL_STORE_MAP).find(p => pathname.startsWith(p))
    if (matchedPortal) {
      const storeId = PORTAL_STORE_MAP[matchedPortal]
      try {
        if (!(await isStoreActive(storeId))) {
          return NextResponse.redirect(
            new URL(`/store-unavailable?store=${encodeURIComponent(storeId)}`, request.url)
          )
        }
      } catch {
        // Fail open on lookup error — let the page handle it
      }
    }
  }

  if (user && pathname === '/') {
    return NextResponse.redirect(new URL('/select-store', request.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|vendor|manifest.json|sw.js|workbox.*).*)',
  ],
}
