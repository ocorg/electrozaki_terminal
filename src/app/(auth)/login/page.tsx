'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2, ChevronLeft } from 'lucide-react'
import type { PortalType } from '@/lib/context/portal'

// ─── Portal identity cards ────────────────────────────────────
const PORTALS: {
  type: PortalType
  name: string
  subtitle: string
  color: string
  border: string
  bg: string
  text: string
  dot: string
}[] = [
  {
    type:     'ez',
    name:     'Electro Zaki',
    subtitle: 'Terminal principal',
    color:    '#C9A440',
    border:   'border-[#C9A440]/40 hover:border-[#C9A440]',
    bg:       'hover:bg-[#FAF5E8]',
    text:     'text-[#C9A440]',
    dot:      'bg-[#C9A440]',
  },
  {
    type:     'hp',
    name:     'Hamid Phone',
    subtitle: 'Terminal secondaire',
    color:    '#0EA5E9',
    border:   'border-[#0EA5E9]/40 hover:border-[#0EA5E9]',
    bg:       'hover:bg-[#F0F9FF]',
    text:     'text-[#0EA5E9]',
    dot:      'bg-[#0EA5E9]',
  },
  {
    type:     'bzg',
    name:     'BZG Group',
    subtitle: 'Tableau de bord global',
    color:    '#6366F1',
    border:   'border-[#6366F1]/40 hover:border-[#6366F1]',
    bg:       'hover:bg-[#F5F3FF]',
    text:     'text-[#6366F1]',
    dot:      'bg-[#6366F1]',
  },
]

export default function LoginPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [step, setStep]               = useState<'select' | 'login'>('select')
  const [portal, setPortal]           = useState<(typeof PORTALS)[0] | null>(null)
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [showPass, setShowPass]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  // Check URL for reason param (e.g. inactive account)
  const reason = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('reason')
    : null

  function selectPortal(p: (typeof PORTALS)[0]) {
    setPortal(p)
    setError('')
    setStep('login')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!portal) return
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError('Email ou mot de passe incorrect')
      setLoading(false)
      return
    }

    // Fetch profile to decide redirect
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Erreur de session'); setLoading(false); return }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single<{
        role: string
        store_id: string | null
        store_locked: boolean
        is_active: boolean
      }>()

    if (!profile || !profile.is_active) {
      await supabase.auth.signOut()
      setError('Compte désactivé. Contactez votre administrateur.')
      setLoading(false)
      return
    }

    // Staff locked to store → direct to their portal
    if (profile.store_locked && profile.store_id) {
      const dest = profile.store_id === 'EZ-001' ? '/ez/dashboard' : '/hp/dashboard'
      router.push(dest)
      return
    }

    // Manager / Owner → store selection screen
    router.push('/select-store')
  }

  // ── Step 1: Portal selector ───────────────────────────────
  if (step === 'select') {
    return (
      <div className="min-h-screen bg-[#F8F7F4] flex flex-col items-center justify-center p-6">
        <div className="absolute inset-0 bg-[radial-gradient(#00000008_1px,transparent_1px)] bg-[size:24px_24px]" />

        <div className="relative w-full max-w-lg">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1A1A1A] mb-5 shadow-lg">
              <span className="text-white font-bold text-xl tracking-widest" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                BZG
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-wide" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              BZG Group
            </h1>
            <p className="text-sm text-[#6B6860] mt-1">Choisissez votre portail</p>
          </div>

          {/* Inactive account warning */}
          {reason === 'inactive' && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm text-center">
              Votre compte a été désactivé.
            </div>
          )}

          {/* Portal cards */}
          <div className="space-y-3">
            {PORTALS.map(p => (
              <button
                key={p.type}
                onClick={() => selectPortal(p)}
                className={`w-full flex items-center gap-4 px-5 py-4 bg-white border-2 rounded-2xl transition-all duration-200 text-left group ${p.border} ${p.bg} active:scale-[0.98]`}
              >
                {/* Color dot */}
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${p.dot} shadow-sm`} />

                {/* Labels */}
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-base tracking-wide ${p.text}`}
                     style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {p.name}
                  </p>
                  <p className="text-xs text-[#B0ADA6] mt-0.5">{p.subtitle}</p>
                </div>

                {/* Arrow */}
                <ChevronLeft className="w-4 h-4 text-[#B0ADA6] group-hover:text-current rotate-180 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>

          <p className="text-center text-[#B0ADA6] text-xs mt-8">
            BZG Group © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    )
  }

  // ── Step 2: Login form (portal-branded) ──────────────────
  if (!portal) return null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: portal.bg || '#F8F7F4' }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(${portal.color}12 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />

      <div className="relative w-full max-w-sm">
        {/* Back button */}
        <button
          onClick={() => { setStep('select'); setError('') }}
          className="flex items-center gap-1.5 text-sm text-[#6B6860] hover:text-[#1A1A1A] mb-8 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Changer de portail
        </button>

        {/* Portal badge */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ backgroundColor: portal.color }}
          >
            <span className="text-white font-bold text-lg tracking-widest"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              {portal.type.toUpperCase()}
            </span>
          </div>
          <h2 className="font-bold text-xl text-[#1A1A1A] tracking-wide"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {portal.name}
          </h2>
          <p className="text-xs text-[#6B6860] mt-1">{portal.subtitle}</p>
        </div>

        {/* Login card */}
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs text-[#6B6860] uppercase tracking-widest mb-2 font-medium">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="vous@bzggroup.ma"
                className="w-full bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl px-4 py-3 text-[#1A1A1A] text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
                style={{ '--tw-ring-color': portal.color } as React.CSSProperties}
                onFocus={e => { e.target.style.borderColor = portal.color; e.target.style.boxShadow = `0 0 0 3px ${portal.color}20` }}
                onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs text-[#6B6860] uppercase tracking-widest mb-2 font-medium">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl px-4 py-3 pr-11 text-[#1A1A1A] text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
                  onFocus={e => { e.target.style.borderColor = portal.color; e.target.style.boxShadow = `0 0 0 3px ${portal.color}20` }}
                  onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#6B6860] transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-bold text-base tracking-wider rounded-xl py-3 mt-1 transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{
                backgroundColor: portal.color,
                fontFamily: "'Barlow Condensed', sans-serif",
                boxShadow: `0 4px 16px ${portal.color}40`,
              }}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Connexion...</>
                : 'Se connecter'
              }
            </button>
          </form>
        </div>

        <p className="text-center text-[#B0ADA6] text-xs mt-6">
          BZG Group © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}