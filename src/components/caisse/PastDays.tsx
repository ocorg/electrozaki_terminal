'use client'
// Correcting an earlier day (owner, 2026-10-13): on the Caisse screen, a
// manager sees the last days' caisses and can
//   • correct the opening or counted amount typed by mistake, or
//   • reopen a closed day to fix or complete what was entered in it — the
//     screens then work at that date (same banner as a forgotten day) until
//     the day is closed again.
// Rules live on the server: PATCH /api/caisse (action), lib/catchUp.ts.
import { useState } from 'react'
import { CalendarDays, Pencil, LockOpen } from 'lucide-react'
import { useUser } from '@/lib/hooks/useUser'
import { useApi } from '@/lib/data/api'
import { formatMAD, getBusinessDate } from '@/lib/utils'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { Modal, Field, Btn, inputClass } from '@/components/shared'
import { useWorkDay, frDay, CORRECTION_DAYS } from '@/lib/stores/workDay'

interface Day {
  caisse_id:       string
  date:            string
  status:          'ouverte' | 'en_attente_cloture' | 'cloturee'
  ouverture:       number
  solde_theorique: number | null
  solde_reel:      number | null
  ecart:           number | null
}

const isManager = (role?: string | null) => role === 'gerant' || role === 'proprietaire'
const signed = (n: number) => `${n > 0 ? '+' : ''}${formatMAD(n)}`

export function PastDaysEntry({ storeId }: { storeId: string }) {
  const { user } = useUser()
  const work = useWorkDay()
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Day | null>(null)       // amounts being corrected
  const [reopen, setReopen] = useState<Day | null>(null)   // day being reopened
  const [ouverture, setOuverture] = useState('')
  const [compte, setCompte] = useState('')
  const [motif, setMotif] = useState('')
  const [saving, setSaving] = useState(false)

  const manager = isManager(user?.role)
  const daysQ = useApi<Day[]>(manager && open ? `/api/bzg/caisse?store_id=${storeId}` : null)
  if (!manager || work.late) return null

  const today = getBusinessDate()
  const from  = new Date(Date.parse(`${today}T00:00:00Z`) - CORRECTION_DAYS * 86_400_000).toISOString().slice(0, 10)
  const days  = (daysQ.data ?? []).filter(d => d.date >= from && d.date <= today)

  function startEdit(d: Day) {
    setEdit(d); setOuverture(String(d.ouverture)); setCompte(d.solde_reel == null ? '' : String(d.solde_reel)); setMotif('')
  }

  async function send(body: Record<string, unknown>, done: string) {
    setSaving(true)
    try {
      const res  = await fetch('/api/caisse', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(done)
      await daysQ.refresh()
      return true
    } catch (err: unknown) {
      showError((err as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  // Preview of the corrected day: its totals do not move, only the two amounts
  const closed    = edit?.status === 'cloturee'
  const newOuv    = parseFloat(ouverture)
  const newCompte = parseFloat(compte)
  const amountsOk = !isNaN(newOuv) && newOuv >= 0 && (!closed || (!isNaN(newCompte) && newCompte >= 0))
  const changed   = !!edit && amountsOk && (newOuv !== Number(edit.ouverture) || (closed && newCompte !== Number(edit.solde_reel)))
  const newTheo   = edit && amountsOk ? Number(edit.solde_theorique ?? 0) + newOuv - Number(edit.ouverture) : null
  const newEcart  = closed && newTheo != null ? newCompte - newTheo : null

  return (
    <>
      <div className="px-4 sm:px-6 pt-2 flex justify-end">
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs font-bold text-ez-subtle underline">
          <CalendarDays className="w-3.5 h-3.5" /> Journées précédentes
        </button>
      </div>

      {/* ── The last days ── */}
      <Modal open={open && !edit && !reopen} onClose={() => setOpen(false)} title="Journées précédentes" size="lg">
        <div className="space-y-3">
          <p className="text-sm text-ez-subtle">
            Les caisses des {CORRECTION_DAYS} derniers jours. <b className="text-ez-text">Corriger</b> change un montant mal tapé ;{' '}
            <b className="text-ez-text">Rouvrir</b> permet d’ajouter ou de rectifier une vente, une dépense ou une entrée d’argent de ce jour.
          </p>
          {daysQ.isLoading && <p className="text-sm text-ez-faint py-6 text-center">Chargement…</p>}
          {!daysQ.isLoading && !days.length && <p className="text-sm text-ez-faint py-6 text-center">Aucune caisse sur cette période.</p>}
          <div className="divide-y divide-ez-muted border border-ez-border rounded-2xl overflow-hidden">
            {days.map(d => (
              <div key={d.caisse_id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-ez-text capitalize">{frDay(d.date)}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${d.status === 'ouverte' ? 'bg-amber-50 text-amber-700' : 'bg-ez-muted text-ez-subtle'}`}>
                    {d.status === 'ouverte' ? 'Ouverte' : d.status === 'cloturee' ? 'Clôturée' : 'En attente'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-xs text-ez-subtle tabular-nums">
                    Ouverture <b className="text-ez-text">{formatMAD(d.ouverture)}</b>
                    {d.status === 'cloturee' && <> · Compté <b className="text-ez-text">{formatMAD(d.solde_reel ?? 0)}</b>
                      {' '}· Écart <b className={Number(d.ecart) === 0 ? 'text-emerald-600' : 'text-red-500'}>{signed(Number(d.ecart ?? 0))}</b></>}
                  </p>
                  {d.status !== 'en_attente_cloture' && (
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(d)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ez-border text-xs font-bold text-ez-text hover:bg-ez-bg">
                        <Pencil className="w-3.5 h-3.5" /> Corriger
                      </button>
                      {d.status === 'cloturee' && (
                        <button onClick={() => { setReopen(d); setMotif('') }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ez-border text-xs font-bold text-ez-text hover:bg-ez-bg">
                          <LockOpen className="w-3.5 h-3.5" /> Rouvrir
                        </button>
                      )}
                      {d.status === 'ouverte' && d.date < today && (
                        <button onClick={() => { work.start(d.date); setOpen(false) }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ez-border text-xs font-bold text-ez-text hover:bg-ez-bg">
                          Continuer
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* ── Correct the amounts ── */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Corriger la caisse — ${frDay(edit.date)}` : ''} size="sm">
        {edit && (
          <div className="space-y-4">
            <Field label="Montant d'ouverture (MAD)" required>
              <input type="number" min="0" step="0.01" className={inputClass} value={ouverture} onChange={e => setOuverture(e.target.value)} />
            </Field>
            {closed && (
              <Field label="Montant compté à la clôture (MAD)" required>
                <input type="number" min="0" step="0.01" className={inputClass} value={compte} onChange={e => setCompte(e.target.value)} />
              </Field>
            )}
            {closed && newTheo != null && newEcart != null && (
              <div className="rounded-xl bg-ez-bg px-4 py-3 text-sm space-y-1 tabular-nums">
                <p className="flex justify-between"><span className="text-ez-subtle">Caisse calculée</span><b>{formatMAD(newTheo)}</b></p>
                <p className="flex justify-between"><span className="text-ez-subtle">Écart</span>
                  <b className={Math.abs(newEcart) < 0.005 ? 'text-emerald-600' : 'text-red-500'}>{signed(Math.round(newEcart * 100) / 100)}</b></p>
                <p className="text-xs text-ez-faint pt-1">Avant correction : écart {signed(Number(edit.ecart ?? 0))}. Les ventes et dépenses du jour ne changent pas.</p>
              </div>
            )}
            <Field label="Motif de la correction" required>
              <input className={inputClass} placeholder="Ex. : erreur de frappe à la clôture" value={motif} onChange={e => setMotif(e.target.value)} />
            </Field>
            <p className="text-xs text-ez-faint">La correction est notée dans le journal avec l’ancien et le nouveau montant, et signalée sur Telegram.</p>
            <div className="flex gap-2">
              <Btn variant="secondary" className="flex-1" onClick={() => setEdit(null)}>Retour</Btn>
              <Btn variant="primary" className="flex-1" loading={saving} disabled={!changed || motif.trim().length < 3}
                onClick={async () => {
                  const ok = await send({ action: 'corriger', caisse_id: edit.caisse_id, ouverture: newOuv, ...(closed && { solde_reel: newCompte }), motif }, 'Caisse corrigée ✓')
                  if (ok) setEdit(null)
                }}>
                Enregistrer
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Reopen a closed day ── */}
      <Modal open={!!reopen} onClose={() => setReopen(null)} title={reopen ? `Rouvrir la caisse — ${frDay(reopen.date)}` : ''} size="sm">
        {reopen && (
          <div className="space-y-4">
            <p className="text-sm text-ez-subtle">
              La journée redevient ouverte. Tout ce que vous enregistrez ensuite est <b className="text-ez-text">daté de ce jour</b>,
              jusqu’à ce que vous la clôturiez de nouveau : ses totaux et son écart seront alors recalculés.
            </p>
            <Field label="Motif de la réouverture" required>
              <input className={inputClass} placeholder="Ex. : une vente oubliée" value={motif} onChange={e => setMotif(e.target.value)} />
            </Field>
            <p className="text-xs text-ez-faint">N’oubliez pas de la clôturer de nouveau, puis « Revenir à aujourd’hui ».</p>
            <div className="flex gap-2">
              <Btn variant="secondary" className="flex-1" onClick={() => setReopen(null)}>Retour</Btn>
              <Btn variant="primary" className="flex-1" loading={saving} disabled={motif.trim().length < 3}
                onClick={async () => {
                  const day = reopen.date
                  const ok = await send({ action: 'rouvrir', caisse_id: reopen.caisse_id, motif }, 'Caisse rouverte ✓')
                  if (!ok) return
                  setReopen(null); setOpen(false)
                  if (day < today) work.start(day)   // the screens now work at that date
                }}>
                Rouvrir
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
