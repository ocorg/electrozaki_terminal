'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email ou mot de passe incorrect')
      setLoading(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-ez-bg flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(#C9A44018_1px,transparent_1px)] bg-[size:24px_24px]" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <img
            src="/logo.png"
            alt="Electro Zaki"
            className="h-16 w-auto mx-auto mb-5 object-contain"
          />
          <p className="text-ez-subtle text-sm tracking-wide">
            Système de gestion v3.0
          </p>
        </div>

        <div className="bg-white border border-ez-border rounded-2xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <h2 className="font-display text-xl font-semibold text-ez-text mb-6 tracking-wide">
            Connexion
          </h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-ez-subtle uppercase tracking-widest mb-2 font-medium">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="vous@electrozaki.ma"
                className="w-full bg-ez-bg border border-ez-border rounded-xl px-4 py-3 text-ez-text text-sm placeholder:text-ez-placeholder focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs text-ez-subtle uppercase tracking-widest mb-2 font-medium">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-ez-bg border border-ez-border rounded-xl px-4 py-3 pr-11 text-ez-text text-sm placeholder:text-ez-placeholder focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ez-subtle hover:text-gold transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gold hover:bg-gold-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-display font-bold text-lg tracking-wider rounded-xl py-3 mt-2 transition-all duration-200 hover:shadow-ez-gold active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Connexion...</>
                : 'Se connecter'
              }
            </button>
          </form>
        </div>

        <p className="text-center text-ez-placeholder text-xs mt-6">
          Electro Zaki © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}