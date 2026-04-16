'use client'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen bg-ez-bg overflow-hidden">

      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-shrink-0 flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}>
        <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative flex flex-col w-64">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-ez-border flex-shrink-0">
          <img
            src="/logo.png"
            alt="EZ"
            className="h-8 w-auto object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-ez-subtle hover:text-ez-text hover:bg-ez-muted transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}