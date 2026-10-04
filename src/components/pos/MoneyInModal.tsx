'use client'
// "Entrée d'argent" at the POS (owner, 2026-10-04) — guided choices instead
// of a free-text cash deposit, so the money lands where it belongs:
//   • Service / réparation  → a real sale (figures + caisse)        everyone
//   • Versement d'un client → his phone file or his account         managers
//   • Avance sur téléphone  → that is a sale: "Plusieurs fois"      managers
//   • Autre                 → free text, as before                  managers
import { useEffect, useMemo, useState } from 'react'
import { Wrench, User, Smartphone, MoreHorizontal, Loader2 } from 'lucide-react'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { Modal, Field, Btn, inputClass } from '@/components/shared'
import { formatMAD, getBusinessDate } from '@/lib/utils'

type Mode = 'service' | 'client' | 'avance' | 'autre'
interface ServiceItem { acc_id: string; nom: string; prix: number | null }
interface ClientRow { client_id: string; nom: string; telephone: string }
interface Account { solde: number; dossiers: { credit_id: string; reste: number }[] }

interface Props {
  open:      boolean
  onClose:   () => void
  storeId:   string
  primary:   string
  isManager: boolean
  services:  ServiceItem[]
  clients:   ClientRow[]
  onSeveralTimes: () => void   // switch the POS to "Plusieurs fois"
  onDone:    () => void        // refresh the POS data
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Erreur')
  return json.data
}

export default function MoneyInModal({ open, onClose, storeId, primary, isManager, services, clients, onSeveralTimes, onDone }: Props) {
  const [mode, setMode]       = useState<Mode>('service')
  const [amount, setAmount]   = useState('')
  const [method, setMethod]   = useState<'especes' | 'virement'>('especes')
  const [busy, setBusy]       = useState(false)
  // service
  const [serviceId, setServiceId] = useState('')
  const [label, setLabel]         = useState('')
  // client payment
  const [search, setSearch]     = useState('')
  const [client, setClient]     = useState<ClientRow | null>(null)
  const [account, setAccount]   = useState<Account | null>(null)
  const [target, setTarget]     = useState<string>('')   // 'compte' or a credit_id
  // other
  const [reason, setReason]     = useState('')

  useEffect(() => {
    if (!open) return
    setMode('service'); setAmount(''); setMethod('especes'); setLabel(''); setSearch(''); setClient(null); setAccount(null); setTarget(''); setReason('')
    setServiceId(services.find(s => s.nom === 'Service divers')?.acc_id ?? services[0]?.acc_id ?? '')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!client) { setAccount(null); setTarget(''); return }
    let alive = true
    fetch(`/api/clients/${client.client_id}/account`).then(r => r.json()).then(j => {
      if (!alive || !j.data) return
      const acc: Account = { solde: j.data.solde, dossiers: j.data.dossiers }
      setAccount(acc)
      const first = acc.dossiers[0]
      setTarget(first ? first.credit_id : acc.solde > 0 ? 'compte' : '')
      setAmount(String(first ? first.reste : acc.solde > 0 ? acc.solde : ''))
    }).catch(() => {})
    return () => { alive = false }
  }, [client])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    return clients.filter(c => c.nom.toLowerCase().includes(q) || (c.telephone ?? '').includes(q)).slice(0, 6)
  }, [search, clients])

  const service = services.find(s => s.acc_id === serviceId)
  const value = Number(amount)

  async function submit() {
    setBusy(true)
    try {
      if (mode === 'service') {
        if (!service) throw new Error('Choisissez un service')
        await post('/api/transactions', {
          store_id: storeId, device_type: 'accessoire', device_id: service.acc_id, type_operation: 'vente', qty: 1,
          prix_vente: value, payment_method: method, warranty_start: getBusinessDate(),
          notes: label.trim() ? `Service : ${label.trim()}` : `Service : ${service.nom}`,
        })
        showSuccess(`Service enregistré — ${formatMAD(value)}`)
      } else if (mode === 'client') {
        if (!client || !target) throw new Error('Choisissez le client et ce qu’il règle')
        if (target === 'compte') await post('/api/credits', { client_id: client.client_id, montant: value, payment_method: method, store_id: storeId })
        else await post(`/api/phone-credits/${target}/payments`, { montant: value, payment_method: method, store_id: storeId })
        showSuccess(`Versement de ${client.nom} enregistré — ${formatMAD(value)}`)
      } else if (mode === 'autre') {
        await post('/api/cash-drops', { amount: value, reason: reason.trim(), store_id: storeId })
        showSuccess(`Entrée d'argent enregistrée — ${formatMAD(value)}`)
      }
      onDone(); onClose()
    } catch (e) { showError((e as Error).message) } finally { setBusy(false) }
  }

  const tabs: { v: Mode; l: string; icon: React.ElementType; show: boolean }[] = [
    { v: 'service', l: 'Service / réparation', icon: Wrench,         show: true },
    { v: 'client',  l: 'Versement d’un client', icon: User,           show: isManager },
    { v: 'avance',  l: 'Avance sur téléphone',  icon: Smartphone,     show: isManager },
    { v: 'autre',   l: 'Autre',                 icon: MoreHorizontal, show: isManager },
  ]
  const ready = value > 0 && (
    mode === 'service' ? !!service
    : mode === 'client' ? !!client && !!target
    : mode === 'autre' ? reason.trim().length >= 3 : false)

  const methodButtons = (
    <div className="grid grid-cols-2 gap-2">
      {(['especes', 'virement'] as const).map(m => (
        <button key={m} type="button" onClick={() => setMethod(m)} className="py-2 rounded-xl text-xs font-bold border transition-all"
          style={{ backgroundColor: method === m ? primary : 'white', borderColor: method === m ? primary : '#E8E5DE', color: method === m ? 'white' : '#6B6860' }}>
          {m === 'especes' ? 'Espèces' : 'Virement'}
        </button>
      ))}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="Entrée d'argent" size="sm">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {tabs.filter(t => t.show).map(({ v, l, icon: Icon }) => (
            <button key={v} type="button" onClick={() => setMode(v)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border text-left transition-all"
              style={{ backgroundColor: mode === v ? `${primary}15` : 'white', borderColor: mode === v ? primary : '#E8E5DE', color: mode === v ? primary : '#6B6860' }}>
              <Icon className="w-4 h-4 flex-shrink-0" />{l}
            </button>
          ))}
        </div>

        {mode === 'service' && (
          <>
            <Field label="Service">
              <select className={inputClass} value={serviceId}
                onChange={e => { setServiceId(e.target.value); const s = services.find(x => x.acc_id === e.target.value); if (s?.prix && !amount) setAmount(String(s.prix)) }}>
                {services.map(s => <option key={s.acc_id} value={s.acc_id}>{s.nom}</option>)}
              </select>
            </Field>
            <Field label="Détail (optionnel)">
              <input className={inputClass} placeholder="Ex : changement écran A12" value={label} onChange={e => setLabel(e.target.value)} />
            </Field>
            <p className="text-xs text-ez-faint -mt-2">Compté comme une vente (chiffres et caisse).</p>
          </>
        )}

        {mode === 'client' && (
          <>
            {!client ? (
              <Field label="Client">
                <input className={inputClass} placeholder="Nom ou téléphone…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
                {matches.length > 0 && (
                  <div className="mt-1 border border-ez-border rounded-xl overflow-hidden">
                    {matches.map(c => (
                      <button key={c.client_id} type="button" onClick={() => setClient(c)}
                        className="w-full flex justify-between px-3 py-2 text-sm hover:bg-ez-bg border-b border-ez-muted last:border-0">
                        <span className="font-semibold text-ez-text">{c.nom}</span><span className="text-ez-faint font-mono text-xs">{c.telephone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            ) : (
              <div className="rounded-xl border border-ez-border p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-bold text-ez-text">{client.nom}</p>
                  <button type="button" onClick={() => setClient(null)} className="text-xs underline text-ez-subtle">Changer</button>
                </div>
                {!account ? <Loader2 className="w-4 h-4 animate-spin text-ez-faint" /> : (
                  account.dossiers.length === 0 && account.solde <= 0 ? <p className="text-xs text-ez-subtle">Ce client ne doit rien.</p> : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-ez-subtle">Il règle :</p>
                      {account.dossiers.map(d => (
                        <label key={d.credit_id} className="flex items-center justify-between gap-2 text-sm cursor-pointer">
                          <span className="flex items-center gap-2"><input type="radio" checked={target === d.credit_id} onChange={() => { setTarget(d.credit_id); setAmount(String(d.reste)) }} />Dossier téléphone {d.credit_id}</span>
                          <b>{formatMAD(d.reste)}</b>
                        </label>
                      ))}
                      {account.solde > 0 && (
                        <label className="flex items-center justify-between gap-2 text-sm cursor-pointer">
                          <span className="flex items-center gap-2"><input type="radio" checked={target === 'compte'} onChange={() => { setTarget('compte'); setAmount(String(account.solde)) }} />Son compte (accessoires, anciennes dettes)</span>
                          <b>{formatMAD(account.solde)}</b>
                        </label>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}

        {mode === 'avance' && (
          <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 space-y-3">
            <p className="text-sm text-purple-800">Une avance sur un téléphone est une <b>vente en plusieurs fois</b> : ajoutez le téléphone au panier, puis choisissez « Plusieurs fois » — l&apos;avance, le client et le dossier sont enregistrés ensemble.</p>
            <Btn variant="primary" onClick={() => { onSeveralTimes(); onClose() }} style={{ backgroundColor: primary }}>Passer en « Plusieurs fois »</Btn>
          </div>
        )}

        {mode === 'autre' && (
          <Field label="Motif *">
            <input className={inputClass} placeholder="Ex : fond de caisse ajouté" value={reason} onChange={e => setReason(e.target.value)} />
            <p className="text-xs text-ez-faint mt-1">Ni vente ni versement client — sinon utilisez les autres choix.</p>
          </Field>
        )}

        {mode !== 'avance' && (
          <>
            <Field label="Montant (MAD)">
              <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass} placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
            </Field>
            {mode !== 'autre' && methodButtons}
            <div className="flex gap-2 pt-1">
              <Btn variant="secondary" className="flex-1" onClick={onClose}>Retour</Btn>
              <Btn variant="primary" className="flex-1" disabled={!ready} loading={busy} onClick={submit} style={{ backgroundColor: primary }}>Enregistrer</Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
