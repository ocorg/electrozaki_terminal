'use client'
import { useMemo, useState } from 'react'
import { ShoppingBag, Phone, MessageCircle, RefreshCw, Receipt, CheckCircle2, XCircle, Store } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { Modal, Btn, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { useSiteLang, Tabs, Chip, ORDER_STATUS, PAYMENT_STATUS, whatsappLink, mad, dateTime } from './common'

interface OrderRow {
  id: string; ref: string; customerName: string; customerPhone: string; status: string
  totalEstimate: number; discountAmount: number; requiresAdvance: boolean; advancePaymentStatus: string
  whatsappOpenedAt: string | null; createdAt: string
  items: { productNameSnapshot: string; quantity: number; isGift: boolean }[]
}

interface OrderDetail extends Omit<OrderRow, 'items'> {
  deliveryAddress: string | null; notes: string | null; receiptUrl: string | null
  promoCode: { code: string } | null
  items: {
    id: string; productNameSnapshot: string; quantity: number; priceAtRequest: number; isGift: boolean; bundleId: string | null
    product: { slug: string; isPhone: boolean }
    erpPhones: { phone_id: string; marque: string; model: string; stockage: string | null; couleur: string | null; battery_level: number | null; status: string; imei_end: string | null }[]
  }[]
}

type Filter = 'open' | 'NEW' | 'CONTACTED' | 'CONFIRMED' | 'CANCELLED' | 'all'

export default function SiteOrdersModule() {
  const { L, isAr, isManager } = useSiteLang()
  const [filter, setFilter]   = useState<Filter>('open')
  const [openId, setOpenId]   = useState<string | null>(null)
  const ordersQ = useApi<OrderRow[]>('/api/site/orders')
  const orders  = useMemo(() => ordersQ.data ?? [], [ordersQ.data])

  const shown = orders.filter(o =>
    filter === 'all' ? true : filter === 'open' ? o.status === 'NEW' || o.status === 'CONTACTED' : o.status === filter)
  const count = (s: string) => orders.filter(o => o.status === s).length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={L('Commandes web', 'طلبات الموقع')}
          subtitle={L('Commandes passées sur le site Electro Zaki', 'الطلبات القادمة من الموقع الإلكتروني')}
          actions={
            <button onClick={() => ordersQ.refresh()} className="p-2 rounded-xl border border-ez-border bg-white text-ez-subtle hover:bg-ez-bg">
              <RefreshCw className={`w-4 h-4 ${ordersQ.isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          }
        />
        <Tabs<Filter> value={filter} onChange={setFilter} tabs={[
          { key: 'open',      label: L('À traiter', 'للمعالجة'), count: count('NEW') + count('CONTACTED') },
          { key: 'NEW',       label: L('Nouvelles', 'جديدة'), count: count('NEW') },
          { key: 'CONTACTED', label: L('Contactées', 'تم الاتصال'), count: count('CONTACTED') },
          { key: 'CONFIRMED', label: L('Confirmées', 'مؤكدة'), count: count('CONFIRMED') },
          { key: 'CANCELLED', label: L('Annulées', 'ملغاة'), count: count('CANCELLED') },
          { key: 'all',       label: L('Toutes', 'الكل'), count: orders.length },
        ]} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {ordersQ.isLoading ? (
          <div className="bg-white rounded-2xl border border-ez-border">{[0, 1, 2].map(i => <SkeletonRow key={i} />)}</div>
        ) : ordersQ.error ? (
          <EmptyState icon={<ShoppingBag className="w-6 h-6" />} title={L('Site web indisponible', 'الموقع غير متاح')} description={ordersQ.error.message} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<ShoppingBag className="w-6 h-6" />} title={L('Aucune commande', 'لا توجد طلبات')} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map(o => {
              const st = ORDER_STATUS[o.status]; const pay = PAYMENT_STATUS[o.advancePaymentStatus]
              return (
                <button key={o.id} onClick={() => setOpenId(o.id)}
                  className="text-start bg-white border border-ez-border rounded-2xl p-4 space-y-2 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-ez-subtle">#{o.ref} · {dateTime(o.createdAt)}</span>
                    <Chip tone={st.tone}>{isAr ? st.ar : st.fr}</Chip>
                  </div>
                  <p className="font-bold text-ez-text">{o.customerName}</p>
                  <p className="text-xs text-ez-subtle line-clamp-2">
                    {o.items.map(i => `${i.quantity}× ${i.productNameSnapshot}`).join(' · ')}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ez-text">{mad(o.totalEstimate)}</span>
                    {o.requiresAdvance && <Chip tone={pay.tone}>{isAr ? pay.ar : pay.fr}</Chip>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {openId && <OrderModal id={openId} isManager={isManager} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function OrderModal({ id, isManager, onClose }: { id: string; isManager: boolean; onClose: () => void }) {
  const { L, isAr } = useSiteLang()
  const q = useApi<OrderDetail>(`/api/site/orders/${id}`)
  const o = q.data
  const [busy, setBusy] = useState<string | null>(null)

  async function act(key: string, url: string, method: string, body: unknown, ok: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(key)
    try {
      await apiWrite(url, { method, body })
      showSuccess(ok)
      await q.refresh()
    } catch (e) {
      showError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const phoneLines = o?.items.filter(i => i.product.isPhone && !i.isGift) ?? []

  return (
    <Modal open onClose={onClose} size="lg" title={o ? `${L('Commande', 'طلب')} #${o.ref}` : L('Commande', 'طلب')}>
      {!o ? <SkeletonRow /> : (
        <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={ORDER_STATUS[o.status].tone}>{isAr ? ORDER_STATUS[o.status].ar : ORDER_STATUS[o.status].fr}</Chip>
            {o.requiresAdvance && <Chip tone={PAYMENT_STATUS[o.advancePaymentStatus].tone}>{isAr ? PAYMENT_STATUS[o.advancePaymentStatus].ar : PAYMENT_STATUS[o.advancePaymentStatus].fr}</Chip>}
            {o.whatsappOpenedAt && <Chip tone="green">WhatsApp ✓</Chip>}
            <span className="text-xs text-ez-subtle">{dateTime(o.createdAt)}</span>
          </div>

          {/* Customer */}
          <div className="rounded-xl bg-ez-bg p-4 space-y-1 text-sm">
            <p className="font-bold text-ez-text">{o.customerName}</p>
            <div className="flex flex-wrap gap-3">
              <a href={`tel:${o.customerPhone}`} className="inline-flex items-center gap-1 text-ez-text font-mono"><Phone className="w-3.5 h-3.5" />{o.customerPhone}</a>
              <a href={whatsappLink(o.customerPhone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>
            </div>
            {o.deliveryAddress && <p className="text-ez-subtle">{o.deliveryAddress}</p>}
            {o.notes && <p className="text-ez-subtle italic">« {o.notes} »</p>}
          </div>

          {/* Items */}
          <div className="space-y-2">
            {o.items.map(item => (
              <div key={item.id} className="border border-ez-border rounded-xl p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-ez-text">{item.quantity}× {item.productNameSnapshot}</span>
                  <span className="font-semibold">{item.isGift ? L('Offert', 'هدية') : mad(item.priceAtRequest * item.quantity)}</span>
                </div>
                {item.product.isPhone && !item.isGift && (
                  item.erpPhones.length === 0
                    ? <p className="text-xs text-red-600 mt-1">{L('Plus en stock dans l’ERP (vendu ou supprimé)', 'لم يعد في المخزون')}</p>
                    : <ul className="mt-1 space-y-0.5">
                        {item.erpPhones.map(p => (
                          <li key={p.phone_id} className="text-xs text-ez-subtle font-mono">
                            {p.phone_id} · {p.model} {p.stockage ?? ''} {p.couleur ?? ''}{p.battery_level !== null ? ` · ${p.battery_level}%` : ''}
                            {p.imei_end ? ` · IMEI …${p.imei_end}` : ''} · <b className={p.status === 'disponible' ? 'text-emerald-700' : 'text-amber-700'}>{p.status}</b>
                          </li>
                        ))}
                      </ul>
                )}
              </div>
            ))}
            <div className="flex justify-between text-sm px-1">
              <span className="text-ez-subtle">{o.promoCode ? `${L('Code', 'رمز')} ${o.promoCode.code} : −${mad(o.discountAmount)}` : ''}</span>
              <span className="font-bold text-base">{L('Total', 'المجموع')} {mad(o.totalEstimate)}</span>
            </div>
          </div>

          {/* Receipt */}
          {o.requiresAdvance && (
            <div className="rounded-xl border border-ez-border p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2"><Receipt className="w-4 h-4" />{L('Avance de 300 DH', 'عربون 300 درهم')}</p>
              {o.receiptUrl ? (
                <a href={o.receiptUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.receiptUrl} alt={L('Reçu de virement', 'وصل التحويل')} className="max-h-72 rounded-lg border border-ez-border" />
                </a>
              ) : <p className="text-sm text-ez-subtle">{L('Aucun reçu envoyé.', 'لم يتم إرسال أي وصل.')}</p>}
              {isManager && o.receiptUrl && (
                <div className="flex gap-2">
                  <Btn size="sm" variant="secondary" loading={busy === 'ok'} onClick={() => act('ok', `/api/site/orders/${o.id}`, 'PATCH', { advancePaymentStatus: 'VERIFIED' }, L('Avance vérifiée', 'تم التحقق'))}>
                    <CheckCircle2 className="w-3.5 h-3.5" />{L('Reçu vérifié', 'وصل صحيح')}
                  </Btn>
                  <Btn size="sm" variant="danger" loading={busy === 'ko'} onClick={() => act('ko', `/api/site/orders/${o.id}`, 'PATCH', { advancePaymentStatus: 'REJECTED' }, L('Reçu refusé', 'تم رفض الوصل'))}>
                    <XCircle className="w-3.5 h-3.5" />{L('Refuser', 'رفض')}
                  </Btn>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-ez-border">
            {o.status === 'NEW' && (
              <Btn variant="secondary" loading={busy === 'contact'} onClick={() => act('contact', `/api/site/orders/${o.id}`, 'PATCH', { status: 'CONTACTED' }, L('Marquée contactée', 'تم'))}>
                {L('Client contacté', 'تم الاتصال بالعميل')}
              </Btn>
            )}
            {(o.status === 'NEW' || o.status === 'CONTACTED') && (
              <Btn loading={busy === 'reserve'}
                onClick={() => act('reserve', `/api/site/orders/${o.id}/reserve`, 'POST', undefined,
                  L('Commande confirmée — téléphones réservés', 'تم تأكيد الطلب وحجز الهواتف'),
                  phoneLines.length ? L('Confirmer la commande et réserver les téléphones dans l’ERP ?', 'تأكيد الطلب وحجز الهواتف؟') : undefined)}>
                <CheckCircle2 className="w-4 h-4" />{phoneLines.length ? L('Confirmer & réserver', 'تأكيد وحجز') : L('Confirmer', 'تأكيد')}
              </Btn>
            )}
            {o.status === 'CONFIRMED' && phoneLines.length > 0 && (
              <Btn variant="secondary" loading={busy === 'checkout'}
                onClick={() => act('checkout', `/api/site/orders/${o.id}/checkout`, 'POST', undefined,
                  L('Téléphones disponibles en caisse (toujours masqués sur le site)', 'الهواتف متاحة في نقطة البيع'),
                  L('Remettre les téléphones en caisse pour enregistrer la vente au point de vente ?', 'إرجاع الهواتف إلى نقطة البيع لتسجيل البيع؟'))}>
                <Store className="w-4 h-4" />{L('Passer en caisse', 'إلى نقطة البيع')}
              </Btn>
            )}
            {o.status !== 'CANCELLED' && (
              <Btn variant="danger" loading={busy === 'cancel'}
                onClick={() => act('cancel', `/api/site/orders/${o.id}/release`, 'POST', undefined,
                  L('Commande annulée', 'تم إلغاء الطلب'),
                  L('Annuler cette commande ? Les téléphones réservés seront remis en vente.', 'إلغاء هذا الطلب؟ ستعود الهواتف المحجوزة للبيع.'))}>
                {L('Annuler la commande', 'إلغاء الطلب')}
              </Btn>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
