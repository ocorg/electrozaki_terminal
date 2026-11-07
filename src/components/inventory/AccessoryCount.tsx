'use client'
import { useMemo, useState } from 'react'
import { Minus, Plus, Search, ScanLine, ClipboardCheck, X, Layers } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { useCategories } from '@/lib/hooks/useCategories'
import { Btn, Modal, inputClass } from '@/components/shared'
import ScanButton from '@/components/scanner/ScanButton'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { playScanSound } from '@/lib/scanSound'
import { confirmDialog } from '@/components/shared/ConfirmHost'
import { modelsLabel } from '@/lib/phoneGroups'
import { LinkCodeModal } from '@/components/pos/LinkCodeModal'

// Inventaire → Accessoires (owner, 2026-11-07; rules in lib/accessoryCount).
// Scan = +1 on the article or the variant its code says; naked products get
// their number typed. « Terminer » lists the gaps; a manager applies them.

type Variant = { variant_id: string; design: string | null; couleur: string | null; modeles: string[]; quantite: number }
type Acc = { acc_id: string; nom: string; marque?: string | null; categorie: string; quantite: number; barcode?: string | null; variants?: Variant[]; codes?: { code: string; variant_id: string | null }[] }
type Count = { count_id: string; categories: string[]; started_at: string; lines: { acc_id: string; line_key: string; counted: number }[] }
type Gap = { acc_id: string; nom: string; categorie: string; line_key: string; label: string; expected: number; counted: number | null }
const ART = '-'

export default function AccessoryCount({ storeId }: { storeId: string }) {
  const accQ = useApi<Acc[]>(`/api/accessories?store_id=${storeId}`)
  const countQ = useApi<Count | null>(`/api/inventory/accessories?store_id=${storeId}`)
  const { accessories: cats } = useCategories()
  const count = countQ.data ?? null
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [chooseFor, setChooseFor] = useState<Acc | null>(null)
  const [gaps, setGaps] = useState<Gap[] | null>(null)

  const catLabel = (c: string) => cats.find(x => x.code === c)?.fr ?? c
  const inScope = useMemo(() => (accQ.data ?? []).filter(a => a.categorie !== 'service' && (!count?.categories.length || count.categories.includes(a.categorie))), [accQ.data, count])
  const counted = useMemo(() => new Map((count?.lines ?? []).map(l => [`${l.acc_id}|${l.line_key}`, l.counted])), [count])
  const vText = (v: Variant) => [v.design, v.couleur, modelsLabel(v.modeles)].filter(Boolean).join(' · ') || 'variante'

  // the scanned code → article / variant (same rules as the till, lib/accessoryCodes)
  const codeIndex = useMemo(() => {
    const m = new Map<string, { acc_id: string; variant_id: string | null }>()
    for (const a of accQ.data ?? []) {
      for (const c of a.codes ?? []) m.set(c.code.toLowerCase(), { acc_id: a.acc_id, variant_id: c.variant_id })
      if (a.barcode) m.set(a.barcode.toLowerCase(), { acc_id: a.acc_id, variant_id: null })
      m.set(a.acc_id.toLowerCase(), { acc_id: a.acc_id, variant_id: null })
      m.set(`ez${Number(a.acc_id.replace(/\D/g, ''))}`, { acc_id: a.acc_id, variant_id: null })
      for (const v of a.variants ?? []) m.set(`ev${Number(v.variant_id.replace(/\D/g, ''))}`, { acc_id: a.acc_id, variant_id: v.variant_id })
    }
    return m
  }, [accQ.data])

  async function patch(accId: string, lineKey: string, op: { add?: number; set?: number }) {
    if (!count) return
    try {
      await apiWrite(`/api/inventory/accessories/${count.count_id}`, { method: 'PATCH', body: { acc_id: accId, line_key: lineKey, ...op } })
      countQ.refresh()
    } catch (e) { playScanSound('error'); showError((e as Error).message) }
  }

  function onScan(raw: string) {
    const hit = codeIndex.get(raw.trim().toLowerCase())
    if (!hit) { playScanSound('inv_unknown'); setLinkFor(raw.trim()); return }
    const acc = inScope.find(a => a.acc_id === hit.acc_id)
    if (!acc) { playScanSound('inv_outside'); showError('Cet article ne fait pas partie de ce comptage'); return }
    // a code shared by every variant: which one is it?
    if (!hit.variant_id && acc.variants?.length) { setChooseFor(acc); return }
    patch(acc.acc_id, hit.variant_id ?? ART, { add: 1 })
    showSuccess(`+1 ${acc.nom}${hit.variant_id ? ` · ${vText(acc.variants!.find(v => v.variant_id === hit.variant_id)!)}` : ''}`)
  }

  async function start() {
    setBusy(true)
    try { await apiWrite('/api/inventory/accessories', { method: 'POST', body: { store_id: storeId, categories: [...picked] } }); countQ.refresh() }
    catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }
  async function showGaps() {
    if (!count) return
    try {
      const r = await fetch(`/api/inventory/accessories/${count.count_id}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Erreur')
      setGaps(j.data)
    } catch (e) { showError((e as Error).message) }
  }
  async function apply() {
    if (!count || !(await confirmDialog('Corriger le stock avec les lignes comptées ? Les lignes non comptées gardent leur stock.'))) return
    setBusy(true)
    try {
      const r = await apiWrite<{ data: { changes: unknown[] } }>(`/api/inventory/accessories/${count.count_id}/apply`, { method: 'POST' }) as unknown as { data: { changes: unknown[] } }
      showSuccess(`Stock corrigé : ${r.data.changes.length} ligne(s)`)
      setGaps(null); countQ.refresh(); accQ.refresh()
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }
  async function cancel() {
    if (!count || !(await confirmDialog('Annuler ce comptage ? Le stock ne change pas.'))) return
    try { await apiWrite(`/api/inventory/accessories/${count.count_id}`, { method: 'DELETE' }); setGaps(null); countQ.refresh() } catch (e) { showError((e as Error).message) }
  }

  if (countQ.isLoading || accQ.isLoading) return <p className="p-6 text-sm text-ez-subtle">Chargement…</p>

  if (!count) {
    const types = [...new Set((accQ.data ?? []).map(a => a.categorie))].filter(c => c !== 'service').sort((a, b) => catLabel(a).localeCompare(catLabel(b), 'fr'))
    return (
      <div className="p-4 sm:p-6 max-w-3xl space-y-4">
        <div className="rounded-2xl border border-ez-border bg-white p-5 space-y-4">
          <div className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-gold" /><h2 className="text-lg font-bold">Compter les accessoires</h2></div>
          <p className="text-sm text-ez-subtle">Scannez chaque pièce (code de la boîte ou nos étiquettes) : chaque scan compte 1. Pour les produits nus, tapez le nombre. Rien ne change dans le stock avant « Appliquer ».</p>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ez-subtle mb-2">Types à compter (aucun coché = tous)</p>
            <div className="flex flex-wrap gap-2">
              {types.map(c => (
                <button key={c} type="button" onClick={() => setPicked(p => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n })}
                  className={`px-3 py-1.5 rounded-full border text-sm ${picked.has(c) ? 'border-gold bg-gold/10 font-semibold' : 'border-ez-border'}`}>{catLabel(c)}</button>
              ))}
            </div>
          </div>
          <Btn onClick={start} loading={busy}><ClipboardCheck className="w-4 h-4" />Commencer le comptage</Btn>
        </div>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const shown = inScope.filter(a => !q || [a.nom, a.marque, a.acc_id].some(x => x?.toLowerCase().includes(q)))
  const touched = count.lines.length
  const byType = new Map<string, Acc[]>()
  for (const a of shown) byType.set(a.categorie, [...(byType.get(a.categorie) ?? []), a])

  const Row = ({ acc, lineKey, label, expected }: { acc: Acc; lineKey: string; label: string; expected: number }) => {
    const c = counted.get(`${acc.acc_id}|${lineKey}`)
    const diff = c === undefined ? null : c - expected
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="flex-1 min-w-0 text-sm truncate">{label}</span>
        <span className="text-xs text-ez-faint whitespace-nowrap">stock {expected}</span>
        <button type="button" onClick={() => patch(acc.acc_id, lineKey, { add: -1 })} disabled={!c} aria-label="Retirer 1" className="w-8 h-8 rounded-lg border border-ez-border flex items-center justify-center disabled:opacity-30"><Minus className="w-3.5 h-3.5" /></button>
        <input key={`${lineKey}-${c ?? 'x'}`} type="number" min={0} defaultValue={c ?? ''} placeholder="—"
          onBlur={e => { const v = e.target.value.trim(); if (v !== '' && Number(v) !== c) patch(acc.acc_id, lineKey, { set: Math.max(0, Math.floor(Number(v)) || 0) }) }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          aria-label={`Compté : ${acc.nom} ${label}`} className="w-16 text-center rounded-lg border border-ez-border py-1 text-sm tabular-nums" />
        <button type="button" onClick={() => patch(acc.acc_id, lineKey, { add: 1 })} aria-label="Ajouter 1" className="w-8 h-8 rounded-lg border border-ez-border flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
        <span className={`w-12 text-end text-xs font-bold tabular-nums ${diff === null ? 'text-ez-faint' : diff === 0 ? 'text-emerald-600' : 'text-red-600'}`}>{diff === null ? '' : diff === 0 ? 'OK' : diff > 0 ? `+${diff}` : diff}</span>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <p className="font-bold">Comptage en cours · {touched} ligne(s) comptée(s)</p>
          <p className="text-xs text-ez-subtle">Depuis {new Date(count.started_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · {count.categories.length ? count.categories.map(catLabel).join(', ') : 'tous les types'}</p>
        </div>
        <ScanButton sound="inv_found" onScan={onScan} hint="Scannez la pièce" mode="barcode" />
        <Btn variant="secondary" onClick={showGaps}><ClipboardCheck className="w-4 h-4" />Terminer : voir les écarts</Btn>
        <button type="button" onClick={cancel} className="text-sm underline text-ez-subtle">Annuler le comptage</button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-ez-placeholder" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher un article…" className={`${inputClass} ps-9`} />
      </div>

      <div className="space-y-4">
        {[...byType].sort((a, b) => catLabel(a[0]).localeCompare(catLabel(b[0]), 'fr')).map(([type, accs]) => (
          <div key={type} className="rounded-2xl border border-ez-border bg-white">
            <p className="px-4 py-2.5 bg-ez-bg rounded-t-2xl text-xs font-bold uppercase tracking-widest">{catLabel(type)} · {accs.length}</p>
            <div className="divide-y divide-ez-border">
              {accs.map(a => {
                const vs = a.variants ?? []
                const inV = vs.reduce((n, v) => n + v.quantite, 0)
                return (
                  <div key={a.acc_id} className="px-4 py-2">
                    {vs.length ? (
                      <>
                        <p className="text-sm font-semibold">{a.nom}{a.marque ? <span className="text-ez-faint font-normal"> · {a.marque}</span> : null}</p>
                        {vs.map(v => <div key={v.variant_id} className="ps-4 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-ez-faint flex-shrink-0" /><div className="flex-1 min-w-0"><Row acc={a} lineKey={v.variant_id} label={vText(v)} expected={v.quantite} /></div></div>)}
                        <div className="ps-4"><Row acc={a} lineKey={ART} label="sans variante (non réparti)" expected={Math.max(0, a.quantite - inV)} /></div>
                      </>
                    ) : (
                      <Row acc={a} lineKey={ART} label={`${a.nom}${a.marque ? ` · ${a.marque}` : ''}`} expected={a.quantite} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {chooseFor && (
        <Modal open onClose={() => setChooseFor(null)} title={`${chooseFor.nom} : quelle variante ?`} size="md">
          <div className="grid gap-2">
            {(chooseFor.variants ?? []).map(v => (
              <button key={v.variant_id} type="button" onClick={() => { patch(chooseFor.acc_id, v.variant_id, { add: 1 }); setChooseFor(null) }}
                className="text-start px-3 py-2.5 rounded-xl border border-ez-border hover:border-gold text-sm">{vText(v)}</button>
            ))}
            <button type="button" onClick={() => { patch(chooseFor.acc_id, ART, { add: 1 }); setChooseFor(null) }} className="text-start px-3 py-2.5 rounded-xl border border-dashed border-ez-border text-sm text-ez-subtle">Sans variante (non réparti)</button>
          </div>
        </Modal>
      )}

      {linkFor && (
        <LinkCodeModal code={linkFor} isAr={false} accessories={inScope as unknown as Parameters<typeof LinkCodeModal>[0]['accessories']}
          onClose={() => setLinkFor(null)}
          onLinked={(accId, variantId) => { setLinkFor(null); accQ.refresh(); const a = inScope.find(x => x.acc_id === accId); if (a && !variantId && a.variants?.length) setChooseFor(a); else patch(accId, variantId ?? ART, { add: 1 }) }} />
      )}

      {gaps && (
        <Modal open onClose={() => setGaps(null)} title="Écarts du comptage" size="lg">
          {(() => {
            const touchedGaps = gaps.filter(g => g.counted !== null)
            const wrong = touchedGaps.filter(g => g.counted !== g.expected)
            const notCounted = gaps.filter(g => g.counted === null && g.expected > 0).length
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[['Lignes comptées', touchedGaps.length], ['Écarts', wrong.length], ['Non comptées (gardées)', notCounted]].map(([k, v]) => (
                    <div key={k as string} className="rounded-xl border border-ez-border p-2"><p className="text-[11px] text-ez-subtle">{k}</p><p className="text-lg font-bold">{v}</p></div>
                  ))}
                </div>
                <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-ez-border divide-y divide-ez-border">
                  {wrong.map(g => (
                    <div key={`${g.acc_id}|${g.line_key}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1 min-w-0 truncate">{g.nom}{g.label ? <span className="text-ez-faint"> · {g.label}</span> : null}</span>
                      <span className="tabular-nums text-ez-subtle">{g.expected} → <b className="text-ez-text">{g.counted}</b></span>
                      <span className={`w-12 text-end font-bold tabular-nums ${g.counted! > g.expected ? 'text-emerald-600' : 'text-red-600'}`}>{g.counted! - g.expected > 0 ? '+' : ''}{g.counted! - g.expected}</span>
                    </div>
                  ))}
                  {!wrong.length && <p className="px-3 py-3 text-sm text-emerald-700">Aucun écart sur les lignes comptées.</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Btn variant="ghost" onClick={() => setGaps(null)}><X className="w-4 h-4" />Continuer à compter</Btn>
                  <Btn onClick={apply} loading={busy}><ScanLine className="w-4 h-4" />Appliquer au stock et terminer</Btn>
                </div>
              </div>
            )
          })()}
        </Modal>
      )}
    </div>
  )
}
