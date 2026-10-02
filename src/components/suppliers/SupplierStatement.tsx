'use client'
// A supplier's statement (owner, 2026-10-02): how we got to what he is owed —
// one-line calculation, bank-style ledger, trade-in chains — with a PDF to
// send him. Managers only (the supplier portal is).
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, FileDown, ShoppingCart, Banknote, CheckCircle2, Clock, Package } from 'lucide-react'
import { useEscapeKey } from '@/lib/hooks/useEscapeKey'
import { formatMAD, getBusinessDate } from '@/lib/utils'
import { STORE_TIME_ZONE } from '@/lib/time'

interface PhoneDesc { phone_id: string; name: string; imei: string | null; specs: string; issues: string | null }
interface Line { at: string; kind: 'vente' | 'paiement'; label: string; phone?: PhoneDesc; detail?: string; du: number; paye: number; solde: number }
interface ChainNode { phone: PhoneDesc; carried: number; owed_on_sale: number; state: 'regle' | 'a_regler' | 'en_stock' | 'autre'; status: string; payment?: string | null; children: ChainNode[] }
interface Statement {
  supplier: { supplier_id: string; nom: string; telephone: string | null; categorie: string }
  summary: { vendus_a_regler: number; nb_a_regler: number; credit: number; a_payer: number; total_paye: number; en_stock: number; nb_en_stock: number; reprises_en_attente: number; nb_reprises_en_attente: number }
  period: { from: string | null; to: string | null; opening: number }
  ledger: Line[]
  closing: number
  chains: ChainNode[]
}

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: STORE_TIME_ZONE, day: '2-digit', month: '2-digit', year: '2-digit' })
const dh = (n: number) => `${Number(n).toLocaleString('fr-MA')} DH`
const phoneLine = (p: PhoneDesc) => [p.name, p.imei ? `IMEI ${p.imei}` : null, p.specs].filter(Boolean).join(' · ')

function monthRange(offset: number) {
  const [y, m] = getBusinessDate().split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + offset, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}

const STATE: Record<ChainNode['state'], { label: string; cls: string; icon: React.ElementType }> = {
  regle:    { label: 'réglé',            cls: 'text-emerald-600', icon: CheckCircle2 },
  a_regler: { label: 'à régler',         cls: 'text-red-500',     icon: Clock },
  en_stock: { label: 'en stock — sera dû à sa vente', cls: 'text-ez-subtle', icon: Package },
  autre:    { label: '',                 cls: 'text-ez-subtle',   icon: Package },
}

function Chain({ n, depth = 0 }: { n: ChainNode; depth?: number }) {
  const st = STATE[n.state]
  const Icon = st.icon
  const passed = n.children.reduce((s, c) => s + c.carried, 0)
  return (
    <div className={depth ? 'ml-4 pl-3 border-l border-ez-border' : ''}>
      <div className="py-1.5">
        <p className="text-sm font-semibold text-ez-text">{n.phone.phone_id} · {n.phone.name} <span className="font-normal text-ez-faint">— porte {dh(n.carried)}</span></p>
        <p className="text-xs text-ez-faint">{[n.phone.imei ? `IMEI ${n.phone.imei}` : null, n.phone.specs].filter(Boolean).join(' · ')}</p>
        {n.phone.issues && <p className="text-xs text-red-600">{n.phone.issues}</p>}
        <p className={`text-xs flex items-center gap-1 ${st.cls}`}>
          <Icon className="w-3.5 h-3.5" />
          {n.state === 'en_stock' ? `${dh(n.owed_on_sale)} ${st.label}` : `${dh(n.owed_on_sale)} dus à sa vente${st.label ? ` — ${st.label}` : ''}${n.payment ? ` (${n.payment})` : ''}`}
          {passed > 0 && <span className="text-ez-faint"> · {dh(passed)} reportés sur sa reprise</span>}
        </p>
      </div>
      {n.children.map(c => <Chain key={c.phone.phone_id} n={c} depth={depth + 1} />)}
    </div>
  )
}

const chainTotal = (n: ChainNode): number => n.owed_on_sale + n.children.reduce((s, c) => s + chainTotal(c), 0)

async function downloadPdf(st: Statement) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 12
  let y = M
  const clean = (t: string) => t.replace(/→/g, '->').replace(/−/g, '-').replace(/[^\x20-\x7E -ÿ\n]/g, '')
  const text = (t: string, size = 9, bold = false, color: [number, number, number] = [26, 26, 26], x = M, maxW = W - 2 * M) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color)
    const rows = pdf.splitTextToSize(clean(t), maxW) as string[]
    for (const r of rows) { if (y > 285) { pdf.addPage(); y = M } pdf.text(r, x, y); y += size * 0.42 + 0.6 }
  }
  const rule = () => { pdf.setDrawColor(232, 229, 222); pdf.line(M, y, W - M, y); y += 2 }

  text('ELECTRO ZAKI', 14, true, [201, 164, 64])
  text(`Relevé fournisseur — ${st.supplier.nom}`, 12, true)
  text(`Édité le ${new Date().toLocaleDateString('fr-FR')}${st.period.from || st.period.to ? ` · période ${st.period.from ?? '…'} au ${st.period.to ?? '…'}` : ' · depuis le début'}`, 8, false, [107, 104, 96])
  y += 2; rule()
  text(`Téléphones vendus à régler (${st.summary.nb_a_regler}) : ${dh(st.summary.vendus_a_regler)}   -   crédit : ${dh(st.summary.credit)}   =   À PAYER : ${dh(st.summary.a_payer)}`, 10, true)
  if (st.summary.nb_reprises_en_attente) text(`En attente (reprises pas encore vendues) : ${dh(st.summary.reprises_en_attente)} sur ${st.summary.nb_reprises_en_attente} téléphone(s)`, 8, false, [107, 104, 96])
  y += 2; rule()

  text('Relevé de compte', 11, true)
  if (st.period.from) text(`Solde au ${st.period.from} : ${dh(st.period.opening)}`, 8, false, [107, 104, 96])
  for (const l of st.ledger) {
    if (y > 270) { pdf.addPage(); y = M }
    const amt = l.du ? `+${dh(l.du)}` : `-${dh(l.paye)}`
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(26, 26, 26)
    pdf.text(clean(`${day(l.at)}  ${l.label}`), M, y)
    pdf.text(clean(amt), W - M - 45, y, { align: 'right' })
    pdf.text(clean(`solde ${dh(l.solde)}`), W - M, y, { align: 'right' })
    y += 4.4
    if (l.phone) text(phoneLine(l.phone), 8, false, [107, 104, 96], M + 4)
    if (l.phone?.issues) text(l.phone.issues, 8, false, [185, 28, 28], M + 4)
    if (l.detail) text(l.detail, 8, false, [107, 104, 96], M + 4)
    y += 1
  }
  text(`Solde final : ${dh(st.closing)}${st.closing < 0 ? ' (crédit en notre faveur)' : ''}`, 10, true)

  if (st.chains.length) {
    y += 3; rule(); text('Chaînes de reprises', 11, true)
    const walk = (n: ChainNode, depth: number) => {
      const pad = M + depth * 5
      text(`${depth ? '└ ' : ''}${n.phone.phone_id} · ${phoneLine(n.phone)} — porte ${dh(n.carried)}`, 8, true, [26, 26, 26], pad)
      if (n.phone.issues) text(n.phone.issues, 8, false, [185, 28, 28], pad + 3)
      text(`${dh(n.owed_on_sale)} ${n.state === 'regle' ? `réglé${n.payment ? ` (${n.payment})` : ''}` : n.state === 'a_regler' ? 'à régler' : n.state === 'en_stock' ? 'en stock, dû à sa vente' : n.status}`, 8, false, [107, 104, 96], pad + 3)
      n.children.forEach(c => walk(c, depth + 1))
    }
    for (const c of st.chains) { walk(c, 0); text(`Total de la chaîne : ${dh(chainTotal(c))}`, 8, true, [201, 164, 64]); y += 1 }
  }
  pdf.save(`releve-${st.supplier.nom.replace(/\s+/g, '-')}-${getBusinessDate()}.pdf`)
}

export default function SupplierStatement({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const [period, setPeriod] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [st, setSt] = useState<Statement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  useEscapeKey(onClose, true)

  useEffect(() => {
    let alive = true
    setSt(null); setError(null)
    const qs = new URLSearchParams({ ...(period.from && { from: period.from }), ...(period.to && { to: period.to }) })
    fetch(`/api/suppliers/${supplierId}/statement?${qs}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (!ok) setError(j.error ?? 'Erreur'); else setSt(j.data) })
      .catch(() => alive && setError('Connexion impossible'))
    return () => { alive = false }
  }, [supplierId, period])

  const presets = useMemo(() => [
    { label: 'Tout', ...{ from: '', to: '' } },
    { label: 'Ce mois', ...monthRange(0) },
    { label: 'Mois dernier', ...monthRange(-1) },
  ], [])

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end items-end sm:items-stretch bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Relevé fournisseur" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[90vh] sm:max-h-none bg-white rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ez-border">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ez-text">Relevé{st ? ` — ${st.supplier.nom}` : ''}</h2>
            <p className="text-xs text-ez-faint">Comment on arrive au montant à payer</p>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={!st || pdfBusy} onClick={async () => { if (!st) return; setPdfBusy(true); try { await downloadPdf(st) } finally { setPdfBusy(false) } }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gold text-white disabled:opacity-40">
              {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}PDF
            </button>
            <button onClick={onClose} aria-label="Fermer" className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Period */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-ez-border text-xs">
          {presets.map(p => {
            const on = p.from === period.from && p.to === period.to
            return (
              <button key={p.label} onClick={() => setPeriod({ from: p.from, to: p.to })}
                className={`px-2.5 py-1 rounded-lg border font-bold ${on ? 'bg-gold text-white border-gold' : 'border-ez-border text-ez-subtle'}`}>{p.label}</button>
            )
          })}
          <input type="date" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} className="border border-ez-border rounded-lg px-2 py-1" />
          <span className="text-ez-faint">→</span>
          <input type="date" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} className="border border-ez-border rounded-lg px-2 py-1" />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error ? <p className="text-sm text-red-500">{error}</p>
            : !st ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-ez-faint" /></div>
            : (
              <>
                {/* 1. One-line calculation (always the current position) */}
                <section className="rounded-2xl bg-ez-bg border border-ez-border p-4">
                  <p className="text-sm text-ez-text">
                    Vendus à régler ({st.summary.nb_a_regler}) <b>{formatMAD(st.summary.vendus_a_regler)}</b>
                    {' − '}crédit <b>{formatMAD(st.summary.credit)}</b>
                    {' = '}<b className={st.summary.a_payer > 0 ? 'text-red-500' : 'text-emerald-600'}>À payer {formatMAD(st.summary.a_payer)}</b>
                  </p>
                  {st.summary.nb_reprises_en_attente > 0 && (
                    <p className="text-xs text-ez-subtle mt-1">En attente : {formatMAD(st.summary.reprises_en_attente)} sur {st.summary.nb_reprises_en_attente} téléphone(s) repris pas encore vendu(s)</p>
                  )}
                  <p className="text-xs text-ez-faint mt-1">Déjà payé au total : {formatMAD(st.summary.total_paye)} · En stock : {st.summary.nb_en_stock} tél. ({formatMAD(st.summary.en_stock)})</p>
                </section>

                {/* 2. Ledger */}
                <section>
                  <h3 className="text-xs font-bold text-ez-subtle uppercase tracking-wide mb-2">Relevé de compte</h3>
                  {st.period.from && <p className="text-xs text-ez-faint mb-2">Solde au {st.period.from} : <b>{formatMAD(st.period.opening)}</b></p>}
                  {!st.ledger.length ? <p className="text-sm text-ez-faint">Aucune opération sur cette période.</p> : (
                    <ol className="space-y-2">
                      {st.ledger.map((l, i) => (
                        <li key={i} className="rounded-xl border border-ez-border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs text-ez-faint">{day(l.at)}</p>
                              <p className="text-sm font-semibold text-ez-text flex items-center gap-1.5">
                                {l.kind === 'vente' ? <ShoppingCart className="w-3.5 h-3.5 text-gold" /> : <Banknote className="w-3.5 h-3.5 text-emerald-600" />}{l.label}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className={`text-sm font-bold ${l.du ? 'text-ez-text' : 'text-emerald-600'}`}>{l.du ? `+${formatMAD(l.du)}` : `−${formatMAD(l.paye)}`}</p>
                              <p className="text-xs text-ez-faint">solde {formatMAD(l.solde)}</p>
                            </div>
                          </div>
                          {l.phone && <p className="text-xs text-ez-subtle mt-1">{phoneLine(l.phone)}</p>}
                          {l.phone?.issues && <p className="text-xs text-red-600">{l.phone.issues}</p>}
                          {l.detail && <p className="text-xs text-ez-faint whitespace-pre-line mt-0.5">{l.detail}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="text-sm font-bold text-ez-text mt-3">Solde final : {formatMAD(st.closing)}{st.closing < 0 ? ' (crédit en notre faveur)' : ''}</p>
                </section>

                {/* 3. Trade-in chains */}
                <section>
                  <h3 className="text-xs font-bold text-ez-subtle uppercase tracking-wide mb-2">Chaînes de reprises</h3>
                  {!st.chains.length ? <p className="text-sm text-ez-faint">Aucune reprise reportée pour ce fournisseur (la règle s&apos;applique aux échanges à partir du 02/10/2026).</p> : (
                    <div className="space-y-3">
                      {st.chains.map(c => (
                        <div key={c.phone.phone_id} className="rounded-xl border border-ez-border p-3">
                          <Chain n={c} />
                          <p className="text-xs font-bold text-gold mt-1">Total de la chaîne : {dh(chainTotal(c))}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
