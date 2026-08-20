'use client'

import { useState } from 'react'
import { Printer, Loader2, User, Phone, CreditCard, CheckCircle2, Circle } from 'lucide-react'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepriseForm {
  mode:               'RCH' | 'ECH'
  vendor_name:        string
  vendor_tel:         string
  vendor_cin:         string
  marque:             string
  model:              string
  stockage:           string
  couleur:            string
  condition:          string
  imei:               string
  apple_id_removed:   boolean
  google_frp_removed: boolean
  samsung_removed:    boolean
  xiaomi_removed:     boolean
  factory_reset:      boolean
  prix_achat:         number
  accessories:        string
  observations:       string
  linked_fac_ref:     string
}

const DEFAULT: RepriseForm = {
  mode: 'RCH',
  vendor_name: '', vendor_tel: '', vendor_cin: '',
  marque: '', model: '', stockage: '', couleur: '', condition: 'Occasion', imei: '',
  apple_id_removed: false, google_frp_removed: false,
  samsung_removed: false, xiaomi_removed: false, factory_reset: false,
  prix_achat: 0, accessories: '', observations: '', linked_fac_ref: '',
}

const CHECKLIST = [
  { key: 'apple_id_removed'   as const, label: 'Apple ID / Find My désactivé', labelAr: 'تم حذف Apple ID / Find My'     },
  { key: 'google_frp_removed' as const, label: 'Compte Google supprimé (FRP)', labelAr: 'تم حذف حساب Google (FRP)'      },
  { key: 'samsung_removed'    as const, label: 'Compte Samsung supprimé',      labelAr: 'تم حذف حساب Samsung'           },
  { key: 'xiaomi_removed'     as const, label: 'Compte Mi / Xiaomi supprimé',  labelAr: 'تم حذف حساب Mi / Xiaomi'      },
  { key: 'factory_reset'      as const, label: 'Réinitialisation usine faite', labelAr: 'تم إعادة الضبط المصنعي'        },
]

const fmtDate = (d: Date) =>
  d.toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Component ─────────────────────────────────────────────────────────────────

export function AcquisitionTab() {
  const [form,     setForm]     = useState<RepriseForm>(DEFAULT)
  const [printing, setPrinting] = useState(false)
  const [docRef,   setDocRef]   = useState('')
  const today = new Date()

  const set = (k: keyof RepriseForm, v: unknown) =>
    setForm(p => ({ ...p, [k]: v }))

  const toggle = (k: keyof RepriseForm) =>
    setForm(p => ({ ...p, [k]: !p[k] }))

  const handlePrint = async () => {
    if (!form.vendor_name)                     { toast.error('Nom du vendeur obligatoire'); return }
    if (!form.marque || !form.model)           { toast.error('Marque et modèle obligatoires'); return }
    if (!form.prix_achat || form.prix_achat <= 0) { toast.error('Prix d\'achat obligatoire'); return }

    setPrinting(true)
    try {
      const res  = await fetch('/api/documents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type:       form.mode,
          client_name:    form.vendor_name,
          client_tel:     form.vendor_tel     || null,
          client_cin:     form.vendor_cin     || null,
          device_label:   `${form.marque} ${form.model} ${form.stockage}`.trim(),
          imei:           form.imei           || null,
          montant:        form.prix_achat,
          linked_doc_ref: form.linked_fac_ref || null,
          doc_data:       form,
        }),
      })
      const json = await res.json()
      if (json.status !== 'success') throw new Error(json.error)

      setDocRef(json.data.doc_ref)
      setTimeout(() => { window.print(); setPrinting(false) }, 150)
    } catch (err: any) {
      toast.error('Erreur', { description: err.message })
      setPrinting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Screen ──────────────────────────────────────────────────────── */}
      <div className="print:hidden grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-4">

          {/* Mode */}
          <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
            {(['RCH', 'ECH'] as const).map(m => (
              <button
                key={m}
                onClick={() => set('mode', m)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                  form.mode === m
                    ? 'bg-[#C9A440] text-black'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {m === 'RCH' ? 'Acquisition directe' : 'Reprise — échange'}
              </button>
            ))}
          </div>

          {/* ECH: facture liée */}
          {form.mode === 'ECH' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <label className="block text-[10px] text-amber-400/70 uppercase tracking-widest mb-2">
                Référence facture de vente liée
              </label>
              <input
                type="text"
                value={form.linked_fac_ref}
                onChange={e => set('linked_fac_ref', e.target.value)}
                placeholder="EZ-2025-000001"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                           font-mono text-sm text-white placeholder-white/20 focus:outline-none
                           focus:border-[#C9A440]/50 transition-colors"
              />
            </div>
          )}

          {/* Vendeur */}
          <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
              {form.mode === 'RCH' ? 'Vendeur · البائع' : 'Client — Reprise · الزبون'}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                  <User className="inline w-3 h-3 mr-1" />
                  Nom complet
                </label>
                <input
                  type="text"
                  value={form.vendor_name}
                  onChange={e => set('vendor_name', e.target.value)}
                  placeholder="Mohamed Alami"
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                             text-white text-sm placeholder-white/15 focus:outline-none
                             focus:border-[#C9A440]/50 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                    <Phone className="inline w-3 h-3 mr-1" />
                    Téléphone
                  </label>
                  <input
                    type="tel"
                    value={form.vendor_tel}
                    onChange={e => set('vendor_tel', e.target.value)}
                    placeholder="06 XX XX XX XX"
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                               text-white text-sm placeholder-white/15 focus:outline-none
                               focus:border-[#C9A440]/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                    <CreditCard className="inline w-3 h-3 mr-1" />
                    CIN
                  </label>
                  <input
                    type="text"
                    value={form.vendor_cin}
                    onChange={e => set('vendor_cin', e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                               text-white text-sm placeholder-white/15 focus:outline-none
                               focus:border-[#C9A440]/50 transition-colors"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Appareil */}
          <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
              Appareil · الجهاز
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: 'marque',   label: 'Marque',    span: false },
                { key: 'model',    label: 'Modèle',    span: false },
                { key: 'stockage', label: 'Stockage',  span: false },
                { key: 'couleur',  label: 'Couleur',   span: false },
                { key: 'imei',     label: 'IMEI',      span: true  },
              ] as { key: keyof RepriseForm; label: string; span: boolean }[]).map(({ key, label, span }) => (
                <div key={key} className={span ? 'col-span-2' : ''}>
                  <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={form[key] as string}
                    onChange={e => set(key, e.target.value)}
                    className={`w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                               text-white text-sm focus:outline-none focus:border-[#C9A440]/50
                               transition-colors ${key === 'imei' ? 'font-mono' : ''}`}
                  />
                </div>
              ))}
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                  État
                </label>
                <select
                  value={form.condition}
                  onChange={e => set('condition', e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                             text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                >
                  {['Neuf', 'Très bon état', 'Bon état', 'État moyen', 'Pour pièces'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                  Prix d'achat (MAD)
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.prix_achat || ''}
                  onChange={e => set('prix_achat', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                             text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                />
              </div>
            </div>
          </section>

          {/* Checklist comptes */}
          <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
              Vérification comptes · فحص الحسابات
            </p>
            <div className="space-y-2">
              {CHECKLIST.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border
                              text-left transition-all ${
                    form[key]
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20'
                  }`}
                >
                  {form[key]
                    ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                    : <Circle       className="w-4 h-4 shrink-0" />}
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Extras */}
          <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">Extras</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                  Accessoires inclus
                </label>
                <input
                  type="text"
                  value={form.accessories}
                  onChange={e => set('accessories', e.target.value)}
                  placeholder="Boîte, chargeur, câble..."
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                             text-white text-sm placeholder-white/15 focus:outline-none
                             focus:border-[#C9A440]/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                  Observations / Défauts
                </label>
                <textarea
                  value={form.observations}
                  onChange={e => set('observations', e.target.value)}
                  rows={2}
                  placeholder="Rayures, pixels morts, défauts constatés..."
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                             text-white text-sm placeholder-white/15 focus:outline-none
                             focus:border-[#C9A440]/50 transition-colors resize-none"
                />
              </div>
            </div>
          </section>

          <button
            onClick={handlePrint}
            disabled={printing || !form.vendor_name || !form.marque || form.prix_achat <= 0}
            className="w-full flex items-center justify-center gap-3 py-4 bg-[#C9A440]
                       hover:bg-[#d4aa48] text-black font-semibold rounded-xl transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed text-base"
          >
            {printing
              ? <><Loader2 className="w-5 h-5 animate-spin" />Préparation...</>
              : <><Printer className="w-5 h-5" />{form.mode === 'RCH' ? "Imprimer le bon d'acquisition" : 'Imprimer le bon de reprise'}</>}
          </button>
        </div>

        {/* Right: preview */}
        <div className="hidden xl:block">
          <div className="sticky top-6">
            <p className="text-[10px] text-white/30 uppercase tracking-widest mb-3">Aperçu</p>
            <div className="bg-white rounded-xl shadow-2xl overflow-hidden" style={{ aspectRatio: '210/297' }}>
              <div className="w-full h-full overflow-auto scale-[0.6] origin-top-left" style={{ width: '166.67%', height: '166.67%' }}>
                <AcquisitionPrintTemplate form={form} docRef="EN COURS..." today={today} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Print template ───────────────────────────────────────────────── */}
      <div className="hidden print:block">
        <AcquisitionPrintTemplate form={form} docRef={docRef} today={today} />
      </div>
    </>
  )
}

// ── Print Template ────────────────────────────────────────────────────────────

function AcquisitionPrintTemplate({
  form, docRef, today,
}: { form: RepriseForm; docRef: string; today: Date }) {
  const page: React.CSSProperties = {
    width: '210mm', minHeight: '297mm', padding: '14mm',
    fontFamily: 'Arial, sans-serif', fontSize: '9pt', color: '#111',
    background: '#fff', boxSizing: 'border-box',
  }

  return (
    <div style={page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #C9A440', paddingBottom: '5mm', marginBottom: '5mm' }}>
        <div>
          <div style={{ fontSize: '22pt', fontWeight: 800, color: '#C9A440', letterSpacing: '2px' }}>ELECTRO ZAKI</div>
          <div style={{ fontSize: '8pt', color: '#666', marginTop: '1mm' }}>Zone Industrielle Meknès · Tél: 05 35 XX XX XX</div>
          <div style={{ fontSize: '7.5pt', color: '#666' }}>ICE: 001234567000000 · IF: 12345678 · RC: 12345</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14pt', fontWeight: 700 }}>
            {form.mode === 'RCH' ? "BON D'ACQUISITION" : 'BON DE REPRISE'}
          </div>
          <div style={{ fontSize: '11pt', color: '#555' }} dir="rtl">
            {form.mode === 'RCH' ? 'وثيقة الاقتناء' : 'وثيقة الاسترداد'}
          </div>
          <div style={{ marginTop: '2mm', fontSize: '8.5pt' }}>
            <strong>N°:</strong> <span style={{ color: '#C9A440', fontWeight: 700 }}>{docRef}</span>
          </div>
          <div style={{ fontSize: '8.5pt' }}><strong>Date:</strong> {fmtDate(today)}</div>
          {form.linked_fac_ref && (
            <div style={{ fontSize: '7.5pt', color: '#888', marginTop: '1mm' }}>
              Facture liée: <span style={{ color: '#C9A440' }}>{form.linked_fac_ref}</span>
            </div>
          )}
        </div>
      </div>

      {/* Vendor + Device */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginBottom: '4mm' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>
            {form.mode === 'RCH' ? 'VENDEUR · البائع' : 'CLIENT · العميل'}
          </div>
          <div style={{ fontWeight: 600 }}>{form.vendor_name}</div>
          {form.vendor_tel && <div style={{ color: '#555', fontSize: '8pt' }}>Tél: {form.vendor_tel}</div>}
          {form.vendor_cin && <div style={{ color: '#555', fontSize: '8pt' }}>CIN: {form.vendor_cin}</div>}
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
          <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>
            APPAREIL · الجهاز
          </div>
          <div style={{ fontWeight: 600 }}>{form.marque} {form.model} {form.stockage}</div>
          <div style={{ color: '#555', fontSize: '8pt' }}>État: {form.condition}</div>
          {form.couleur && <div style={{ color: '#555', fontSize: '8pt' }}>Couleur: {form.couleur}</div>}
          {form.imei && <div style={{ fontFamily: 'monospace', fontSize: '7.5pt', color: '#555', marginTop: '1mm' }}>IMEI: {form.imei}</div>}
        </div>
      </div>

      {/* Checklist */}
      <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm', marginBottom: '4mm' }}>
        <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '3mm' }}>
          VÉRIFICATION COMPTES · فحص الحسابات
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2mm' }}>
          {CHECKLIST.map(({ key, label, labelAr }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '2mm', fontSize: '7.5pt', padding: '2mm', background: form[key] ? '#f0fdf4' : '#fff9f9', borderRadius: '1mm', border: `1px solid ${form[key] ? '#86efac' : '#fecaca'}` }}>
              <span style={{ fontWeight: 800, color: form[key] ? '#16a34a' : '#dc2626', minWidth: '12px', marginTop: '0.5mm' }}>
                {form[key] ? '✓' : '✗'}
              </span>
              <div>
                <div>{label}</div>
                <div style={{ color: '#888', fontSize: '6.5pt' }} dir="rtl">{labelAr}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Accessories + Observations */}
      {(form.accessories || form.observations) && (
        <div style={{ display: 'grid', gridTemplateColumns: form.accessories && form.observations ? '1fr 1fr' : '1fr', gap: '3mm', marginBottom: '4mm', fontSize: '8pt' }}>
          {form.accessories && (
            <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '3mm' }}>
              <div style={{ fontWeight: 700, marginBottom: '1mm' }}>Accessoires inclus</div>
              <div style={{ color: '#444' }}>{form.accessories}</div>
            </div>
          )}
          {form.observations && (
            <div style={{ border: '1px solid #fca5a5', borderRadius: '2mm', padding: '3mm' }}>
              <div style={{ fontWeight: 700, marginBottom: '1mm', color: '#c33' }}>Observations</div>
              <div style={{ color: '#444' }}>{form.observations}</div>
            </div>
          )}
        </div>
      )}

      {/* Price */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6mm' }}>
        <div style={{ width: '80mm', border: '1.5px solid #C9A440', borderRadius: '2mm', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3mm 4mm', background: '#C9A440', fontWeight: 700, fontSize: '10pt' }}>
            <span>{form.mode === 'RCH' ? "PRIX D'ACHAT:" : 'VALEUR REPRISE:'}</span>
            <span>{form.prix_achat.toLocaleString('fr-MA')} MAD</span>
          </div>
        </div>
      </div>

      {/* Signatures */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '10mm' }}>
        <div>
          <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>
            {form.mode === 'RCH' ? 'Signature du vendeur · توقيع البائع' : 'Signature du client · توقيع العميل'}
          </div>
          <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Cachet du magasin · ختم المحل</div>
          <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
        </div>
      </div>

      <div style={{ marginTop: '6mm', padding: '3mm', background: '#f9f9f9', borderRadius: '2mm', fontSize: '7pt', color: '#666', textAlign: 'center' }}>
        Je soussigné(e) <strong>{form.vendor_name}</strong> déclare céder le présent appareil à Electro Zaki de plein gré.
        <span dir="rtl" style={{ display: 'block', marginTop: '1mm' }}>أقر أنا <strong>{form.vendor_name}</strong> بتسليم الجهاز المذكور إلى إليكترو زكي طوعاً.</span>
      </div>
    </div>
  )
}