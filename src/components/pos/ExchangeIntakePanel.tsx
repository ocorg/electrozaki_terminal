'use client'
import { useState } from 'react'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { t } from '@/lib/i18n/t'

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

const INPUT = 'w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white'

export default function ExchangeIntakePanel({ exchangePanel, storeId, isAr, onSuccess, onClose }: Props) {
  // Everything entered in the POS trade-in form, shown again so it can be checked
  // and completed before the phone goes into stock
  const [form, setForm] = useState({
    marque:      exchangePanel.marque_echange,
    modele:      exchangePanel.model_echange,
    imei:        exchangePanel.imei_echange,
    couleur:     exchangePanel.couleur_echange,
    stockage:    exchangePanel.stockage_echange,
    ram:         exchangePanel.ram_echange,
    batterie:    exchangePanel.battery_echange != null ? String(exchangePanel.battery_echange) : '',
    prix_achat:  String(exchangePanel.valeur_echange || ''),
    prix_vente:  exchangePanel.prix_vente_echange != null ? String(exchangePanel.prix_vente_echange) : '',
    prix_min:    exchangePanel.prix_min_echange   != null ? String(exchangePanel.prix_min_echange)   : '',
    reparation:  exchangePanel.echange_vers_reparation,
  })
  const set = (k: keyof typeof form, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
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
          marque:                form.marque.trim() || 'Inconnu',
          model:                 form.modele.trim(),
          imei:                  form.imei.trim(),
          couleur:               form.couleur.trim()  || null,
          stockage:              form.stockage.trim() || null,
          ram:                   form.ram.trim()      || null,
          battery_level:         num(form.batterie),
          prix_achat:            num(form.prix_achat),
          prix_vente_recommande: num(form.prix_vente),
          prix_vente_minimum:    num(form.prix_min),
          condition:             'occasion',
          source:                'echange',
          status:                form.reparation ? 'en_reparation' : 'disponible',
          location:              'magasin_principal',
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
          <label className="text-xs text-amber-700 font-medium">{t(isAr, 'common.brand')}</label>
          <input className={INPUT}
            value={form.marque as string} onChange={e => set('marque', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{t(isAr, 'common.model')} *</label>
          <input className={INPUT}
            value={form.modele as string} onChange={e => set('modele', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">IMEI *</label>
          <input className={INPUT + ' font-mono'}
            value={form.imei as string} onChange={e => set('imei', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'اللون' : 'Couleur'}</label>
          <input className={INPUT}
            value={form.couleur as string} onChange={e => set('couleur', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'السعة' : 'Stockage'}</label>
          <input className={INPUT}
            value={form.stockage as string} onChange={e => set('stockage', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">RAM</label>
          <input className={INPUT}
            value={form.ram as string} onChange={e => set('ram', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'البطارية (%)' : 'Batterie (%)'}</label>
          <input className={INPUT} type="number"
            value={form.batterie as string} onChange={e => set('batterie', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'سعر الشراء' : 'Prix achat (MAD)'}</label>
          <input className={INPUT} type="number"
            value={form.prix_achat as string} onChange={e => set('prix_achat', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'سعر البيع' : 'Prix vente (MAD)'}</label>
          <input className={INPUT} type="number"
            value={form.prix_vente as string} onChange={e => set('prix_vente', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium">{isAr ? 'السعر الأدنى' : 'Prix minimum (MAD)'}</label>
          <input className={INPUT} type="number"
            value={form.prix_min as string} onChange={e => set('prix_min', e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 mb-3 text-xs font-medium text-amber-800 cursor-pointer select-none">
        <input type="checkbox" checked={form.reparation} onChange={e => set('reparation', e.target.checked)} />
        {isAr ? 'إرسال للإصلاح قبل الوضع في المخزون' : 'Envoyer en réparation avant mise en stock'}
      </label>
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