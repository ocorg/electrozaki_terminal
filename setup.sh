#!/usr/bin/env bash
# ============================================================
#  ELECTRO ZAKI — Project Scaffold Script v3.0
#
#  Run this from the root of your cloned GitHub repo:
#    git clone https://github.com/ocorg/electrozaki_terminal.git
#    cd electrozaki_terminal
#    chmod +x setup.sh && ./setup.sh
#
#  What this does:
#    1. Initializes Next.js 14 (App Router + TypeScript + Tailwind)
#    2. Installs all project dependencies
#    3. Creates every folder and file (with content)
#    4. Writes Supabase client, types, i18n, middleware, layouts
# ============================================================
set -e
echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║     ELECTRO ZAKI — Scaffold v3.0         ║"
echo "╚═══════════════════════════════════════════╝"
echo ""


# ── 2. Install dependencies ───────────────────────────────────
echo "▶  Installing dependencies..."
npm install \
  @supabase/supabase-js \
  @supabase/ssr \
  zustand \
  react-hook-form \
  @hookform/resolvers \
  zod \
  recharts \
  lucide-react \
  date-fns \
  react-hot-toast \
  next-pwa \
  @zxing/browser \
  @zxing/library \
  jspdf \
  html2canvas \
  resend \
  clsx \
  tailwind-merge \
  class-variance-authority \
  @radix-ui/react-dialog \
  @radix-ui/react-select \
  @radix-ui/react-toast \
  @radix-ui/react-tabs \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-popover \
  @radix-ui/react-tooltip \
  @radix-ui/react-switch \
  sonner

npm install --save-dev \
  @types/node \
  @types/react \
  @types/react-dom

echo "▶  Installing shadcn/ui..."
npx shadcn@latest init --defaults --yes || true
npx shadcn@latest add button input label card badge dialog select tabs toast switch dropdown-menu popover tooltip separator skeleton --yes || true

# ── 3. Create directory structure ─────────────────────────────
echo "▶  Creating folder structure..."
mkdir -p src/app/\(auth\)/login
mkdir -p src/app/\(dashboard\)/pos
mkdir -p src/app/\(dashboard\)/stock/phones
mkdir -p src/app/\(dashboard\)/stock/laptops
mkdir -p src/app/\(dashboard\)/stock/accessories
mkdir -p src/app/\(dashboard\)/repairs
mkdir -p src/app/\(dashboard\)/clients
mkdir -p src/app/\(dashboard\)/suppliers
mkdir -p src/app/\(dashboard\)/expenses
mkdir -p src/app/\(dashboard\)/caisse
mkdir -p src/app/\(dashboard\)/movements
mkdir -p src/app/\(dashboard\)/admin
mkdir -p src/app/api/auth/login
mkdir -p src/app/api/auth/verify-override
mkdir -p src/app/api/phones
mkdir -p src/app/api/laptops
mkdir -p src/app/api/accessories
mkdir -p src/app/api/transactions
mkdir -p src/app/api/repairs
mkdir -p src/app/api/clients
mkdir -p src/app/api/suppliers
mkdir -p src/app/api/expenses
mkdir -p src/app/api/caisse
mkdir -p src/app/api/movements
mkdir -p src/app/api/reports/receipt
mkdir -p src/app/api/reports/label
mkdir -p src/app/api/alerts/restock
mkdir -p src/lib/supabase
mkdir -p src/lib/utils
mkdir -p src/lib/validations
mkdir -p src/lib/hooks
mkdir -p src/lib/stores
mkdir -p src/lib/i18n
mkdir -p src/types
mkdir -p src/components/layout
mkdir -p src/components/pos
mkdir -p src/components/scanner
mkdir -p src/components/print
mkdir -p src/components/shared
mkdir -p src/components/ui
mkdir -p public/icons
mkdir -p supabase/migrations

echo "▶  Writing configuration files..."

# ── tailwind.config.ts ────────────────────────────────────────
cat > tailwind.config.ts << 'TAILWIND'
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // EZ Brand
        gold: {
          DEFAULT: '#C9A440',
          50:  '#FAF5E8',
          100: '#F3E9C7',
          200: '#E8D494',
          300: '#DCBE61',
          400: '#C9A440',
          500: '#A8872E',
          600: '#876B22',
          700: '#665117',
          800: '#44360F',
          900: '#221B07',
        },
        ez: {
          black:  '#0A0A0A',
          dark:   '#111111',
          surface:'#1A1A1A',
          border: '#2A2A2A',
          muted:  '#3A3A3A',
          text:   '#E5E5E5',
          subtle: '#888888',
        }
      },
      fontFamily: {
        display: ['Barlow Condensed', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '6px',
      },
      boxShadow: {
        'ez-sm':  '0 1px 3px rgba(0,0,0,0.4)',
        'ez-md':  '0 4px 12px rgba(0,0,0,0.5)',
        'ez-lg':  '0 8px 24px rgba(0,0,0,0.6)',
        'ez-gold':'0 0 20px rgba(201,164,64,0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
TAILWIND

# ── next.config.js ────────────────────────────────────────────
cat > next.config.js << 'NEXTCONFIG'
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['*.supabase.co'],
  },
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
}

module.exports = withPWA(nextConfig)
NEXTCONFIG

# ── .env.local.example ───────────────────────────────────────
cat > .env.local.example << 'ENVEXAMPLE'
# Supabase — copy from your project settings (Settings > API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Supabase service role key — NEVER expose to client
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Resend (email alerts)
RESEND_API_KEY=re_xxxxxxxxxxxxx
ALERT_FROM_EMAIL=alerts@electrozaki.ma
ALERT_TO_EMAIL=owner@electrozaki.ma

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
ENVEXAMPLE

cp .env.local.example .env.local

# ── src/types/database.ts ─────────────────────────────────────
cat > src/types/database.ts << 'DBTYPES'
// ============================================================
//  ELECTRO ZAKI — Supabase Database Types
//  Auto-maintained — matches supabase_schema.sql exactly
// ============================================================

export type UserRole = 'staff' | 'manager' | 'owner'
export type DeviceSource = 'Fournisseur' | 'Reprise' | 'Échange'
export type DeviceCondition = 'جديد' | 'مستعمل' | 'معطوب'
export type DeviceStatus = 'متوفر' | 'مباع' | 'إستبدال' | 'إصلاح'
export type LocationType = 'Magasin Principal' | 'Magasin Secondaire' | 'Externe'
export type OperationType = 'بيع' | 'إستبدال' | 'تسبيق' | 'Retour'
export type PaymentMethod = 'نقد' | 'تحويل' | 'تسبيق' | 'إستبدال' | 'مختلط'
export type RepairStatus = 'معلق' | 'قيد الإصلاح' | 'جاهز' | 'تم الاستلام'
export type MovementReason = 'Transfert' | 'Réparation Externe' | 'Retour' | 'Prêt'
export type DeviceType = 'هاتف' | 'لابتوب' | 'إكسسوار'
export type AccCategory = 'كفر' | 'شاحن' | 'سماعة' | 'واقي' | 'سيم' | 'أخرى'
export type SupplierCategory = 'هواتف' | 'لابتوبات' | 'إكسسوارات' | 'كل شيء'
export type ExpenseCategory = 'إيجار' | 'فاتورة' | 'نقل' | 'صيانة' | 'أجور' | 'تسويق' | 'معدات' | 'أخرى'

export interface UserProfile {
  id: string
  display_name: string
  role: UserRole
  override_pin?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Phone {
  phone_id: string
  imei?: string
  source: DeviceSource
  fournisseur_id?: string
  txn_ref_id?: string
  condition: DeviceCondition
  marque: string
  serie?: string
  type?: string
  couleur?: string
  model: string
  stockage?: string
  battery_level?: number
  ram?: string
  description?: string
  icloud_compte?: string   // manager/owner only
  icloud_mdp?: string      // owner only
  prix_achat?: number
  prix_vente_recommande?: number
  prix_vente_minimum?: number
  warranty_months?: number
  status: DeviceStatus
  location: LocationType
  date_entree?: string
  image_url?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
}

export interface Laptop {
  laptop_id: string
  serial?: string
  source: DeviceSource
  fournisseur_id?: string
  txn_ref_id?: string
  condition: DeviceCondition
  marque: string
  model: string
  processeur?: string
  carte_graphique?: string
  stockage?: string
  ram?: string
  ecran?: string
  battery_level?: number
  couleur?: string
  description?: string
  prix_achat?: number
  prix_vente_recommande?: number
  prix_vente_minimum?: number
  warranty_months?: number
  status: DeviceStatus
  location: LocationType
  date_entree?: string
  notes?: string    // passwords — manager/owner only
  image_url?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
}

export interface Accessory {
  acc_id: string
  barcode?: string
  nom: string
  categorie: AccCategory
  marque?: string
  compatible_with?: string
  prix_achat?: number
  prix_vente_recommande?: number
  prix_vente_minimum?: number
  quantite: number
  seuil_alerte: number
  fournisseur_id?: string
  location: LocationType
  image_url?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
  // Computed (from view)
  status_computed?: 'متوفر' | 'تحذير' | 'نفذ'
  is_low_stock?: boolean
}

export interface Transaction {
  txn_id: string
  device_type: DeviceType
  device_id: string
  client_id?: string
  type_operation: OperationType
  txn_original_id?: string
  prix_vente: number
  date_vente: string
  avance?: number
  date_avance?: string
  payment_method: PaymentMethod
  montant_especes?: number
  montant_carte?: number
  montant_rendu?: number
  payment_ref?: string
  valeur_echange?: number
  marque_echange?: string
  model_echange?: string
  stockage_echange?: string
  ram_echange?: string
  etat_batterie_echange?: number
  imei_echange?: string
  description_echange?: string
  warranty_start?: string
  warranty_expiry?: string
  override_required?: boolean
  override_by?: string
  override_reason?: string
  notes?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
  // Computed (app layer)
  fariq?: number
  statut_paiement?: '✅ مسدد' | '🔵 متبقي' | '⚠️ زيادة دفع'
}

export interface Reparation {
  rep_id: string
  client_id?: string
  device_type_libre?: string
  device_serial?: string
  marque?: string
  model: string
  probleme: string
  diagnostic?: string
  cout_reparation?: number
  avance_rep?: number
  date_avance_rep?: string
  statut: RepairStatus
  date_depot: string
  date_prevue?: string
  date_livraison?: string
  technicien?: string
  whatsapp_notified?: boolean
  notes?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
  // Computed
  fariq_rep?: number
}

export interface ReparationPart {
  part_id: string
  rep_id: string
  description: string
  cout: number
  fournisseur?: string
  date_achat?: string
  created_at: string
  created_by?: string
}

export interface Client {
  client_id: string
  nom: string
  telephone: string
  telephone_2?: string
  email?: string
  adresse?: string
  date_premier_achat?: string
  notes?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
  // Computed (from client_summary view)
  total_ca?: number
  solde_impaye?: number
  total_reparations?: number
}

export interface Supplier {
  supplier_id: string
  nom: string
  telephone?: string
  email?: string
  adresse?: string
  ville?: string
  categorie?: SupplierCategory
  notes?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
  // Computed (from supplier_summary view)
  total_achats?: number
  total_paye?: number
  solde_du?: number
}

export interface SupplierPayment {
  payment_id: string
  supplier_id: string
  montant: number
  payment_method: PaymentMethod
  payment_ref?: string
  facture_ref?: string
  date_paiement: string
  notes?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
}

export interface Expense {
  exp_id: string
  categorie: ExpenseCategory
  montant: number
  date: string
  fournisseur_id?: string
  facture_ref?: string
  notes?: string
  created_at: string
  created_by?: string
  updated_at: string
  updated_by?: string
}

export interface Caisse {
  caisse_id: string
  date: string
  ouverture: number
  total_ventes?: number
  total_reparations?: number
  total_depenses?: number
  solde_theorique?: number
  solde_reel?: number
  ecart?: number
  payment_breakdown?: { cash: number; transfer: number; credit: number }
  notes?: string
  closed_by?: string
  closed_at?: string
  created_at: string
  created_by?: string
}

export interface StockMovement {
  movement_id: string
  device_type: DeviceType
  device_id: string
  quantity: number
  from_location: LocationType
  to_location: LocationType
  external_name?: string
  reason: MovementReason
  notes?: string
  moved_by?: string
  moved_at: string
  created_at: string
  created_by?: string
}

export interface Setting {
  key: string
  value?: string
  notes?: string
  updated_at: string
  updated_by?: string
}

// ── Database shape for Supabase client typing ─────────────────
export interface Database {
  public: {
    Tables: {
      user_profiles:    { Row: UserProfile;     Insert: Partial<UserProfile>;     Update: Partial<UserProfile> }
      phones:           { Row: Phone;           Insert: Partial<Phone>;           Update: Partial<Phone> }
      laptops:          { Row: Laptop;          Insert: Partial<Laptop>;          Update: Partial<Laptop> }
      accessories:      { Row: Accessory;       Insert: Partial<Accessory>;       Update: Partial<Accessory> }
      transactions:     { Row: Transaction;     Insert: Partial<Transaction>;     Update: Partial<Transaction> }
      reparations:      { Row: Reparation;      Insert: Partial<Reparation>;      Update: Partial<Reparation> }
      reparations_parts:{ Row: ReparationPart;  Insert: Partial<ReparationPart>;  Update: Partial<ReparationPart> }
      clients:          { Row: Client;          Insert: Partial<Client>;          Update: Partial<Client> }
      suppliers:        { Row: Supplier;        Insert: Partial<Supplier>;        Update: Partial<Supplier> }
      supplier_payments:{ Row: SupplierPayment; Insert: Partial<SupplierPayment>; Update: Partial<SupplierPayment> }
      expenses:         { Row: Expense;         Insert: Partial<Expense>;         Update: Partial<Expense> }
      caisse:           { Row: Caisse;          Insert: Partial<Caisse>;          Update: Partial<Caisse> }
      stock_movements:  { Row: StockMovement;   Insert: Partial<StockMovement>;   Update: Partial<StockMovement> }
      settings:         { Row: Setting;         Insert: Partial<Setting>;         Update: Partial<Setting> }
    }
    Views: {
      client_summary:         { Row: Client }
      supplier_summary:       { Row: Supplier }
      accessories_with_status:{ Row: Accessory & { status_computed: string; is_low_stock: boolean } }
    }
    Functions: {
      get_user_role:     { Args: Record<never, never>; Returns: string }
      verify_override_pin: { Args: { p_pin: string }; Returns: string | null }
    }
  }
}
DBTYPES

# ── src/lib/supabase/client.ts ────────────────────────────────
cat > src/lib/supabase/client.ts << 'SUPCLIENT'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
SUPCLIENT

# ── src/lib/supabase/server.ts ────────────────────────────────
cat > src/lib/supabase/server.ts << 'SUPSERVER'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch {}
        },
      },
    }
  )
}

// Admin client — server-side only, bypasses RLS
export function createAdminClient() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch {}
        },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
}
SUPSERVER

# ── src/middleware.ts ─────────────────────────────────────────
cat > src/middleware.ts << 'MIDDLEWARE'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)'],
}
MIDDLEWARE

# ── src/lib/i18n/translations.ts ─────────────────────────────
cat > src/lib/i18n/translations.ts << 'I18N'
// ============================================================
//  ELECTRO ZAKI — Translations (FR ↔ AR)
//  Usage: const t = useTranslation()  →  t('nav.pos')
// ============================================================

export type Language = 'fr' | 'ar'

export const translations = {
  fr: {
    // Navigation
    nav: {
      dashboard:   'Tableau de bord',
      pos:         'Point de vente',
      phones:      'Téléphones',
      laptops:     'Laptops',
      accessories: 'Accessoires',
      repairs:     'Réparations',
      clients:     'Clients',
      suppliers:   'Fournisseurs',
      expenses:    'Dépenses',
      caisse:      'Caisse du jour',
      movements:   'Transferts',
      admin:       'Administration',
      stock:       'Stock',
    },
    // Actions
    actions: {
      add:        'Ajouter',
      edit:       'Modifier',
      delete:     'Supprimer',
      save:       'Enregistrer',
      cancel:     'Annuler',
      search:     'Rechercher',
      filter:     'Filtrer',
      export:     'Exporter',
      print:      'Imprimer',
      scan:       'Scanner',
      confirm:    'Confirmer',
      close:      'Fermer',
      open:       'Ouvrir',
      view:       'Voir',
      refresh:    'Actualiser',
    },
    // Status labels (stored as Arabic in DB)
    status: {
      'متوفر':       'Disponible',
      'مباع':        'Vendu',
      'إستبدال':     'Échangé',
      'إصلاح':       'En réparation',
      'معلق':        'En attente',
      'قيد الإصلاح': 'En cours',
      'جاهز':        'Prêt',
      'تم الاستلام': 'Récupéré',
      'نفذ':         'Épuisé',
      'تحذير':       'Stock bas',
    },
    // Device condition
    condition: {
      'جديد':    'Neuf',
      'مستعمل':  'Occasion',
      'معطوب':   'Défectueux',
    },
    // Payment methods
    payment: {
      'نقد':       'Espèces',
      'تحويل':     'Virement',
      'تسبيق':     'Avance',
      'إستبدال':   'Échange',
      'مختلط':     'Mixte',
    },
    // Payment status
    paymentStatus: {
      '✅ مسدد':       '✅ Soldé',
      '🔵 متبقي':     '🔵 Solde restant',
      '⚠️ زيادة دفع': '⚠️ Trop payé',
    },
    // Operations
    operation: {
      'بيع':      'Vente',
      'إستبدال':  'Échange',
      'تسبيق':    'Avance',
      'Retour':   'Retour',
    },
    // Repair status
    repair: {
      'معلق':        'En attente',
      'قيد الإصلاح': 'En cours',
      'جاهز':        'Prêt',
      'تم الاستلام': 'Récupéré',
    },
    // Source
    source: {
      'Fournisseur': 'Fournisseur',
      'Reprise':     'Reprise',
      'Échange':     'Échange',
    },
    // Accessory categories
    accCategory: {
      'كفر':    'Coque',
      'شاحن':   'Chargeur',
      'سماعة':  'Écouteurs',
      'واقي':   'Protection',
      'سيم':    'Carte SIM',
      'أخرى':   'Autre',
    },
    // Fields
    fields: {
      name:      'Nom',
      phone:     'Téléphone',
      price:     'Prix',
      quantity:  'Quantité',
      brand:     'Marque',
      model:     'Modèle',
      storage:   'Stockage',
      ram:       'RAM',
      color:     'Couleur',
      battery:   'Batterie',
      imei:      'IMEI',
      serial:    'Numéro de série',
      status:    'Statut',
      location:  'Emplacement',
      date:      'Date',
      notes:     'Notes',
      client:    'Client',
      amount:    'Montant',
      total:     'Total',
      balance:   'Solde',
      warranty:  'Garantie',
      condition: 'État',
    },
    // Messages
    messages: {
      loading:       'Chargement...',
      saving:        'Enregistrement...',
      saved:         'Enregistré avec succès',
      error:         'Une erreur est survenue',
      deleted:       'Supprimé avec succès',
      noData:        'Aucune donnée',
      confirmDelete: 'Confirmer la suppression ?',
      overridePin:   'Code de dérogation (4 chiffres)',
      belowMinPrice: 'Prix inférieur au minimum autorisé',
      scanImei:      'Scanner IMEI / Code-barres',
      caisseOpen:    'La caisse est ouverte',
      caisseClosed:  'La caisse est fermée',
    },
    // POS
    pos: {
      title:        'Point de vente',
      searchDevice: 'Rechercher un appareil (IMEI, marque, modèle...)',
      client:       'Client',
      newClient:    'Nouveau client',
      payment:      'Paiement',
      exchange:     'Échange',
      subtotal:     'Sous-total',
      discount:     'Remise',
      finalize:     'Finaliser la vente',
      receipt:      'Imprimer le reçu',
    },
  },

  ar: {
    nav: {
      dashboard:   'لوحة التحكم',
      pos:         'نقطة البيع',
      phones:      'الهواتف',
      laptops:     'اللابتوبات',
      accessories: 'الإكسسوارات',
      repairs:     'الإصلاحات',
      clients:     'العملاء',
      suppliers:   'الموردون',
      expenses:    'المصاريف',
      caisse:      'صندوق اليوم',
      movements:   'التنقلات',
      admin:       'الإدارة',
      stock:       'المخزون',
    },
    actions: {
      add:        'إضافة',
      edit:       'تعديل',
      delete:     'حذف',
      save:       'حفظ',
      cancel:     'إلغاء',
      search:     'بحث',
      filter:     'تصفية',
      export:     'تصدير',
      print:      'طباعة',
      scan:       'مسح',
      confirm:    'تأكيد',
      close:      'إغلاق',
      open:       'فتح',
      view:       'عرض',
      refresh:    'تحديث',
    },
    status: {
      'متوفر':       'متوفر',
      'مباع':        'مباع',
      'إستبدال':     'إستبدال',
      'إصلاح':       'قيد الإصلاح',
      'معلق':        'معلق',
      'قيد الإصلاح': 'قيد الإصلاح',
      'جاهز':        'جاهز',
      'تم الاستلام': 'تم الاستلام',
      'نفذ':         'نفذ',
      'تحذير':       'مخزون منخفض',
    },
    condition: {
      'جديد':    'جديد',
      'مستعمل':  'مستعمل',
      'معطوب':   'معطوب',
    },
    payment: {
      'نقد':      'نقد',
      'تحويل':    'تحويل',
      'تسبيق':    'تسبيق',
      'إستبدال':  'إستبدال',
      'مختلط':    'مختلط',
    },
    paymentStatus: {
      '✅ مسدد':       '✅ مسدد',
      '🔵 متبقي':     '🔵 متبقي',
      '⚠️ زيادة دفع': '⚠️ زيادة دفع',
    },
    operation: {
      'بيع':      'بيع',
      'إستبدال':  'إستبدال',
      'تسبيق':    'تسبيق',
      'Retour':   'إرجاع',
    },
    repair: {
      'معلق':        'معلق',
      'قيد الإصلاح': 'قيد الإصلاح',
      'جاهز':        'جاهز',
      'تم الاستلام': 'تم الاستلام',
    },
    source: {
      'Fournisseur': 'مورد',
      'Reprise':     'استرداد',
      'Échange':     'مبادلة',
    },
    accCategory: {
      'كفر':    'كفر',
      'شاحن':   'شاحن',
      'سماعة':  'سماعة',
      'واقي':   'واقي',
      'سيم':    'سيم',
      'أخرى':   'أخرى',
    },
    fields: {
      name:      'الاسم',
      phone:     'الهاتف',
      price:     'السعر',
      quantity:  'الكمية',
      brand:     'الماركة',
      model:     'الموديل',
      storage:   'التخزين',
      ram:       'الرام',
      color:     'اللون',
      battery:   'البطارية',
      imei:      'الرقم التسلسلي',
      serial:    'الرقم التسلسلي',
      status:    'الحالة',
      location:  'الموقع',
      date:      'التاريخ',
      notes:     'ملاحظات',
      client:    'العميل',
      amount:    'المبلغ',
      total:     'الإجمالي',
      balance:   'الرصيد',
      warranty:  'الضمان',
      condition: 'الحالة',
    },
    messages: {
      loading:       'جارٍ التحميل...',
      saving:        'جارٍ الحفظ...',
      saved:         'تم الحفظ بنجاح',
      error:         'حدث خطأ',
      deleted:       'تم الحذف بنجاح',
      noData:        'لا توجد بيانات',
      confirmDelete: 'تأكيد الحذف؟',
      overridePin:   'رمز التجاوز (4 أرقام)',
      belowMinPrice: 'السعر أقل من الحد المسموح',
      scanImei:      'مسح الرمز',
      caisseOpen:    'الصندوق مفتوح',
      caisseClosed:  'الصندوق مغلق',
    },
    pos: {
      title:        'نقطة البيع',
      searchDevice: 'بحث عن جهاز (IMEI، ماركة، موديل...)',
      client:       'العميل',
      newClient:    'عميل جديد',
      payment:      'الدفع',
      exchange:     'المبادلة',
      subtotal:     'المجموع الجزئي',
      discount:     'الخصم',
      finalize:     'إتمام البيع',
      receipt:      'طباعة الفاتورة',
    },
  }
} as const

export type TranslationKeys = typeof translations['fr']
I18N

# ── src/lib/stores/language.ts ────────────────────────────────
cat > src/lib/stores/language.ts << 'LANGSTORE'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language } from '@/lib/i18n/translations'
import { translations } from '@/lib/i18n/translations'

interface LanguageStore {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set, get) => ({
      language: 'fr',
      setLanguage: (language) => set({ language }),
      t: (key: string) => {
        const lang = get().language
        const keys = key.split('.')
        let value: unknown = translations[lang]
        for (const k of keys) {
          if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[k]
          } else {
            return key
          }
        }
        return typeof value === 'string' ? value : key
      },
    }),
    { name: 'ez-language' }
  )
)

// Convenience hook
export function useTranslation() {
  return useLanguageStore((s) => s.t)
}

// Translate a stored Arabic value (status, payment method, etc.)
export function useTranslateValue() {
  const lang = useLanguageStore((s) => s.language)
  return (key: string, category: keyof typeof translations['fr']): string => {
    const map = (translations[lang] as Record<string, Record<string, string>>)[category]
    return map?.[key] ?? key
  }
}
LANGSTORE

# ── src/lib/utils/index.ts ────────────────────────────────────
cat > src/lib/utils/index.ts << 'UTILS'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number as MAD currency */
export function formatMAD(amount: number | null | undefined): string {
  if (amount == null) return '— MAD'
  return new Intl.NumberFormat('fr-MA', {
    style: 'currency',
    currency: 'MAD',
    minimumFractionDigits: 2,
  }).format(amount)
}

/** Format date to DD/MM/YYYY */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR')
}

/** Compute FARIQ for a transaction */
export function computeFariq(prixVente: number, avance = 0, valeurEchange = 0): number {
  return prixVente - avance - valeurEchange
}

/** Compute STATUT_PAIEMENT */
export function computeStatutPaiement(fariq: number): '✅ مسدد' | '🔵 متبقي' | '⚠️ زيادة دفع' {
  if (fariq === 0) return '✅ مسدد'
  if (fariq > 0)  return '🔵 متبقي'
  return '⚠️ زيادة دفع'
}

/** Compute WARRANTY_EXPIRY: start + (months × 30 days) */
export function computeWarrantyExpiry(startDate: string, months: number): Date {
  const start = new Date(startDate)
  start.setDate(start.getDate() + months * 30)
  return start
}

/** Get warranty flag */
export function getWarrantyFlag(expiryDate: string | null | undefined): '🟢' | '🟡' | '🔴' | null {
  if (!expiryDate) return null
  const expiry = new Date(expiryDate)
  const today = new Date()
  const diffDays = Math.floor((expiry.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0)  return '🔴'
  if (diffDays <= 30) return '🟡'
  return '🟢'
}

/** Check if price is below minimum (requires override) */
export function isBelowMinimum(price: number, minimum: number | null | undefined): boolean {
  if (!minimum) return false
  return price < minimum
}

/** Moroccan phone number validation */
export function isValidMoroccanPhone(phone: string): boolean {
  return /^0[67]\d{8}$/.test(phone.replace(/\s/g, ''))
}

/** Generate EZ-ACC barcode ID */
export function generateBarcodeId(accId: string): string {
  return accId // acc_id already follows EZ-ACC-000001 format
}
UTILS

# ── src/app/layout.tsx ────────────────────────────────────────
cat > src/app/layout.tsx << 'ROOTLAYOUT'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Electro Zaki',
  description: 'Système de gestion — Electro Zaki',
  manifest: '/manifest.json',
  icons: { apple: '/icons/icon-192x192.png' },
}

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className={`${inter.variable} font-body bg-ez-black text-ez-text antialiased`}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1A1A1A',
              color: '#E5E5E5',
              border: '1px solid #2A2A2A',
            },
          }}
        />
      </body>
    </html>
  )
}
ROOTLAYOUT

# ── src/app/(auth)/login/page.tsx ─────────────────────────────
cat > "src/app/(auth)/login/page.tsx" << 'LOGINPAGE'
// Login page — full implementation comes in Phase 3 step 3
// Scaffold only
export default function LoginPage() {
  return (
    <div className="min-h-screen bg-ez-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-gold tracking-wider">ELECTRO ZAKI</h1>
          <p className="text-ez-subtle text-sm mt-1">Système de gestion v3.0</p>
        </div>
        <div className="bg-ez-dark border border-ez-border rounded-lg p-6 shadow-ez-lg">
          <p className="text-ez-subtle text-center text-sm">
            Connexion — à implémenter (Phase 3)
          </p>
        </div>
      </div>
    </div>
  )
}
LOGINPAGE

# ── src/app/(dashboard)/layout.tsx ───────────────────────────
cat > "src/app/(dashboard)/layout.tsx" << 'DASHLAYOUT'
// Dashboard shell layout — full implementation in Phase 3 step 4
// Scaffold only
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-ez-black overflow-hidden">
      {/* Sidebar — Phase 3 */}
      <aside className="w-64 bg-ez-dark border-r border-ez-border hidden lg:flex flex-col">
        <div className="p-4 border-b border-ez-border">
          <span className="font-display text-xl text-gold font-bold tracking-wider">ELECTRO ZAKI</span>
        </div>
        <nav className="flex-1 p-3">
          <p className="text-ez-subtle text-xs">Navigation — Phase 3</p>
        </nav>
      </aside>
      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
DASHLAYOUT

# ── src/app/(dashboard)/page.tsx ─────────────────────────────
cat > "src/app/(dashboard)/page.tsx" << 'DASHPAGE'
// Dashboard — scaffold only, full implementation in Phase 6
export default function DashboardPage() {
  return (
    <div className="p-6 animate-fade-in">
      <h1 className="font-display text-3xl font-bold text-gold mb-6">Tableau de bord</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {['CA du jour', 'Ventes ce mois', 'Réparations actives', 'Stock critique'].map((label) => (
          <div key={label} className="bg-ez-dark border border-ez-border rounded-lg p-4 shadow-ez-sm">
            <p className="text-ez-subtle text-xs">{label}</p>
            <p className="text-2xl font-display font-bold text-ez-text mt-1">—</p>
          </div>
        ))}
      </div>
      <p className="text-ez-subtle text-sm mt-8">Modules — implémentation Phase 4–6</p>
    </div>
  )
}
DASHPAGE

# ── Module placeholder pages ──────────────────────────────────
for module in pos repairs clients suppliers expenses caisse movements admin; do
  cat > "src/app/(dashboard)/${module}/page.tsx" << PLACEHOLDER
export default function Page() {
  return (
    <div className="p-6">
      <h1 className="font-display text-3xl font-bold text-gold capitalize">${module}</h1>
      <p className="text-ez-subtle text-sm mt-2">Module à implémenter</p>
    </div>
  )
}
PLACEHOLDER
done

for sub in phones laptops accessories; do
  cat > "src/app/(dashboard)/stock/${sub}/page.tsx" << PLACEHOLDER
export default function Page() {
  return (
    <div className="p-6">
      <h1 className="font-display text-3xl font-bold text-gold capitalize">${sub}</h1>
      <p className="text-ez-subtle text-sm mt-2">Module à implémenter</p>
    </div>
  )
}
PLACEHOLDER
done

# ── PWA manifest ──────────────────────────────────────────────
cat > public/manifest.json << 'MANIFEST'
{
  "name": "Electro Zaki",
  "short_name": "EZ",
  "description": "Système de gestion Electro Zaki",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0A0A0A",
  "theme_color": "#C9A440",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512x512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
MANIFEST

# ── .gitignore additions ──────────────────────────────────────
echo ".env.local" >> .gitignore
echo ".env*.local" >> .gitignore

# ── README.md ─────────────────────────────────────────────────
cat > README.md << 'README'
# ⚡ Electro Zaki — Terminal v3.0

Business management system for Electro Zaki phone store, built with Next.js + Supabase + Vercel.

## Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Database:** Supabase (PostgreSQL + Auth + Realtime + RLS)
- **Deployment:** Vercel (auto-deploy from GitHub)
- **PWA:** Installable on Android/iOS (next-pwa)

## Setup

### 1. Database (Supabase)
1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase_schema.sql`
3. Go to **Authentication > Users** → create 3 users (owner, manager, staff)
4. For each user, set `app_metadata.role` in the Supabase Dashboard

### 2. Local Development
```bash
cp .env.local.example .env.local
# Fill in your Supabase keys
npm run dev
```

### 3. Deploy to Vercel
1. Push to GitHub
2. Connect repo in Vercel dashboard
3. Add environment variables (same as .env.local)
4. Deploy

## Build Phases
- ✅ Phase 1 — Google Sheets foundation (complete)
- ✅ Phase 2 — Supabase schema (complete — run supabase_schema.sql)
- ✅ Phase 3 — Project scaffold (complete — this repo)
- 🔲 Phase 4 — Core modules (POS, Stock, Repairs)
- 🔲 Phase 5 — Operations (Clients, Suppliers, Expenses)
- 🔲 Phase 6 — Intelligence (Dashboard, Caisse, Reports)
- 🔲 Phase 7 — Print & Polish (Labels, Receipts, PWA)

## Commands
```bash
npm run dev      # Local dev (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```
README

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║        ✅ Scaffold complete!              ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "  Next steps:"
echo "  1. Fill in .env.local with your Supabase keys"
echo "  2. Run the SQL schema in Supabase SQL Editor"
echo "  3. npm run dev"
echo ""
