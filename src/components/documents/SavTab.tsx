'use client'

import { useState } from 'react'
import { Search, Printer, Loader2, CheckSquare, Square, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { WarrantyBadge } from './WarrantyBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

type SavMode = 'PEC' | 'RST' | 'BOTH'

interface WarrantyInfo {
  txn_id:                    string
  facture_ref:               string
  device_id:                 string
  prix_vente:                number
  date_vente:                string
  warranty_start:            string
  warranty_expiry_effective: string
  days_remaining:            number
  warranty_status:           'active' | 'expired' | 'no_warranty'
  sav_currently_open:        boolean
}

interface SavForm {
  lookup_query:    string
  warranty_info:   WarrantyInfo | null
  device_label:    string
  client_name:     string
  client_tel:      string
  mode:            SavMode
  probleme:        string
  defauts:         string[]
  accessories_pec: string
  date_prevue:     string
  remplacement:    string
  etat_retour:     string
  observations:    string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAUTS = [
  'Écran cassé / fissuré', 'Batterie défectueuse',
  'Charge ne fonctionne pas', 'Caméra défectueuse',
  'Haut-parleur défectueux', 'Micro défectueux',
  'Réseau / signal faible', 'WiFi défectueux',
  'Bluetooth défectueux', 'Face ID / Touch ID',
  'Boutons physiques', 'Autre',
]

const addWorkingDays = (d: Date, n: number) => {
  const r = new Date(d)
  let added = 0
  while (added < n) {
    r.setDate(r.getDate() + 1)
    if (r.getDay() !== 0 && r.getDay() !== 6) added++
  }
  return r
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' })

const DEFAULT: SavForm = {
  lookup_query: '', warranty_info: null,
  device_label: '', client_name: '', client_tel: '',
  mode: 'PEC', probleme: '', defauts: [], accessories_pec: '',
  date_prevue: addWorkingDays(new Date(), 2).toISOString().split('T')[0],
  remplacement: '', etat_retour: '', observations: '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SavTab() {
  const [form,     setForm]     = useState<SavForm>(DEFAULT)
  const [looking,  setLooking]  = useState(false)
  const [printing, setPrinting] = useState(false)
  const [pecRef,   setPecRef]   = useState('')
  const [rstRef,   setRstRef]   = useState('')
  const today = new Date()

  const set = (k: keyof SavForm, v: unknown) =>
    setForm(p => ({ ...p, [k]: v }))

  const toggleDefaut = (d: string) =>
    setForm(p => ({
      ...p,
      defauts: p.defauts.includes(d) ? p.defauts.filter(x => x !== d) : [...p.defauts, d],
    }))

  // ── Lookup ─────────────────────────────────────────────────────────────────

  const handleLookup = async () => {
    const q = form.lookup_query.trim()
    if (!q) return
    setLooking(true)
    try {
      const params = new URLSearchParams()
      if (/^\d{15}/.test(q)) params.set('imei', q)
      else params.set('facture_ref', q)

      const res  = await fetch(`/api/warranty?${params}`)
      const json = await res.json()
      if (json.status !== 'success') {
        toast.error('Aucune vente trouvée', { description: 'Vérifiez la référence ou l\'IMEI' })
        return
      }

      const info: WarrantyInfo = json.data

      // Try to load document details
      let deviceLabel = '', clientName = '', clientTel = ''
      if (info.facture_ref) {
        const docRes  = await fetch(`/api/documents/${info.facture_ref}`)
        const docJson = await docRes.json()
        if (docJson.status === 'success') {
          deviceLabel = docJson.data.device_label || ''
          clientName  = docJson.data.client_name  || ''
          clientTel   = docJson.data.client_tel   || ''
        }
      }

      setForm(p => ({ ...p, warranty_info: info, device_label: deviceLabel, client_name: clientName, client_tel: clientTel }))

      if (info.warranty_status === 'expired') {
        toast.warning('Garantie expirée', { description: `Expirée il y a ${Math.abs(info.days_remaining)} jours` })
      } else if (info.warranty_status === 'active') {
        toast.success('Garantie active', { description: `${info.days_remaining} jours restants` })
      }
    } catch { toast.error('Erreur lors de la recherche') }
    finally   { setLooking(false) }
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  const handlePrint = async () => {
    const info = form.warranty_info
    if (!info) { toast.error('Chargez d\'abord une vente via le lookup'); return }
    if (!form.probleme && (form.mode === 'PEC' || form.mode === 'BOTH')) {
      toast.error('Décrivez le problème signalé'); return
    }
    setPrinting(true)
    try {
      let newPecRef = pecRef
      let newRstRef = rstRef

      if (form.mode === 'PEC' || form.mode === 'BOTH') {
        const res  = await fetch('/api/documents', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_type:       'PEC',
            phone_id:       info.device_id    || null,
            client_name:    form.client_name  || null,
            client_tel:     form.client_tel   || null,
            device_label:   form.device_label || null,
            linked_doc_ref: info.facture_ref,
            doc_data:       form,
          }),
        })
        const json = await res.json()
        if (json.status !== 'success') throw new Error(json.error)
        newPecRef = json.data.doc_ref
        setPecRef(newPecRef)

        await fetch('/api/warranty/events', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txn_id: info.txn_id, facture_ref: info.facture_ref, event_type: 'SAV_OPEN', sav_ref: newPecRef }),
        })
      }

      if (form.mode === 'RST' || form.mode === 'BOTH') {
        const res  = await fetch('/api/documents', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_type:       'RST',
            phone_id:       info.device_id    || null,
            client_name:    form.client_name  || null,
            client_tel:     form.client_tel   || null,
            device_label:   form.device_label || null,
            linked_doc_ref: newPecRef || info.facture_ref,
            doc_data:       form,
          }),
        })
        const json = await res.json()
        if (json.status !== 'success') throw new Error(json.error)
        newRstRef = json.data.doc_ref
        setRstRef(newRstRef)

        await fetch('/api/warranty/events', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txn_id: info.txn_id, facture_ref: info.facture_ref, event_type: 'SAV_CLOSE', sav_ref: newRstRef }),
        })
      }

      setTimeout(() => { window.print(); setPrinting(false) }, 150)
    } catch (err: any) {
      toast.error('Erreur', { description: err.message })
      setPrinting(false)
    }
  }

  const info = form.warranty_info

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Screen ──────────────────────────────────────────────────────── */}
      <div className="print:hidden space-y-4 max-w-2xl">

        {/* Lookup */}
        <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
            Recherche · البحث
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.lookup_query}
              onChange={e => set('lookup_query', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              placeholder="EZ-2025-000001 ou IMEI (15 chiffres)"
              className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl
                         font-mono text-sm text-white placeholder-white/20 focus:outline-none
                         focus:border-[#C9A440]/50 transition-colors"
            />
            <button
              onClick={handleLookup}
              disabled={looking}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#C9A440]/10
                         hover:bg-[#C9A440]/20 border border-[#C9A440]/30 text-[#C9A440]
                         rounded-xl transition-all disabled:opacity-40 text-sm"
            >
              {looking
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Search  className="w-4 h-4" />}
              {looking ? 'Recherche...' : 'Chercher'}
            </button>
          </div>

          {info && (
            <div className="mt-4 p-4 bg-white/[0.02] border border-white/10 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium text-sm">{form.device_label || 'Appareil'}</p>
                  <p className="text-white/40 text-xs font-mono mt-0.5">{info.facture_ref}</p>
                </div>
                <WarrantyBadge txn_id={info.txn_id} showDetails />
              </div>
              {form.client_name && (
                <p className="text-white/40 text-xs">
                  {form.client_name}{form.client_tel ? ` · ${form.client_tel}` : ''}
                </p>
              )}
              {info.sav_currently_open && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10
                                border border-blue-500/20 rounded-lg">
                  <AlertCircle className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <p className="text-blue-400 text-xs">Un SAV est déjà ouvert pour cet appareil</p>
                </div>
              )}
            </div>
          )}
        </section>

        {info && (
          <>
            {/* Mode */}
            <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                Mode
              </p>
              <div className="flex gap-2">
                {(['PEC', 'RST', 'BOTH'] as SavMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => set('mode', m)}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-xl border transition-all ${
                      form.mode === m
                        ? 'border-[#C9A440] bg-[#C9A440]/10 text-[#C9A440]'
                        : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                    }`}
                  >
                    {m === 'PEC' ? 'Prise en charge' : m === 'RST' ? 'Restitution' : 'PEC + RST'}
                  </button>
                ))}
              </div>
            </section>

            {/* PEC fields */}
            {(form.mode === 'PEC' || form.mode === 'BOTH') && (
              <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                  Prise en charge · الاستلام
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Problème signalé *
                    </label>
                    <textarea
                      value={form.probleme}
                      onChange={e => set('probleme', e.target.value)}
                      rows={3}
                      placeholder="Description du problème rapporté par le client..."
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm placeholder-white/15 focus:outline-none
                                 focus:border-[#C9A440]/50 transition-colors resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-2">
                      Défauts constatés à l'accueil
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {DEFAUTS.map(d => {
                        const active = form.defauts.includes(d)
                        return (
                          <button
                            key={d}
                            onClick={() => toggleDefaut(d)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border
                                        text-left text-xs transition-all ${
                              active
                                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                                : 'border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20'
                            }`}
                          >
                            {active ? <CheckSquare className="w-3.5 h-3.5 shrink-0" /> : <Square className="w-3.5 h-3.5 shrink-0" />}
                            {d}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                        Accessoires déposés
                      </label>
                      <input
                        type="text"
                        value={form.accessories_pec}
                        onChange={e => set('accessories_pec', e.target.value)}
                        placeholder="Câble, coque..."
                        className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                   text-white text-sm placeholder-white/15 focus:outline-none
                                   focus:border-[#C9A440]/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                        Date prévue de retour
                      </label>
                      <input
                        type="date"
                        value={form.date_prevue}
                        onChange={e => set('date_prevue', e.target.value)}
                        className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* RST fields */}
            {(form.mode === 'RST' || form.mode === 'BOTH') && (
              <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                  Restitution · الإرجاع
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Interventions / Pièces remplacées
                    </label>
                    <textarea
                      value={form.remplacement}
                      onChange={e => set('remplacement', e.target.value)}
                      rows={3}
                      placeholder="Remplacement batterie, écran, connecteur charge..."
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm placeholder-white/15 focus:outline-none
                                 focus:border-[#C9A440]/50 transition-colors resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      État à la restitution
                    </label>
                    <select
                      value={form.etat_retour}
                      onChange={e => set('etat_retour', e.target.value)}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                    >
                      <option value="">Sélectionner...</option>
                      <option value="Réparé — fonctionne correctement">Réparé — fonctionne correctement</option>
                      <option value="Partiellement réparé">Partiellement réparé</option>
                      <option value="Non réparable">Non réparable</option>
                      <option value="Remplacé par appareil équivalent">Remplacé par appareil équivalent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Observations
                    </label>
                    <textarea
                      value={form.observations}
                      onChange={e => set('observations', e.target.value)}
                      rows={2}
                      placeholder="Optionnel..."
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm placeholder-white/15 focus:outline-none
                                 focus:border-[#C9A440]/50 transition-colors resize-none"
                    />
                  </div>
                </div>
              </section>
            )}

            <button
              onClick={handlePrint}
              disabled={printing || (!form.probleme && (form.mode === 'PEC' || form.mode === 'BOTH'))}
              className="w-full flex items-center justify-center gap-3 py-4 bg-[#C9A440]
                         hover:bg-[#d4aa48] text-black font-semibold rounded-xl transition-all
                         disabled:opacity-40 disabled:cursor-not-allowed text-base"
            >
              {printing
                ? <><Loader2 className="w-5 h-5 animate-spin" />Préparation...</>
                : <><Printer className="w-5 h-5" />Imprimer le bon SAV</>}
            </button>
          </>
        )}
      </div>

      {/* ── Print templates ──────────────────────────────────────────────── */}
      {info && (
        <div className="hidden print:block">
          {(form.mode === 'PEC' || form.mode === 'BOTH') && (
            <PecPrintTemplate form={form} pecRef={pecRef} today={today} info={info} />
          )}
          {(form.mode === 'RST' || form.mode === 'BOTH') && (
            <RstPrintTemplate form={form} rstRef={rstRef} pecRef={pecRef} today={today} info={info} />
          )}
        </div>
      )}
    </>
  )
}

// ── PEC Print ─────────────────────────────────────────────────────────────────

function PecPrintTemplate({ form, pecRef, today, info }: {
  form: SavForm; pecRef: string; today: Date; info: WarrantyInfo
}) {
  const page: React.CSSProperties = {
    width: '210mm', minHeight: '297mm', padding: '14mm',
    fontFamily: 'Arial, sans-serif', fontSize: '9pt', color: '#111',
    background: '#fff', boxSizing: 'border-box', pageBreakAfter: 'always',
  }
  return (
    <div style={page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #C9A440', paddingBottom: '5mm', marginBottom: '5mm' }}>
        <div>
          <div style={{ fontSize: '22pt', fontWeight: 800, color: '#C9A440', letterSpacing: '2px' }}>ELECTRO ZAKI</div>
          <div style={{ fontSize: '8pt', color: '#666', marginTop: '1mm' }}>Zone Industrielle Meknès · Tél: 05 35 XX XX XX</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '13pt', fontWeight: 700 }}>BON DE PRISE EN CHARGE SAV</div>
          <div style={{ fontSize: '10pt', color: '#555' }} dir="rtl">وثيقة استلام للصيانة</div>
          <div style={{ marginTop: '2mm', fontSize: '8.5pt' }}>
            <strong>N°:</strong> <span style={{ color: '#C9A440', fontWeight: 700 }}>{pecRef}</span>
          </div>
          <div style={{ fontSize: '8.5pt' }}><strong>Date:</strong> {fmtDate(today)}</div>
          <div style={{ fontSize: '8pt', color: '#888' }}>Facture: <span style={{ color: '#C9A440' }}>{info.facture_ref}</span></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginBottom: '4mm' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>CLIENT · العميل</div>
          <div style={{ fontWeight: 600 }}>{form.client_name || '—'}</div>
          {form.client_tel && <div style={{ color: '#555', fontSize: '8pt' }}>Tél: {form.client_tel}</div>}
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>APPAREIL · الجهاز</div>
          <div style={{ fontWeight: 600 }}>{form.device_label || '—'}</div>
          {info.date_vente && <div style={{ fontSize: '7.5pt', color: '#888', marginTop: '1mm' }}>Acheté le: {fmtDate(new Date(info.date_vente))}</div>}
        </div>
      </div>

      <div style={{ border: '1px solid #fca5a5', borderRadius: '2mm', padding: '4mm', marginBottom: '4mm', background: '#fff9f9' }}>
        <div style={{ fontWeight: 700, fontSize: '8pt', color: '#c33', borderBottom: '1px solid #fecaca', paddingBottom: '2mm', marginBottom: '2mm' }}>PROBLÈME SIGNALÉ · المشكلة المُبلَّغ عنها</div>
        <div>{form.probleme}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginBottom: '4mm', fontSize: '8pt' }}>
        {form.defauts.length > 0 && (
          <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '3mm' }}>
            <div style={{ fontWeight: 700, marginBottom: '2mm' }}>Défauts constatés</div>
            {form.defauts.map(d => (
              <div key={d} style={{ display: 'flex', gap: '2mm', marginBottom: '1mm' }}>
                <span style={{ color: '#c33', fontWeight: 700 }}>✗</span>{d}
              </div>
            ))}
          </div>
        )}
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '3mm' }}>
          <div style={{ fontWeight: 700, marginBottom: '2mm' }}>Informations</div>
          {form.accessories_pec && <div style={{ marginBottom: '1mm' }}>Accessoires: {form.accessories_pec}</div>}
          <div>Date prévue: <strong style={{ color: '#C9A440' }}>
            {form.date_prevue ? fmtDate(new Date(form.date_prevue)) : '—'}
          </strong></div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '14mm' }}>
        <div>
          <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Signature du client · توقيع العميل</div>
          <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Technicien responsable · المسؤول التقني</div>
          <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
        </div>
      </div>
      <div style={{ marginTop: '6mm', padding: '3mm', background: '#f9f9f9', borderRadius: '2mm', fontSize: '7pt', color: '#666', textAlign: 'center' }}>
        Le magasin décline toute responsabilité pour les données personnelles sur l'appareil · المحل غير مسؤول عن البيانات الشخصية المخزّنة في الجهاز
      </div>
    </div>
  )
}

// ── RST Print ─────────────────────────────────────────────────────────────────

function RstPrintTemplate({ form, rstRef, pecRef, today, info }: {
  form: SavForm; rstRef: string; pecRef: string; today: Date; info: WarrantyInfo
}) {
  const page: React.CSSProperties = {
    width: '210mm', minHeight: '297mm', padding: '14mm',
    fontFamily: 'Arial, sans-serif', fontSize: '9pt', color: '#111',
    background: '#fff', boxSizing: 'border-box',
  }
  return (
    <div style={page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #C9A440', paddingBottom: '5mm', marginBottom: '5mm' }}>
        <div>
          <div style={{ fontSize: '22pt', fontWeight: 800, color: '#C9A440', letterSpacing: '2px' }}>ELECTRO ZAKI</div>
          <div style={{ fontSize: '8pt', color: '#666', marginTop: '1mm' }}>Zone Industrielle Meknès · Tél: 05 35 XX XX XX</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '13pt', fontWeight: 700 }}>BON DE RESTITUTION SAV</div>
          <div style={{ fontSize: '10pt', color: '#555' }} dir="rtl">وثيقة إرجاع بعد الصيانة</div>
          <div style={{ marginTop: '2mm', fontSize: '8.5pt' }}>
            <strong>N°:</strong> <span style={{ color: '#C9A440', fontWeight: 700 }}>{rstRef}</span>
          </div>
          <div style={{ fontSize: '8.5pt' }}><strong>Date:</strong> {fmtDate(today)}</div>
          {pecRef && <div style={{ fontSize: '8pt', color: '#888' }}>PEC: <span style={{ color: '#C9A440' }}>{pecRef}</span></div>}
          <div style={{ fontSize: '8pt', color: '#888' }}>Facture: <span style={{ color: '#C9A440' }}>{info.facture_ref}</span></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginBottom: '4mm' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>CLIENT · العميل</div>
          <div style={{ fontWeight: 600 }}>{form.client_name || '—'}</div>
          {form.client_tel && <div style={{ color: '#555', fontSize: '8pt' }}>Tél: {form.client_tel}</div>}
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>APPAREIL · الجهاز</div>
          <div style={{ fontWeight: 600 }}>{form.device_label || '—'}</div>
        </div>
      </div>

      {form.remplacement && (
        <div style={{ border: '1px solid #86efac', borderRadius: '2mm', padding: '4mm', marginBottom: '4mm', background: '#f0fdf4' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#16a34a', borderBottom: '1px solid #bbf7d0', paddingBottom: '2mm', marginBottom: '2mm' }}>INTERVENTIONS EFFECTUÉES · الإصلاحات المُنجزة</div>
          <div>{form.remplacement}</div>
        </div>
      )}

      {form.etat_retour && (
        <div style={{ border: '1.5px solid #C9A440', borderRadius: '2mm', padding: '3mm', marginBottom: '4mm', display: 'flex', alignItems: 'center', gap: '3mm' }}>
          <span style={{ fontWeight: 700, color: '#C9A440', fontSize: '8pt' }}>État à la restitution:</span>
          <span style={{ fontWeight: 600 }}>{form.etat_retour}</span>
        </div>
      )}

      {form.observations && (
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '3mm', marginBottom: '4mm', fontSize: '8pt' }}>
          <div style={{ fontWeight: 700, marginBottom: '1mm' }}>Observations</div>
          <div style={{ color: '#444' }}>{form.observations}</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '16mm' }}>
        <div>
          <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Signature du client (appareil reçu) · توقيع العميل (استلام الجهاز)</div>
          <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Technicien responsable · المسؤول التقني</div>
          <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
        </div>
      </div>
    </div>
  )
}