'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, Search, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { useApi } from '@/lib/data/api'
import { useLanguageStore } from '@/lib/stores/language'
import { Btn, inputClass, selectClass, Select, PageHeader } from '@/components/shared'
import { useCouleurs, useColourLabel } from '@/components/shared/ColourPicker'
import { modelsLabel } from '@/lib/phoneGroups'

// Grouped label printing on A4 sticker sheets (owner, 2026-11-07): pick
// articles or variants and how many of each, the sheets are laid out side by
// side with dashed cut lines, then printed from the browser. No prices (they
// change, the label stays). The QR holds our short code (EZ42 = article,
// EV35 = variant, lib/accessoryCodes), the text is for the eye.

type Variant = { variant_id: string; design: string | null; couleur: string | null; modeles: string[]; quantite: number }
type Acc = { acc_id: string; nom: string; marque?: string | null; categorie: string; couleur?: string | null; quantite: number; variants?: Variant[] }

type Format = 'mini' | 'flag' | 'card'
// sizes in mm; 5 mm kept free around the sheet (printers can't print the edge)
const FORMATS: Record<Format, { w: number; h: number; fr: string; ar: string; hint: string }> = {
  mini: { w: 30, h: 20, fr: 'Mini 30 × 20 mm', ar: 'صغير', hint: 'boîtes en réserve, sachets' },
  flag: { w: 40, h: 14, fr: 'Drapeau câble 40 × 14 mm', ar: 'علم الكابل', hint: 'plié autour du câble, le QR des deux côtés' },
  card: { w: 50, h: 30, fr: 'Case comptoir 50 × 30 mm', ar: 'بطاقة', hint: 'planche du comptoir, produits nus' },
}
const SHEET = { w: 210, h: 297, m: 5 }
const perSheet = (f: Format) => {
  const { w, h } = FORMATS[f]
  const cols = Math.floor((SHEET.w - 2 * SHEET.m) / w), rows = Math.floor((SHEET.h - 2 * SHEET.m) / h)
  return { cols, rows, n: cols * rows }
}
const shortOf = (id: string, prefix: 'EZ' | 'EV') => `${prefix}${Number(id.replace(/\D/g, ''))}`

type Label = { code: string; name: string; line: string }

export default function LabelSheets({ storeId }: { storeId: string }) {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const couleurs = useCouleurs()
  const colourLabel = useColourLabel()
  const accQ = useApi<Acc[]>(`/api/accessories?store_id=${storeId}`)
  const all = useMemo(() => (accQ.data ?? []).slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), [accQ.data])

  const [format, setFormat] = useState<Format>('mini')
  const [start, setStart] = useState(1)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [qty, setQty] = useState<Record<string, number>>({})   // key: acc_id or variant_id
  const [svgs, setSvgs] = useState<Record<string, string>>({})

  // an article opened from its fiche: ?acc=EZ-ACC-…
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('acc')
    if (id) { setSearch(''); setOpen(new Set([id])) }
  }, [])

  const vText = (v: Variant) => [v.design, v.couleur && colourLabel(couleurs.byName.get(v.couleur), v.couleur), modelsLabel(v.modeles)].filter(Boolean).join(' · ')
  const shown = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const preset = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('acc') : null
    return all.filter(a => (!tokens.length && (!preset || a.acc_id === preset || open.has(a.acc_id))) || (tokens.length && tokens.every(t => [a.nom, a.marque, a.acc_id].some(x => x?.toLowerCase().includes(t)))))
      .slice(0, tokens.length ? 60 : 200)
  }, [all, search, open])

  // the labels, grouped article by article in the list order
  const labels = useMemo(() => {
    const out: Label[] = []
    for (const a of all) {
      const n = qty[a.acc_id] ?? 0
      for (let i = 0; i < n; i++) out.push({ code: shortOf(a.acc_id, 'EZ'), name: a.nom, line: [a.marque, a.couleur].filter(Boolean).join(' · ') })
      for (const v of a.variants ?? []) {
        const k = qty[v.variant_id] ?? 0
        for (let i = 0; i < k; i++) out.push({ code: shortOf(v.variant_id, 'EV'), name: a.nom, line: vText(v) })
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, qty, couleurs.byName])

  // one QR per distinct code (qrcode is already used by the Phomemo labels)
  useEffect(() => {
    const missing = [...new Set(labels.map(l => l.code))].filter(c => !svgs[c])
    if (!missing.length) return
    let alive = true
    import('qrcode').then(async QR => {
      const made: Record<string, string> = {}
      for (const c of missing) made[c] = await QR.toString(c, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      if (alive) setSvgs(s => ({ ...s, ...made }))
    })
    return () => { alive = false }
  }, [labels, svgs])

  const { cols, rows, n } = perSheet(format)
  const skip = Math.min(Math.max(1, start), n) - 1
  const cells: (Label | null)[] = [...Array(skip).fill(null), ...labels]
  const sheets: (Label | null)[][] = []
  for (let i = 0; i < cells.length; i += n) sheets.push(cells.slice(i, i + n))
  const set = (k: string, v: number) => setQty(q => ({ ...q, [k]: Math.max(0, Math.min(999, Math.floor(v) || 0)) }))
  const toggle = (id: string) => setOpen(o => { const x = new Set(o); if (x.has(id)) x.delete(id); else x.add(id); return x })
  const f = FORMATS[format]
  // the grid centred on the sheet
  const ox = (SHEET.w - cols * f.w) / 2, oy = (SHEET.h - rows * f.h) / 2

  return (
    <div className="flex flex-col h-full overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
      <style>{`
        @page { size: A4; margin: 0 }
        @media print {
          body * { visibility: hidden !important }
          .ez-print, .ez-print * { visibility: visible !important }
          .ez-print { position: absolute; inset: 0 auto auto 0; }
          .ez-sheet { box-shadow: none !important; margin: 0 !important; transform: none !important; page-break-after: always; break-after: page; }
          .ez-sheet-wrap { transform: none !important; margin: 0 !important; height: auto !important; }
        }
        .ez-sheet { width: 210mm; height: 297mm; background: #fff; position: relative; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
        .ez-cell { position: absolute; box-sizing: border-box; overflow: hidden; color: #111; font-family: Arial, sans-serif; }
        .ez-cell svg { display: block; width: 100%; height: 100%; }
        .ez-cut-v { position: absolute; top: 0; bottom: 0; border-left: 0.2mm dashed #999; }
        .ez-cut-h { position: absolute; left: 0; right: 0; border-top: 0.2mm dashed #999; }
      `}</style>

      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 space-y-3 print:hidden">
        <PageHeader
          title={L('Imprimer des étiquettes', 'طباعة الملصقات')}
          subtitle={L('Feuille A4 autocollante, découpée aux pointillés. Sans prix.', 'ورقة A4 لاصقة')}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/ez/stock/accessories" className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-ez-border bg-white text-sm text-ez-subtle"><ArrowLeft className="w-4 h-4" />{L('Accessoires', 'الإكسسوارات')}</Link>
              <Btn onClick={() => window.print()} disabled={!labels.length}><Printer className="w-4 h-4" />{L(`Imprimer ${labels.length} étiquette(s)`, 'طباعة')}</Btn>
            </div>
          }
        />
      </div>

      <div className="flex-1 overflow-hidden grid lg:grid-cols-[minmax(320px,420px)_1fr] gap-4 px-4 sm:px-6 pb-4 print:block print:p-0">
        {/* choices */}
        <div className="overflow-y-auto space-y-3 print:hidden min-w-0">
          <div className="rounded-xl border border-ez-border bg-white p-3 space-y-3">
            <div className="grid gap-1.5">
              {(Object.keys(FORMATS) as Format[]).map(k => (
                <label key={k} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${format === k ? 'border-gold bg-gold/5' : 'border-ez-border'}`}>
                  <input type="radio" name="format" checked={format === k} onChange={() => setFormat(k)} className="mt-1" />
                  <span className="text-sm"><b>{isAr ? FORMATS[k].ar : FORMATS[k].fr}</b> <span className="text-ez-subtle">· {perSheet(k).n} {L('par feuille', 'لكل ورقة')}</span><span className="block text-xs text-ez-faint">{FORMATS[k].hint}</span></span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              {L('Commencer à la case', 'ابدأ من الخانة')}
              <input type="number" min={1} max={n} value={start} onChange={e => setStart(Number(e.target.value) || 1)} className={`${inputClass} w-24`} />
              <span className="text-xs text-ez-faint">{L('(feuille entamée)', '')}</span>
            </label>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-placeholder" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Chercher un article…', 'ابحث عن منتج…')} className={`${inputClass} ps-9`} />
          </div>

          <div className="rounded-xl border border-ez-border bg-white divide-y divide-ez-border">
            {shown.map(a => {
              const vs = a.variants ?? []
              const isOpen = open.has(a.acc_id)
              return (
                <div key={a.acc_id} className="p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    {vs.length ? (
                      <button type="button" onClick={() => toggle(a.acc_id)} aria-label={L('Variantes', 'الأنواع')} className="p-1 rounded hover:bg-ez-muted">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                      </button>
                    ) : <span className="w-6" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{a.nom}</span>
                      <span className="block text-xs text-ez-faint">{shortOf(a.acc_id, 'EZ')} · {a.quantite} {L('en stock', 'في المخزون')}{vs.length ? ` · ${vs.length} ${L('variante(s)', 'نوع')}` : ''}</span>
                    </span>
                    <input type="number" min={0} value={qty[a.acc_id] ?? 0} onChange={e => set(a.acc_id, Number(e.target.value))}
                      aria-label={L(`Étiquettes de ${a.nom}`, 'العدد')} className="w-16 text-center rounded-lg border border-ez-border py-1 text-sm" />
                  </div>
                  {isOpen && vs.map(v => (
                    <div key={v.variant_id} className="flex items-center gap-2 ps-8">
                      <Layers className="w-3.5 h-3.5 text-ez-faint flex-shrink-0" />
                      <span className="flex-1 min-w-0 text-sm truncate">{vText(v) || '—'} <span className="text-xs text-ez-faint font-mono">{shortOf(v.variant_id, 'EV')}</span></span>
                      <button type="button" onClick={() => set(v.variant_id, v.quantite)} className="text-xs underline text-ez-subtle whitespace-nowrap">{L(`= stock (${v.quantite})`, `= ${v.quantite}`)}</button>
                      <input type="number" min={0} value={qty[v.variant_id] ?? 0} onChange={e => set(v.variant_id, Number(e.target.value))}
                        aria-label={L('Étiquettes de la variante', 'العدد')} className="w-16 text-center rounded-lg border border-ez-border py-1 text-sm" />
                    </div>
                  ))}
                </div>
              )
            })}
            {!shown.length && <p className="p-3 text-sm text-ez-faint">{search.trim() ? L('Aucun article', 'لا شيء') : L('Cherchez un article pour choisir ses étiquettes.', 'ابحث عن منتج')}</p>}
          </div>
          {labels.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-ez-subtle">{labels.length} {L('étiquette(s)', 'ملصق')} · {sheets.length} {L('feuille(s)', 'ورقة')}</span>
              <button type="button" onClick={() => setQty({})} className="underline text-ez-subtle">{L('Tout effacer', 'مسح')}</button>
            </div>
          )}
        </div>

        {/* preview = what is printed */}
        <div className="overflow-auto bg-ez-muted/40 rounded-xl p-4 print:p-0 print:bg-transparent print:overflow-visible">
          {!labels.length && <p className="text-sm text-ez-subtle p-4 print:hidden">{L('L’aperçu des feuilles apparaît ici.', 'المعاينة هنا')}</p>}
          <div className="ez-print">
            {sheets.map((sheet, si) => (
              <div key={si} className="ez-sheet-wrap" style={{ transform: 'scale(.6)', transformOrigin: 'top left', height: 'calc(297mm * .6 + 16px)' }}>
                <div className="ez-sheet">
                  {/* dashed cut lines */}
                  {[...Array(cols + 1)].map((_, c) => <div key={`v${c}`} className="ez-cut-v" style={{ left: `${ox + c * f.w}mm`, top: `${oy}mm`, bottom: 'auto', height: `${rows * f.h}mm` }} />)}
                  {[...Array(rows + 1)].map((_, r) => <div key={`h${r}`} className="ez-cut-h" style={{ top: `${oy + r * f.h}mm`, left: `${ox}mm`, right: 'auto', width: `${cols * f.w}mm` }} />)}
                  {sheet.map((l, i) => l && (
                    <div key={i} className="ez-cell" style={{ left: `${ox + (i % cols) * f.w}mm`, top: `${oy + Math.floor(i / cols) * f.h}mm`, width: `${f.w}mm`, height: `${f.h}mm` }}>
                      <Cell label={l} format={format} svg={svgs[l.code]} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** One label's drawing, in mm. */
function Cell({ label, format, svg }: { label: Label; format: Format; svg?: string }) {
  const qr = (size: number, style: React.CSSProperties = {}) => (
    <div style={{ width: `${size}mm`, height: `${size}mm`, flexShrink: 0, ...style }} dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
  )
  const clamp = (lines: number): React.CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' })
  if (format === 'flag') {
    // folded in the middle around the cable: the same QR + code on each half
    const half = (
      <div style={{ width: '20mm', height: '14mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.6mm' }}>
        {qr(10)}
        <div style={{ fontSize: '5.5pt', fontFamily: 'Consolas, monospace', lineHeight: 1 }}>{label.code}</div>
      </div>
    )
    return (
      <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
        {half}
        <div style={{ position: 'absolute', left: '20mm', top: '1mm', bottom: '1mm', borderLeft: '0.2mm dotted #bbb' }} />
        {half}
      </div>
    )
  }
  const big = format === 'card'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: big ? '2mm' : '1.2mm', height: '100%', padding: big ? '2mm' : '1.2mm', boxSizing: 'border-box' }}>
      {qr(big ? 24 : 15)}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: big ? '0.8mm' : '0.4mm' }}>
        <div style={{ fontSize: big ? '8.5pt' : '6.5pt', fontWeight: 700, lineHeight: 1.1, ...clamp(big ? 3 : 2) }}>{label.name}</div>
        {label.line && <div style={{ fontSize: big ? '7pt' : '5.5pt', lineHeight: 1.1, ...clamp(2) }}>{label.line}</div>}
        <div style={{ fontSize: big ? '7pt' : '5.5pt', fontFamily: 'Consolas, monospace', color: '#444' }}>{label.code}</div>
      </div>
    </div>
  )
}
