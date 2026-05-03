import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Paths that never need auth
const PUBLIC_PATHS = ['/login', '/select-store']

// Paths that are portal roots — require auth + correct store access
const PORTAL_PATHS = ['/ez', '/hp', '/bzg']

async function handleMiddleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // Guard: if Supabase env vars are missing, skip auth and let the page handle it
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  // ── Build supabase client with cookie forwarding ────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll()        { return request.cookies.getAll() },
        setAll(toSet) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    // Edge network error — fail open (let the page/API handle auth)
    return NextResponse.next({ request })
  }

  // ── Not authenticated → redirect to login ───────────────────
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // ── Already authenticated → keep away from login ────────────
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/select-store', request.url))
  }

  // ── Authenticated: check portal access ──────────────────────
  if (user && PORTAL_PATHS.some(p => pathname.startsWith(p))) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, store_id, store_locked, is_active')
        .eq('id', user.id)
        .single()

      // Deactivated account
      if (!profile || !profile.is_active) {
        await supabase.auth.signOut()
        return NextResponse.redirect(new URL('/login?reason=inactive', request.url))
      }

      // Staff locked to a store: enforce their portal
      if (profile.store_locked && profile.store_id) {
        const STORE_PORTAL_MAP: Record<string, string> = {
          'EZ-001': '/ez',
          'HP-001': '/hp',
        }
        const storePortal = STORE_PORTAL_MAP[profile.store_id]
        if (!storePortal) {
          // store_id not recognised — block access entirely
          await supabase.auth.signOut()
          return NextResponse.redirect(new URL('/login?reason=store_not_found', request.url))
        }
        if (!pathname.startsWith(storePortal)) {
          return NextResponse.redirect(new URL(`${storePortal}/dashboard`, request.url))
        }
      }

      // BZG portal: only manager and owner allowed
      if (pathname.startsWith('/bzg') && !['manager', 'owner'].includes(profile.role)) {
        return NextResponse.redirect(new URL('/select-store', request.url))
      }
    } catch {
      // Profile fetch failed — fail open, let the page handle it
      return NextResponse.next({ request })
    }
  }

  // ── Root "/" → redirect to select-store ─────────────────────
  if (user && pathname === '/') {
    return NextResponse.redirect(new URL('/select-store', request.url))
  }

  return response
}

// ── Top-level safety net — NEVER let middleware crash into a 404 ──
export async function middleware(request: NextRequest): Promise<NextResponse> {
  try {
    return await handleMiddleware(request)
  } catch {
    // If anything unexpected throws, fail open so pages remain accessible
    return NextResponse.next({ request })
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|workbox.*).*)',
  ],
}