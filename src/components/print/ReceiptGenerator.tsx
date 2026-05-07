'use client'
import React from 'react'

// ─── Types ────────────────────────────────────────────────────
export interface ReceiptItem {
  name:       string
  qty:        number
  unit_price: number
  line_total: number
  imei?:      string
}

export interface ReceiptData {
  store_name:       string
  store_address?:   string
  store_phone?:     string
  txn_id:           string
  date_vente:       string
  cashier_name:     string
  items:            ReceiptItem[]
  total:            number
  avance?:          number
  valeur_echange?:  number
  fariq?:           number
  payment_method:   string
  montant_especes?: number
  montant_carte?:   number
  montant_rendu?:   number
  warranty_start?:  string
  warranty_expiry?: string
  warranty_months?: number
}

interface ReceiptPrintProps {
  data:    ReceiptData
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────
function fmtMAD(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' MAD'
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function fmtDateTime(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return `${fmtDate(s)} — ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const PM_LABELS: Record<string, string> = {
  'نقد':     'Espèces / نقداً',
  'تحويل':   'Virement / تحويل',
  'تسبيق':   'Avance / تسبيق',
  'إستبدال': 'Échange / استبدال',
  'مختلط':   'Mixte / مختلط',
}

// ─── Component ────────────────────────────────────────────────
export function ReceiptPrint({ data, onClose }: ReceiptPrintProps) {
  const fariq = data.fariq ?? (
    data.total - (data.avance ?? 0) - (data.valeur_echange ?? 0)
  )

  return (
    <>
      <style>{`
        @media print {
          body > *:not(#receipt-root) { display: none !important; }
          #receipt-root {
            display:    block !important;
            position:   static !important;
            background: white;
          }
          .receipt-no-print { display: none !important; }
          @page { margin: 0; size: 80mm auto; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Backdrop */}
      <div
        className="receipt-no-print fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Receipt panel */}
      <div
        id="receipt-root"
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4"
      >
        <div
          className="pointer-events-auto bg-white rounded-2xl shadow-2xl overflow-y-auto"
          style={{
            width:      '320px',
            maxHeight:  '90vh',
            fontFamily: "'Courier New', Courier, monospace",
            fontSize:   '12px',
          }}
        >
          <div className="p-5 space-y-3">

            {/* Store header */}
            <div className="text-center space-y-0.5 pb-1">
              <p className="font-bold text-base tracking-widest uppercase">
                {data.store_name}
              </p>
              {data.store_address && (
                <p className="text-[11px] text-gray-500">{data.store_address}</p>
              )}
              {data.store_phone && (
                <p className="text-[11px] text-gray-500">{data.store_phone}</p>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300" />

            {/* Transaction meta */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Ticket N° / رقم</span>
                <span className="font-bold">{data.txn_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date / التاريخ</span>
                <span>{fmtDateTime(data.date_vente)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Caissier / الكاشير</span>
                <span className="truncate max-w-[160px] text-right">
                  {data.cashier_name}
                </span>
              </div>
            </div>

            <div className="border-t border-dashed border-gray-300" />

            {/* Items */}
            <div className="space-y-2">
              <p className="font-bold text-[11px] uppercase tracking-widest text-gray-500">
                Articles / المواد
              </p>
              {data.items.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between font-medium">
                    <span className="flex-1 pr-2 leading-tight text-[11px]">
                      {item.name}
                    </span>
                    <span className="flex-shrink-0 text-[11px]">
                      {fmtMAD(item.line_total)}
                    </span>
                  </div>
                  {item.imei && (
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                      IMEI: {item.imei}
                    </p>
                  )}
                  {item.qty > 1 && (
                    <p className="text-[10px] text-gray-400">
                      {item.qty} × {fmtMAD(item.unit_price)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-gray-300" />

            {/* Payment breakdown */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">Sous-total / المجموع</span>
                <span className="font-bold">{fmtMAD(data.total)}</span>
              </div>

              {(data.avance ?? 0) > 0 && (
                <div className="flex justify-between text-[11px] text-amber-700">
                  <span>Avance versée / التسبيق</span>
                  <span>- {fmtMAD(data.avance!)}</span>
                </div>
              )}

              {(data.valeur_echange ?? 0) > 0 && (
                <div className="flex justify-between text-[11px] text-blue-700">
                  <span>Reprise échange / الاستبدال</span>
                  <span>- {fmtMAD(data.valeur_echange!)}</span>
                </div>
              )}

              <div className="flex justify-between font-bold text-[13px] border-t border-gray-200 pt-1 mt-1">
                <span>
                  {fariq === 0 ? '✓ Soldé / مسدد' : 'Reste à payer / المتبقي'}
                </span>
                <span>
                  {fariq === 0 ? '0,00 MAD' : fmtMAD(fariq)}
                </span>
              </div>

              <div className="flex justify-between text-[11px] text-gray-500">
                <span>Règlement / الدفع</span>
                <span className="text-right max-w-[180px]">
                  {PM_LABELS[data.payment_method] ?? data.payment_method}
                  {data.payment_method === 'مختلط' &&
                   data.montant_especes != null &&
                   data.montant_carte   != null
                    ? ` (${fmtMAD(data.montant_especes)} esp. + ${fmtMAD(data.montant_carte)} vir.)`
                    : ''}
                </span>
              </div>

              {(data.montant_rendu ?? 0) > 0 && (
                <div className="flex justify-between text-[11px] font-bold text-emerald-700">
                  <span>Monnaie rendue / الباقي</span>
                  <span>{fmtMAD(data.montant_rendu!)}</span>
                </div>
              )}
            </div>

            {/* Warranty */}
            {data.warranty_expiry && (
              <>
                <div className="border-t border-dashed border-gray-300" />
                <div className="space-y-1">
                  <p className="font-bold text-[11px] uppercase tracking-widest text-gray-500">
                    Garantie / الضمان
                  </p>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Début / البداية</span>
                    <span>{fmtDate(data.warranty_start)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Expiration / الانتهاء</span>
                    <span className="font-bold">{fmtDate(data.warranty_expiry)}</span>
                  </div>
                  {data.warranty_months != null && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Durée / المدة</span>
                      <span>{data.warranty_months} mois / أشهر</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="border-t border-dashed border-gray-300" />

            {/* Signature + stamp */}
            <div className="space-y-4">
              <div>
                <p className="text-[11px] text-gray-500 mb-6">
                  Signature client / توقيع العميل :
                </p>
                <div className="border-b border-gray-400 w-full" />
              </div>
              <div className="border border-gray-300 rounded-lg h-14 flex items-center justify-center">
                <span className="text-[10px] text-gray-400">
                  Cachet magasin / ختم المحل
                </span>
              </div>
            </div>

            <div className="border-t border-dashed border-gray-300" />

            {/* Footer */}
            <div className="text-center space-y-0.5">
              <p className="text-[11px] font-medium">Merci de votre confiance !</p>
              <p className="text-[10px] text-gray-400">
                شكراً لثقتكم — نتمنى رؤيتك مجدداً
              </p>
              {data.store_phone && (
                <p className="text-[10px] text-gray-400">{data.store_phone}</p>
              )}
            </div>

          </div>

          {/* Controls — hidden in print */}
          <div className="receipt-no-print flex gap-2 px-5 pb-5">
            <button
              onClick={() => window.print()}
              className="flex-1 py-3 rounded-xl bg-[#1A1A1A] text-white text-sm font-bold hover:bg-[#333] transition-all"
            >
              🖨 Imprimer
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-[#E8E5DE] text-[#6B6860] text-sm font-medium hover:bg-[#F8F7F4] transition-all"
            >
              Fermer
            </button>
          </div>

        </div>
      </div>
    </>
  )
}

// Legacy shim — keeps existing imports from breaking
export async function generateReceiptPDF(): Promise<void> {
  console.warn('[ReceiptGenerator] Deprecated — use ReceiptPrint component instead.')
}