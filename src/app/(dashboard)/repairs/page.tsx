'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, Btn, PageHeader, EmptyState } from '@/components/shared'
import { toast } from 'sonner'
import type { Reparation, RepairStatus } from '@/types/database'
import { Wrench, Plus, Clock, User, Phone, Calendar, ChevronRight, Loader2, Package } from 'lucide-react'

const COLUMNS: { status: RepairStatus; label: string; labelAr: string; color: string; bg: string; dot: string }[] = [
  { status: 'معلق',        label: 'En attente',  labelAr: 'معلق',        color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',   dot: 'bg-amber-500' },
  { status: 'قيد الإصلاح', label: 'En cours',    labelAr: 'قيد الإصلاح', color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',      dot: 'bg-blue-500' },
  { status: 'جاهز',        label: 'Prêt',        labelAr: 'جاهز',        color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200',dot: 'bg-emerald-500' },
  { status: 'تم الاستلام', label: 'Récupéré',    labelAr: 'تم الاستلام', color: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200',    dot: 'bg-slate-400' },
]

const STATUS_NEXT: Record<RepairStatus, RepairStatus | null> = {
  'معلق':        'قيد الإصلاح',
  'قيد الإصلاح': 'جاهز',
  'جاهز':        'تم الاستلام',
  'تم الاستلام': null,
}

interface RepairWithClient extends Reparation {
  clients?: { nom: string; telephone: string } | null
  reparations_parts?: Array<{ cout: number }>
}

export default function RepairsPage() {
  const { user } = useUser()
  const { language } = useLanguageStore()
  const isAr = language === 'ar'

  const [repairs, setRepairs]     = useState<RepairWithClient[]>([])
  const [loading, setLoading]     = useState(true)
  const [formOpen, setFormOpen]   = useState(false)
  const [detailRepair, setDetailRepair] = useState<RepairWithClient | null>(null)
  const [updating, setUpdating]   = useState<string | null>(null)

  const fetchRepairs = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/repairs')
    const json = await res.json()
    setRepairs(json.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchRepairs() }, [fetchRepairs])

  async function advanceStatus(repair: RepairWithClient) {
    const next = STATUS_NEXT[repair.statut]
    if (!next) return
    setUpdating(repair.rep_id)
    const updates: Partial<Reparation> = { statut: next }
    if (next === 'تم الاستلام') updates.date_livraison = new Date().toISOString().split('T')[0]
    try {
      const res = await fetch('/api/repairs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rep_id: repair.rep_id, ...updates }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`Statut → ${next}`)
      fetchRepairs()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setUpdating(null)
    }
  }

  const activeCount = repairs.filter(r => ['معلق','قيد الإصلاح'].includes(r.statut)).length
  const readyCount  = repairs.filter(r => r.statut === 'جاهز').length

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title={isAr ? 'الإصلاحات' : 'Réparations'}
        subtitle={`${activeCount} actives · ${readyCount} prêtes à retirer`}
        actions={
          <Btn variant="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            {isAr ? 'إصلاح جديد' : 'Nouvelle réparation'}
          </Btn>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-gold animate-spin" />
        </div>
      ) : (
        /* Kanban board */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => {
            const cards = repairs.filter(r => r.statut === col.status)
            return (
              <div key={col.status} className="flex flex-col gap-3">
                {/* Column header */}
                <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${col.bg}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <span className={`text-sm font-semibold ${col.color}`}>
                      {isAr ? col.labelAr : col.label}
                    </span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/60 ${col.color}`}>
                    {cards.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 min-h-[120px]">
                  {cards.length === 0 ? (
                    <div className="flex items-center justify-center h-20 border-2 border-dashed border-ez-border rounded-xl">
                      <p className="text-xs text-ez-placeholder">Aucune</p>
                    </div>
                  ) : (
                    cards.map(repair => (
                      <RepairCard
                        key={repair.rep_id}
                        repair={repair}
                        isAr={isAr}
                        updating={updating === repair.rep_id}
                        onAdvance={() => advanceStatus(repair)}
                        onDetail={() => setDetailRepair(repair)}
                        nextStatus={STATUS_NEXT[repair.statut]}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* New repair form */}
      <RepairForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchRepairs}
      />

      {/* Detail modal */}
      {detailRepair && (
        <RepairDetail
          repair={detailRepair}
          onClose={() => setDetailRepair(null)}
          onAdvance={() => { advanceStatus(detailRepair); setDetailRepair(null) }}
          nextStatus={STATUS_NEXT[detailRepair.statut]}
        />
      )}
    </div>
  )
}

// ── Repair Card ───────────────────────────────────────────────
function RepairCard({ repair, isAr, updating, onAdvance, onDetail, nextStatus }: {
  repair: RepairWithClient
  isAr: boolean
  updating: boolean
  onAdvance: () => void
  onDetail: () => void
  nextStatus: RepairStatus | null
}) {
  const fariq = (repair.cout_reparation || 0) - (repair.avance_rep || 0)
  const totalParts = repair.reparations_parts?.reduce((sum, p) => sum + (p.cout || 0), 0) || 0

  return (
    <div
      className="bg-white border border-ez-border rounded-xl p-3.5 hover:border-gold/30 hover:shadow-[0_2px_12px_rgba(201,164,64,0.08)] transition-all cursor-pointer group"
      onClick={onDetail}
    >
      {/* Rep ID + date */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-ez-placeholder">{repair.rep_id}</span>
        <span className="text-[10px] text-ez-placeholder">{formatDate(repair.date_depot)}</span>
      </div>

      {/* Device */}
      <div className="flex items-start gap-2 mb-2">
        <Wrench className="w-3.5 h-3.5 text-ez-subtle flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-sm text-ez-text leading-tight truncate">
            {repair.marque ? `${repair.marque} ` : ''}{repair.model}
          </p>
          <p className="text-xs text-ez-subtle truncate">{repair.probleme}</p>
        </div>
      </div>

      {/* Client */}
      {repair.clients && (
        <div className="flex items-center gap-1.5 mb-2">
          <User className="w-3 h-3 text-ez-placeholder" />
          <span className="text-xs text-ez-subtle">{repair.clients.nom}</span>
          <span className="text-ez-placeholder">·</span>
          <Phone className="w-3 h-3 text-ez-placeholder" />
          <span className="text-xs text-ez-subtle font-mono">{repair.clients.telephone}</span>
        </div>
      )}

      {/* Cost */}
      {repair.cout_reparation ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-ez-subtle">
            {fariq > 0 ? `Reste: ${formatMAD(fariq)}` : 'Soldé ✓'}
          </span>
          {repair.date_prevue && (
            <span className="text-[10px] text-ez-placeholder flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(repair.date_prevue)}
            </span>
          )}
        </div>
      ) : null}

      {/* Advance button */}
      {nextStatus && (
        <button
          onClick={e => { e.stopPropagation(); onAdvance() }}
          disabled={updating}
          className="w-full mt-2.5 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-ez-muted hover:bg-gold/10 hover:text-gold text-ez-subtle text-xs font-medium transition-all disabled:opacity-50"
        >
          {updating
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <><ChevronRight className="w-3 h-3" /> → {nextStatus}</>
          }
        </button>
      )}
    </div>
  )
}

// ── Repair Detail Modal ───────────────────────────────────────
function RepairDetail({ repair, onClose, onAdvance, nextStatus }: {
  repair: RepairWithClient
  onClose: () => void
  onAdvance: () => void
  nextStatus: RepairStatus | null
}) {
  const fariq = (repair.cout_reparation || 0) - (repair.avance_rep || 0)
  const totalParts = repair.reparations_parts?.reduce((sum, p) => sum + (p.cout || 0), 0) || 0
  return (
    <Modal open onClose={onClose} title={`${repair.rep_id} — ${repair.model}`} size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-ez-subtle mb-0.5">Appareil</p><p className="font-medium">{repair.marque} {repair.model}</p></div>
          <div><p className="text-xs text-ez-subtle mb-0.5">Problème</p><p className="font-medium">{repair.probleme}</p></div>
          {repair.clients && <>
            <div><p className="text-xs text-ez-subtle mb-0.5">Client</p><p className="font-medium">{repair.clients.nom}</p></div>
            <div><p className="text-xs text-ez-subtle mb-0.5">Téléphone</p><p className="font-medium font-mono">{repair.clients.telephone}</p></div>
          </>}
          <div><p className="text-xs text-ez-subtle mb-0.5">Déposé le</p><p className="font-medium">{formatDate(repair.date_depot)}</p></div>
          {repair.date_prevue && <div><p className="text-xs text-ez-subtle mb-0.5">Date prévue</p><p className="font-medium">{formatDate(repair.date_prevue)}</p></div>}
          {repair.technicien && <div><p className="text-xs text-ez-subtle mb-0.5">Technicien</p><p className="font-medium">{repair.technicien}</p></div>}
        </div>
        {repair.diagnostic && (
          <div className="bg-ez-bg rounded-xl p-3">
            <p className="text-xs text-ez-subtle mb-1">Diagnostic</p>
            <p className="text-sm">{repair.diagnostic}</p>
          </div>
        )}
        <div className="bg-gold/5 border border-gold/15 rounded-xl p-3">
          <p className="text-xs font-bold text-gold/70 uppercase tracking-widest mb-2">Tarification</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-xs text-ez-subtle">Coût réparation</p><p className="font-bold">{formatMAD(repair.cout_reparation || 0)}</p></div>
            <div><p className="text-xs text-ez-subtle">Avance</p><p className="font-bold">{formatMAD(repair.avance_rep || 0)}</p></div>
            <div><p className="text-xs text-ez-subtle">Reste à payer</p><p className={`font-bold ${fariq > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>{formatMAD(fariq)}</p></div>
          </div>
        </div>
        {repair.reparations_parts && repair.reparations_parts.length > 0 && (
          <div>
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest mb-2">Pièces utilisées</p>
            <div className="space-y-1">
              {repair.reparations_parts.map((p: { description?: string; cout: number; fournisseur?: string }, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm bg-ez-bg rounded-lg px-3 py-2">
                  <span>{p.description}</span>
                  <span className="font-medium">{formatMAD(p.cout)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm font-bold px-3 pt-1 border-t border-ez-border">
                <span>Total pièces</span>
                <span>{formatMAD(totalParts)}</span>
              </div>
            </div>
          </div>
        )}
        {repair.notes && (
          <div><p className="text-xs text-ez-subtle mb-1">Notes</p><p className="text-sm">{repair.notes}</p></div>
        )}
        {nextStatus && (
          <div className="flex justify-end pt-2 border-t border-ez-border">
            <Btn variant="primary" onClick={onAdvance}>
              <ChevronRight className="w-4 h-4" />
              Passer à: {nextStatus}
            </Btn>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── New Repair Form ───────────────────────────────────────────
function RepairForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    model: '', marque: '', probleme: '', diagnostic: '',
    cout_reparation: '', avance_rep: '',
    date_prevue: '', technicien: '', notes: '',
    client_nom: '', client_tel: '',
    device_serial: '',
  })
  const [loading, setLoading] = useState(false)

  function set(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.model || !form.probleme) { toast.error('Modèle et problème obligatoires'); return }
    setLoading(true)
    try {
      // First create or find client
      let clientId: string | undefined
      if (form.client_nom && form.client_tel) {
        const cRes = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nom: form.client_nom, telephone: form.client_tel }),
        })
        const cJson = await cRes.json()
        clientId = cJson.data?.client_id
      }

      const res = await fetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: form.model,
          marque: form.marque || undefined,
          probleme: form.probleme,
          diagnostic: form.diagnostic || undefined,
          cout_reparation: form.cout_reparation ? Number(form.cout_reparation) : 0,
          avance_rep: form.avance_rep ? Number(form.avance_rep) : 0,
          date_avance_rep: form.avance_rep ? new Date().toISOString().split('T')[0] : undefined,
          date_prevue: form.date_prevue || undefined,
          technicien: form.technicien || undefined,
          notes: form.notes || undefined,
          device_serial: form.device_serial || undefined,
          client_id: clientId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`Réparation ${json.data.rep_id} créée ✓`)
      onSaved()
      onClose()
      setForm({ model:'',marque:'',probleme:'',diagnostic:'',cout_reparation:'',avance_rep:'',date_prevue:'',technicien:'',notes:'',client_nom:'',client_tel:'',device_serial:'' })
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle réparation" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Client — Nom">
            <input className={inputClass} value={form.client_nom} onChange={e => set('client_nom', e.target.value)} placeholder="Nom du client" />
          </Field>
          <Field label="Client — Téléphone">
            <input className={inputClass} value={form.client_tel} onChange={e => set('client_tel', e.target.value)} placeholder="06XXXXXXXX" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Marque">
            <input className={inputClass} value={form.marque} onChange={e => set('marque', e.target.value)} placeholder="Apple, Samsung..." />
          </Field>
          <Field label="Modèle" required>
            <input className={inputClass} value={form.model} onChange={e => set('model', e.target.value)} placeholder="iPhone 13, Galaxy S22..." />
          </Field>
        </div>
        <Field label="N° Série / IMEI">
          <input className={inputClass} value={form.device_serial} onChange={e => set('device_serial', e.target.value)} placeholder="Optionnel" />
        </Field>
        <Field label="Problème décrit" required>
          <textarea className={`${inputClass} resize-none`} rows={2} value={form.probleme} onChange={e => set('probleme', e.target.value)} placeholder="Écran cassé, batterie, ne s'allume pas..." />
        </Field>
        <Field label="Diagnostic technique">
          <textarea className={`${inputClass} resize-none`} rows={2} value={form.diagnostic} onChange={e => set('diagnostic', e.target.value)} placeholder="Après examen..." />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Coût réparation (MAD)">
            <input type="number" className={inputClass} value={form.cout_reparation} onChange={e => set('cout_reparation', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Avance reçue (MAD)">
            <input type="number" className={inputClass} value={form.avance_rep} onChange={e => set('avance_rep', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Date prévue retour">
            <input type="date" className={inputClass} value={form.date_prevue} onChange={e => set('date_prevue', e.target.value)} />
          </Field>
        </div>
        <Field label="Technicien">
          <input className={inputClass} value={form.technicien} onChange={e => set('technicien', e.target.value)} placeholder="Nom du technicien" />
        </Field>
        <Field label="Notes internes">
          <textarea className={`${inputClass} resize-none`} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
        <div className="flex justify-end gap-3 pt-2 border-t border-ez-border">
          <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" type="submit" loading={loading}>Créer la réparation</Btn>
        </div>
      </form>
    </Modal>
  )
}