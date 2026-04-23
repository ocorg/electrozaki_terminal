'use client'
import { formatMAD, formatDate } from '@/lib/utils'

interface RepairPart {
  nom_piece:    string
  fournisseur?: string
  cout:         number
}

interface RepairTicketProps {
  rep_id:             string
  marque?:            string
  model:              string
  device_type_libre?: string
  device_serial?:     string
  probleme:           string
  diagnostic?:        string
  battery_level?:     number
  statut:             string
  date_depot:         string
  date_prevue?:       string
  cout_reparation?:   number
  avance_rep?:        number
  fariq_rep?:         number
  technicien?:        string
  notes?:             string
  client_nom?:        string
  client_tel?:        string
  parts?:             RepairPart[]
  store_name:         string
  store_phone:        string
}

export async function generateRepairTicketPDF(r: RepairTicketProps): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  let y = 20

  const text  = (str: string, x: number, size = 10, bold = false, align: 'left'|'center'|'right' = 'left') => {
    doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(str, x, y, { align })
  }
  const row   = (label: string, value: string) => {
    text(label, 20, 9, true); text(value, 100, 9); y += 5.5
  }
  const hline = () => { doc.setDrawColor(200, 200, 200); doc.line(15, y, pageW - 15, y); y += 4 }

  // ── Header ────────────────────────────────────────────────
  text(r.store_name.toUpperCase(), pageW / 2, 15, true, 'center')
  y += 7
  text('BON DE RÉPARATION', pageW / 2, 12, true, 'center')
  y += 8
  hline()

  // ── Repair ID + dates ──────────────────────────────────────
  row('N° Réparation:', r.rep_id)
  row('Date de dépôt:', formatDate(r.date_depot))
  if (r.date_prevue) row('Date prévue:', formatDate(r.date_prevue))

  // Statut badge inline
  text(`Statut: ${r.statut}`, 20, 10, true)
  y += 7
  hline()

  // ── Device ────────────────────────────────────────────────
  text('APPAREIL', 20, 10, true); y += 6
  const deviceLabel = [r.marque, r.model].filter(Boolean).join(' ')
  row('Appareil:', deviceLabel || '—')
  if (r.device_type_libre) row('Type:', r.device_type_libre)
  if (r.device_serial)     row('IMEI / Série:', r.device_serial)
  if (r.battery_level != null) row('Batterie:', `${r.battery_level}%`)
  y += 2; hline()

  // ── Problem ───────────────────────────────────────────────
  text('PANNE SIGNALÉE', 20, 10, true); y += 6
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  const panneLines = doc.splitTextToSize(r.probleme, 170)
  doc.text(panneLines, 20, y); y += panneLines.length * 5 + 3

  if (r.diagnostic) {
    text('Diagnostic:', 20, 9, true); y += 5
    const diagLines = doc.splitTextToSize(r.diagnostic, 170)
    doc.text(diagLines, 20, y); y += diagLines.length * 5 + 3
  }
  hline()

  // ── Client ────────────────────────────────────────────────
  if (r.client_nom) {
    text('CLIENT', 20, 10, true); y += 6
    row('Nom:', r.client_nom)
    if (r.client_tel) row('Téléphone:', r.client_tel)
    hline()
  }

  // ── Financials ────────────────────────────────────────────
  text('DÉTAIL FINANCIER', 20, 10, true); y += 6
  if (r.cout_reparation != null) row('Coût réparation:', formatMAD(r.cout_reparation))
  if (r.avance_rep      != null) row('Avance versée:',  formatMAD(r.avance_rep))
  if (r.fariq_rep       != null) row('Reste à payer:',  formatMAD(r.fariq_rep))
  if (r.technicien) row('Technicien:', r.technicien)
  hline()

  // ── Parts ─────────────────────────────────────────────────
  if (r.parts && r.parts.length > 0) {
    text('PIÈCES UTILISÉES', 20, 10, true); y += 6
    for (const p of r.parts) {
      text(`• ${p.nom_piece}${p.fournisseur ? ` (${p.fournisseur})` : ''}`, 22, 9)
      text(formatMAD(p.cout), 190, 9, false, 'right')
      y += 5
    }
    const totalParts = r.parts.reduce((s, p) => s + p.cout, 0)
    text('Total pièces:', 20, 9, true)
    text(formatMAD(totalParts), 190, 9, true, 'right')
    y += 6
    hline()
  }

  // ── Notes ─────────────────────────────────────────────────
  if (r.notes) {
    text('Notes:', 20, 9, true); y += 5
    const notesLines = doc.splitTextToSize(r.notes, 170)
    doc.text(notesLines, 20, y); y += notesLines.length * 5 + 3
  }

  // ── Footer ────────────────────────────────────────────────
  y = Math.max(y + 10, 265)
  doc.line(15, y, pageW - 15, y); y += 6
  text('Merci de votre confiance — BZG Group', pageW / 2, 9, false, 'center')
  y += 5
  text(r.store_phone, pageW / 2, 9, false, 'center')

  doc.save(`reparation-${r.rep_id}.pdf`)
}