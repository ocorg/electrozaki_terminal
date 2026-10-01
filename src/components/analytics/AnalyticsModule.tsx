'use client'
import { useMemo, useState } from 'react'
import {
  TrendingUp, Wallet, Receipt, PiggyBank, ShoppingCart, ShoppingBag, CalendarDays, Coins,
  ArrowUpRight, ArrowDownRight, Minus, ChevronLeft, ChevronRight, AlertTriangle, Smartphone, Package,
  Layers, Users, Clock, BookOpen, BarChart3, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { PageHeader, SkeletonRow } from '@/components/shared'
import { useLanguageStore } from '@/lib/stores/language'
import { codeLabel, type Code } from '@/lib/codes'

// EZ → Analyse: sales, margins, categories, best sellers, expenses, cash and
// ratios over any period — down to a single day with its full journal.
// Computed by src/lib/analytics.ts (definitions there).

type Totals = {
  revenue: number; salesRevenue: number; refunds: number; repairRevenue: number; cogs: number; repairParts: number
  gross: number; opex: number; net: number; grossMargin: number | null; netMargin: number | null
  itemsSold: number; lines: number; tickets: number; basket: number | null; perDay: number | null; collected: number; missingCost: number
}
type Item = { name: string; qty: number; revenue: number; profit: number; margin: number | null }
interface Analytics {
  from: string; to: string; days: number; bucket: 'day' | 'month'
  totals: Totals; previous: Totals
  series: { key: string; revenue: number; gross: number; net: number; opex: number; n: number }[]
  categories: { key: string; label: string; group: string; revenue: number; cost: number; profit: number; qty: number; margin: number | null; profitShare: number | null }[]
  phones: Item[]; phonesByProfit: Item[]; accessories: Item[]
  expenseCats: { code: string; label: string; total: number; n: number; stock: boolean; share: number | null }[]
  sellers: { key: string; name: string; n: number; revenue: number; profit: number }[]
  payments: { key: string; n: number; revenue: number; profit: number }[]
  hours: { hour: number; n: number; revenue: number }[]
  missingCosts: { device_type: string; device_id: string; item: string; lines: number; revenue: number; deleted: boolean }[]
  cash: { received: number; tradeIns: number; avoirs: number; toCollect: number; repairs: number; stockBuys: number; refundsPaid: number; expenses: number }
  journal: null | {
    sales: { time: string; txn_id: string; item: string; qty: number; price: number; cost: number | null; profit: number | null; payment: string; op: string; seller: string }[]
    returns: { id: string; item: string; qty: number; montant: number; mode: string; destination: string | null; motif: string }[]
    repairs: { id: string; item: string; price: number; parts: number; kind: string }[]
    expenses: { id: string; label: string; montant: number; notes: string | null; stock: boolean }[]
  }
}

const STORE = 'EZ-001'
const GOLD = '#C9A440'
const today = () => new Date().toISOString().slice(0, 10)
const shift = (d: string, days: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10) }
const mad = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(v)} DH`)
const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1).replace('.', ',')} %`)
const num = (v: number) => new Intl.NumberFormat('fr-MA').format(v)
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...opts })

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastmonth' | 'year'
function presetRange(p: Preset): [string, string] {
  const t = today()
  if (p === 'today') return [t, t]
  if (p === 'yesterday') return [shift(t, -1), shift(t, -1)]
  if (p === '7d') return [shift(t, -6), t]
  if (p === '30d') return [shift(t, -29), t]
  if (p === 'month') return [`${t.slice(0, 7)}-01`, t]
  if (p === 'lastmonth') {
    const first = new Date(`${t.slice(0, 7)}-01T00:00:00Z`); first.setUTCMonth(first.getUTCMonth() - 1)
    const start = first.toISOString().slice(0, 10)
    return [start, shift(`${t.slice(0, 7)}-01`, -1)]
  }
  return [`${t.slice(0, 4)}-01-01`, t]
}

export default function AnalyticsModule() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const lang = isAr ? 'ar' : 'fr'
  const [[from, to], setRange] = useState<[string, string]>(() => presetRange('month'))
  const [preset, setPreset] = useState<Preset | null>('month')
  const [measure, setMeasure] = useState<'revenue' | 'gross' | 'net'>('revenue')
  const q = useApi<Analytics>(`/api/analytics?store_id=${STORE}&from=${from}&to=${to}`)
  const a = q.data
  const single = from === to

  const pick = (p: Preset) => { setPreset(p); setRange(presetRange(p)) }
  const setDay = (d: string) => { setPreset(null); setRange([d, d]) }
  const setDates = (f: string, t: string) => { if (!f || !t) return; setPreset(null); setRange(f <= t ? [f, t] : [t, f]) }

  const PRESETS: [Preset, string][] = [
    ['today', "Aujourd'hui"], ['yesterday', 'Hier'], ['7d', '7 jours'], ['30d', '30 jours'],
    ['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['year', 'Cette année'],
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 space-y-3 border-b border-ez-border bg-ez-bg">
        <PageHeader title="Analyse financière" subtitle={single ? dayLabel(from) : `Du ${dayLabel(from, { day: 'numeric', month: 'short', year: 'numeric' })} au ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })} · ${a?.days ?? ''} jours`} />
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {PRESETS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => pick(k)}
              className={`px-3 py-1.5 rounded-xl border text-sm font-semibold whitespace-nowrap transition-all ${preset === k ? 'bg-ez-dark border-ez-dark text-white' : 'bg-white border-ez-border text-ez-subtle hover:border-gold'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {single && (
            <button type="button" onClick={() => setDay(shift(from, -1))} aria-label="Jour précédent"
              className="p-2 rounded-xl border border-ez-border bg-white hover:border-gold"><ChevronLeft className="w-4 h-4" /></button>
          )}
          <CalendarDays className="w-4 h-4 text-ez-faint" />
          <input type="date" value={from} max={today()} onChange={e => setDates(e.target.value, single ? e.target.value : to)}
            className="border border-ez-border rounded-xl px-2 py-1.5 bg-white" />
          {!single && (<>
            <span className="text-ez-faint">→</span>
            <input type="date" value={to} max={today()} onChange={e => setDates(from, e.target.value)}
              className="border border-ez-border rounded-xl px-2 py-1.5 bg-white" />
          </>)}
          {single && (
            <button type="button" onClick={() => setDay(shift(from, 1))} disabled={from >= today()} aria-label="Jour suivant"
              className="p-2 rounded-xl border border-ez-border bg-white hover:border-gold disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          )}
          <button type="button" onClick={() => (single ? setDates(shift(from, -6), from) : setDay(to))}
            className="text-xs font-semibold text-[#A8862E] underline underline-offset-2 ml-1">
            {single ? 'Voir une période' : 'Voir un seul jour'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
        {q.isLoading || !a ? (
          <div className="bg-white border border-ez-border rounded-2xl">{[0, 1, 2, 3].map(i => <SkeletonRow key={i} />)}</div>
        ) : (
          <>
            {a.missingCosts.length > 0 && <MissingCosts items={a.missingCosts} lines={a.totals.missingCost} onSaved={() => q.refresh()} />}

            {/* ── Key figures ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile icon={TrendingUp} label="Chiffre d’affaires" value={mad(a.totals.revenue)} now={a.totals.revenue} before={a.previous.revenue}
                hint={a.totals.refunds ? `Retours déduits : ${mad(a.totals.refunds)}` : `${num(a.totals.itemsSold)} article(s) vendu(s)`} />
              <Tile icon={Coins} label="Bénéfice brut" value={mad(a.totals.gross)} now={a.totals.gross} before={a.previous.gross}
                hint={`Marge brute ${pctText(a.totals.grossMargin)}`} />
              <Tile icon={Receipt} label="Dépenses" value={mad(a.totals.opex)} now={a.totals.opex} before={a.previous.opex} lowerIsBetter
                hint={a.totals.revenue ? `${pctText((a.totals.opex / a.totals.revenue) * 100)} du CA · hors achats de stock` : 'hors achats de stock'} />
              <Tile icon={PiggyBank} label="Bénéfice net" value={mad(a.totals.net)} now={a.totals.net} before={a.previous.net} strong
                hint={`Marge nette ${pctText(a.totals.netMargin)}`} />
              <Tile icon={ShoppingCart} label="Ventes" value={num(a.totals.tickets)} now={a.totals.tickets} before={a.previous.tickets}
                hint={`${num(a.totals.itemsSold)} article(s)`} />
              <Tile icon={ShoppingBag} label="Panier moyen" value={mad(a.totals.basket)} now={a.totals.basket ?? 0} before={a.previous.basket ?? 0} />
              <Tile icon={BarChart3} label={single ? 'Réparations' : 'CA moyen par jour'} value={single ? mad(a.totals.repairRevenue) : mad(a.totals.perDay)}
                now={single ? a.totals.repairRevenue : a.totals.perDay ?? 0} before={single ? a.previous.repairRevenue : a.previous.perDay ?? 0} />
              <Tile icon={Wallet} label="Argent encaissé" value={mad(a.totals.collected)} now={a.totals.collected} before={a.previous.collected}
                hint="Reçu pour les ventes (espèces, virement…)" />
            </div>

            {/* ── Chart ── */}
            {!single && (
              <Card title={a.bucket === 'month' ? 'Par mois' : 'Jour par jour'} icon={BarChart3}
                note="Touchez une barre pour voir ce jour en détail."
                right={
                  <div className="flex gap-1 p-0.5 bg-ez-muted rounded-lg text-xs font-semibold">
                    {([['revenue', 'CA'], ['gross', 'Bénéfice brut'], ['net', 'Bénéfice net']] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setMeasure(k)}
                        className={`px-2 py-1 rounded-md ${measure === k ? 'bg-white shadow-sm text-ez-text' : 'text-ez-subtle'}`}>{l}</button>
                    ))}
                  </div>
                }>
                <SeriesChart series={a.series} measure={measure} monthly={a.bucket === 'month'} onPick={k => a.bucket === 'day' && setDay(k)} />
              </Card>
            )}

            <div className="grid lg:grid-cols-2 gap-5">
              {/* ── P&L ── */}
              <Card title="Compte de résultat" icon={BookOpen} note="Comment le chiffre d’affaires devient bénéfice.">
                <PnL a={a} />
              </Card>

              {/* ── Cash ── */}
              <Card title="Trésorerie" icon={Wallet} note="L’argent réellement reçu et sorti sur la période.">
                <div className="space-y-1.5 text-sm">
                  <Line label="Reçu pour les ventes" value={a.cash.received} />
                  {a.cash.repairs > 0 && <Line label="Réparations remises" value={a.cash.repairs} />}
                  <Line label="Payé en téléphones repris (reprises)" value={a.cash.tradeIns} muted />
                  {a.cash.avoirs > 0 && <Line label="Payé avec des avoirs" value={a.cash.avoirs} muted />}
                  <Line label="Reste à encaisser (crédits, avances)" value={a.cash.toCollect} muted />
                  <div className="border-t border-ez-border my-2" />
                  <Line label="Achats de stock (Marchandises)" value={-a.cash.stockBuys} />
                  <Line label="Dépenses" value={-a.cash.expenses} />
                  {a.cash.refundsPaid > 0 && <Line label="Remboursements de retours" value={-a.cash.refundsPaid} />}
                  <div className="border-t border-ez-border my-2" />
                  <Line label="Solde de la période" value={a.cash.received + a.cash.repairs - a.cash.stockBuys - a.cash.expenses - a.cash.refundsPaid} bold />
                </div>
              </Card>
            </div>

            {/* ── Categories ── */}
            <Card title="Par catégorie — où se fait le bénéfice" icon={Layers}>
              {a.categories.length === 0 ? <Empty /> : (
                <Table head={['Catégorie', 'Qté', 'CA', 'Bénéfice', 'Marge', 'Part du bénéfice']}
                  rows={a.categories.map(c => [
                    <span key="l" className="font-medium text-ez-text">{c.label}</span>,
                    num(c.qty), mad(c.revenue), <b key="p" className={c.profit < 0 ? 'text-red-600' : 'text-ez-text'}>{mad(c.profit)}</b>, pctText(c.margin),
                    <ShareBar key="s" value={c.profitShare} />,
                  ])} />
              )}
            </Card>

            {/* ── Best sellers ── */}
            <div className="grid lg:grid-cols-2 gap-5">
              <Card title="Téléphones les plus vendus" icon={Smartphone}>
                {a.phones.length === 0 ? <Empty /> : (
                  <Table head={['Modèle', 'Vendus', 'CA', 'Bénéfice', 'Marge']}
                    rows={a.phones.map(p => [<span key="n" className="font-medium text-ez-text">{p.name}</span>, num(p.qty), mad(p.revenue), mad(p.profit), pctText(p.margin)])} />
                )}
                {a.phonesByProfit.length > 0 && (
                  <p className="text-xs text-ez-subtle mt-3">
                    <b className="text-ez-text">Les plus rentables :</b> {a.phonesByProfit.map(p => `${p.name} (${mad(p.profit)})`).join(' · ')}
                  </p>
                )}
              </Card>
              <Card title="Accessoires les plus vendus" icon={Package}>
                {a.accessories.length === 0 ? <Empty /> : (
                  <Table head={['Article', 'Qté', 'CA', 'Bénéfice', 'Marge']}
                    rows={a.accessories.map(p => [<span key="n" className="font-medium text-ez-text">{p.name}</span>, num(p.qty), mad(p.revenue), mad(p.profit), pctText(p.margin)])} />
                )}
              </Card>
            </div>

            {/* ── Expenses ── */}
            <Card title="Dépenses par catégorie" icon={Receipt} note="Les achats de stock (Marchandises) sont affichés à part : leur coût est déjà compté quand l’article se vend.">
              {a.expenseCats.length === 0 ? <Empty text="Aucune dépense sur la période" /> : (
                <div className="space-y-2">
                  {a.expenseCats.filter(e => !e.stock).map(e => (
                    <RankRow key={e.code} label={e.label} value={mad(e.total)} sub={`${e.n} dépense(s) · ${pctText(e.share)}`} ratio={e.share ?? 0} />
                  ))}
                  {a.expenseCats.filter(e => e.stock).map(e => (
                    <p key={e.code} className="text-sm text-ez-subtle pt-2 border-t border-ez-border flex justify-between">
                      <span>{e.label} — achats de stock ({e.n})</span><b className="text-ez-text">{mad(e.total)}</b>
                    </p>
                  ))}
                </div>
              )}
            </Card>

            <div className="grid lg:grid-cols-3 gap-5">
              <Card title="Par vendeur" icon={Users}>
                {a.sellers.length === 0 ? <Empty /> : a.sellers.map(s => (
                  <RankRow key={s.key} label={s.name} value={mad(s.revenue)} sub={`${s.n} ligne(s) · bénéfice ${mad(s.profit)}`}
                    ratio={a.totals.salesRevenue ? (s.revenue / a.totals.salesRevenue) * 100 : 0} />
                ))}
              </Card>
              <Card title="Modes de paiement" icon={Wallet}>
                {a.payments.length === 0 ? <Empty /> : a.payments.map(p => (
                  <RankRow key={p.key} label={codeLabel('payment_method', p.key as Code<'payment_method'>, lang)} value={mad(p.revenue)}
                    sub={`${p.n} ligne(s)`} ratio={a.totals.salesRevenue ? (p.revenue / a.totals.salesRevenue) * 100 : 0} />
                ))}
              </Card>
              <Card title="Heures d’affluence" icon={Clock} note="Nombre de ventes enregistrées par heure.">
                <HoursChart hours={a.hours} />
              </Card>
            </div>

            {/* ── One day: journal ── */}
            {a.journal && <Journal j={a.journal} lang={lang} />}
          </>
        )}
      </div>
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────

/** Sold items with no purchase price: listed, fixable right here (even deleted ones). */
function MissingCosts({ items, lines, onSaved }: { items: Analytics['missingCosts']; lines: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function save(it: Analytics['missingCosts'][number]) {
    const key = `${it.device_type}:${it.device_id}`
    const value = Number(values[key])
    if (!Number.isFinite(value) || value < 0 || values[key] === undefined || values[key] === '') { setError('Entrez un prix d’achat (0 ou plus).'); return }
    setSaving(key); setError(null)
    try {
      const url = it.device_type === 'telephone' ? '/api/phones' : it.device_type === 'laptop' ? '/api/laptops' : '/api/accessories'
      const id  = it.device_type === 'telephone' ? { phone_id: it.device_id } : it.device_type === 'laptop' ? { laptop_id: it.device_id } : { acc_id: it.device_id }
      await apiWrite(url, { method: 'PATCH', body: { ...id, prix_achat: value } })
      onSaved()
    } catch (e) { setError((e as Error).message) } finally { setSaving(null) }
  }
  return (
    <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-2 px-3 py-2 text-left">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span className="flex-1">
          {lines} vente(s) sans prix d’achat ({items.length} article{items.length > 1 ? 's' : ''}) : leur bénéfice est compté en entier (surestimé).{' '}
          <b className="underline underline-offset-2">{open ? 'Masquer' : 'Voir et compléter'}</b>
        </span>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-amber-200 bg-white rounded-b-xl divide-y divide-ez-muted">
          <p className="px-3 py-2 text-xs text-ez-subtle">Entrez ce que l’article vous a coûté (à l’unité). Mettez 0 pour un service sans pièce.</p>
          {items.map(it => {
            const key = `${it.device_type}:${it.device_id}`
            return (
              <div key={key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-medium text-ez-text">{it.item}{it.deleted && <span className="ml-1 text-xs text-ez-faint">(supprimé)</span>}</p>
                  <p className="text-xs text-ez-faint"><span className="font-mono">{it.device_id}</span> · {it.lines} vente(s) · {mad(it.revenue)}</p>
                </div>
                <input type="number" min={0} step={1} inputMode="decimal" placeholder="Prix d’achat"
                  value={values[key] ?? ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
                  className="w-28 border border-ez-border rounded-lg px-2 py-1.5 text-right" />
                <button type="button" onClick={() => save(it)} disabled={saving === key}
                  className="px-3 py-1.5 rounded-lg bg-ez-dark text-white text-xs font-bold disabled:opacity-50">
                  {saving === key ? '…' : 'Enregistrer'}
                </button>
              </div>
            )
          })}
          {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

function Card({ title, icon: Icon, note, right, children }: { title: string; icon: typeof TrendingUp; note?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-ez-border rounded-2xl p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ez-text flex items-center gap-2"><Icon className="w-4 h-4" style={{ color: GOLD }} />{title}</h2>
          {note && <p className="text-xs text-ez-subtle mt-0.5">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Tile({ icon: Icon, label, value, now, before, hint, lowerIsBetter, strong }: {
  icon: typeof TrendingUp; label: string; value: string; now: number; before: number; hint?: string; lowerIsBetter?: boolean; strong?: boolean
}) {
  const change = before ? Math.round(((now - before) / Math.abs(before)) * 100) : null
  const good = change !== null && change !== 0 && (lowerIsBetter ? change < 0 : change > 0)
  const Arrow = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <div className={`rounded-2xl p-4 border ${strong ? 'bg-ez-dark border-ez-dark text-white' : 'bg-white border-ez-border'}`}>
      <p className={`text-xs font-semibold flex items-center gap-1.5 ${strong ? 'text-white/70' : 'text-ez-subtle'}`}><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${strong ? (now < 0 ? 'text-red-300' : 'text-[#E8C766]') : now < 0 ? 'text-red-600' : 'text-ez-text'}`}>{value}</p>
      <p className={`text-xs mt-1 flex items-center gap-1 ${change === null || change === 0 ? (strong ? 'text-white/60' : 'text-ez-faint') : good ? (strong ? 'text-emerald-300' : 'text-emerald-700') : (strong ? 'text-red-300' : 'text-red-600')}`}>
        <Arrow className="w-3.5 h-3.5 flex-shrink-0" />
        {change === null ? 'pas de comparaison' : `${change > 0 ? '+' : ''}${change} % vs période précédente`}
      </p>
      {hint && <p className={`text-xs mt-1 ${strong ? 'text-white/60' : 'text-ez-faint'}`}>{hint}</p>}
    </div>
  )
}

function Line({ label, value, muted, bold }: { label: string; value: number; muted?: boolean; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${muted ? 'text-ez-faint' : 'text-ez-text'} ${bold ? 'font-bold text-base' : ''}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${value < 0 ? 'text-red-600' : ''}`}>{mad(value)}</span>
    </div>
  )
}

function PnL({ a }: { a: Analytics }) {
  const t = a.totals
  const group = (g: string) => a.categories.filter(c => c.group === g).reduce((s, c) => s + c.revenue, 0)
  const pct = (v: number) => (t.revenue ? `${((v / t.revenue) * 100).toFixed(1).replace('.', ',')} %` : '')
  const rows: { label: string; value: number; kind?: 'sub' | 'total' | 'minus' }[] = [
    { label: 'Ventes de téléphones', value: group('telephones'), kind: 'sub' },
    { label: 'Ventes d’accessoires', value: group('accessoires'), kind: 'sub' },
    ...(group('laptop') ? [{ label: 'Ventes d’ordinateurs', value: group('laptop'), kind: 'sub' as const }] : []),
    ...(t.repairRevenue ? [{ label: 'Réparations', value: t.repairRevenue, kind: 'sub' as const }] : []),
    { label: t.refunds ? `Chiffre d’affaires (retours déduits : ${mad(t.refunds)})` : 'Chiffre d’affaires', value: t.revenue, kind: 'total' },
    { label: 'Coût d’achat des articles vendus', value: -(t.cogs + t.repairParts), kind: 'minus' },
    { label: 'Bénéfice brut', value: t.gross, kind: 'total' },
    ...a.expenseCats.filter(e => !e.stock).map(e => ({ label: e.label, value: -e.total, kind: 'minus' as const })),
    { label: 'Bénéfice net', value: t.net, kind: 'total' },
  ]
  return (
    <div className="text-sm">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-baseline justify-between gap-3 py-1.5 ${r.kind === 'total' ? 'border-t border-ez-border font-bold text-ez-text' : r.kind === 'minus' ? 'text-ez-subtle pl-3' : 'text-ez-text pl-3'}`}>
          <span className="min-w-0">{r.label}</span>
          <span className="flex items-baseline gap-3 flex-shrink-0">
            <span className="text-xs text-ez-faint w-14 text-right">{pct(Math.abs(r.value))}</span>
            <span className={`tabular-nums w-28 text-right ${r.value < 0 && r.kind === 'total' ? 'text-red-600' : ''}`}>{mad(r.value)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** One measure per day (or month); bars below zero for losses; tap = that day. */
function SeriesChart({ series, measure, monthly, onPick }: { series: Analytics['series']; measure: 'revenue' | 'gross' | 'net'; monthly: boolean; onPick: (k: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const values = series.map(s => s[measure])
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const zero = (max / span) * 100 // % from the top
  const fmt = (k: string) => monthly
    ? new Date(`${k}-01T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'short', year: '2-digit' })
    : new Date(`${k}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
  const h = hover === null ? null : series[hover]
  return (
    <div>
      <div className="relative h-52" onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 border-t border-[#D9D5CC]" style={{ top: `${zero}%` }} />
        <div className="absolute inset-0 flex gap-[2px]">
          {series.map((s, i) => {
            const v = s[measure]
            const height = (Math.abs(v) / span) * 100
            return (
              <button key={s.key} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => onPick(s.key)}
                aria-label={`${fmt(s.key)} : ${mad(v)}`} className="relative flex-1 h-full focus:outline-none">
                <span className={`absolute left-0 right-0 ${v >= 0 ? 'rounded-t-[4px]' : 'rounded-b-[4px]'} ${hover === i ? 'opacity-100' : 'opacity-85'}`}
                  style={{
                    backgroundColor: v >= 0 ? (hover === i ? '#A8862E' : GOLD) : '#DC2626',
                    height: `${Math.max(v !== 0 ? 1 : 0, height)}%`,
                    ...(v >= 0 ? { bottom: `${100 - zero}%` } : { top: `${zero}%` }),
                  }} />
              </button>
            )
          })}
        </div>
        {h && (
          <div className="absolute top-1 left-1/2 -translate-x-1/2 bg-ez-dark text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg whitespace-nowrap z-10">
            <p className="font-semibold capitalize">{fmt(h.key)}</p>
            <p>CA {mad(h.revenue)} · Brut {mad(h.gross)}</p>
            <p>Dépenses {mad(h.opex)} · Net {mad(h.net)} · {h.n} ligne(s)</p>
          </div>
        )}
      </div>
      <div className="flex justify-between text-xs text-ez-faint mt-1 capitalize">
        <span>{series[0] && fmt(series[0].key)}</span>
        {series.length > 2 && <span>{fmt(series[Math.floor(series.length / 2)].key)}</span>}
        <span>{series.length > 1 && fmt(series[series.length - 1].key)}</span>
      </div>
    </div>
  )
}

function HoursChart({ hours }: { hours: Analytics['hours'] }) {
  const shown = hours.filter(h => h.hour >= 8 && h.hour <= 23)
  const max = Math.max(...shown.map(h => h.n), 1)
  const busiest = [...hours].sort((a, b) => b.n - a.n)[0]
  return (
    <div>
      <div className="flex items-end h-28 gap-[2px] border-b border-ez-border">
        {shown.map(h => (
          <div key={h.hour} className="flex-1 h-full flex items-end" title={`${h.hour}h : ${h.n} vente(s), ${mad(h.revenue)}`}>
            <span className="block w-full rounded-t-[3px]" style={{ height: `${(h.n / max) * 100}%`, backgroundColor: GOLD }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-ez-faint mt-1"><span>8h</span><span>16h</span><span>23h</span></div>
      {busiest?.n > 0 && <p className="text-xs text-ez-subtle mt-2">Heure la plus active : <b className="text-ez-text">{busiest.hour}h–{busiest.hour + 1}h</b> ({busiest.n} ventes)</p>}
    </div>
  )
}

function RankRow({ label, value, sub, ratio }: { label: string; value: string; sub?: string; ratio: number }) {
  return (
    <div className="py-1">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-ez-text font-medium truncate">{label}</span>
        <b className="tabular-nums text-ez-text flex-shrink-0">{value}</b>
      </div>
      <div className="h-1.5 mt-1 bg-ez-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, ratio))}%`, backgroundColor: GOLD }} />
      </div>
      {sub && <p className="text-xs text-ez-faint mt-0.5">{sub}</p>}
    </div>
  )
}

function ShareBar({ value }: { value: number | null }) {
  if (value === null) return <span>—</span>
  return (
    <span className="inline-flex items-center gap-2 justify-end w-full">
      <span className="hidden sm:block w-16 h-1.5 bg-ez-muted rounded-full overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: value < 0 ? '#DC2626' : GOLD }} />
      </span>
      <span className="tabular-nums">{pctText(value)}</span>
    </span>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-ez-faint border-b border-ez-border">
            {head.map((h, i) => <th key={h} className={`py-1.5 px-1 font-semibold whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-ez-muted">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={`py-1.5 px-1 ${j === 0 ? 'text-left' : 'text-right tabular-nums text-ez-subtle whitespace-nowrap'}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Empty = ({ text = 'Aucune vente sur la période' }: { text?: string }) => <p className="text-sm text-ez-faint">{text}</p>

function Journal({ j, lang }: { j: NonNullable<Analytics['journal']>; lang: 'fr' | 'ar' }) {
  const totalProfit = useMemo(() => j.sales.reduce((s, x) => s + (x.profit ?? 0), 0), [j.sales])
  return (
    <Card title="Journal de la journée" icon={BookOpen} note="Chaque vente, retour, réparation et dépense du jour.">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ez-faint mb-1.5">Ventes ({j.sales.length}) · bénéfice {mad(totalProfit)}</p>
          {j.sales.length === 0 ? <Empty text="Aucune vente ce jour" /> : (
            <Table head={['Heure', 'Article', 'Prix', 'Coût', 'Bénéfice', 'Paiement', 'Vendeur']}
              rows={j.sales.map(s => [
                <span key="t" className="tabular-nums text-ez-subtle">{s.time}</span>,
                <span key="i" className="text-ez-text">{s.qty > 1 ? `${s.qty} × ` : ''}{s.item}{s.op === 'echange' ? ' · reprise' : ''}</span>,
                mad(s.price), s.cost === null ? <span key="c" className="text-amber-700">?</span> : mad(s.cost),
                s.profit === null ? '—' : <b key="p" className={s.profit < 0 ? 'text-red-600' : 'text-ez-text'}>{mad(s.profit)}</b>,
                codeLabel('payment_method', s.payment as Code<'payment_method'>, lang), s.seller,
              ])} />
          )}
        </div>
        {j.returns.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ez-faint mb-1.5">Retours ({j.returns.length})</p>
            <Table head={['Réf.', 'Article', 'Remboursé', 'Mode', 'Motif']}
              rows={j.returns.map(r => [<span key="r" className="font-mono text-xs">{r.id}</span>, `${r.qty > 1 ? `${r.qty} × ` : ''}${r.item}`, mad(r.montant), codeLabel('retour_mode', r.mode as Code<'retour_mode'>, lang), r.motif])} />
          </div>
        )}
        {j.repairs.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ez-faint mb-1.5">Réparations remises ({j.repairs.length})</p>
            <Table head={['Ticket', 'Appareil', 'Prix', 'Pièces', 'Bénéfice']}
              rows={j.repairs.map(r => [<span key="r" className="font-mono text-xs">{r.id}</span>, r.item, mad(r.price), mad(r.parts), mad(r.price - r.parts)])} />
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ez-faint mb-1.5">Dépenses ({j.expenses.length})</p>
          {j.expenses.length === 0 ? <Empty text="Aucune dépense ce jour" /> : (
            <Table head={['Catégorie', 'Note', 'Montant']}
              rows={j.expenses.map(e => [<span key="l" className="text-ez-text">{e.label}{e.stock ? ' · stock' : ''}</span>, e.notes ?? '—', mad(e.montant)])} />
          )}
        </div>
      </div>
    </Card>
  )
}
