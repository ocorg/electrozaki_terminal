'use client'
// What a client's account balance is made of — each debt and payment, with
// a WhatsApp reminder (owner, 2026-10-04). Opened from Crédits → Comptes clients.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, ShoppingCart, Banknote, FileText, MessageCircle } from 'lucide-react'
import { useEscapeKey } from '@/lib/hooks/useEscapeKey'
import { formatMAD } from '@/lib/utils'
import { STORE_TIME_ZONE } from '@/lib/time'
import { whatsappLink } from '@/components/site/common'

interface Line { at: string; kind: 'vente' | 'import' | 'paiement'; label: string; detail?: string; du: number; paye: number; solde: number; ref?: string }
interface Account {
  client: { client_id: string; nom: string; telephone: string | null }
  solde: number
  ledger: Line[]
  dossiers: { credit_id: string; reste: number }[]
}

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: STORE_TIME_ZONE, day: '2-digit', month: '2-digit', year: '2-digit' })

export const accountReminder = (nom: string, solde: number) =>
  `Bonjour ${nom.trim().split(' ')[0]}, petit rappel d'Electro Zaki : il reste ${Number(solde).toLocaleString('fr-MA')} DH à régler sur votre compte. Merci !`

export default function ClientAccountPanel({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [acc, setAcc] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEscapeKey(onClose, true)

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/account`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (!ok) setError(j.error ?? 'Erreur'); else setAcc(j.data) })
      .catch(() => alive && setError('Connexion impossible'))
    return () => { alive = false }
  }, [clientId])

  const icon = { vente: ShoppingCart, import: FileText, paiement: Banknote }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end items-end sm:items-stretch bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Compte client" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[88vh] sm:max-h-none bg-white rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ez-border">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ez-text truncate">{acc?.client.nom ?? 'Compte client'}</h2>
            <p className="text-xs text-ez-faint">{acc?.client.telephone || 'Détail du solde'}</p>
          </div>
          <div className="flex items-center gap-2">
            {acc && acc.solde > 0 && acc.client.telephone && (
              <a href={`${whatsappLink(acc.client.telephone)}?text=${encodeURIComponent(accountReminder(acc.client.nom, acc.solde))}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <MessageCircle className="w-3.5 h-3.5" />Rappel
              </a>
            )}
            <button onClick={onClose} aria-label="Fermer" className="p-2 rounded-lg text-ez-subtle hover:bg-ez-muted"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error ? <p className="text-sm text-red-500">{error}</p>
            : !acc ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-ez-faint" /></div>
            : (
              <>
                <div className="rounded-2xl bg-ez-bg border border-ez-border p-4">
                  <p className="text-xs text-ez-subtle">Reste à payer sur le compte</p>
                  <p className={`font-display text-2xl font-bold ${acc.solde > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{formatMAD(acc.solde)}</p>
                  {acc.dossiers.length > 0 && (
                    <p className="text-xs text-ez-subtle mt-1">
                      + {acc.dossiers.length} dossier{acc.dossiers.length > 1 ? 's' : ''} téléphone en cours ({formatMAD(acc.dossiers.reduce((s, d) => s + d.reste, 0))}) — suivi{acc.dossiers.length > 1 ? 's' : ''} dans « Dossiers téléphones »
                    </p>
                  )}
                </div>
                {!acc.ledger.length ? <p className="text-sm text-ez-faint">Aucune opération à crédit sur ce compte.</p> : (
                  <ol className="space-y-2">
                    {acc.ledger.map((l, i) => {
                      const Icon = icon[l.kind]
                      return (
                        <li key={i} className="rounded-xl border border-ez-border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs text-ez-faint">{day(l.at)}{l.ref ? ` · ${l.ref}` : ''}</p>
                              <p className="text-sm font-semibold text-ez-text flex items-start gap-1.5">
                                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${l.kind === 'paiement' ? 'text-emerald-600' : 'text-gold'}`} /><span>{l.label}</span>
                              </p>
                              {l.detail && <p className="text-xs text-ez-faint mt-0.5">{l.detail}</p>}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className={`text-sm font-bold ${l.paye ? 'text-emerald-600' : 'text-ez-text'}`}>{l.paye ? `−${formatMAD(l.paye)}` : `+${formatMAD(l.du)}`}</p>
                              <p className="text-xs text-ez-faint">solde {formatMAD(Math.max(l.solde, 0))}</p>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </>
            )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
