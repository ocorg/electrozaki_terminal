'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import {
  LayoutDashboard, ShoppingCart, Smartphone, Laptop, Package,
  Wrench, Users, Truck, Receipt, Vault, ArrowLeftRight,
  Settings, LogOut, Globe, Zap, ChevronRight
} from 'lucide-react'
import type { UserRole } from '@/types/database'

const NAV_ITEMS = [
  { href: '/',              icon: LayoutDashboard, labelFr: 'Dashboard',      labelAr: 'لوحة التحكم',  roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/pos',           icon: ShoppingCart,    labelFr: 'Point de vente', labelAr: 'نقطة البيع',   roles: ['staff','manager','owner'] as UserRole[] },
  { href: null,             icon: null,            labelFr: 'STOCK',          labelAr: 'المخزون',      roles: ['staff','manager','owner'] as UserRole[], divider: true },
  { href: '/stock/phones',  icon: Smartphone,      labelFr: 'Téléphones',     labelAr: 'الهواتف',      roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/stock/laptops', icon: Laptop,          labelFr: 'Laptops',        labelAr: 'اللابتوبات',   roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/stock/accessories', icon: Package,     labelFr: 'Accessoires',    labelAr: 'الإكسسوارات', roles: ['staff','manager','owner'] as UserRole[] },
  { href: null,             icon: null,            labelFr: 'OPÉRATIONS',     labelAr: 'العمليات',     roles: ['manager','owner'] as UserRole[], divider: true },
  { href: '/repairs',       icon: Wrench,          labelFr: 'Réparations',    labelAr: 'الإصلاحات',   roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/clients',       icon: Users,           labelFr: 'Clients',        labelAr: 'العملاء',      roles: ['staff','manager','owner'] as UserRole[] },
  { href: '/suppliers',     icon: Truck,           labelFr: 'Fournisseurs',   labelAr: 'الموردون',     roles: ['manager','owner'] as UserRole[] },
  { href: '/expenses',      icon: Receipt,         labelFr: 'Dépenses',       labelAr: 'المصاريف',     roles: ['manager','owner'] as UserRole[] },
  { href: '/caisse',        icon: Vault,           labelFr: 'Caisse du jour', labelAr: 'صندوق اليوم',  roles: ['manager','owner'] as UserRole[] },
  { href: '/movements',     icon: ArrowLeftRight,  labelFr: 'Transferts',     labelAr: 'التنقلات',     roles: ['manager','owner'] as UserRole[] },
  { href: '/admin',         icon: Settings,        labelFr: 'Administration', labelAr: 'الإدارة',      roles: ['owner'] as UserRole[] },
]

export default function Sidebar({ onClose }: { onClose?: () => void }) {
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
    <div className="flex flex-col h-full bg-ez-sidebar border-r border-white/10">
      {/* Logo */}
      <div className="p-5 border-b border-ez-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-gold" fill="currentColor" />
          </div>
          <div>
            <span className="font-display text-lg font-bold text-gold tracking-widest">ELECTRO ZAKI</span>
            <p className="text-ez-subtle text-[10px] tracking-wider">
              {user?.display_name || '—'} ·{' '}
              <span className="text-gold/70 capitalize">{user?.role || '—'}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {visibleItems.map((item, i) => {
          if (item.divider) {
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
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group
                ${isActive
                  ? 'bg-gold/15 text-gold border border-gold/20'
                  : 'text-white/50 hover:text-white hover:bg-white/8'
                }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-gold' : 'text-ez-muted group-hover:text-ez-subtle'}`} />
              <span className="flex-1">{isAr ? item.labelAr : item.labelFr}</span>
              {isActive && <ChevronRight className="w-3 h-3 text-gold/50" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10 space-y-1">
        {/* Language toggle */}
        <button
          onClick={() => setLanguage(isAr ? 'fr' : 'ar')}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/50 hover:text-white hover:bg-white/8 transition-all"
        >
          <Globe className="w-4 h-4" />
          <span>{isAr ? 'Français' : 'العربية'}</span>
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-ez-subtle hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>{isAr ? 'تسجيل الخروج' : 'Se déconnecter'}</span>
        </button>
      </div>
    </div>
  )
}