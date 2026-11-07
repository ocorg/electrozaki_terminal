'use client'
import { useEffect } from 'react'
import { toast } from 'sonner'

// The little notices at the top right (owner, 2026-11-07): on a tablet or a
// phone, touching one made the notice library believe the finger was still
// "over" them, which pauses every notice for good — they piled up and had to
// be swiped away. This closes any notice still showing well after its own
// time (its duration + 3 s), whatever paused it, for every screen.
const GRACE_MS = 3000
const DEFAULT_MS = 2500

export function ToastJanitor() {
  useEffect(() => {
    const seen = new Map<string | number, number>()
    const timer = setInterval(() => {
      const now = Date.now()
      const live = toast.getToasts().filter(t => !('dismiss' in t && t.dismiss))
      const ids = new Set(live.map(t => t.id))
      for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id)
      for (const t of live) {
        if (!seen.has(t.id)) { seen.set(t.id, now); continue }
        const d = 'duration' in t ? t.duration : undefined
        const limit = (typeof d === 'number' && Number.isFinite(d) ? d : DEFAULT_MS) + GRACE_MS
        if (now - seen.get(t.id)! > limit) { toast.dismiss(t.id); seen.delete(t.id) }
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  return null
}
