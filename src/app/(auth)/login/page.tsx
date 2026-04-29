'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const reason = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('reason')
    : null

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Email ou mot de passe incorrect')
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Erreur de session'); setLoading(false); return }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, store_id, store_locked, is_active')
      .eq('id', user.id)
      .single<{ role: string; store_id: string | null; store_locked: boolean; is_active: boolean }>()

    if (!profile || !profile.is_active) {
      await supabase.auth.signOut()
      setError('Compte désactivé. Contactez votre administrateur.')
      setLoading(false)
      return
    }

    // Staff locked to a store → skip portal selection entirely
    if (profile.store_locked && profile.store_id) {
      const dest = profile.store_id === 'EZ-001' ? '/ez/dashboard' : '/hp/dashboard'
      router.push(dest)
      return
    }

    // Manager / Owner → portal selection
    router.push('/select-store')
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4] flex flex-col items-center justify-center p-6">
      <div className="absolute inset-0 bg-[radial-gradient(#00000008_1px,transparent_1px)] bg-[size:24px_24px]" />

      <div className="relative w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1A1A1A] mb-5 shadow-lg">
            <span
              className="text-white font-bold text-xl tracking-widest"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
            >
              BZG
            </span>
          </div>
          <h1
            className="text-2xl font-bold text-[#1A1A1A] tracking-wide"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            BZG Group
          </h1>
          <p className="text-sm text-[#6B6860] mt-1">Connectez-vous pour continuer</p>
        </div>

        {/* Inactive account warning */}
        {reason === 'inactive' && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm text-center">
            Votre compte a été désactivé.
          </div>
        )}

        {/* Login card */}
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <form onSubmit={handleLogin} className="space-y-5">

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
                autoFocus
                placeholder="vous@bzggroup.ma"
                className="w-full bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl px-4 py-3 text-[#1A1A1A] text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
                onFocus={e => { e.target.style.borderColor = '#C9A440'; e.target.style.boxShadow = '0 0 0 3px #C9A44020' }}
                onBlur={e =>  { e.target.style.borderColor = '#E8E5DE';  e.target.style.boxShadow = 'none' }}
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
                  onFocus={e => { e.target.style.borderColor = '#C9A440'; e.target.style.boxShadow = '0 0 0 3px #C9A44020' }}
                  onBlur={e =>  { e.target.style.borderColor = '#E8E5DE';  e.target.style.boxShadow = 'none' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#6B6860] transition-colors"
                  tabIndex={-1}
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
              className="w-full text-white font-bold text-base tracking-wider rounded-xl py-3 transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{
                backgroundColor: '#C9A440',
                fontFamily: "'Barlow Condensed', sans-serif",
                boxShadow: '0 4px 16px #C9A44040',
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