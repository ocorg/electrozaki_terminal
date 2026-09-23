'use client'
import { useEffect } from 'react'
import useSWR, { type SWRConfiguration, type ScopedMutator } from 'swr'
import { entitiesForWrite, prefixesFor } from '@/lib/data/entities'
import { cache, markStale, staleKeys } from '@/lib/data/cache'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res  = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Erreur ${res.status}`)
  return json as T
}

// The app's SWR cache is a custom provider, which the global `mutate` export
// doesn't reach: DataProvider hands over the provider-bound one here.
let scopedMutate: ScopedMutator | null = null
export function bindMutate(m: ScopedMutator) { scopedMutate = m }

/**
 * Refresh every cached read whose URL starts with one of the prefixes: screens
 * showing it refetch now in the background; the others are marked stale and
 * refetch (behind their cached data) the next time they are opened.
 */
export function refreshPrefixes(prefixes: string[]) {
  if (!prefixes.length) return
  const match = (key: string) => prefixes.some(p => key.startsWith(p))
  markStale(match)
  // single-argument form = revalidate only (passing data, even undefined, would replace it)
  return scopedMutate?.(key => typeof key === 'string' && match(key))
}

export function refreshAll() {
  return refreshPrefixes(['/api/'])
}

/**
 * Cached read. Coming back to a screen shows the cached data instantly;
 * refreshes happen in the background (live change events, idle refresh).
 * `url` null = don't fetch yet. By default returns `json.data`.
 */
export function useApi<T = unknown, R = { data: T }>(
  url: string | null,
  options: SWRConfiguration & { select?: (json: R) => T } = {},
) {
  const { select = (json: R) => (json as unknown as { data: T }).data, ...swr } = options
  const res = useSWR<R>(url, fetchJson, swr)

  // Data changed while this screen was closed: show the cache, refetch behind it
  const { mutate } = res
  useEffect(() => {
    if (url && staleKeys.has(url)) {
      staleKeys.delete(url)
      mutate()
    }
  }, [url, mutate])

  return {
    data:         res.data === undefined ? undefined : select(res.data),
    raw:          res.data,
    error:        res.error as ApiError | undefined,
    // true only when there is nothing to show yet — never during background refreshes
    isLoading:    res.isLoading,
    isRefreshing: res.isValidating && !res.isLoading,
    refresh:      () => res.mutate(),
    mutate:       res.mutate,
  }
}

/**
 * Write (POST/PATCH/PUT/DELETE). On success, immediately refreshes every
 * screen on this device that shows data the write changed; other devices are
 * told by the server's live change event.
 */
export async function apiWrite<T = unknown>(url: string, init: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method:  init.method,
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body:    init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Erreur ${res.status}`)
  refreshPrefixes(prefixesFor(entitiesForWrite(new URL(url, window.location.origin).pathname)))
  return json as T
}

/**
 * Warms the cache for screens the staff are likely to open next, once the
 * current screen has settled: two requests at a time, skipping what is cached.
 */
export function usePrefetch(urls: string[], delayMs = 1500) {
  const key = urls.join('|')
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const queue = urls.filter(u => cache.get(u)?.data === undefined)
      const worker = async () => {
        for (let url = queue.shift(); url && !cancelled; url = queue.shift()) {
          await scopedMutate?.(url, fetchJson(url), { revalidate: false }).catch(() => {})
        }
      }
      await Promise.all([worker(), worker()])
    }, delayMs)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [key, delayMs]) // eslint-disable-line react-hooks/exhaustive-deps
}
