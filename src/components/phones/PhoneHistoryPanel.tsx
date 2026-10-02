'use client'
// A phone's full history in a side panel (bottom sheet on a phone) —
// managers only, opened from the row's "…" menu or the phone form.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, PackagePlus, PencilLine, ShoppingCart, Undo2, CreditCard, Truck, ScanLine, Link2, Trash2,
} from 'lucide-react'
import { useEscapeKey } from '@/lib/hooks/useEscapeKey'
import { STORE_TIME_ZONE } from '@/lib/time'

type Kind = 'stock' | 'edit' | 'sale' | 'return' | 'credit' | 'supplier' | 'inventory' | 'chain' | 'delete'
interface Event { at: string; kind: Kind; title: string; detail?: string; by?: string | null }

const ICON: Record<Kind, { icon: React.ElementType; cls: string }> = {
  stock:     { icon: PackagePlus,  cls: 'bg-emerald-50 text-emerald-600' },
  edit:      { icon: PencilLine,   cls: 'bg-ez-muted text-ez-subtle' },
  sale:      { icon: ShoppingCart, cls: 'bg-gold-50 text-gold' },
  return:    { icon: Undo2,        cls: 'bg-red-50 text-red-500' },
  credit:    { icon: CreditCard,   cls: 'bg-amber-50 text-amber-600' },
  supplier:  { icon: Truck,        cls: 'bg-blue-50 text-blue-600' },
  inventory: { icon: ScanLine,     cls: 'bg-ez-muted text-ez-subtle' },
  chain:     { icon: Link2,        cls: 'bg-blue-50 text-blue-600' },
  delete:    { icon: Trash2,       cls: 'bg-red-50 text-red-500' },
}

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', {
  timeZone: STORE_TIME_ZONE, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
})

export default function PhoneHistoryPanel({ phoneId, label, onClose }: { phoneId: string; label?: string; onClose: () => void }) {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEscapeKey(onClose, true)

  useEffect(() => {
    let alive = true
    fetch(`/api/phones/${phoneId}/history`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (!ok) setError(j.error ?? 'Erreur'); else setEvents(j.data.events) })
      .catch(() => alive && setError('Connexion impossible'))
    return () => { alive = false }
  }, [phoneId])

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end items-end sm:items-stretch bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Historique du téléphone" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[85vh] sm:max-h-none bg-white rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ez-border">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ez-text">Historique</h2>
            <p className="text-xs text-ez-faint truncate">{label ? `${label} · ` : ''}{phoneId}</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? <p className="text-sm text-red-500">{error}</p>
            : !events ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-ez-faint" /></div>
            : !events.length ? <p className="text-sm text-ez-faint">Aucun événement enregistré.</p>
            : (
              <ol className="relative border-l border-ez-border ml-3 space-y-4">
                {events.map((e, i) => {
                  const { icon: Icon, cls } = ICON[e.kind] ?? ICON.edit
                  return (
                    <li key={i} className="ml-5">
                      <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ring-4 ring-white ${cls}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <p className="text-xs text-ez-faint">{when(e.at)}{e.by ? ` · par ${e.by}` : ''}</p>
                      <p className="text-sm font-semibold text-ez-text">{e.title}</p>
                      {e.detail && <p className="text-xs text-ez-subtle whitespace-pre-line mt-0.5">{e.detail}</p>}
                    </li>
                  )
                })}
              </ol>
            )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
