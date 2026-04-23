'use client'
import { formatMAD, formatDate } from '@/lib/utils'

interface ReceiptTransaction {
  txn_id:           string
  device_type:      string
  device_id:        string
  type_operation:   string
  prix_vente:       number
  avance?:          number
  valeur_echange?:  number
  fariq?:           number
  payment_method:   string
  warranty_expiry?: string
  created_at:       string
  // Joined from clients
  client_nom?:      string
  client_tel?:      string
  // Device display
  device_model?:    string
  device_imei?:     string
}

interface ReceiptStore {
  name:    string
  address: string
  phone:   string
}

interface ReceiptGeneratorProps {
  transaction: ReceiptTransaction
  store:       ReceiptStore
}

export async function generateReceiptPDF(props: ReceiptGeneratorProps): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { transaction: t, store } = props

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  let y = 20

  // ── Helper functions ──────────────────────────────────────
  const line   = (x1: number, x2: number) => { doc.line(x1, y, x2, y); y += 4 }
  const text   = (str: string, x: number, size = 10, bold = false, align: 'left'|'center'|'right' = 'left') => {
    doc.setFontSize(size)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(str, x, y, { align })
  }
  const row    = (label: string, value: string, labelX = 20, valueX = 190) => {
    text(label, labelX, 10)
    text(value, valueX, 10, false, 'right')
    y += 6
  }

  // ── Header ────────────────────────────────────────────────
  text(store.name.toUpperCase(), pageW / 2, 16, true, 'center')
  y += 8
  text(store.address, pageW / 2, 9, false, 'center')
  y += 5
  text(store.phone, pageW / 2, 9, false, 'center')
  y += 8

  doc.setDrawColor(180, 180, 180)
  line(15, pageW - 15)

  // ── Receipt metadata ──────────────────────────────────────
  text('REÇU DE VENTE', pageW / 2, 13, true, 'center')
  y += 7
  row('N° Transaction:', t.txn_id)
  row('Date:', formatDate(t.created_at))

  if (t.client_nom) {
    row('Client:', t.client_nom)
    if (t.client_tel) row('Téléphone:', t.client_tel)
  }

  y += 2
  doc.setDrawColor(200, 200, 200)
  line(15, pageW - 15)

  // ── Item table header ─────────────────────────────────────
  text('Article', 20, 10, true)
  text('Prix', 190, 10, true, 'right')
  y += 6
  line(15, pageW - 15)

  // ── Item ─────────────────────────────────────────────────
  const itemName = t.device_model
    ? `${t.device_type} — ${t.device_model}`
    : `${t.device_type} (${t.device_id})`
  text(itemName, 20, 10)
  text(formatMAD(t.prix_vente), 190, 10, false, 'right')
  y += 6
  if (t.device_imei) {
    text(`IMEI: ${t.device_imei}`, 20, 8)
    y += 5
  }

  y += 2
  line(15, pageW - 15)

  // ── Payment breakdown ─────────────────────────────────────
  text('DÉTAIL DU PAIEMENT', 20, 10, true)
  y += 6

  row('Prix de vente:', formatMAD(t.prix_vente))
  if (t.avance && t.avance > 0) {
    row('Avance versée:', `- ${formatMAD(t.avance)}`)
  }
  if (t.valeur_echange && t.valeur_echange > 0) {
    row('Valeur reprise (échange):', `- ${formatMAD(t.valeur_echange)}`)
  }

  const fariq = t.fariq ?? (t.prix_vente - (t.avance ?? 0) - (t.valeur_echange ?? 0))
  const isSettled = fariq === 0

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Reste à payer:', 20, y)
  doc.text(isSettled ? '✓ SOLDÉ' : formatMAD(fariq), 190, y, { align: 'right' })
  y += 7

  row('Mode de paiement:', t.payment_method)

  // ── Warranty ─────────────────────────────────────────────
  if (t.warranty_expiry) {
    y += 3
    doc.setDrawColor(200, 200, 200)
    line(15, pageW - 15)
    text('GARANTIE', 20, 10, true)
    y += 6
    row("Date d'expiration:", formatDate(t.warranty_expiry))
  }

  // ── Footer ────────────────────────────────────────────────
  y = 270
  doc.setDrawColor(180, 180, 180)
  doc.line(15, y, pageW - 15, y)
  y += 6
  text('Merci de votre confiance — BZG Group', pageW / 2, 10, false, 'center')
  y += 5
  text(store.phone, pageW / 2, 9, false, 'center')

  doc.save(`recu-${t.txn_id}.pdf`)
}