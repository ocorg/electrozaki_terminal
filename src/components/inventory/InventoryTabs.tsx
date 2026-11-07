'use client'
import { useState } from 'react'
import { Smartphone, Package } from 'lucide-react'
import InventoryModule from './InventoryModule'
import AccessoryCount from './AccessoryCount'

// Inventaire: the phones (by IMEI) and, since 2026-11-07, the accessories
// (scan = +1, typed numbers for naked products; lib/accessoryCount).
export default function InventoryTabs({ role }: { role: string }) {
  const [tab, setTab] = useState<'phones' | 'accessories'>('phones')
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-4 sm:px-6 pt-3 flex gap-2">
        {([['phones', 'Téléphones', Smartphone], ['accessories', 'Accessoires', Package]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border ${tab === k ? 'bg-gold text-white border-gold' : 'bg-white border-ez-border text-ez-subtle'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'phones' ? <InventoryModule role={role} /> : <AccessoryCount storeId="EZ-001" />}
      </div>
    </div>
  )
}
