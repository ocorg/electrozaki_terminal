'use client'
import { useState } from 'react'
import {
  Users, MousePointerClick, Eye, ShoppingBag, Percent, Wallet, ShoppingCart, Gauge,
  ArrowUpRight, ArrowDownRight, Minus, ShieldCheck, Bot, Search, Smartphone, Globe, BarChart3,
} from 'lucide-react'
import { useApi } from '@/lib/data/api'
import { PageHeader, SkeletonRow } from '@/components/shared'
import { useSiteLang, Tabs, Chip, mad } from './common'

// "Site web → Statistiques": the website's visits, pages, sources, loading
// time, sales funnel, carts, searches and robots (the "Bouclier").

interface Kpis {
  views: number; visitors: number; sessions: number; productViewers: number; cartVisitors: number; adds: number
  loadP50: number | null; orders: number; ordersKept: number; ordersConfirmed: number; ordersCancelled: number
  avgOrder: number | null; confirmedValue: number; avgCart: number | null; bots: number; probes: number; blocked: number
}
interface Stats {
  days: number; bucket: 'day' | 'week'; current: Kpis; previous: Kpis
  series: { day: string; views: number; visitors: number }[]
  pages: { path: string; label: string; views: number; visitors: number }[]
  sources: { key: string; visitors: number }[]
  devices: { key: string; visitors: number }[]
  load: { measured: number; p50: number | null; p75: number | null; slow: number; mobileP50: number | null }
  slowPages: { label: string; p50: number | null; measured: number }[]
  cartProducts: { name: string; adds: number; visitors: number }[]
  searches: { query: string; times: number; results: number }[]
  noResults: { query: string; times: number }[]
  bots: {
    kinds: { key: string; hits: number }[]
    names: { category: string; name: string; hits: number }[]
    stopped: { category: string; name: string; hits: number }[]
  }
}

type Range = '7' | '30' | '90' | '365'
type T = { fr: string; ar: string }

const SOURCES: Record<string, T> = {
  direct: { fr: 'Accès direct / lien partagé', ar: 'مباشر / رابط' }, instagram: { fr: 'Instagram', ar: 'إنستغرام' },
  facebook: { fr: 'Facebook', ar: 'فيسبوك' }, tiktok: { fr: 'TikTok', ar: 'تيك توك' }, google: { fr: 'Google', ar: 'غوغل' },
  whatsapp: { fr: 'WhatsApp', ar: 'واتساب' }, youtube: { fr: 'YouTube', ar: 'يوتيوب' }, snapchat: { fr: 'Snapchat', ar: 'سناب شات' },
  recherche: { fr: 'Autres moteurs de recherche', ar: 'محركات بحث أخرى' }, qr: { fr: 'QR code (pages promo)', ar: 'رمز QR' },
  autre: { fr: 'Autres sites', ar: 'مواقع أخرى' },
}
const DEVICES: Record<string, T> = {
  mobile: { fr: 'Téléphone', ar: 'هاتف' }, desktop: { fr: 'Ordinateur', ar: 'حاسوب' }, tablet: { fr: 'Tablette', ar: 'لوحي' },
}
// Robot families: what they are, and whether they help the shop.
const BOTS: Record<string, T & { note: T; tone: 'green' | 'amber' | 'gray' | 'red' }> = {
  search:  { fr: 'Moteurs de recherche', ar: 'محركات البحث', tone: 'green', note: { fr: 'Utiles : font apparaître le site sur Google', ar: 'مفيدة: تظهر الموقع في غوغل' } },
  social:  { fr: 'Aperçus de liens', ar: 'معاينة الروابط', tone: 'green', note: { fr: 'Utiles : l’aperçu quand un lien est partagé (WhatsApp, Facebook…)', ar: 'مفيدة: معاينة الرابط عند مشاركته' } },
  ai:      { fr: 'Robots d’intelligence artificielle', ar: 'روبوتات الذكاء الاصطناعي', tone: 'gray', note: { fr: 'Lisent le site pour ChatGPT, Claude, etc.', ar: 'تقرأ الموقع لـ ChatGPT وغيره' } },
  seo:     { fr: 'Outils de référencement', ar: 'أدوات السيو', tone: 'gray', note: { fr: 'Analysent le site (Ahrefs, Semrush…)', ar: 'تحلل الموقع' } },
  monitor: { fr: 'Surveillance', ar: 'مراقبة', tone: 'gray', note: { fr: 'Vérifient que le site est en ligne', ar: 'تتحقق من عمل الموقع' } },
  script:  { fr: 'Scripts automatiques', ar: 'برامج آلية', tone: 'amber', note: { fr: 'Programmes sans navigateur : à surveiller', ar: 'برامج بدون متصفح: للمراقبة' } },
  other:   { fr: 'Autres robots', ar: 'روبوتات أخرى', tone: 'gray', note: { fr: 'Robots qui se déclarent comme tels', ar: 'روبوتات أخرى' } },
  probe:   { fr: 'Tentatives d’attaque', ar: 'محاولات اختراق', tone: 'red', note: { fr: 'Recherche de failles (WordPress, fichiers secrets…) : refusées', ar: 'بحث عن ثغرات: مرفوضة' } },
  blocked: { fr: 'Abus bloqués', ar: 'تجاوزات محظورة', tone: 'red', note: { fr: 'Trop de commandes, d’envois ou de codes promo essayés : bloqués', ar: 'محاولات كثيرة: محظورة' } },
}
const BUCKETS: Record<string, T> = {
  order: { fr: 'Commandes', ar: 'طلبات' }, upload: { fr: 'Envois de reçus', ar: 'إرسال الوصل' }, contact: { fr: 'Formulaire contact', ar: 'نموذج الاتصال' },
  repair: { fr: 'Demandes de réparation', ar: 'طلبات الإصلاح' }, promo: { fr: 'Codes promo essayés', ar: 'رموز التخفيض' },
  track: { fr: 'Suivi de réparation', ar: 'تتبع الإصلاح' }, track_phone: { fr: 'Suivi : téléphone verrouillé (numéros devinés)', ar: 'تتبع: هاتف مقفل' }, view: { fr: 'Visites pages promo', ar: 'زيارات صفحات العروض' },
}

const num = (v: number) => new Intl.NumberFormat('fr-MA').format(Math.round(v))
const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

export default function SiteStatsModule() {
  const { L, isAr } = useSiteLang()
  const [range, setRange] = useState<Range>('30')
  const q = useApi<Stats>(`/api/site/stats?days=${range}`)
  const s = q.data
  const t = (x: T | undefined, fallback: string) => (x ? (isAr ? x.ar : x.fr) : fallback)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={L('Statistiques du site', 'إحصائيات الموقع')}
          subtitle={L('Visiteurs anonymes, sans cookies — robots comptés à part', 'زوار مجهولون بدون كوكيز — الروبوتات منفصلة')}
        />
        <Tabs<Range> value={range} onChange={setRange} tabs={[
          { key: '7',   label: L('7 jours', '7 أيام') },
          { key: '30',  label: L('30 jours', '30 يومًا') },
          { key: '90',  label: L('90 jours', '90 يومًا') },
          { key: '365', label: L('12 mois', '12 شهرًا') },
        ]} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
        {q.isLoading || !s ? (
          <div className="bg-white border border-ez-border rounded-2xl">{[0, 1, 2, 3].map(i => <SkeletonRow key={i} />)}</div>
        ) : (
          <>
            {s.current.views === 0 && s.current.bots === 0 && (
              <p className="text-sm text-ez-subtle bg-white border border-ez-border rounded-2xl p-4">
                {L('Pas encore de données sur cette période : les statistiques commencent le jour de leur mise en ligne.',
                  'لا توجد بيانات بعد لهذه الفترة.')}
              </p>
            )}

            {/* ── Headline numbers ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile icon={Users} label={L('Visiteurs', 'الزوار')} value={num(s.current.visitors)} now={s.current.visitors} before={s.previous.visitors}
                hint={L('Personnes différentes (comptées par jour)', 'أشخاص مختلفون')} />
              <Tile icon={MousePointerClick} label={L('Visites', 'الزيارات')} value={num(s.current.sessions)} now={s.current.sessions} before={s.previous.sessions}
                hint={L('Une visite s’arrête après 30 min sans activité', 'تنتهي الزيارة بعد 30 دقيقة')} />
              <Tile icon={Eye} label={L('Pages vues', 'الصفحات المشاهدة')} value={num(s.current.views)} now={s.current.views} before={s.previous.views}
                hint={s.current.sessions ? L(`${(s.current.views / s.current.sessions).toFixed(1).replace('.', ',')} pages par visite`, 'صفحات لكل زيارة') : undefined} />
              <Tile icon={ShoppingBag} label={L('Commandes web', 'الطلبات')} value={num(s.current.ordersKept)} now={s.current.ordersKept} before={s.previous.ordersKept}
                hint={L(`${s.current.ordersConfirmed} confirmée(s) · ${s.current.ordersCancelled} annulée(s)`, `${s.current.ordersConfirmed} مؤكدة · ${s.current.ordersCancelled} ملغاة`)} />
              <Tile icon={Percent} label={L('Taux de conversion', 'نسبة التحويل')}
                value={`${(s.current.sessions ? (s.current.ordersKept / s.current.sessions) * 100 : 0).toFixed(1).replace('.', ',')} %`}
                now={s.current.sessions ? s.current.ordersKept / s.current.sessions : 0} before={s.previous.sessions ? s.previous.ordersKept / s.previous.sessions : 0}
                hint={L('Visites qui finissent en commande', 'زيارات انتهت بطلب')} />
              <Tile icon={Wallet} label={L('Commande moyenne', 'متوسط الطلب')} value={s.current.avgOrder === null ? '—' : mad(s.current.avgOrder)}
                now={s.current.avgOrder ?? 0} before={s.previous.avgOrder ?? 0}
                hint={L(`${mad(s.current.confirmedValue)} confirmés`, `${mad(s.current.confirmedValue)} مؤكدة`)} />
              <Tile icon={ShoppingCart} label={L('Panier moyen', 'متوسط السلة')} value={s.current.avgCart === null ? '—' : mad(s.current.avgCart)}
                now={s.current.avgCart ?? 0} before={s.previous.avgCart ?? 0}
                hint={L('Ce qu’un visiteur met au panier', 'ما يضعه الزائر في السلة')} />
              <Tile icon={Gauge} label={L('Temps de chargement', 'وقت التحميل')} value={secs(s.current.loadP50)}
                now={s.current.loadP50 ?? 0} before={s.previous.loadP50 ?? 0} lowerIsBetter
                hint={L('Moitié des pages chargées en moins de…', 'نصف الصفحات تحمل في أقل من')} />
            </div>

            {/* ── Visitors over time ── */}
            <Card title={s.bucket === 'week' ? L('Visiteurs par semaine', 'الزوار أسبوعيًا') : L('Visiteurs par jour', 'الزوار يوميًا')} icon={BarChart3}>
              <VisitorsChart series={s.series} bucket={s.bucket} />
            </Card>

            {/* ── Sales funnel ── */}
            <Card title={L('Du visiteur à la commande', 'من الزائر إلى الطلب')} icon={ShoppingBag}
              note={L('Où les visiteurs s’arrêtent. Le % indique combien passent à l’étape suivante.', 'أين يتوقف الزوار')}>
              <Funnel steps={[
                { label: L('Visiteurs', 'الزوار'), value: s.current.visitors },
                { label: L('Ont regardé un produit', 'شاهدوا منتجًا'), value: s.current.productViewers },
                { label: L('Ont ajouté au panier', 'أضافوا إلى السلة'), value: s.current.cartVisitors },
                { label: L('Ont commandé', 'طلبوا'), value: s.current.ordersKept },
              ]} />
            </Card>

            <div className="grid lg:grid-cols-2 gap-5">
              <Card title={L('Pages les plus vues', 'الصفحات الأكثر زيارة')} icon={Eye}>
                <Table
                  head={[L('Page', 'الصفحة'), L('Vues', 'مشاهدات'), L('Visiteurs', 'زوار')]}
                  rows={s.pages.map(p => [<span key="l" title={p.path} className="font-medium text-ez-text">{p.label}</span>, num(p.views), num(p.visitors)])}
                  empty={L('Aucune visite', 'لا توجد زيارات')}
                />
              </Card>
              <Card title={L('Produits les plus ajoutés au panier', 'المنتجات الأكثر إضافة للسلة')} icon={ShoppingCart}>
                <Table
                  head={[L('Produit', 'المنتج'), L('Ajouts', 'إضافات'), L('Visiteurs', 'زوار')]}
                  rows={s.cartProducts.map(p => [<span key="l" className="font-medium text-ez-text">{p.name}</span>, num(p.adds), num(p.visitors)])}
                  empty={L('Aucun ajout au panier', 'لا توجد إضافات')}
                />
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
              <Card title={L('D’où viennent les visiteurs', 'مصدر الزوار')} icon={Globe}>
                <RankedBars items={s.sources.map(x => ({ label: t(SOURCES[x.key], x.key), value: x.visitors }))} empty={L('Aucune donnée', 'لا توجد بيانات')} />
              </Card>
              <Card title={L('Appareils', 'الأجهزة')} icon={Smartphone}>
                <RankedBars items={s.devices.map(x => ({ label: t(DEVICES[x.key], x.key), value: x.visitors }))} empty={L('Aucune donnée', 'لا توجد بيانات')} />
              </Card>
            </div>

            {/* ── Loading time ── */}
            <Card title={L('Vitesse du site', 'سرعة الموقع')} icon={Gauge}
              note={L('Temps pour afficher entièrement la première page d’une visite, mesuré chez les vrais visiteurs.', 'الوقت اللازم لعرض الصفحة الأولى')}>
              {s.load.measured === 0 ? <p className="text-sm text-ez-subtle">{L('Pas encore de mesure', 'لا توجد قياسات')}</p> : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <SpeedVerdict ms={s.load.p50} />
                    <span className="text-sm text-ez-subtle">{L(`${num(s.load.measured)} chargements mesurés`, `${num(s.load.measured)} قياس`)}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Mini label={L('Moitié des visiteurs', 'نصف الزوار')} value={`≤ ${secs(s.load.p50)}`} />
                    <Mini label={L('3 visiteurs sur 4', '3 من 4 زوار')} value={`≤ ${secs(s.load.p75)}`} />
                    <Mini label={L('Sur téléphone (moitié)', 'على الهاتف')} value={secs(s.load.mobileP50)} />
                    <Mini label={L('Chargements lents (> 3 s)', 'تحميل بطيء')} value={`${pct(s.load.slow, s.load.measured)} %`} />
                  </div>
                  {s.slowPages.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ez-subtle mb-1.5">{L('Pages les plus lentes', 'الصفحات الأبطأ')}</p>
                      <Table head={[L('Page', 'الصفحة'), L('Moitié en moins de', 'النصف في أقل من'), L('Mesures', 'قياسات')]}
                        rows={s.slowPages.map(p => [<span key="l" className="font-medium text-ez-text">{p.label}</span>, secs(p.p50), num(p.measured)])} empty="" />
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* ── Searches ── */}
            <div className="grid lg:grid-cols-2 gap-5">
              <Card title={L('Ce que les visiteurs recherchent', 'ما يبحث عنه الزوار')} icon={Search}>
                <Table head={[L('Recherche', 'البحث'), L('Fois', 'مرات'), L('Résultats', 'نتائج')]}
                  rows={s.searches.map(x => [<span key="q" className="font-medium text-ez-text">« {x.query} »</span>, num(x.times), num(x.results)])}
                  empty={L('Aucune recherche', 'لا يوجد بحث')} />
              </Card>
              <Card title={L('Recherché mais introuvable', 'مطلوب وغير متوفر')} icon={Search}
                note={L('Demandes sans aucun résultat : des produits à ajouter au stock ou au site.', 'طلبات بدون نتيجة: منتجات يجب توفيرها')}>
                <Table head={[L('Recherche', 'البحث'), L('Fois', 'مرات')]}
                  rows={s.noResults.map(x => [<span key="q" className="font-medium text-ez-text">« {x.query} »</span>, num(x.times)])}
                  empty={L('Tout ce qui a été cherché a été trouvé', 'تم العثور على كل شيء')} />
              </Card>
            </div>

            {/* ── Shield ── */}
            <Card title={L('Bouclier : robots et attaques', 'الدرع: الروبوتات والهجمات')} icon={ShieldCheck}
              note={L('Les robots sont comptés à part : ils ne gonflent pas les visiteurs ci-dessus.', 'الروبوتات محسوبة على حدة')}>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                  {L(`Bouclier actif — ${num(s.current.probes)} tentative(s) d’attaque refusée(s), ${num(s.current.blocked)} abus bloqué(s)`,
                    `الدرع نشط — ${num(s.current.probes)} محاولة مرفوضة، ${num(s.current.blocked)} تجاوز محظور`)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Mini label={L('Passages de robots', 'زيارات الروبوتات')} value={num(s.current.bots)} />
                  <Mini label={L('Part des robots', 'نسبة الروبوتات')} value={`${pct(s.current.bots, s.current.bots + s.current.views)} %`} />
                  <Mini label={L('Attaques refusées', 'هجمات مرفوضة')} value={num(s.current.probes)} />
                  <Mini label={L('Abus bloqués', 'تجاوزات محظورة')} value={num(s.current.blocked)} />
                </div>
                <div className="grid lg:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ez-subtle">{L('Par famille', 'حسب النوع')}</p>
                    {s.bots.kinds.length === 0 ? <p className="text-sm text-ez-subtle">{L('Aucun robot', 'لا توجد روبوتات')}</p> : s.bots.kinds.map(k => (
                      <div key={k.key} className="flex items-start gap-3 py-1.5 border-b border-ez-border last:border-0">
                        <Bot className="w-4 h-4 mt-0.5 text-ez-subtle flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ez-text flex items-center gap-2 flex-wrap">
                            {t(BOTS[k.key], k.key)}
                            {BOTS[k.key] && <Chip tone={BOTS[k.key].tone}>
                              {BOTS[k.key].tone === 'green' ? L('Utile', 'مفيد') : BOTS[k.key].tone === 'red' ? L('Bloqué', 'محظور') : BOTS[k.key].tone === 'amber' ? L('À surveiller', 'للمراقبة') : L('Neutre', 'محايد')}
                            </Chip>}
                          </p>
                          <p className="text-xs text-ez-subtle">{BOTS[k.key] ? (isAr ? BOTS[k.key].note.ar : BOTS[k.key].note.fr) : ''}</p>
                        </div>
                        <span className="text-sm font-bold tabular-nums">{num(k.hits)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ez-subtle mb-1.5">{L('Robots les plus actifs', 'الروبوتات الأكثر نشاطًا')}</p>
                      <Table head={[L('Robot', 'الروبوت'), L('Famille', 'النوع'), L('Passages', 'زيارات')]}
                        rows={s.bots.names.map(b => [<span key="n" className="font-mono text-xs">{b.name}</span>, t(BOTS[b.category], b.category), num(b.hits)])}
                        empty={L('Aucun robot', 'لا توجد روبوتات')} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ez-subtle mb-1.5">{L('Arrêtés par le bouclier', 'أوقفها الدرع')}</p>
                      <Table head={[L('Cible', 'الهدف'), L('Type', 'النوع'), L('Fois', 'مرات')]}
                        rows={s.bots.stopped.map(b => [
                          <span key="n" className="font-mono text-xs">{b.category === 'blocked' ? t(BUCKETS[b.name], b.name) : b.name}</span>,
                          t(BOTS[b.category], b.category), num(b.hits),
                        ])}
                        empty={L('Rien à signaler', 'لا شيء')} />
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────

function Card({ title, icon: Icon, note, children }: { title: string; icon: typeof Eye; note?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-ez-border rounded-2xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-ez-text flex items-center gap-2"><Icon className="w-4 h-4 text-[#C9A440]" />{title}</h2>
        {note && <p className="text-xs text-ez-subtle mt-0.5">{note}</p>}
      </div>
      {children}
    </section>
  )
}

/** A headline number with its change against the previous period of the same length. */
function Tile({ icon: Icon, label, value, now, before, hint, lowerIsBetter }: {
  icon: typeof Eye; label: string; value: string; now: number; before: number; hint?: string; lowerIsBetter?: boolean
}) {
  const { L } = useSiteLang()
  const change = before > 0 ? Math.round(((now - before) / before) * 100) : null
  const good = change !== null && change !== 0 && (lowerIsBetter ? change < 0 : change > 0)
  const Arrow = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <div className="bg-white border border-ez-border rounded-2xl p-4">
      <p className="text-xs font-semibold text-ez-subtle flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className="text-2xl font-bold text-ez-text mt-1 tabular-nums">{value}</p>
      <p className={`text-xs mt-1 flex items-center gap-1 ${change === null || change === 0 ? 'text-ez-subtle' : good ? 'text-emerald-700' : 'text-red-600'}`}>
        <Arrow className="w-3.5 h-3.5 flex-shrink-0" />
        {change === null ? L('pas de comparaison', 'لا مقارنة') : `${change > 0 ? '+' : ''}${change} % ${L('vs période précédente', 'مقارنة بالفترة السابقة')}`}
      </p>
      {hint && <p className="text-[11px] text-ez-subtle mt-1">{hint}</p>}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ez-muted/60 px-3 py-2">
      <p className="text-[11px] text-ez-subtle">{label}</p>
      <p className="text-lg font-bold text-ez-text tabular-nums">{value}</p>
    </div>
  )
}

function SpeedVerdict({ ms }: { ms: number | null }) {
  const { L } = useSiteLang()
  if (ms === null) return null
  if (ms <= 2500) return <Chip tone="green">{L('Rapide', 'سريع')}</Chip>
  if (ms <= 4000) return <Chip tone="amber">{L('Correct — peut mieux faire', 'مقبول')}</Chip>
  return <Chip tone="red">{L('Lent — à améliorer', 'بطيء')}</Chip>
}

/** Daily (or weekly) visitors: one series, bars with a hover tooltip. */
function VisitorsChart({ series, bucket }: { series: Stats['series']; bucket: 'day' | 'week' }) {
  const { L } = useSiteLang()
  const [hover, setHover] = useState<number | null>(null)
  if (series.length === 0) return <p className="text-sm text-ez-subtle">{L('Aucune visite sur la période', 'لا توجد زيارات')}</p>
  const max = Math.max(...series.map(d => d.visitors), 1)
  const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: '2-digit', month: 'short' })
  const h = hover === null ? null : series[hover]
  return (
    <div>
      <div className="relative">
        <div className="flex items-end h-44 gap-[2px] border-b border-ez-border" onMouseLeave={() => setHover(null)}>
          {series.map((d, i) => (
            <button key={d.day} type="button"
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`${fmt(d.day)} : ${d.visitors} ${L('visiteurs', 'زوار')}, ${d.views} ${L('pages vues', 'صفحات')}`}
              className="flex-1 h-full flex items-end focus:outline-none">
              <span className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-[#A8862E]' : 'bg-[#C9A440]'}`}
                style={{ height: `${Math.max(d.visitors > 0 ? 2 : 0, (d.visitors / max) * 100)}%` }} />
            </button>
          ))}
        </div>
        <span className="absolute -top-1 left-0 text-[10px] text-ez-subtle tabular-nums">{num(max)}</span>
        {h && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-[#1A1A1A] text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg whitespace-nowrap">
            <p className="font-semibold">{bucket === 'week' ? L(`Semaine du ${fmt(h.day)}`, `أسبوع ${fmt(h.day)}`) : fmt(h.day)}</p>
            <p>{num(h.visitors)} {L('visiteurs', 'زوار')} · {num(h.views)} {L('pages vues', 'صفحات')}</p>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-ez-subtle mt-1 tabular-nums">
        <span>{fmt(series[0].day)}</span>
        {series.length > 2 && <span>{fmt(series[Math.floor(series.length / 2)].day)}</span>}
        <span>{fmt(series[series.length - 1].day)}</span>
      </div>
    </div>
  )
}

function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(steps[0]?.value ?? 0, 1)
  return (
    <div className="space-y-2">
      {steps.map((st, i) => (
        <div key={st.label} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
          <span className="text-sm text-ez-text truncate">{st.label}</span>
          <div className="h-6 bg-ez-muted rounded-[4px] overflow-hidden">
            <div className="h-full bg-[#C9A440] rounded-[4px]" style={{ width: `${Math.max(st.value > 0 ? 1 : 0, (st.value / top) * 100)}%` }} />
          </div>
          <span className="text-sm tabular-nums w-28 text-right">
            <b>{num(st.value)}</b>
            {i > 0 && <span className="text-ez-subtle"> · {pct(st.value, steps[i - 1].value)} %</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function RankedBars({ items, empty }: { items: { label: string; value: number }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-ez-subtle">{empty}</p>
  const total = items.reduce((a, b) => a + b.value, 0)
  const max = Math.max(...items.map(x => x.value), 1)
  return (
    <div className="space-y-2">
      {items.map(x => (
        <div key={x.label}>
          <div className="flex justify-between text-sm">
            <span className="text-ez-text">{x.label}</span>
            <span className="tabular-nums"><b>{num(x.value)}</b> <span className="text-ez-subtle">· {pct(x.value, total)} %</span></span>
          </div>
          <div className="h-2 mt-1 bg-ez-muted rounded-full overflow-hidden">
            <div className="h-full bg-[#C9A440] rounded-full" style={{ width: `${(x.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return empty ? <p className="text-sm text-ez-subtle">{empty}</p> : null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ez-subtle border-b border-ez-border">
            {head.map((h, i) => <th key={h} className={`py-1.5 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-ez-border">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={`py-1.5 ${j === 0 ? 'text-left pr-3' : 'text-right tabular-nums text-ez-subtle'}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
