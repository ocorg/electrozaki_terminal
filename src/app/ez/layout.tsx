'use client'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { PortalProvider } from '@/lib/context/portal'
import PortalSidebar from '@/components/layout/PortalSidebar'

export default function EZLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed]     = useState(false)

  return (
    <PortalProvider type="ez">
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#F8F7F4' }}>

        {/* Desktop sidebar */}
        <aside className="hidden lg:flex flex-shrink-0 flex-col transition-all duration-300">
          <PortalSidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <aside className="relative flex flex-col w-64 z-10">
              <PortalSidebar onClose={() => setSidebarOpen(false)} />
            </aside>
          </div>
        )}

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Mobile topbar */}
          <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#E8E5DE] flex-shrink-0">
            <span className="font-bold text-[#C9A440] tracking-widest text-lg"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              ELECTRO ZAKI
            </span>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-[#6B6860] hover:bg-[#F2F0EB] transition-all"
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