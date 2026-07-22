// ============================================================
//  BZG GROUP — Supabase Database Types
//  Matches live schema exactly — update here after every SQL migration
// ============================================================

// ─── Enums ───────────────────────────────────────────────────
export type UserRole         = 'staff' | 'manager' | 'owner'
export type DeviceSource     = 'Fournisseur' | 'Reprise' | 'Échange'
export type DeviceCondition  = 'جديد' | 'مستعمل' | 'معطوب'
export type DeviceStatus     = 'متوفر' | 'مباع' | 'إستبدال' | 'إصلاح'
export type LocationType     = 'Magasin Principal' | 'Magasin Secondaire' | 'Externe'
export type OperationType    = 'بيع' | 'إستبدال' | 'تسبيق' | 'Retour'
export type PaymentMethod    = 'نقد' | 'تحويل' | 'تسبيق' | 'إستبدال' | 'مختلط' | 'آجل'
export type RepairStatus     = 'معلق' | 'قيد الإصلاح' | 'جاهز' | 'تم الاستلام'
export type MovementReason   = 'Transfert' | 'Réparation Externe' | 'Retour' | 'Prêt'
export type DeviceType       = 'هاتف' | 'لابتوب' | 'إكسسوار'
// These are now open strings — values are managed via BZG Settings → Catégories
export type AccCategory      = string
export type SupplierCategory = string
export type ExpenseCategory  = string
export type CaisseStatus     = 'open' | 'pending_eod' | 'closed'
export type PunchType        = 'in' | 'out'
export type ActionType       = 'INSERT' | 'UPDATE' | 'DELETE' | 'VOID' | 'LOGIN' | 'LOGOUT' | 'OVERRIDE' | 'EOD_SUBMIT' | 'EOD_APPROVE' | 'EOD_REJECT' | 'PUNCH_IN' | 'PUNCH_OUT'
export type LogModule        = 'phones' | 'laptops' | 'accessories' | 'transactions' | 'reparations' | 'clients' | 'suppliers' | 'supplier_payments' | 'expenses' | 'caisse' | 'stock_movements' | 'users' | 'settings' | 'auth' | 'attendance' | 'changelog' | 'repairs/parts' | 'cash_drops' | 'credits' | 'credit_imports' | 'prospects' | 'inventaire'

// ─── Interfaces ───────────────────────────────────────────────

export interface Store {
  store_id:    string
  name:        string
  theme_color: string
  logo_url?:   string | null
  address?:    string | null
  phone?:      string | null
  is_active:   boolean
  created_at:  string
}

export interface UserProfile {
  id:           string
  display_name: string
  role:         UserRole
  // override_pin intentionally omitted — server-side only (verify-override route)
  is_active: boolean
  store_id:     string | null
  avatar_url:   string | null
  store_locked: boolean
  created_at:   string
  updated_at:   string
}

export interface Phone {
  phone_id:               string
  imei?:                  string | null
  source:                 DeviceSource
  fournisseur_id?:        string | null
  txn_ref_id?:            string | null
  condition:              DeviceCondition
  marque:                 string
  serie?:                 string | null
  type?:                  string | null
  couleur?:               string | null
  model:                  string
  stockage?:              string | null
  battery_level?:         number | null
  ram?:                   string | null
  description?:           string | null
  icloud_compte?:         string | null
  icloud_mdp?:            string | null
  prix_achat?:            number | null
  prix_vente_recommande?: number | null
  prix_vente_minimum?:    number | null
  warranty_months?:       number | null
  status:                 DeviceStatus
  location:               LocationType
  store_id?:              string | null
  date_entree?:           string | null
  image_url?:             string | null
  created_at:             string
  created_by?:            string | null
  updated_at:             string
  updated_by?:            string | null
  replaced_components?:    ReplacedComponent[] | null
  is_damaged?:             boolean | null
  damage_notes?:           string | null
  promo_type?:             'valeur' | 'pourcentage' | null
  promo_montant?:          number | null
}

export interface ReplacedComponent {
  name:      string
  condition: 'original' | 'standard'
}

export type ProspectStatus   = 'Nouveau' | 'Contacté' | 'Converti' | 'Perdu'
export type ProspectDemand   = 'modele' | 'budget'
export type ProspectSource   = 'TikTok' | 'Instagram' | 'WhatsApp' | 'En magasin' | 'Autre'

export interface Prospect {
  prospect_id:  string
  store_id:     string
  nom:          string
  telephone?:   string | null
  source:       ProspectSource
  demand_type:  ProspectDemand
  marque?:      string | null
  model?:       string | null
  stockage?:    string | null
  budget_max?:  number | null
  notes?:       string | null
  statut:       ProspectStatus
  created_at:   string
  created_by?:  string | null
  updated_at:   string
  updated_by?:  string | null
  is_deleted:   boolean
}

export interface Laptop {
  laptop_id:              string
  serial?:                string | null
  source:                 DeviceSource
  fournisseur_id?:        string | null
  txn_ref_id?:            string | null
  condition:              DeviceCondition
  marque:                 string
  model:                  string
  processeur?:            string | null
  carte_graphique?:       string | null
  stockage?:              string | null
  ram?:                   string | null
  ecran?:                 string | null
  battery_level?:         number | null
  couleur?:               string | null
  description?:           string | null
  prix_achat?:            number | null
  prix_vente_recommande?: number | null
  prix_vente_minimum?:    number | null
  warranty_months?:       number | null
  status:                 DeviceStatus
  location:               LocationType
  store_id?:              string | null
  date_entree?:           string | null
  notes?:                 string | null
  image_url?:             string | null
  created_at:             string
  created_by?:            string | null
  updated_at:             string
  updated_by?:            string | null
}

export interface Accessory {
  acc_id:                 string
  barcode?:               string | null
  nom:                    string
  categorie:              AccCategory
  marque?:                string | null
  compatible_with?:       string | null
  prix_achat?:            number | null
  prix_vente_recommande?: number | null
  prix_vente_minimum?:    number | null
  quantite:               number
  seuil_alerte:           number
  fournisseur_id?:        string | null
  location:               LocationType
  store_id?:              string | null
  image_url?:             string | null
  created_at:             string
  created_by?:            string | null
  updated_at:             string
  updated_by?:            string | null
  status_computed?:       'متوفر' | 'تحذير' | 'نفذ'
  is_low_stock?:          boolean
}

export interface Transaction {
  txn_id:               string
  device_type:          DeviceType
  device_id:            string
  client_id?:           string | null
  type_operation:       OperationType
  txn_original_id?:     string | null
  prix_vente:           number
  date_vente:           string
  avance?:              number | null
  date_avance?:         string | null
  payment_method:       PaymentMethod
  montant_especes?:     number | null
  montant_carte?:       number | null
  montant_rendu?:       number | null
  payment_ref?:         string | null
  valeur_echange?:      number | null
  marque_echange?:      string | null
  model_echange?:       string | null
  stockage_echange?:    string | null
  ram_echange?:         string | null
  etat_batterie_echange?: number | null
  imei_echange?:        string | null
  description_echange?: string | null
  warranty_start?:      string | null
  warranty_expiry?:     string | null
  override_required?:   boolean | null
  override_by?:         string | null
  override_reason?:     string | null
  store_id?:            string | null
  notes?:               string | null
  created_at:           string
  created_by?:          string | null
  updated_at:           string
  updated_by?:          string | null
  fariq?:               number
  statut_paiement?:     '✅ مسدد' | '🔵 متبقي' | '⚠️ زيادة دفع'
}

export interface Reparation {
  rep_id:            string
  client_id?:        string | null
  device_type_libre?: string | null
  device_serial?:    string | null
  marque?:           string | null
  model:             string
  probleme:          string
  diagnostic?:       string | null
  cout_reparation?:  number | null
  avance_rep?:       number | null
  date_avance_rep?:  string | null
  statut:            RepairStatus
  date_depot:        string
  date_prevue?:      string | null
  date_livraison?:   string | null
  technicien?:       string | null
  technicien_id?:    string | null
  whatsapp_notified?: boolean | null
  store_id?:         string | null
  notes?:            string | null
  created_at:        string
  created_by?:       string | null
  updated_at:        string
  updated_by?:       string | null
  fariq_rep?:        number
}

export interface ReparationPart {
  part_id:      string
  rep_id:       string
  description:  string
  cout:         number
  fournisseur?: string | null
  date_achat?:  string | null
  created_at:   string
  created_by?:  string | null
}

export interface Client {
  client_id:           string
  nom:                 string
  telephone:           string
  telephone_2?:        string | null
  email?:              string | null
  adresse?:            string | null
  date_premier_achat?: string | null
  store_id?:           string | null
  notes?:              string | null
  created_at:          string
  created_by?:         string | null
  updated_at:          string
  updated_by?:         string | null
  total_ca?:           number
  solde_impaye?:       number
  total_reparations?:  number
}

export interface Supplier {
  supplier_id:  string
  nom:          string
  telephone?:   string | null
  email?:       string | null
  adresse?:     string | null
  ville?:       string | null
  categorie?:   SupplierCategory | null
  store_id?:    string | null
  notes?:       string | null
  created_at:   string
  created_by?:  string | null
  updated_at:   string
  updated_by?:  string | null
  total_achats?: number
  total_paye?:   number
  solde_du?:     number
}

export interface SupplierPayment {
  payment_id:     string
  supplier_id:    string
  montant:        number
  payment_method: PaymentMethod
  payment_ref?:   string | null
  facture_ref?:   string | null
  date_paiement:  string
  store_id?:      string | null
  notes?:         string | null
  created_at:     string
  created_by?:    string | null
  updated_at:     string
  updated_by?:    string | null
}

export interface Expense {
  exp_id:             string
  categorie:          ExpenseCategory
  montant:            number
  date:               string
  fournisseur_id?:    string | null
  facture_ref?:       string | null
  receipt_photo_url?: string | null
  store_id?:          string | null
  notes?:             string | null
  created_at:         string
  created_by?:        string | null
  updated_at:         string
  updated_by?:        string | null
}

export interface Caisse {
  caisse_id:         string
  date:              string
  ouverture:         number
  total_ventes?:     number | null
  total_reparations?: number | null
  total_depenses?:   number | null
  solde_theorique?:  number | null
  solde_reel?:       number | null
  ecart?:            number | null
  payment_breakdown?: { cash: number; transfer: number; credit: number } | null
  status:            CaisseStatus
  eod_submitted_at?: string | null
  approved_by?:      string | null
  approved_at?:      string | null
  rejection_note?:   string | null
  store_id?:         string | null
  notes?:            string | null
  closed_by?:        string | null
  closed_at?:        string | null
  created_at:        string
  created_by?:       string | null
}

export interface StockMovement {
  movement_id:    string
  device_type:    DeviceType
  device_id:      string
  quantity:       number
  from_location:  LocationType
  to_location:    LocationType
  external_name?: string | null
  reason:         MovementReason
  store_id?:      string | null
  notes?:         string | null
  moved_by?:      string | null
  moved_at:       string
  created_at:     string
  created_by?:    string | null
}

export interface Setting {
  key:        string
  value?:     string | null
  notes?:     string | null
  updated_at: string
  updated_by?: string | null
}

export interface ActivityLog {
  log_id:       string
  store_id?:    string | null
  user_id?:     string | null
  user_name:    string
  action_type:  ActionType
  module:       LogModule
  record_id?:   string | null
  before_state?: Record<string, unknown> | null
  after_state?:  Record<string, unknown> | null
  ip_address?:  string | null
  notes?:       string | null
  created_at:   string
}

export interface StaffAttendance {
  attendance_id: string
  store_id:      string
  user_id:       string
  user_name:     string
  punch_type:    PunchType
  punched_at:    string
  date:          string
  notes?:        string | null
  created_at:    string
}

export interface PlatformChangelog {
  change_id:       string
  title:           string
  description?:    string | null
  affected_module?: string | null
  version_tag?:    string | null
  author:          string
  changed_at:      string
  created_at:      string
  created_by?:     string | null
}

// ── Inventory ──────────────────────────────────────────────
export type InventoryResultat =
  | 'en_attente'
  | 'trouvé'
  | 'manquant'
  | 'non_enregistré'
  | 'hors_périmètre'

export interface InventorySession {
  session_id:     string
  store_id:       string
  created_by:     string
  started_at:     string
  completed_at:   string | null
  statut:         'en_cours' | 'terminée'
  snapshot_count: number
}

export interface InventorySessionItem {
  item_id:      string
  session_id:   string
  phone_id:     string | null   // TEXT — peut contenir PHO-XXX ou UUID selon l'origine   // TEXT — peut contenir PHO-XXX ou UUID selon l'origine
  imei:         string
  phone_label:  string | null
  phone_status: string | null
  resultat:     InventoryResultat
  scanned_at:   string | null
}

// ─── Database shape for typed Supabase client ─────────────────
export interface Database {
  public: {
    Tables: {
      phone_catalog: {
        Row:    { catalog_id: string; marque: string; serie: string; type: string; model: string; couleur: string; created_at: string }
        Insert: { catalog_id?: string; marque: string; serie: string; type: string; model: string; couleur: string; created_at?: string }
        Update: { catalog_id?: string; marque?: string; serie?: string; type?: string; model?: string; couleur?: string; created_at?: string }
      }
      stores: {
        Row:    Store
        Insert: Partial<Store>
        Update: Partial<Store>
      }
      user_profiles: {
        Row:    UserProfile
        Insert: Partial<UserProfile>
        Update: Partial<UserProfile>
      }
      phones: {
        Row:    Phone
        Insert: Partial<Phone>
        Update: Partial<Phone>
      }
      laptops: {
        Row:    Laptop
        Insert: Partial<Laptop>
        Update: Partial<Laptop>
      }
      accessories: {
        Row:    Accessory
        Insert: Partial<Accessory>
        Update: Partial<Accessory>
      }
      transactions: {
        Row:    Transaction
        Insert: Partial<Transaction>
        Update: Partial<Transaction>
      }
      reparations: {
        Row:    Reparation
        Insert: Partial<Reparation>
        Update: Partial<Reparation>
      }
      reparations_parts: {
        Row:    ReparationPart
        Insert: Partial<ReparationPart>
        Update: Partial<ReparationPart>
      }
      clients: {
        Row:    Client
        Insert: Partial<Client>
        Update: Partial<Client>
      }
      suppliers: {
        Row:    Supplier
        Insert: Partial<Supplier>
        Update: Partial<Supplier>
      }
      supplier_payments: {
        Row:    SupplierPayment
        Insert: Partial<SupplierPayment>
        Update: Partial<SupplierPayment>
      }
      expenses: {
        Row:    Expense
        Insert: Partial<Expense>
        Update: Partial<Expense>
      }
      caisse: {
        Row:    Caisse
        Insert: Partial<Caisse>
        Update: Partial<Caisse>
      }
      stock_movements: {
        Row:    StockMovement
        Insert: Partial<StockMovement>
        Update: Partial<StockMovement>
      }
      settings: {
        Row:    Setting
        Insert: Partial<Setting>
        Update: Partial<Setting>
      }
      activity_log: {
        Row:    ActivityLog
        Insert: Partial<ActivityLog>
        Update: Partial<ActivityLog>
      }
      staff_attendance: {
        Row:    StaffAttendance
        Insert: Partial<StaffAttendance>
        Update: Partial<StaffAttendance>
      }
      platform_changelog: {
        Row:    PlatformChangelog
        Insert: Partial<PlatformChangelog>
        Update: Partial<PlatformChangelog>
      }
    }
    Views: {
  client_summary:          { Row: Client }
  supplier_summary:        { Row: Supplier }
  accessories_with_status: { Row: Accessory & { status_computed: string; is_low_stock: boolean } }
}
Functions: {
  get_user_role:        { Args: Record<never, never>; Returns: string }
  get_user_store:       { Args: Record<never, never>; Returns: string }
  verify_override_pin:  { Args: { p_pin: string };    Returns: string | null }
  get_dashboard_kpis:   { Args: { p_store_id: string }; Returns: { ca_today: number; nb_ventes_today: number; ca_month: number; nb_ventes_month: number; total_credit_open: number }[] }
    }
  }
}