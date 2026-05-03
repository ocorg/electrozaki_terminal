'use client'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { PortalProvider } from '@/lib/context/portal'
import PortalSidebar from '@/components/layout/PortalSidebar'

export default function BZGLayout({ children }: { children: React.ReactNode }) {
    // Extra client-side guard (middleware is the primary gate but can fail open)
  const { user } = require('@/lib/hooks/useUser').useUser?.() ?? {}
  if (user && !['manager', 'owner'].includes(user.role)) {
    return <div className="p-8 text-red-600 font-bold">Accès refusé.</div>
  }
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed]     = useState(false)

  return (
    <PortalProvider type="bzg">
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#F5F3FF' }}>

        <aside className="hidden lg:flex flex-shrink-0 flex-col transition-all duration-300">
          <PortalSidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
        </aside>

        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <aside className="relative flex flex-col w-64 z-10">
              <PortalSidebar onClose={() => setSidebarOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#C4B5FD] flex-shrink-0">
            <span className="font-bold text-[#6366F1] tracking-widest text-lg"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              BZG GROUP
            </span>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-[#6B6860] hover:bg-[#F5F3FF] transition-all"
            >
              <Menu className="w-5 h-5" />
            </button>
          </header>

          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </PortalProvider>
  )
}