'use client'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { PortalProvider } from '@/lib/context/portal'
import PortalSidebar from '@/components/layout/PortalSidebar'

export default function HPLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed]     = useState(false)

  return (
    <PortalProvider type="hp">
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#F0F9FF' }}>

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
          <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#BAE6FD] flex-shrink-0">
            <span className="font-bold text-[#0EA5E9] tracking-widest text-lg"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              HAMID PHONE
            </span>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-[#6B6860] hover:bg-[#F0F9FF] transition-all"
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