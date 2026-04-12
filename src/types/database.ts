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
