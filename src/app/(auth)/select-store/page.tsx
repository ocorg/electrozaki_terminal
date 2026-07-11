'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { Loader2, LogOut } from 'lucide-react'

const PORTALS = [
  {
    path:     '/ez/dashboard',
    name:     'Electro Zaki',
    subtitle: 'Téléphones · Laptops · Accessoires · Réparations',
    color:    '#C9A440',
    bg:       '#FAF5E8',
    border:   '#E8D494',
    abbr:     'EZ',
  },
  {
    path:     '/bzg/dashboard',
    name:     'BZG Group',
    subtitle: 'Vue globale · Rapports · Caisse · Logs',
    color:    '#6366F1',
    bg:       '#F5F3FF',
    border:   '#C4B5FD',
    abbr:     'BZG',
    managerOnly: false,
  },
]

export default function SelectStorePage() {
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading } = useUser()
  const [loggingOut, setLoggingOut] = useState(false)

  // If employee somehow lands here, redirect immediately
  useEffect(() => {
    if (!loading && user) {
      if (user.store_locked && user.store_id) {
        const dest = user.store_id === 'EZ-001' ? '/ez/dashboard' : '/select-store'
        router.replace(dest)
      }
    }
  }, [user, loading, router])

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#6B6860] animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4] flex flex-col items-center justify-center p-6">
      <div className="absolute inset-0 bg-[radial-gradient(#00000008_1px,transparent_1px)] bg-[size:24px_24px]" />

      <div className="relative w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1A1A1A] mb-4 shadow-lg">
            <span className="text-white font-bold text-xl tracking-widest"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              BZG
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Bienvenue, {user?.display_name}
          </h1>
          <p className="text-sm text-[#6B6860] mt-1 capitalize">
            {user?.role === 'owner' ? 'Propriétaire' : 'Manager'} · Choisissez un portail
          </p>
        </div>

        {/* Portal cards */}
        <div className="space-y-3">
          {PORTALS.map(p => (
            <button
              key={p.path}
              onClick={() => router.push(p.path)}
              className="w-full flex items-center gap-5 px-6 py-5 bg-white rounded-2xl border-2 transition-all duration-200 text-left group active:scale-[0.98] hover:shadow-lg"
              style={{
                borderColor: p.border,
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = p.color)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = p.border)}
            >
              {/* Logo bubble */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
                style={{ backgroundColor: p.color }}
              >
                <span className="text-white font-bold text-sm tracking-wider"
                      style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {p.abbr}
                </span>
              </div>

              {/* Labels */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg text-[#1A1A1A] tracking-wide"
                   style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {p.name}
                </p>
                <p className="text-xs text-[#B0ADA6] mt-0.5 truncate">{p.subtitle}</p>
              </div>

              {/* Arrow */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all group-hover:translate-x-0.5"
                style={{ backgroundColor: `${p.color}15` }}
              >
                <svg className="w-4 h-4" style={{ color: p.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {/* Logout */}
        <div className="mt-8 text-center">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="inline-flex items-center gap-2 text-sm text-[#B0ADA6] hover:text-red-500 transition-colors"
          >
            {loggingOut
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <LogOut className="w-4 h-4" />
            }
            Se déconnecter
          </button>
        </div>

        <p className="text-center text-[#B0ADA6] text-xs mt-4">
          BZG Group © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}