'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { usePortal } from '@/lib/context/portal'
import {
  LayoutDashboard, ShoppingCart, Smartphone, Laptop, Package,
  Wrench, Users, Truck, Receipt, Vault, ArrowLeftRight,
  Settings, LogOut, Globe, ChevronRight,
  PanelLeftClose, PanelLeftOpen, Store, FileText, Clock,
  BarChart3, UserCheck, ScrollText, Shield, PackageCheck, CreditCard, List
} from 'lucide-react'
import type { UserRole } from '@/types/database'
import { useLanguageStore } from '@/lib/stores/language'

// ─── Nav item definition ──────────────────────────────────────
interface NavItem {
  href?:   string
  icon?:   React.ComponentType<{ className?: string }>
  label:   string
  roles:   UserRole[]
  divider?: true
}

// ─── Nav items per portal ─────────────────────────────────────
function getNavItems(portalBase: string, portalType: string): NavItem[] {
  if (portalType === 'bzg') {
    return [
      { href: `${portalBase}/dashboard`,    icon: LayoutDashboard, label: 'Tableau de bord',    roles: ['manager','owner'] as UserRole[] },
      { divider: true, label: 'OPÉRATIONS',                                                      roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/transactions`, icon: ShoppingCart,    label: 'Transactions',        roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/caisse`,       icon: Vault,           label: 'Caisse — Validation', roles: ['manager','owner'] as UserRole[] },
      { divider: true, label: 'ANALYSE',                                                          roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/reports`,      icon: BarChart3,       label: 'Rapports',            roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/staff`,        icon: UserCheck,       label: 'Présence équipe',     roles: ['manager','owner'] as UserRole[] },
      { divider: true, label: 'ADMIN',                                                            roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/logs`,         icon: ScrollText,      label: "Journal d'activité",  roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/users`,        icon: Shield,          label: 'Utilisateurs',        roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/changelog`,    icon: FileText,        label: 'Changelog plateforme',roles: ['manager','owner'] as UserRole[] },
      { href: `${portalBase}/settings`,     icon: Settings,        label: 'Paramètres',          roles: ['owner'] as UserRole[] },
    ]
  }

  if (portalType === 'hp') {
    return [
      { href: `${portalBase}/dashboard`,        icon: LayoutDashboard, label: 'Tableau de bord',  roles: ['staff','manager','owner'] },
      { href: `${portalBase}/pos`,              icon: ShoppingCart,    label: 'Point de vente',    roles: ['staff','manager','owner'] },
      { divider: true, label: 'STOCK',                                                             roles: ['staff','manager','owner'] },
      { href: `${portalBase}/stock/phones`,     icon: Smartphone,      label: 'Téléphones',        roles: ['staff','manager','owner'] },
      { href: `${portalBase}/stock/accessories`,icon: Package,         label: 'Accessoires',       roles: ['staff','manager','owner'] },
      { divider: true, label: 'OPÉRATIONS',                                                        roles: ['staff','manager','owner'] },
      { href: `${portalBase}/deliveries`,       icon: PackageCheck,    label: 'Livraisons',        roles: ['manager','owner'] },
      { href: `${portalBase}/repairs`,          icon: Wrench,          label: 'Réparations',       roles: ['staff','manager','owner'] },
      { href: `${portalBase}/clients`,          icon: Users,           label: 'Clients',           roles: ['staff','manager','owner'] },
      { href: `${portalBase}/expenses`,         icon: Receipt,         label: 'Dépenses',          roles: ['manager','owner'] },
      { href: `${portalBase}/transactions`,     icon: List,            label: 'Transactions',      roles: ['manager','owner'] },
      { href: `${portalBase}/caisse`,           icon: Vault,           label: 'Caisse du jour',    roles: ['staff','manager','owner'] },
      { href: `${portalBase}/movements`,        icon: ArrowLeftRight,  label: 'Transferts stock',  roles: ['manager','owner'] },
      { href: `${portalBase}/credits`,          icon: CreditCard,      label: 'Crédits clients',   roles: ['manager','owner'] },
      { href: `${portalBase}/suppliers`,        icon: Truck,           label: 'Fournisseurs',      roles: ['manager','owner'] },
  ]
}

  // Default: EZ portal
  return [
    { href: `${portalBase}/dashboard`,        icon: LayoutDashboard, label: 'Tableau de bord',   roles: ['staff','manager','owner'] },
    { href: `${portalBase}/pos`,              icon: ShoppingCart,    label: 'Point de vente',     roles: ['staff','manager','owner'] },
    { divider: true, label: 'STOCK',                                                              roles: ['staff','manager','owner'] },
    { href: `${portalBase}/stock/phones`,     icon: Smartphone,      label: 'Téléphones',         roles: ['staff','manager','owner'] },
    { href: `${portalBase}/stock/laptops`,    icon: Laptop,          label: 'Laptops',            roles: ['staff','manager','owner'] },
    { href: `${portalBase}/stock/accessories`,icon: Package,         label: 'Accessoires',        roles: ['staff','manager','owner'] },
    { divider: true, label: 'OPÉRATIONS',                                                         roles: ['staff','manager','owner'] },
    { href: `${portalBase}/deliveries`,       icon: PackageCheck,    label: 'Livraisons',         roles: ['manager','owner'] },
    { href: `${portalBase}/repairs`,          icon: Wrench,          label: 'Réparations',        roles: ['staff','manager','owner'] },
    { href: `${portalBase}/clients`,          icon: Users,           label: 'Clients',            roles: ['staff','manager','owner'] },
    { href: `${portalBase}/suppliers`,        icon: Truck,           label: 'Fournisseurs',       roles: ['manager','owner'] },
    { href: `${portalBase}/expenses`,         icon: Receipt,         label: 'Dépenses',           roles: ['manager','owner'] },
    { href: `${portalBase}/caisse`,           icon: Vault,           label: 'Caisse du jour',     roles: ['staff','manager','owner'] },
    { href: `${portalBase}/movements`,        icon: ArrowLeftRight,  label: 'Transferts stock',   roles: ['manager','owner'] },
    { href: `${portalBase}/credits`,          icon: CreditCard,      label: 'Crédits clients',    roles: ['manager','owner'] },
  ]
}

interface PortalSidebarProps {
  onClose?:           () => void
  collapsed?:         boolean
  onCollapsedChange?: (v: boolean) => void
}

export default function PortalSidebar({ onClose, collapsed = false, onCollapsedChange }: PortalSidebarProps) {
  const pathname    = usePathname() ?? ''
  const router      = useRouter()
  const supabase    = createClient()
  const { user }    = useUser()
  const portal      = usePortal()
  const { language, setLanguage } = useLanguageStore()

  const LANG_LABEL: Record<string, string> = { fr: 'FR', ar: 'AR' }

  const portalBase  = `/${portal.type}`
  const navItems    = getNavItems(portalBase, portal.type)
  const visibleItems = navItems.filter(item =>
    !user?.role || item.roles.includes(user.role as UserRole)
  )

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const primary    = portal.primaryColor
  const sidebarBg  = portal.sidebarBg

  return (
    <div
      className="flex flex-col h-full transition-all duration-300"
      style={{
        backgroundColor: sidebarBg,
        width: collapsed ? '64px' : '256px',
      }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0 border-b"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          padding: collapsed ? '12px' : '16px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? 0 : '12px',
        }}
      >
        {/* Store badge */}
        <div
          className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
          style={{ backgroundColor: primary }}
        >
          <span className="text-white font-bold text-xs tracking-wider"
                style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {portal.shortName}
          </span>
        </div>

        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm tracking-wide truncate"
               style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              {portal.storeName}
            </p>
            {user && (
              <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {user.display_name}
                {' · '}
                <span style={{ color: `${primary}99` }} className="capitalize">{user.role}</span>
              </p>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        {onCollapsedChange && (
          <button
            onClick={() => onCollapsedChange(!collapsed)}
            className="hidden lg:flex flex-shrink-0 w-7 h-7 items-center justify-center rounded-lg transition-all"
            style={{ color: 'rgba(255,255,255,0.3)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </button>
        )}
      </div>

      {/* ── Nav ────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {visibleItems.map((item, i) => {
          // Section divider
          if (item.divider) {
            if (collapsed) return (
              <div key={i} className="border-t my-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
            )
            return (
              <p key={i} className="text-[10px] font-bold uppercase tracking-widest px-3 pt-4 pb-1"
                 style={{ color: 'rgba(255,255,255,0.25)' }}>
                {item.label}
              </p>
            )
          }

          const isActive = item.href === `${portalBase}/dashboard`
            ? pathname === item.href || pathname === `${portalBase}`
            : pathname.startsWith(item.href!)
          const Icon = item.icon!

          return (
            <Link
              key={item.href}
              href={item.href!}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              className="flex items-center gap-3 rounded-xl text-sm font-medium transition-all"
              style={{
                padding: collapsed ? '10px 0' : '10px 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                color: isActive ? primary : 'rgba(255,255,255,0.5)',
                backgroundColor: isActive ? `${primary}20` : 'transparent',
                border: `1px solid ${isActive ? `${primary}30` : 'transparent'}`,
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.color = 'rgba(255,255,255,0.9)'
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
                }
              }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="w-3 h-3 opacity-50" />}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="border-t p-2 space-y-0.5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>

        {/* Language toggle */}
        <button
          onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
          title={collapsed ? 'Langue' : undefined}
          className="w-full flex items-center gap-3 rounded-xl text-sm transition-all"
          style={{
            padding: collapsed ? '10px 0' : '10px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: 'rgba(255,255,255,0.4)',
          }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
        >
          <Globe className="w-4 h-4 flex-shrink-0" />
          {!collapsed && (
            <span className="flex items-center gap-2">
              Langue
              <span
                className="text-xs font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${portal.primaryColor}25`, color: portal.primaryColor }}
              >
                {LANG_LABEL[language]}
              </span>
            </span>
          )}
        </button>

        {/* Switch portal (non-staff only) */}
        {user && !user.store_locked && (
          <button
            onClick={() => router.push('/select-store')}
            title={collapsed ? 'Changer de portail' : undefined}
            className="w-full flex items-center gap-3 rounded-xl text-sm transition-all"
            style={{
              padding: collapsed ? '10px 0' : '10px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              color: 'rgba(255,255,255,0.4)',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
          >
            <Store className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Changer de portail</span>}
          </button>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Déconnexion' : undefined}
          className="w-full flex items-center gap-3 rounded-xl text-sm transition-all"
          style={{
            padding: collapsed ? '10px 0' : '10px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: 'rgba(255,255,255,0.4)',
          }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = 'rgb(248,113,113)' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Déconnecter</span>}
        </button>
      </div>
    </div>
  )
}