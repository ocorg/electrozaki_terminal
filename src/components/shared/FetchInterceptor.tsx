'use client'
import { useEffect } from 'react'

/**
 * Installs a global fetch interceptor once, on mount, for the entire app.
 * Any same-origin /api/ request that returns 401 is retried once after
 * 800ms — long enough for a Supabase token refresh to complete. This
 * eliminates the transient "Non autorisé" error for real, logged-in
 * sessions everywhere in the app without touching individual components.
 *
 * A genuinely expired/logged-out session still returns 401 on the retry,
 * so real auth failures are not masked.
 */
export default function FetchInterceptor() {
  useEffect(() => {
    // Guard against double-patching (e.g. React StrictMode double-invoke, HMR)
    if ((window as unknown as { __fetchPatched?: boolean }).__fetchPatched) return
    ;(window as unknown as { __fetchPatched?: boolean }).__fetchPatched = true

    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const isApiCall = url.includes('/api/')

      const res = await originalFetch(input, init)

      if (isApiCall && res.status === 401) {
        await new Promise(r => setTimeout(r, 800))
        return originalFetch(input, init)
      }

      return res
    }

    return () => {
      window.fetch = originalFetch
      ;(window as unknown as { __fetchPatched?: boolean }).__fetchPatched = false
    }
  }, [])

  return null
}