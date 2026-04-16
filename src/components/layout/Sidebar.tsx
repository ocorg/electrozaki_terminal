'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import {
  LayoutDashboard, ShoppingCart, Smartphone, Laptop, Package,
  Wrench, Users, Truck, Receipt, Vault, ArrowLeftRight,
  Settings, LogOut, Globe, ChevronRight, ChevronLeft,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react'
import type { UserRole } from '@/types/database'

const NAV_ITEMS = [
  { href: '/',                  icon: LayoutDashboard, labelFr: 'Dashboard',      labelAr: 'لوحة التحكم',  roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/pos',               icon: ShoppingCart,    labelFr: 'Point de vente', labelAr: 'نقطة البيع',   roles: ['staff','manager','owner'] as UserRole[] },
  { divider: true,              labelFr: 'STOCK',      labelAr: 'المخزون',        roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/stock/phones',      icon: Smartphone,      labelFr: 'Téléphones',     labelAr: 'الهواتف',      roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/stock/laptops',     icon: Laptop,          labelFr: 'Laptops',        labelAr: 'اللابتوبات',   roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/stock/accessories', icon: Package,         labelFr: 'Accessoires',    labelAr: 'الإكسسوارات', roles: ['staff','manager','owner'] as UserRole[] },
  { divider: true,              labelFr: 'OPÉRATIONS', labelAr: 'العمليات',       roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/repairs',           icon: Wrench,          labelFr: 'Réparations',    labelAr: 'الإصلاحات',   roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/clients',           icon: Users,           labelFr: 'Clients',        labelAr: 'العملاء',      roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/suppliers',         icon: Truck,           labelFr: 'Fournisseurs',   labelAr: 'الموردون',     roles: ['manager','owner'] as UserRole[] },
  { href: '/expenses',          icon: Receipt,         labelFr: 'Dépenses',       labelAr: 'المصاريف',     roles: ['manager','owner'] as UserRole[] },
  { href: '/caisse',            icon: Vault,           labelFr: 'Caisse du jour', labelAr: 'صندوق اليوم',  roles: ['manager','owner'] as UserRole[] },
  { href: '/movements',         icon: ArrowLeftRight,  labelFr: 'Transferts',     labelAr: 'التنقلات',     roles: ['manager','owner'] as UserRole[] },
  { href: '/admin',             icon: Settings,        labelFr: 'Administration', labelAr: 'الإدارة',      roles: ['owner'] as UserRole[] },
]

interface SidebarProps {
  onClose?: () => void
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
}

export default function Sidebar({ onClose, collapsed = false, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { user } = useUser()
  const { language, setLanguage } = useLanguageStore()
  const isAr = language === 'ar'

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const visibleItems = NAV_ITEMS.filter(item =>
    !user?.role || item.roles.includes(user.role)
  )

  return (
    <div className={`flex flex-col h-full bg-[#111111] transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}>

      {/* Header */}
      <div className={`flex items-center border-b border-white/8 flex-shrink-0 ${collapsed ? 'p-3 justify-center' : 'p-4 gap-3'}`}>
        {/* Logo */}
        <div className="flex-shrink-0">
          <img
            src="/logo.png"
            alt="EZ"
            className={`object-contain transition-all duration-300 ${collapsed ? 'h-8 w-8' : 'h-9 w-auto max-w-[120px]'}`}
            onError={(e) => {
              // fallback to text if logo missing
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling?.removeAttribute('style')
            }}
          />
          <span
            style={{ display: 'none' }}
            className={`font-display font-bold text-gold tracking-widest ${collapsed ? 'text-lg' : 'text-xl'}`}
          >
            {collapsed ? 'EZ' : 'ELECTRO ZAKI'}
          </span>
        </div>

        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-white/40 text-[10px] tracking-wider truncate">
              {user?.display_name || '—'}
              {' · '}
              <span className="text-gold/60 capitalize">{user?.role || '—'}</span>
            </p>
          </div>
        )}

        {/* Collapse toggle — desktop only */}
        {onCollapsedChange && (
          <button
            onClick={() => onCollapsedChange(!collapsed)}
            className="hidden lg:flex flex-shrink-0 w-7 h-7 items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/8 transition-all"
          >
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {visibleItems.map((item, i) => {
          if (item.divider) {
            if (collapsed) return <div key={i} className="border-t border-white/8 my-2" />
            return (
              <p key={i} className="text-[10px] font-bold text-white/25 tracking-widest uppercase px-3 pt-4 pb-1">
                {isAr ? item.labelAr : item.labelFr}
              </p>
            )
          }

          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href!)
          const Icon = item.icon!

          return (
            <Link
              key={item.href}
              href={item.href!}
              onClick={onClose}
              title={collapsed ? (isAr ? item.labelAr : item.labelFr) : undefined}
              className={`flex items-center gap-3 rounded-xl text-sm font-medium transition-all group
                ${collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'}
                ${isActive
                  ? 'bg-gold/15 text-gold border border-gold/20'
                  : 'text-white/50 hover:text-white hover:bg-white/8 border border-transparent'
                }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-gold' : 'text-white/40 group-hover:text-white/70'}`} />
              {!collapsed && (
                <>
                  <span className="flex-1">{isAr ? item.labelAr : item.labelFr}</span>
                  {isActive && <ChevronRight className="w-3 h-3 text-gold/50" />}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-white/8 p-2 space-y-0.5`}>
        <button
          onClick={() => setLanguage(isAr ? 'fr' : 'ar')}
          title={collapsed ? (isAr ? 'Français' : 'العربية') : undefined}
          className={`w-full flex items-center gap-3 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/8 transition-all
            ${collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'}`}
        >
          <Globe className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>{isAr ? 'Français' : 'العربية'}</span>}
        </button>

        <button
          onClick={handleLogout}
          title={collapsed ? (isAr ? 'خروج' : 'Déconnexion') : undefined}
          className={`w-full flex items-center gap-3 rounded-xl text-sm text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all
            ${collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'}`}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>{isAr ? 'تسجيل الخروج' : 'Se déconnecter'}</span>}
        </button>
      </div>
    </div>
  )
}