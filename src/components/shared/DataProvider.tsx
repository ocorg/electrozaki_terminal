'use client'
import { useEffect, useRef, useState } from 'react'
import { SWRConfig, useSWRConfig } from 'swr'
import { useSession } from 'next-auth/react'
import PusherClient from 'pusher-js'
import { cache, restoreCache, persistCache, clearDataCache } from '@/lib/data/cache'
import { fetchJson, refreshPrefixes, refreshAll, bindMutate } from '@/lib/data/api'
import { prefixesFor, REALTIME_CHANNEL, REALTIME_EVENT, type ChangeEvent } from '@/lib/data/entities'

const IDLE_AFTER_MS     = 2 * 60_000  // no mouse/keyboard for this long = idle
const IDLE_REFRESH_MS   = 2 * 60_000  // while idle, refresh visible data this often
const HEARTBEAT_MS      = 4 * 60_000  // keeps Neon (sleeps after 5 min) and functions warm
const ACTIVE_WINDOW_MS  = 30 * 60_000 // heartbeat only if someone was active this recently

let pusher: PusherClient | null = null

// Gives refreshPrefixes() the mutate bound to this provider's cache
function MutateBridge() {
  const { mutate } = useSWRConfig()
  bindMutate(mutate)
  return null
}

export default function DataProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const userId = session?.user?.id ?? null

  // Restore this tab's cache before the first screen renders, so a reload
  // shows the last data at once (refreshed behind it)
  const owner = useRef<string | null>(null)
  useState(() => {
    if (typeof window !== 'undefined') owner.current = restoreCache()
    return null
  })

  // Once the session is known: a different user (or none) must never see that data
  useEffect(() => {
    if (status === 'loading') return
    if (owner.current && owner.current !== userId) clearDataCache()
    owner.current = userId
  }, [userId, status])

  // Save the cache when the tab is hidden or closed
  useEffect(() => {
    if (!userId) return
    const save = () => persistCache(userId)
    const onVisibility = () => { if (document.visibilityState === 'hidden') save() }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', onVisibility) }
  }, [userId])

  // Live changes from any device: refresh exactly the affected data
  useEffect(() => {
    if (!userId) return
    pusher ??= new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER! })
    const channel = pusher.subscribe(REALTIME_CHANNEL)
    const onChange = (e: ChangeEvent) => refreshPrefixes(prefixesFor(e.entities ?? []))
    channel.bind(REALTIME_EVENT, onChange)
    // Reconnecting after a network drop: events may have been missed
    const onState = ({ previous, current }: { previous: string; current: string }) => {
      if (current === 'connected' && previous !== 'initialized' && previous !== 'connecting') refreshAll()
    }
    pusher.connection.bind('state_change', onState)
    return () => {
      channel.unbind(REALTIME_EVENT, onChange)
      pusher?.connection.unbind('state_change', onState)
    }
  }, [userId])

  // Idle refresh + heartbeat
  useEffect(() => {
    if (!userId) return
    let lastActivity    = Date.now()
    let lastIdleRefresh = Date.now()
    let lastHeartbeat   = Date.now()
    let hiddenSince: number | null = null

    const onActivity = () => {
      const now = Date.now()
      // back after a long idle stretch: make sure what's on screen is current
      if (now - lastActivity >= IDLE_AFTER_MS && now - lastIdleRefresh >= IDLE_REFRESH_MS) {
        lastIdleRefresh = now
        refreshAll()
      }
      lastActivity = now
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenSince = Date.now(); return }
      if (hiddenSince && Date.now() - hiddenSince >= IDLE_AFTER_MS) { lastIdleRefresh = Date.now(); refreshAll() }
      hiddenSince = null
      lastActivity = Date.now()
    }
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastActivity >= IDLE_AFTER_MS && now - lastIdleRefresh >= IDLE_REFRESH_MS) {
        lastIdleRefresh = now
        refreshAll()
      }
      if (now - lastActivity <= ACTIVE_WINDOW_MS && now - lastHeartbeat >= HEARTBEAT_MS) {
        lastHeartbeat = now
        fetch('/api/ping', { cache: 'no-store' }).catch(() => {})
      }
    }, 30_000)

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const
    let throttled = false
    const throttledActivity = () => {
      if (throttled) return
      throttled = true
      setTimeout(() => { throttled = false }, 5_000)
      onActivity()
    }
    events.forEach(e => window.addEventListener(e, throttledActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(tick)
      events.forEach(e => window.removeEventListener(e, throttledActivity))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId])

  return (
    <SWRConfig value={{
      provider:              () => cache,
      fetcher:               fetchJson,
      revalidateOnFocus:     false,        // no reload just for clicking back into the window
      revalidateIfStale:     false,        // reopening a screen shows the cache; changes arrive as events
      revalidateOnReconnect: true,
      dedupingInterval:      5 * 60_000,   // reopening a screen within 5 min reuses its data
      keepPreviousData:      true,         // changing a filter keeps the old list until the new one arrives
      errorRetryCount:       2,
    }}>
      <MutateBridge />
      {children}
    </SWRConfig>
  )
}
