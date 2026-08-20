'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldX, ShieldOff, Wrench } from 'lucide-react'

interface WarrantyInfo {
  warranty_status: 'active' | 'expired' | 'no_warranty'
  days_remaining:            number | null
  warranty_expiry_effective: string | null
  sav_currently_open:        boolean
  facture_ref:               string | null
}

interface Props {
  txn_id?:      string
  facture_ref?: string
  imei?:        string
  showDetails?: boolean
}

export function WarrantyBadge({ txn_id, facture_ref, imei, showDetails = false }: Props) {
  const [info,    setInfo]    = useState<WarrantyInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if      (txn_id)      params.set('txn_id', txn_id)
    else if (facture_ref) params.set('facture_ref', facture_ref)
    else if (imei)        params.set('imei', imei)
    else { setLoading(false); return }

    fetch(`/api/warranty?${params}`)
      .then(r => r.json())
      .then(res => { if (res.status === 'success') setInfo(res.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [txn_id, facture_ref, imei])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs
                       bg-white/5 text-white/30 border border-white/10 animate-pulse">
        <span className="w-2 h-2 rounded-full bg-white/20" />
        Vérification...
      </span>
    )
  }

  if (!info) return null

  // SAV ouvert → téléphone actuellement en atelier
  if (info.sav_currently_open) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs
                       font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
        <Wrench className="w-3 h-3" />
        En SAV — garantie suspendue
      </span>
    )
  }

  if (info.warranty_status === 'active') {
    const days    = info.days_remaining ?? 0
    const urgent  = days <= 30
    const cls     = urgent
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                        text-xs font-medium border ${cls}`}>
        <ShieldCheck className="w-3 h-3" />
        Garantie active
        {showDetails && (
          <span className="opacity-60">— {days}j restants</span>
        )}
      </span>
    )
  }

  if (info.warranty_status === 'expired') {
    const elapsed = info.days_remaining != null ? Math.abs(info.days_remaining) : null
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs
                       font-medium bg-red-500/10 text-red-400 border border-red-500/20">
        <ShieldX className="w-3 h-3" />
        Garantie expirée
        {showDetails && elapsed != null && (
          <span className="opacity-60">— il y a {elapsed}j</span>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs
                     font-medium bg-white/5 text-white/30 border border-white/10">
      <ShieldOff className="w-3 h-3" />
      Sans garantie
    </span>
  )
}