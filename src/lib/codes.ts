// Fixed values are stored in the database as short French codes (lowercase,
// no accents, no spaces). Screens never show a code directly: they show
// CODES[domain][code][language]. Categories are user-editable and live in the
// `categories` table instead.
//
// Each domain matches a Postgres enum in prisma/schema.prisma — keep in sync.

export type Lang = 'fr' | 'ar'
type Labels = Record<string, { fr: string; ar: string }>

export const CODES = {
  device_status: {
    disponible:    { fr: 'Disponible',     ar: 'متوفر' },
    vendu:         { fr: 'Vendu',          ar: 'مباع' },
    echange:       { fr: 'Échangé',        ar: 'مستبدل' },
    en_reparation: { fr: 'En réparation',  ar: 'قيد الإصلاح' },
    en_livraison:  { fr: 'En livraison',   ar: 'قيد التوصيل' },
    en_transfert:  { fr: 'En transfert',   ar: 'قيد النقل' },
    reserve:       { fr: 'Réservé',        ar: 'محجوز' },
  },
  device_condition: {
    neuf:       { fr: 'Neuf',       ar: 'جديد' },
    occasion:   { fr: 'Occasion',   ar: 'مستعمل' },
    defectueux: { fr: 'Défectueux', ar: 'معطوب' },
  },
  device_source: {
    fournisseur: { fr: 'Fournisseur', ar: 'المورد' },
    reprise:     { fr: 'Reprise',     ar: 'إعادة شراء' },
    echange:     { fr: 'Échange',     ar: 'إستبدال' },
  },
  device_type: {
    telephone:  { fr: 'Téléphone',  ar: 'هاتف' },
    laptop:     { fr: 'Laptop',     ar: 'لابتوب' },
    accessoire: { fr: 'Accessoire', ar: 'إكسسوار' },
  },
  location_type: {
    magasin_principal:  { fr: 'Magasin principal',  ar: 'المحل الرئيسي' },
    magasin_secondaire: { fr: 'Magasin secondaire', ar: 'المحل الثاني' },
    externe:            { fr: 'Externe',            ar: 'خارجي' },
  },
  movement_reason: {
    transfert:          { fr: 'Transfert',          ar: 'نقل' },
    reparation_externe: { fr: 'Réparation externe', ar: 'إصلاح خارجي' },
    retour:             { fr: 'Retour',             ar: 'إرجاع' },
    pret:               { fr: 'Prêt',               ar: 'إعارة' },
  },
  operation_type: {
    vente:   { fr: 'Vente',   ar: 'بيع' },
    echange: { fr: 'Échange', ar: 'إستبدال' },
    avance:  { fr: 'Avance',  ar: 'تسبيق' },
    retour:  { fr: 'Retour',  ar: 'إرجاع' },
  },
  payment_method: {
    especes:  { fr: 'Espèces',  ar: 'نقد' },
    virement: { fr: 'Virement', ar: 'تحويل' },
    avance:   { fr: 'Avance',   ar: 'تسبيق' },
    echange:  { fr: 'Échange',  ar: 'إستبدال' },
    mixte:    { fr: 'Mixte',    ar: 'مختلط' },
    credit:   { fr: 'Crédit',   ar: 'آجل' },
  },
  repair_status: {
    en_attente:   { fr: 'En attente',   ar: 'معلق' },
    devis_envoye: { fr: 'Devis envoyé', ar: 'تم إرسال السعر' },
    en_cours:     { fr: 'En cours',     ar: 'قيد الإصلاح' },
    pret:       { fr: 'Prêt',       ar: 'جاهز' },
    recupere:   { fr: 'Récupéré',   ar: 'تم الاستلام' },
  },
  repair_kind: {
    materiel:     { fr: 'Matériel',             ar: 'عتاد' },
    logiciel:     { fr: 'Logiciel',             ar: 'برمجيات' },
    consultation: { fr: 'Consultation en ligne', ar: 'استشارة عن بعد' },
  },
  // Same keys as the website's repair form (electrozaki-storefront
  // lib/repair-problems.ts) — keep both lists in step.
  repair_problem: {
    ecran:          { fr: 'Écran',                                  ar: 'الشاشة' },
    batterie:       { fr: 'Batterie',                               ar: 'البطارية' },
    camera:         { fr: 'Appareil photo',                         ar: 'الكاميرا' },
    connecteur:     { fr: 'Port de charge',                         ar: 'منفذ الشحن' },
    son:            { fr: 'Son / Micro',                            ar: 'الصوت / الميكروفون' },
    reseau:         { fr: 'Désimlockage réseau',                    ar: 'فك الشبكة' },
    autre_materiel: { fr: 'Autre panne matérielle',                 ar: 'عطل عتاد آخر' },
    systeme_bloque: { fr: 'Bloqué / lent / redémarre en boucle',    ar: 'معطل / بطيء / يعيد التشغيل' },
    mise_a_jour:    { fr: 'Mise à jour / réinstallation',           ar: 'تحديث / إعادة تثبيت' },
    donnees:        { fr: 'Récupération & transfert de données',    ar: 'استرجاع ونقل البيانات' },
    compte_config:  { fr: 'Compte & configuration',                 ar: 'الحساب والإعدادات' },
    consultation:   { fr: 'Consultation / diagnostic à distance',   ar: 'استشارة / تشخيص عن بعد' },
  },
  user_role: {
    employe:      { fr: 'Employé',      ar: 'موظف' },
    gerant:       { fr: 'Gérant',       ar: 'مسير' },
    proprietaire: { fr: 'Propriétaire', ar: 'مالك' },
  },
  caisse_status: {
    ouverte:            { fr: 'Ouverte',            ar: 'مفتوح' },
    en_attente_cloture: { fr: 'Clôture en attente', ar: 'في انتظار الإغلاق' },
    cloturee:           { fr: 'Clôturée',           ar: 'مغلق' },
  },
  punch_type: {
    entree: { fr: 'Entrée', ar: 'دخول' },
    sortie: { fr: 'Sortie', ar: 'خروج' },
  },
  delivery_status: {
    confirmation_en_cours: { fr: 'Confirmation en cours', ar: 'قيد التأكيد' },
    attente_avance:        { fr: "En attente d'avance",   ar: 'في انتظار التسبيق' },
    prepare:               { fr: 'Préparé',               ar: 'جاهز' },
    en_transit:            { fr: 'En transit',            ar: 'في الطريق' },
    livre:                 { fr: 'Livré',                 ar: 'تم التوصيل' },
    annule:                { fr: 'Annulé',                ar: 'ملغى' },
    retour:                { fr: 'Retour',                ar: 'مرتجع' },
  },
  payment_scenario: {
    avance_totale:      { fr: 'Avance totale',        ar: 'تسبيق كامل' },
    avance_partielle:   { fr: 'Avance partielle',     ar: 'تسبيق جزئي' },
    paiement_livraison: { fr: 'Paiement à la livraison', ar: 'الدفع عند الاستلام' },
  },
  credit_status: {
    en_cours: { fr: 'En cours', ar: 'جاري' },
    solde:    { fr: 'Soldé',    ar: 'مسدد' },
    annule:   { fr: 'Annulé',   ar: 'ملغى' },
  },
  supplier_payment_type: {
    reglement_a: { fr: 'Règlement A', ar: 'تسوية A' },
    avance_a:    { fr: 'Avance A',    ar: 'تسبيق A' },
    paiement_b:  { fr: 'Paiement B',  ar: 'دفع B' },
  },
  warranty_event_type: {
    ouverture_sav: { fr: 'Ouverture SAV', ar: 'فتح خدمة ما بعد البيع' },
    cloture_sav:   { fr: 'Clôture SAV',   ar: 'إغلاق خدمة ما بعد البيع' },
  },
  inventory_status: {
    en_cours: { fr: 'En cours', ar: 'جاري' },
    terminee: { fr: 'Terminée', ar: 'منتهي' },
  },
  inventory_result: {
    trouve:         { fr: 'Trouvé',          ar: 'موجود' },
    manquant:       { fr: 'Manquant',        ar: 'مفقود' },
    non_enregistre: { fr: 'Non enregistré',  ar: 'غير مسجل' },
    hors_perimetre: { fr: 'Hors périmètre',  ar: 'خارج النطاق' },
    en_attente:     { fr: 'En attente',      ar: 'في الانتظار' },
  },
  prospect_source: {
    tiktok:     { fr: 'TikTok',     ar: 'تيك توك' },
    instagram:  { fr: 'Instagram',  ar: 'إنستغرام' },
    whatsapp:   { fr: 'WhatsApp',   ar: 'واتساب' },
    en_magasin: { fr: 'En magasin', ar: 'في المحل' },
    autre:      { fr: 'Autre',      ar: 'أخرى' },
  },
  prospect_status: {
    nouveau:  { fr: 'Nouveau',  ar: 'جديد' },
    contacte: { fr: 'Contacté', ar: 'تم الاتصال' },
    converti: { fr: 'Converti', ar: 'تحول لزبون' },
    perdu:    { fr: 'Perdu',    ar: 'ضائع' },
  },
  prospect_demand: {
    budget: { fr: 'Budget', ar: 'الميزانية' },
    modele: { fr: 'Modèle', ar: 'الموديل' },
  },
  retour_mode: {
    especes:  { fr: 'Espèces',  ar: 'نقدًا' },
    virement: { fr: 'Virement', ar: 'تحويل' },
    avoir:    { fr: 'Avoir',    ar: 'رصيد' },
  },
  retour_destination: {
    stock:      { fr: 'Remis en vente',     ar: 'إرجاع للبيع' },
    reparation: { fr: 'Envoyé en réparation', ar: 'إلى الإصلاح' },
    defectueux: { fr: 'Défectueux',         ar: 'معطوب' },
  },
  promo_type: {
    valeur:      { fr: 'Valeur',      ar: 'قيمة' },
    pourcentage: { fr: 'Pourcentage', ar: 'نسبة' },
  },
  reprise_etat: {
    bon:     { fr: 'Bon',     ar: 'جيد' },
    moyen:   { fr: 'Moyen',   ar: 'متوسط' },
    mauvais: { fr: 'Mauvais', ar: 'سيء' },
  },
  // Computed by the accessories_with_status view, not stored.
  stock_level: {
    epuise:     { fr: 'Épuisé',      ar: 'نفذ' },
    alerte:     { fr: 'Stock faible', ar: 'تحذير' },
    disponible: { fr: 'Disponible',  ar: 'متوفر' },
  },
  // Computed from prix_vente / avance / valeur_echange, not stored.
  payment_status: {
    solde:      { fr: 'Soldé',         ar: 'مسدد' },
    reste:      { fr: 'Solde restant', ar: 'متبقي' },
    trop_percu: { fr: 'Trop payé',     ar: 'زيادة دفع' },
  },
  category_type: {
    accessoire:  { fr: 'Accessoire',  ar: 'إكسسوار' },
    depense:     { fr: 'Dépense',     ar: 'مصروف' },
    fournisseur: { fr: 'Fournisseur', ar: 'مورد' },
  },
  log_action: {
    creation:             { fr: 'Création',              ar: 'إنشاء' },
    modification:         { fr: 'Modification',          ar: 'تعديل' },
    suppression:          { fr: 'Suppression',           ar: 'حذف' },
    connexion:            { fr: 'Connexion',             ar: 'تسجيل الدخول' },
    deconnexion:          { fr: 'Déconnexion',           ar: 'تسجيل الخروج' },
    derogation:           { fr: 'Dérogation',            ar: 'تجاوز' },
    soumission_cloture:   { fr: 'Clôture soumise',       ar: 'إرسال الإغلاق' },
    validation_cloture:   { fr: 'Clôture validée',       ar: 'الموافقة على الإغلاق' },
    rejet_cloture:        { fr: 'Clôture rejetée',       ar: 'رفض الإغلاق' },
    pointage_entree:      { fr: 'Pointage entrée',       ar: 'تسجيل الدخول للعمل' },
    pointage_sortie:      { fr: 'Pointage sortie',       ar: 'تسجيل الخروج من العمل' },
    creation_utilisateur: { fr: 'Création utilisateur',  ar: 'إنشاء مستخدم' },
    annulation:           { fr: 'Annulation',            ar: 'إلغاء' },
  },
  log_module: {
    telephones:             { fr: 'Téléphones',             ar: 'الهواتف' },
    laptops:                { fr: 'Laptops',                ar: 'الحواسب' },
    accessoires:            { fr: 'Accessoires',            ar: 'الإكسسوارات' },
    transactions:           { fr: 'Transactions',           ar: 'المعاملات' },
    reparations:            { fr: 'Réparations',            ar: 'الإصلاحات' },
    pieces_reparation:      { fr: 'Pièces de réparation',   ar: 'قطع الإصلاح' },
    clients:                { fr: 'Clients',                ar: 'العملاء' },
    fournisseurs:           { fr: 'Fournisseurs',           ar: 'الموردون' },
    paiements_fournisseurs: { fr: 'Paiements fournisseurs', ar: 'دفعات الموردين' },
    depenses:               { fr: 'Dépenses',               ar: 'المصاريف' },
    caisse:                 { fr: 'Caisse',                 ar: 'الصندوق' },
    encaissements_manuels:  { fr: 'Encaissements manuels',  ar: 'إيداعات نقدية' },
    mouvements_stock:       { fr: 'Transferts stock',       ar: 'تنقلات المخزون' },
    utilisateurs:           { fr: 'Utilisateurs',           ar: 'المستخدمون' },
    parametres:             { fr: 'Paramètres',             ar: 'الإعدادات' },
    authentification:       { fr: 'Authentification',       ar: 'المصادقة' },
    pointage:               { fr: 'Pointage',               ar: 'الحضور' },
    journal_modifications:  { fr: 'Changelog',              ar: 'سجل التغييرات' },
    credits:                { fr: 'Crédits',                ar: 'القروض' },
    credits_importes:       { fr: 'Crédits importés',       ar: 'القروض المستوردة' },
    prospects:              { fr: 'Prospects',              ar: 'العملاء المحتملون' },
    inventaire:             { fr: 'Inventaire',             ar: 'الجرد' },
    site_web:               { fr: 'Site web',               ar: 'الموقع الإلكتروني' },
  },
} as const satisfies Record<string, Labels>

export type CodeDomain = keyof typeof CODES
export type Code<D extends CodeDomain> = keyof (typeof CODES)[D] & string

export function codeLabel<D extends CodeDomain>(domain: D, code: Code<D> | null | undefined, lang: Lang): string {
  if (!code) return ''
  const entry = (CODES[domain] as Labels)[code]
  return entry ? entry[lang] : code
}

// 'Tête de chargeur' → 'tete_de_chargeur' (used for user-created categories).
export function toCode(label: string): string {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export function codeOptions<D extends CodeDomain>(domain: D, lang: Lang): { value: Code<D>; label: string }[] {
  return Object.entries(CODES[domain] as Labels).map(([value, l]) => ({ value: value as Code<D>, label: l[lang] }))
}
