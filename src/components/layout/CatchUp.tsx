'use client'
// Catching up on a forgotten day (owner, 2026-10-10):
//   • CatchUpBanner — on every screen while a past day is being entered, so
//     nobody records today's sales on it by mistake;
//   • CatchUpEntry — on the Caisse screen, where a manager starts it.
import { useState } from 'react'
import { History, Undo2 } from 'lucide-react'
import { useUser } from '@/lib/hooks/useUser'
import { Modal, Field, Btn, inputClass } from '@/components/shared'
import { useWorkDay, frDay, earliestCatchUp, yesterday, CATCH_UP_DAYS } from '@/lib/stores/workDay'

const isManager = (role?: string | null) => role === 'gerant' || role === 'proprietaire'

export function CatchUpBanner() {
  const work = useWorkDay()
  if (!work.late) return null
  return (
    <div className="print:hidden flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-amber-400 text-black text-sm font-bold flex-shrink-0">
      <span className="flex items-center gap-2">
        <History className="w-4 h-4 flex-shrink-0" />
        Rattrapage : tout ce que vous enregistrez est daté du {frDay(work.date)}
      </span>
      <button onClick={work.stop} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-black text-white text-xs font-bold">
        <Undo2 className="w-3.5 h-3.5" /> Revenir à aujourd’hui
      </button>
    </div>
  )
}

export function CatchUpEntry() {
  const { user } = useUser()
  const work = useWorkDay()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(yesterday())
  if (!isManager(user?.role) || work.late) return null
  const ok = date >= earliestCatchUp() && date <= yesterday()
  return (
    <>
      <div className="px-4 sm:px-6 pt-3 flex justify-end">
        <button onClick={() => { setDate(yesterday()); setOpen(true) }}
          className="flex items-center gap-1.5 text-xs font-bold text-ez-subtle underline">
          <History className="w-3.5 h-3.5" /> Rattraper une journée oubliée
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Rattraper une journée oubliée" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-ez-subtle">
            Pour une journée où les ventes n’ont pas été saisies. Vous ouvrez sa caisse, vous enregistrez ses ventes,
            ses dépenses et ses entrées d’argent <b className="text-ez-text">à sa vraie date</b>, puis vous la clôturez.
          </p>
          <Field label="Journée à rattraper" required>
            <input type="date" className={inputClass} value={date} min={earliestCatchUp()} max={yesterday()} onChange={e => setDate(e.target.value)} />
          </Field>
          <p className="text-xs text-ez-faint">
            Possible sur les {CATCH_UP_DAYS} derniers jours, et seulement si la caisse de ce jour n’est pas déjà clôturée.
            Chaque saisie est notée « après coup » dans le journal.
          </p>
          <div className="flex gap-2">
            <Btn variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Retour</Btn>
            <Btn variant="primary" className="flex-1" disabled={!ok} onClick={() => { work.start(date); setOpen(false) }}>Commencer</Btn>
          </div>
        </div>
      </Modal>
    </>
  )
}
