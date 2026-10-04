'use client'
// Website orders / requests (owner, 2026-10-04) — two pieces for managers:
//   • SiteAlerts: mounted once in the store layout; rings and shows a message
//     on any open screen when a new order or request comes in.
//   • PushToggle: the sidebar button that turns on real notifications for this
//     device (phone or PC), delivered even when the ERP is closed.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bell, BellRing } from 'lucide-react'
import { useUser } from '@/lib/hooks/useUser'
import { useApi } from '@/lib/data/api'
import { showSuccess, showError } from '@/lib/utils/toasts'

const isManager = (role?: string | null) => role === 'gerant' || role === 'proprietaire'

// Two short notes, made on the spot (no sound file). Browsers stay silent
// until the page has been clicked once — the message still shows.
function ring() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const note = (freq: number, at: number) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.4)
    }
    note(880, 0); note(1175, 0.22)
    setTimeout(() => void ctx.close(), 1200)
  } catch { /* no sound: the message is enough */ }
}

export function SiteAlerts() {
  const { user } = useUser()
  const router   = useRouter()
  const counts = useApi<{ orders: number; repairs: number }>(
    isManager(user?.role) ? '/api/site/counts' : null,
    { refreshInterval: 60_000, shouldRetryOnError: false },
  ).data
  const seen = useRef<{ orders: number; repairs: number } | null>(null)

  useEffect(() => {
    if (!counts) return
    const before = seen.current
    seen.current = counts
    if (!before) return   // first load: what was already waiting is shown by the badges
    const alert = (label: string, path: string) => {
      ring()
      toast(label, { duration: 20_000, action: { label: 'Ouvrir', onClick: () => router.push(path) } })
    }
    if (counts.orders > before.orders)   alert('Nouvelle commande web', '/ez/site/orders')
    if (counts.repairs > before.repairs) alert('Nouvelle demande du site', '/ez/site/requests')
  }, [counts, router])

  return null
}

const keyBytes = (base64: string) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export function PushToggle({ collapsed }: { collapsed: boolean }) {
  const { user } = useUser()
  const [on, setOn]     = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  useEffect(() => {
    if (!supported || !isManager(user?.role)) return
    navigator.serviceWorker.getRegistration('/push-sw.js')
      .then(reg => reg?.pushManager.getSubscription())
      .then(sub => setOn(!!sub && Notification.permission === 'granted'))
      .catch(() => {})
  }, [supported, user?.role])

  if (!isManager(user?.role)) return null

  async function test() {
    const res  = await fetch('/api/push/test', { method: 'POST' })
    const data = (await res.json().catch(() => ({}))).data
    if (!res.ok) throw new Error('Test impossible')
    showSuccess(`Test envoyé${data?.push ? ` — ${data.push} appareil(s)` : ''}${data?.telegram ? ' + Telegram' : ''}`)
  }

  async function click() {
    setBusy(true)
    try {
      if (!supported) {
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
        throw new Error(ios
          ? "Sur iPhone : touchez Partager, puis « Sur l'écran d'accueil », et ouvrez l'ERP depuis cette icône"
          : 'Ce navigateur ne gère pas les notifications')
      }
      if (on) { await test(); return }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!key) throw new Error('Notifications pas encore configurées')
      if ((await Notification.requestPermission()) !== 'granted') {
        throw new Error('Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site')
      }
      const reg = await navigator.serviceWorker.register('/push-sw.js')
      await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Activation impossible')
      setOn(true)
      await test()
    } catch (err) {
      showError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const Icon = on ? BellRing : Bell
  return (
    <button
      onClick={click}
      disabled={busy}
      title={collapsed ? 'Notifications' : on ? 'Notifications activées sur cet appareil — cliquer pour tester' : 'Recevoir les commandes web sur cet appareil'}
      className="w-full flex items-center gap-3 rounded-xl text-sm transition-all disabled:opacity-50"
      style={{
        padding: collapsed ? '10px 0' : '10px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: on ? '#34D399' : 'rgba(255,255,255,0.4)',
      }}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {!collapsed && <span>{on ? 'Notifications activées' : 'Activer les notifications'}</span>}
    </button>
  )
}
