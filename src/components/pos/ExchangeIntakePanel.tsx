'use client'
import { useState } from 'react'
import { showSuccess, showError } from '@/lib/utils/toasts'

export interface ExchangePanelState {
  txn_id:                  string
  valeur_echange:          number
  marque_echange:          string
  model_echange:           string
  imei_echange:            string
  couleur_echange:         string
  stockage_echange:        string
  battery_echange?:        number
  ram_echange:             string
  prix_vente_echange?:     number
  prix_min_echange?:       number
  echange_vers_reparation: boolean
}

interface Props {
  exchangePanel: ExchangePanelState
  storeId:       string
  isAr:          boolean
  onSuccess:     (phoneId: string) => void
  onClose:       () => void
}

export default function ExchangeIntakePanel({ exchangePanel, storeId, isAr, onSuccess, onClose }: Props) {
  const [form, setForm] = useState({
    modele:     exchangePanel.model_echange,
    imei:       exchangePanel.imei_echange,
    marque:     exchangePanel.marque_echange,
    prix_achat: exchangePanel.valeur_echange,
    couleur:    '',
    capacite:   '',
  })
  const [loading, setLoading] = useState(false)

  async function handleAddToStock() {
    if (!form.modele || !form.imei) {
      showError(isAr ? 'الموديل والرقم التسلسلي مطلوبان' : 'Modèle et IMEI requis')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/phones', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id:              storeId,
          marque:                form.marque || 'Inconnu',
          model:                 form.modele,
          imei:                  form.imei,
          prix_achat:            form.prix_achat,
          prix_vente_recommande: exchangePanel.prix_vente_echange ?? null,
          prix_vente_minimum:    exchangePanel.prix_min_echange   ?? null,
          couleur:               exchangePanel.couleur_echange  || form.couleur  || null,
          stockage:              exchangePanel.stockage_echange || form.capacite || null,
          battery_level:         exchangePanel.battery_echange  ?? null,
          ram:                   exchangePanel.ram_echange       || null,
          condition:             'مستعمل',
          source:                'Échange',
          status:                exchangePanel.echange_vers_reparation ? 'إصلاح' : 'متوفر',
          location:              'Magasin Principal',
          txn_ref_id:            exchangePanel.txn_id,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(`${isAr ? 'أضيف إلى المخزون' : 'Ajouté au stock'}: ${json.data.phone_id}`)
      onSuccess(json.data.phone_id)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally { setLoading(false) }
  }

  return (
    <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 animate-fade-in">
      <p className="text-sm font-bold text-amber-800 mb-3">
        {isAr ? 'إضافة الجهاز المستلم إلى المخزون؟' : "Ajouter l'appareil repris à l'inventaire ?"}
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'الماركة' : 'Marque'}</label>
          <input className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.marque} onChange={e => setForm(p => ({ ...p, marque: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'الموديل' : 'Modèle'} *</label>
          <input className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.modele} onChange={e => setForm(p => ({ ...p, modele: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">IMEI *</label>
          <input className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white font-mono"
            value={form.imei} onChange={e => setForm(p => ({ ...p, imei: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'سعر الشراء' : 'Prix achat (MAD)'}</label>
          <input type="number" className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.prix_achat} onChange={e => setForm(p => ({ ...p, prix_achat: Number(e.target.value) }))} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleAddToStock} disabled={loading}
          className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-all disabled:opacity-50">
          {loading ? (isAr ? 'جارٍ...' : 'En cours...') : (isAr ? 'إضافة إلى المخزون' : 'Ajouter au stock')}
        </button>
        <button onClick={onClose}
          className="px-4 py-2 rounded-xl border border-amber-200 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-all">
          {isAr ? 'تجاهل' : 'Ignorer'}
        </button>
      </div>
    </div>
  )
}