import type { Language } from '@/lib/stores/language'

// ─── Translation map ──────────────────────────────────────────
// Add keys here as new modules are built.
// Format: key → { fr, ar, en }
const T: Record<string, Record<Language, string>> = {

  // ── Navigation ──────────────────────────────────────────────
  'nav.dashboard':      { fr: 'Tableau de bord',    ar: 'لوحة التحكم'},
  'nav.pos':            { fr: 'Point de vente',     ar: 'نقطة البيع'},
  'nav.phones':         { fr: 'Téléphones',         ar: 'الهواتف'},
  'nav.laptops':        { fr: 'Laptops',            ar: 'الحواسب'},
  'nav.accessories':    { fr: 'Accessoires',        ar: 'الإكسسوارات'},
  'nav.repairs':        { fr: 'Réparations',        ar: 'الإصلاحات'},
  'nav.clients':        { fr: 'Clients',            ar: 'العملاء'},
  'nav.suppliers':      { fr: 'Fournisseurs',       ar: 'الموردون'},
  'nav.expenses':       { fr: 'Dépenses',           ar: 'المصاريف'},
  'nav.caisse':         { fr: 'Caisse du jour',     ar: 'صندوق اليوم'},
  'nav.movements':      { fr: 'Transferts stock',   ar: 'تنقلات المخزون'},
  'nav.logs':           { fr: "Journal d'activité", ar: 'سجل النشاط'},
  'nav.staff':          { fr: 'Présence équipe',    ar: 'حضور الفريق'},
  'nav.reports':        { fr: 'Rapports',           ar: 'التقارير'},
  'nav.users':          { fr: 'Utilisateurs',       ar: 'المستخدمون'},
  'nav.changelog':      { fr: 'Changelog',          ar: 'سجل التغييرات'},
  'nav.settings':       { fr: 'Paramètres',         ar: 'الإعدادات'},
  'nav.switchPortal':   { fr: 'Changer de portail', ar: 'تغيير البوابة'},
  'nav.logout':         { fr: 'Déconnecter',        ar: 'تسجيل الخروج'},

  // ── Auth ────────────────────────────────────────────────────
  'auth.choosePortal':  { fr: 'Choisissez votre portail', ar: 'اختر بوابتك'},
  'auth.email':         { fr: 'Email',                    ar: 'البريد الإلكتروني'},
  'auth.password':      { fr: 'Mot de passe',             ar: 'كلمة المرور'},
  'auth.login':         { fr: 'Se connecter',             ar: 'تسجيل الدخول'},
  'auth.loggingIn':     { fr: 'Connexion...',             ar: 'جارٍ الدخول...'},
  'auth.wrongCredentials': { fr: 'Email ou mot de passe incorrect', ar: 'البريد أو كلمة المرور غلط'},
  'auth.deactivated':   { fr: 'Compte désactivé',         ar: 'الحساب معطل'},
  'auth.switchPortal':  { fr: 'Changer de portail',       ar: 'تغيير البوابة'},

  // ── Dashboard ───────────────────────────────────────────────
  'dash.welcome':       { fr: 'Bonjour',             ar: 'مرحباً'},
  'dash.caToday':       { fr: "CA du jour",          ar: 'رقم أعمال اليوم'},
  'dash.salesMonth':    { fr: 'Ventes ce mois',      ar: 'مبيعات الشهر'},
  'dash.activeRepairs': { fr: 'Réparations actives', ar: 'إصلاحات نشطة'},
  'dash.stockAlerts':   { fr: 'Alertes stock',       ar: 'تنبيهات المخزون' },

  // ── POS ─────────────────────────────────────────────────────
  'pos.title':          { fr: 'Point de vente',      ar: 'نقطة البيع'},
  'pos.search':         { fr: 'IMEI, marque, modèle...', ar: 'IMEI، الماركة، الموديل...'},
  'pos.emptyCart':      { fr: 'Panier vide',         ar: 'السلة فارغة'},
  'pos.finalize':       { fr: 'Finaliser la vente',  ar: 'إتمام البيع'},
  'pos.client':         { fr: 'Client',              ar: 'العميل'},
  'pos.clientName':     { fr: 'Nom client',          ar: 'اسم العميل'},
  'pos.clientPhone':    { fr: 'Téléphone',           ar: 'الهاتف'},
  'pos.opType':         { fr: "Type d'opération",    ar: 'نوع العملية'},
  'pos.payment':        { fr: 'Paiement',            ar: 'الدفع'},
  'pos.total':          { fr: 'Total panier',        ar: 'مجموع السلة'},
  'pos.remaining':      { fr: 'Reste à payer',       ar: 'المتبقي للدفع'},
  'pos.saleRecorded':   { fr: 'Vente enregistrée',   ar: 'تم تسجيل البيع'},
  'pos.newSale':        { fr: 'Nouvelle vente',      ar: 'بيع جديد'},

  // ── Stock ───────────────────────────────────────────────────
  'stock.add':          { fr: 'Ajouter',             ar: 'إضافة'},
  'stock.edit':         { fr: 'Modifier',            ar: 'تعديل'},
  'stock.available':    { fr: 'Disponible',          ar: 'متوفر'},
  'stock.sold':         { fr: 'Vendu',               ar: 'مباع'},
  'stock.inRepair':     { fr: 'En réparation',       ar: 'قيد الإصلاح'},
  'stock.exchanged':    { fr: 'Échangé',             ar: 'مستبدل' },

  // ── Repairs ─────────────────────────────────────────────────
  'rep.newRepair':      { fr: 'Nouvelle réparation', ar: 'إصلاح جديد'},
  'rep.pending':        { fr: 'En attente',          ar: 'معلق'},
  'rep.inProgress':     { fr: 'En cours',            ar: 'قيد الإصلاح'},
  'rep.ready':          { fr: 'Prêt',                ar: 'جاهز'},
  'rep.collected':      { fr: 'Récupéré',            ar: 'تم الاستلام'},

  // ── Caisse ──────────────────────────────────────────────────
  'caisse.open':        { fr: 'Ouverte',             ar: 'مفتوح'},
  'caisse.pending':     { fr: 'Clôture en attente',  ar: 'في انتظار الإغلاق'},
  'caisse.closed':      { fr: 'Clôturée',            ar: 'مغلق'},
  'caisse.bod':         { fr: 'Ouverture du jour',   ar: 'فتح اليوم'},
  'caisse.eod':         { fr: 'Clôture du jour',     ar: 'إغلاق اليوم'},
  'caisse.approve':     { fr: 'Approuver',           ar: 'موافقة'},
  'caisse.reject':      { fr: 'Rejeter',             ar: 'رفض'},

  // ── Common ──────────────────────────────────────────────────
  'common.save':        { fr: 'Enregistrer',         ar: 'حفظ'},
  'common.cancel':      { fr: 'Annuler',             ar: 'إلغاء'},
  'common.delete':      { fr: 'Supprimer',           ar: 'حذف'},
  'common.close':       { fr: 'Fermer',              ar: 'إغلاق'},
  'common.confirm':     { fr: 'Confirmer',           ar: 'تأكيد'},
  'common.search':      { fr: 'Rechercher',          ar: 'بحث'},
  'common.filter':      { fr: 'Filtrer',             ar: 'تصفية'},
  'common.refresh':     { fr: 'Actualiser',          ar: 'تحديث'},
  'common.loading':     { fr: 'Chargement...',       ar: 'جارٍ التحميل...'},
  'common.noData':      { fr: 'Aucune donnée',       ar: 'لا توجد بيانات'},
  'common.error':       { fr: 'Une erreur est survenue', ar: 'حدث خطأ'},
  'common.success':     { fr: 'Succès',              ar: 'نجح'},
  'common.required':    { fr: 'Obligatoire',         ar: 'مطلوب'},
  'common.notes':       { fr: 'Notes',               ar: 'ملاحظات'},
  'common.date':        { fr: 'Date',                ar: 'التاريخ'},
  'common.amount':      { fr: 'Montant',             ar: 'المبلغ'},
  'common.actions':     { fr: 'Actions',             ar: 'إجراءات'},
  'common.status':      { fr: 'Statut',              ar: 'الحالة'},
  'common.name':        { fr: 'Nom',                 ar: 'الاسم'},
  'common.phone':       { fr: 'Téléphone',           ar: 'الهاتف'},
  'common.store':       { fr: 'Magasin',             ar: 'المتجر'},
  'common.total':       { fr: 'Total',               ar: 'المجموع'},
  'common.print':       { fr: 'Imprimer',            ar: 'طباعة'},
  'common.export':      { fr: 'Exporter',            ar: 'مشاركة'},
  'common.back':        { fr: 'Retour',              ar: 'رجوع'},
  'common.yes':         { fr: 'Oui',                 ar: 'نعم'},
  'common.no':          { fr: 'Non',                 ar: 'لا'},
  'common.all':         { fr: 'Tous',                ar: 'الكل'},
  'common.today':       { fr: "Aujourd'hui",         ar: 'اليوم'},
}

// ─── Translation hook ─────────────────────────────────────────
export function useTranslation(language: Language) {
  return function t(key: string, fallback?: string): string {
    const entry = T[key]
    if (!entry) return fallback ?? key
    return entry[language] ?? entry['fr'] ?? fallback ?? key
  }
}

// ─── Standalone translate (for use outside components) ────────
export function translate(key: string, language: Language, fallback?: string): string {
  const entry = T[key]
  if (!entry) return fallback ?? key
  return entry[language] ?? entry['fr'] ?? fallback ?? key
}