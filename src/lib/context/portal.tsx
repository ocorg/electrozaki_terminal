'use client'
import { createContext, useContext, ReactNode } from 'react'

// ─── Portal Types ─────────────────────────────────────────────
export type PortalType = 'ez' | 'hp' | 'bzg'

export interface PortalConfig {
  type:         PortalType
  storeId:      string | null   // null for BZG (cross-store)
  storeName:    string
  shortName:    string
  primaryColor: string          // CSS hex for active brand color
  bgAccent:     string          // light tint for backgrounds
  borderAccent: string          // tinted border color
  sidebarBg:    string          // sidebar background
  logoText:     string          // fallback text if no logo image
}

// ─── Portal Definitions ───────────────────────────────────────
export const PORTAL_CONFIGS: Record<PortalType, PortalConfig> = {
  ez: {
    type:         'ez',
    storeId:      'EZ-001',
    storeName:    'Electro Zaki',
    shortName:    'EZ',
    primaryColor: '#C9A440',
    bgAccent:     '#FAF5E8',
    borderAccent: '#E8D494',
    sidebarBg:    '#111111',
    logoText:     'ELECTRO ZAKI',
  },
  hp: {
    type:         'hp',
    storeId:      'HP-001',
    storeName:    'Hamid Phone',
    shortName:    'HP',
    primaryColor: '#0EA5E9',
    bgAccent:     '#F0F9FF',
    borderAccent: '#BAE6FD',
    sidebarBg:    '#0C2D48',
    logoText:     'HAMID PHONE',
  },
  bzg: {
    type:         'bzg',
    storeId:      null,
    storeName:    'BZG Group',
    shortName:    'BZG',
    primaryColor: '#6366F1',
    bgAccent:     '#F5F3FF',
    borderAccent: '#C4B5FD',
    sidebarBg:    '#1A1A2E',
    logoText:     'BZG GROUP',
  },
}

// ─── Context ──────────────────────────────────────────────────
interface PortalContextValue {
  portal: PortalConfig
}

const PortalContext = createContext<PortalContextValue | null>(null)

export function PortalProvider({
  type,
  children,
}: {
  type: PortalType
  children: ReactNode
}) {
  const portal = PORTAL_CONFIGS[type]

  return (
    <PortalContext.Provider value={{ portal }}>
      {/* Inject CSS variables so Tailwind arbitrary values & inline styles work */}
      <style>{`
        :root {
          --portal-primary:  ${portal.primaryColor};
          --portal-bg:       ${portal.bgAccent};
          --portal-border:   ${portal.borderAccent};
          --portal-sidebar:  ${portal.sidebarBg};
        }
      `}</style>
      {children}
    </PortalContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────
export function usePortal(): PortalConfig {
  const ctx = useContext(PortalContext)
  if (!ctx) throw new Error('usePortal must be used inside a PortalProvider')
  return ctx.portal
}