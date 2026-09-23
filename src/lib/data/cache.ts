'use client'
import type { Cache, State } from 'swr'

// One cache for the whole tab (SWR provider). Kept in sessionStorage across
// full reloads of the same tab, owned by one user at a time.
const STORAGE_KEY = 'erp-cache-v1'
const MAX_ENTRY_CHARS = 1_500_000 // don't persist unusually large lists (storage is ~5 MB)

export const cache = new Map<string, State>() as Map<string, State> & Cache

// Reads whose data may be out of date: the next screen that shows them keeps
// displaying the cached data but refetches in the background.
export const staleKeys = new Set<string>()

// Restores what this tab saved before a reload; returns whose data it is, so
// the caller can drop it if the signed-in user turns out to be someone else.
export function restoreCache(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as { userId: string; entries: [string, unknown][] } | null
    if (!saved) return null
    for (const [key, data] of saved.entries) {
      cache.set(key, { data } as State)
      staleKeys.add(key) // from an earlier page load: show it, but refresh
    }
    return saved.userId
  } catch { return null /* storage unavailable or corrupt: start empty */ }
}

export function persistCache(userId: string) {
  try {
    const entries: [string, unknown][] = []
    for (const [key, state] of cache.entries()) {
      if (!key.startsWith('/api/') || state?.data === undefined) continue
      const size = JSON.stringify(state.data).length
      if (size <= MAX_ENTRY_CHARS) entries.push([key, state.data])
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, entries }))
  } catch { /* quota exceeded or storage blocked: skip */ }
}

// On sign-out / user change: nothing of the previous user may remain visible
export function clearDataCache() {
  cache.clear()
  staleKeys.clear()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function markStale(match: (key: string) => boolean) {
  for (const key of cache.keys()) if (match(key)) staleKeys.add(key)
}
