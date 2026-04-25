import { redirect } from 'next/navigation'

/**
 * Root `/` route — server-side redirect.
 *
 * The middleware handles all auth-based routing (unauthenticated → /login,
 * authenticated → /select-store). This page is the fallback for edge cases
 * where the middleware doesn't fire before the page renders.
 *
 * The (dashboard) route group exists for legacy compatibility with the v3
 * scaffold. All real portal pages live under /ez, /hp, and /bzg.
 */
export default function RootPage() {
  redirect('/login')
}