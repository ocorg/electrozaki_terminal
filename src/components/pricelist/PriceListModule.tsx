'use client'
import { useMemo, useState } from 'react'
import { Search, X, Printer, Smartphone, Package } from 'lucide-react'
import { useApi } from '@/lib/data/api'
import { PageHeader, SkeletonRow, Select } from '@/components/shared'
import { useCategories, categoryLabel } from '@/lib/hooks/useCategories'
import { useLanguageStore } from '@/lib/stores/language'
import { computePromoPrice } from '@/lib/utils'
import type { Phone, Accessory } from '@/types/database'

// Liste des prix (every role): what's in the shop, its sale price and the
// "dernier prix" — the lowest the seller may go to when negotiating
// (prix_vente_minimum). Never the purchase price (staff don't receive it).

const STORE = 'EZ-001'
const mad = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${new Intl.NumberFormat('fr-MA').format(v)} DH`)
const phoneName = (p: Phone) => {
  const model = p.model.replace(/\s*\d+\s*(GB|TB)\s*$/i, '').trim()
  const family = (p.serie ?? '').split(' ')[0]
  const base = model.toLowerCase().startsWith(p.marque.toLowerCase()) || (family && model.toLowerCase().startsWith(family.toLowerCase()))
    ? model : `${family || p.marque} ${model}`
  return base
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function PriceListModule() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const [tab, setTab] = useState<'phones' | 'accessories'>('phones')
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [withEmpty, setWithEmpty] = useState(false)

  const phonesQ = useApi<Phone[]>(`/api/phones?status=disponible&store_id=${STORE}&limit=500`)
  const accQ = useApi<Accessory[]>(`/api/accessories?store_id=${STORE}`)
  const { accessories: accCats } = useCategories()

  const words = norm(q).split(/\s+/).filter(Boolean)
  const match = (text: string) => words.every(w => norm(text).includes(w))

  const phones = useMemo(() => (phonesQ.data ?? [])
    .filter(p => !group || p.marque === group)
    .filter(p => match(`${p.marque} ${p.serie ?? ''} ${p.model} ${p.stockage ?? ''} ${p.couleur ?? ''} ${p.imei ?? ''}`))
    .sort((a, b) => a.marque.localeCompare(b.marque) || phoneName(a).localeCompare(phoneName(b), 'fr', { numeric: true }) || (a.stockage ?? '').localeCompare(b.stockage ?? '', 'fr', { numeric: true })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [phonesQ.data, group, q])

  const accessories = useMemo(() => (accQ.data ?? [])
    .filter(a => withEmpty || a.quantite > 0)
    .filter(a => !group || a.categorie === group)
    .filter(a => match(`${a.nom} ${a.marque ?? ''} ${categoryLabel(accCats, a.categorie, false)}`))
    .sort((a, b) => categoryLabel(accCats, a.categorie, false).localeCompare(categoryLabel(accCats, b.categorie, false)) || a.nom.localeCompare(b.nom, 'fr', { numeric: true })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [accQ.data, group, q, withEmpty, accCats])

  const brands = Array.from(new Set((phonesQ.data ?? []).map(p => p.marque))).sort()
  const loading = tab === 'phones' ? phonesQ.isLoading : accQ.isLoading
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in print:h-auto print:overflow-visible" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 space-y-3 print:hidden">
        <PageHeader title="Liste des prix" subtitle="Prix de vente et dernier prix (le minimum en négociation)"
          actions={
            <button type="button" onClick={() => window.print()}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#E8E5DE] bg-white text-sm text-[#1A1A1A] hover:border-[#C9A440]">
              <Printer className="w-4 h-4" />Imprimer
            </button>
          } />
        <div className="flex gap-1 p-1 bg-white border border-[#E8E5DE] rounded-xl w-fit">
          {([['phones', 'Téléphones disponibles', Smartphone, phonesQ.data?.length], ['accessories', 'Accessoires', Package, accQ.data?.filter(a => a.quantite > 0).length]] as const).map(([k, label, Icon, n]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setGroup('') }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? 'bg-[#1A1A1A] text-white' : 'text-[#6B6860]'}`}>
              <Icon className="w-4 h-4" />{label}{n !== undefined && <span className="opacity-60">{n}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder={tab === 'phones' ? 'Modèle, stockage, couleur, IMEI…' : 'Nom, marque, catégorie…'}
              className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm focus:outline-none focus:border-[#C9A440]" />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6]"><X className="w-4 h-4" /></button>}
          </div>
          <Select value={group} onChange={e => setGroup(e.target.value)}
            className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860]">
            <option value="">{tab === 'phones' ? 'Toutes les marques' : 'Toutes les catégories'}</option>
            {tab === 'phones'
              ? brands.map(b => <option key={b} value={b}>{b}</option>)
              : accCats.map(c => <option key={c.code} value={c.code}>{c.fr}</option>)}
          </Select>
          {tab === 'accessories' && (
            <label className="flex items-center gap-2 text-sm text-[#6B6860] px-2">
              <input type="checkbox" checked={withEmpty} onChange={e => setWithEmpty(e.target.checked)} />Afficher les épuisés
            </label>
          )}
        </div>
      </div>

      {/* Printed header */}
      <div className="hidden print:block px-2 pb-3">
        <h1 className="text-xl font-bold">Electro Zaki — {tab === 'phones' ? 'Téléphones disponibles' : 'Accessoires'}</h1>
        <p className="text-xs">Liste des prix au {today} · « Dernier prix » = minimum en négociation</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 print:overflow-visible print:px-0">
        {loading ? (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl">{[0, 1, 2].map(i => <SkeletonRow key={i} />)}</div>
        ) : tab === 'phones' ? (
          <List
            count={phones.length}
            head={['Téléphone', 'État', 'IMEI', 'Prix de vente', 'Dernier prix']}
            rows={phones.map(p => {
              const promo = p.promo_type && p.promo_montant ? computePromoPrice(p.prix_vente_recommande ?? 0, p.promo_type, p.promo_montant) : null
              return {
                key: p.phone_id,
                cells: [
                  <span key="n"><b className="text-[#1A1A1A]">{phoneName(p)}{p.stockage ? ` ${p.stockage}` : ''}</b>{p.couleur && <span className="text-[#6B6860]"> · {p.couleur}</span>}</span>,
                  <span key="e" className="text-[#6B6860]">{p.condition === 'neuf' ? 'Neuf' : 'Occasion'}{p.battery_level != null ? ` · 🔋${p.battery_level}%` : ''}{p.is_damaged ? ' · endommagé' : ''}</span>,
                  <span key="i" className="font-mono text-xs text-[#8A877F]">{p.imei ?? '—'}</span>,
                  promo !== null
                    ? <span key="p"><s className="text-[#8A877F] text-xs mr-1">{mad(p.prix_vente_recommande)}</s><b className="text-[#A8862E]">{mad(Math.round(promo))}</b></span>
                    : <b key="p" className="text-[#1A1A1A]">{mad(p.prix_vente_recommande)}</b>,
                  <b key="m" className="text-emerald-700">{mad(p.prix_vente_minimum)}</b>,
                ],
              }
            })}
          />
        ) : (
          <List
            count={accessories.length}
            head={['Accessoire', 'Catégorie', 'Stock', 'Prix de vente', 'Dernier prix']}
            rows={accessories.map(a => ({
              key: a.acc_id,
              cells: [
                <span key="n"><b className="text-[#1A1A1A]">{a.nom}</b>{a.marque && <span className="text-[#6B6860]"> · {a.marque}</span>}</span>,
                <span key="c" className="text-[#6B6860]">{categoryLabel(accCats, a.categorie, false)}</span>,
                <span key="s" className={a.quantite > 0 ? 'text-[#1A1A1A]' : 'text-red-600'}>{a.quantite}</span>,
                <b key="p" className="text-[#1A1A1A]">{mad(a.prix_vente_recommande)}</b>,
                <b key="m" className="text-emerald-700">{mad(a.prix_vente_minimum)}</b>,
              ],
            }))}
          />
        )}
      </div>
    </div>
  )
}

/** Table on wide screens and paper, cards on phones. */
function List({ head, rows, count }: { head: string[]; rows: { key: string; cells: React.ReactNode[] }[]; count: number }) {
  if (count === 0) return <p className="text-sm text-[#8A877F] bg-white border border-[#E8E5DE] rounded-2xl p-4">Aucun article.</p>
  return (
    <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden print:border-0 print:rounded-none">
      <p className="px-4 py-2 text-xs text-[#8A877F] border-b border-[#F2F0EB] print:hidden">{count} article(s)</p>
      <table className="w-full text-sm hidden md:table print:table">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-[#8A877F] border-b border-[#E8E5DE]">
            {head.map((h, i) => <th key={h} className={`py-2 px-3 font-semibold ${i >= head.length - 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F2F0EB]">
          {rows.map(r => (
            <tr key={r.key} className="break-inside-avoid">
              {r.cells.map((c, i) => <td key={i} className={`py-2 px-3 ${i >= r.cells.length - 2 ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="md:hidden print:hidden divide-y divide-[#F2F0EB]">
        {rows.map(r => (
          <div key={r.key} className="px-4 py-3 space-y-1">
            <div className="text-[15px]">{r.cells[0]}</div>
            <div className="text-xs flex flex-wrap gap-x-3">{r.cells[1]}{r.cells[2]}</div>
            <div className="flex justify-between text-sm pt-1">
              <span><span className="text-xs text-[#8A877F]">Prix </span>{r.cells[3]}</span>
              <span><span className="text-xs text-[#8A877F]">Dernier prix </span>{r.cells[4]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
