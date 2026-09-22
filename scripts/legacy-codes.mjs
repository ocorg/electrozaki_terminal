// Translation of the values stored by the Supabase app (Arabic / English /
// accented French) into the French codes used by the Neon schema
// (see src/lib/codes.ts). Only needed until cut-over.

export const LEGACY = {
  device_status:    { 'متوفر': 'disponible', 'مباع': 'vendu', 'إستبدال': 'echange', 'إصلاح': 'en_reparation', en_livraison: 'en_livraison', en_transfert: 'en_transfert', 'حجز': 'reserve' },
  device_condition: { 'جديد': 'neuf', 'مستعمل': 'occasion', 'معطوب': 'defectueux' },
  device_source:    { Fournisseur: 'fournisseur', Reprise: 'reprise', 'Échange': 'echange' },
  device_type:      { 'هاتف': 'telephone', 'لابتوب': 'laptop', 'إكسسوار': 'accessoire' },
  location_type:    { 'Magasin Principal': 'magasin_principal', 'Magasin Secondaire': 'magasin_secondaire', Externe: 'externe' },
  movement_reason:  { Transfert: 'transfert', 'Réparation Externe': 'reparation_externe', Retour: 'retour', 'Prêt': 'pret' },
  operation_type:   { 'بيع': 'vente', 'إستبدال': 'echange', 'تسبيق': 'avance', Retour: 'retour' },
  payment_method:   { 'نقد': 'especes', 'تحويل': 'virement', 'تسبيق': 'avance', 'إستبدال': 'echange', 'مختلط': 'mixte', 'آجل': 'credit' },
  repair_status:    { 'معلق': 'en_attente', 'قيد الإصلاح': 'en_cours', 'جاهز': 'pret', 'تم الاستلام': 'recupere' },
  user_role:        { staff: 'employe', manager: 'gerant', owner: 'proprietaire' },
  caisse_status:    { open: 'ouverte', pending_eod: 'en_attente_cloture', closed: 'cloturee' },
  punch_type:       { in: 'entree', out: 'sortie' },
  delivery_status:  { confirmation_encours: 'confirmation_en_cours', attente_avance: 'attente_avance', prepare: 'prepare', en_transit: 'en_transit', livre: 'livre', annule: 'annule', retour: 'retour' },
  payment_scenario: { full_advance: 'avance_totale', partial_advance: 'avance_partielle', on_delivery: 'paiement_livraison' },
  credit_status:    { en_cours: 'en_cours', 'soldé': 'solde', solde: 'solde', annule: 'annule' },
  supplier_payment_type: { REGLEMENT_A: 'reglement_a', AVANCE_A: 'avance_a', PAIEMENT_B: 'paiement_b' },
  warranty_event_type:   { SAV_OPEN: 'ouverture_sav', SAV_CLOSE: 'cloture_sav' },
  inventory_status: { en_cours: 'en_cours', 'terminée': 'terminee' },
  inventory_result: { 'trouvé': 'trouve', manquant: 'manquant', 'non_enregistré': 'non_enregistre', 'hors_périmètre': 'hors_perimetre', en_attente: 'en_attente' },
  prospect_source:  { TikTok: 'tiktok', Instagram: 'instagram', WhatsApp: 'whatsapp', 'En magasin': 'en_magasin', Autre: 'autre' },
  prospect_status:  { Nouveau: 'nouveau', 'Contacté': 'contacte', Converti: 'converti', Perdu: 'perdu' },
  prospect_demand:  { budget: 'budget', modele: 'modele' },
  promo_type:       { valeur: 'valeur', pourcentage: 'pourcentage' },
  reprise_etat:     { bon: 'bon', moyen: 'moyen', mauvais: 'mauvais' },
  log_action: {
    INSERT: 'creation', UPDATE: 'modification', DELETE: 'suppression', LOGIN: 'connexion', LOGOUT: 'deconnexion',
    OVERRIDE: 'derogation', EOD_SUBMIT: 'soumission_cloture', EOD_APPROVE: 'validation_cloture', EOD_REJECT: 'rejet_cloture',
    PUNCH_IN: 'pointage_entree', PUNCH_OUT: 'pointage_sortie', USER_CREATE: 'creation_utilisateur', VOID: 'annulation',
  },
  log_module: {
    phones: 'telephones', laptops: 'laptops', accessories: 'accessoires', transactions: 'transactions', reparations: 'reparations',
    'repairs/parts': 'pieces_reparation', clients: 'clients', suppliers: 'fournisseurs', supplier_payments: 'paiements_fournisseurs',
    expenses: 'depenses', caisse: 'caisse', cash_drops: 'encaissements_manuels', stock_movements: 'mouvements_stock',
    users: 'utilisateurs', settings: 'parametres', auth: 'authentification', attendance: 'pointage', changelog: 'journal_modifications',
    credits: 'credits', credit_imports: 'credits_importes', prospects: 'prospects', inventaire: 'inventaire',
  },
}

// table.column → code domain (each domain is a Postgres enum in Neon)
export const COLUMN_DOMAINS = {
  'phones.status': 'device_status', 'laptops.status': 'device_status', 'inventory_session_items.phone_status': 'device_status',
  'phones.condition': 'device_condition', 'laptops.condition': 'device_condition',
  'phones.source': 'device_source', 'laptops.source': 'device_source',
  'transactions.device_type': 'device_type', 'stock_movements.device_type': 'device_type', 'delivery_items.device_type': 'device_type',
  'accessories.location': 'location_type', 'phones.location': 'location_type', 'laptops.location': 'location_type',
  'stock_movements.from_location': 'location_type', 'stock_movements.to_location': 'location_type',
  'stock_movements.reason': 'movement_reason',
  'transactions.type_operation': 'operation_type',
  'transactions.payment_method': 'payment_method', 'deliveries.payment_method': 'payment_method',
  'supplier_payments.payment_method': 'payment_method', 'credit_payments.payment_method': 'payment_method',
  'credit_import_payments.payment_method': 'payment_method', 'phone_credit_payments.payment_method': 'payment_method',
  'reparations.statut': 'repair_status',
  'user_profiles.role': 'user_role',
  'caisse.status': 'caisse_status',
  'staff_attendance.punch_type': 'punch_type',
  'deliveries.statut': 'delivery_status', 'deliveries.payment_scenario': 'payment_scenario',
  'credit_imports.statut': 'credit_status', 'phone_credit_sales.statut': 'credit_status',
  'supplier_payments.payment_type': 'supplier_payment_type',
  'warranty_events.event_type': 'warranty_event_type',
  'inventory_sessions.statut': 'inventory_status', 'inventory_session_items.resultat': 'inventory_result',
  'prospects.source': 'prospect_source', 'prospects.statut': 'prospect_status', 'prospects.demand_type': 'prospect_demand',
  'phones.promo_type': 'promo_type',
  'phone_credit_sales.reprise_etat': 'reprise_etat',
  'activity_log.action_type': 'log_action', 'activity_log.module': 'log_module',
}

// Columns that now reference categories.code, and which settings list feeds them.
export const CATEGORY_COLUMNS = {
  'accessories.categorie': { type: 'accessoire',  settingsKey: 'categories_accessories' },
  'expenses.categorie':    { type: 'depense',     settingsKey: 'categories_expenses' },
  'suppliers.categorie':   { type: 'fournisseur', settingsKey: 'categories_suppliers' },
}

// Values in use that were never added to the category lists in Settings.
export const EXTRA_CATEGORIES = [
  { type: 'accessoire', fr: 'Protection', ar: 'واقي' },
  { type: 'accessoire', fr: 'Autre',      ar: 'أخرى' },
]

// Snapshot fields that mean the same thing whatever table they came from
// (used when the module's own tables don't have a column with that name).
export const SNAPSHOT_FIELDS = {
  payment_method:   'payment_method',
  new_phone_status: 'device_status',
  device_type:      'device_type',
  type_operation:   'operation_type',
  condition:        'device_condition',
}

// Legacy activity_log.module → tables its before/after snapshots come from.
export const MODULE_TABLES = {
  phones: ['phones'], laptops: ['laptops'], accessories: ['accessories'], transactions: ['transactions'],
  reparations: ['reparations'], 'repairs/parts': ['reparations_parts'], clients: ['clients'], suppliers: ['suppliers'],
  supplier_payments: ['supplier_payments'], expenses: ['expenses'], caisse: ['caisse'], cash_drops: ['cash_drops'],
  stock_movements: ['stock_movements'], users: ['user_profiles'], auth: ['user_profiles'], settings: ['settings'],
  attendance: ['staff_attendance'], changelog: ['platform_changelog'],
  credits: ['phone_credit_sales', 'phone_credit_payments', 'credit_payments'],
  credit_imports: ['credit_imports', 'credit_import_payments'], prospects: ['prospects'],
  inventaire: ['inventory_sessions', 'inventory_session_items'],
}

