'use client'
import { useState } from 'react'
import { Star, Eye, EyeOff, Phone, MessageCircle } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { PageHeader, EmptyState, SkeletonRow, Btn } from '@/components/shared'
import { showError, showSuccess } from '@/lib/utils/toasts'
import { confirmDialog } from '@/components/shared/ConfirmHost'
import { useSiteLang, Tabs, Chip, whatsappLink, dateTime } from './common'

interface Review {
  id: string; rating: number; comment: string | null; authorName: string; productName: string
  locale: string; hidden: boolean; createdAt: string; updatedAt: string
  orderRef: string; customerName: string; customerPhone: string
}

type Tab = 'shown' | 'hidden'

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value}/5`} dir="ltr">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-4 h-4 ${i <= value ? 'text-gold fill-current' : 'text-ez-border'}`} />
      ))}
    </span>
  )
}

// "Avis clients": every review left on the website. Published at once on the
// product pages (and given to Google); hide one that breaks the rules.
export default function SiteReviewsModule() {
  const { L, isAr } = useSiteLang()
  const [tab, setTab] = useState<Tab>('shown')
  const [busy, setBusy] = useState<string | null>(null)
  const q = useApi<Review[]>('/api/site/reviews')
  const all    = q.data ?? []
  const shown  = all.filter(r => !r.hidden)
  const hidden = all.filter(r => r.hidden)
  const list   = tab === 'shown' ? shown : hidden
  const average = shown.length ? shown.reduce((a, r) => a + r.rating, 0) / shown.length : null

  async function toggle(r: Review) {
    const hide = !r.hidden
    if (hide && !(await confirmDialog(L(
      `Masquer l'avis de ${r.authorName} ? Il disparaît du site (vous pourrez le réafficher).`,
      `إخفاء رأي ${r.authorName}؟ سيختفي من الموقع (يمكنك إظهاره لاحقًا).`,
    )))) return
    setBusy(r.id)
    try {
      await apiWrite('/api/site/reviews', { method: 'PATCH', body: { id: r.id, hidden: hide } })
      showSuccess(hide ? L('Avis masqué', 'تم إخفاء الرأي') : L('Avis de nouveau affiché', 'تم إظهار الرأي'))
    } catch (e) {
      showError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 space-y-4">
        <PageHeader
          title={L('Avis clients', 'آراء الزبناء')}
          subtitle={L(
            'Laissés sur le site par les clients livrés. Publiés tout de suite ; masquez ceux qui contiennent des insultes, un numéro ou rien à voir avec le produit. Un avis négatif honnête reste affiché : Google se méfie des notes triées.',
            'يتركها الزبناء بعد توصيل طلبهم وتُنشر مباشرة. أخفِ فقط الآراء التي فيها سب أو رقم هاتف أو لا علاقة لها بالمنتج. الرأي السلبي الصادق يبقى ظاهرًا.',
          )}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { key: 'shown',  label: L('Affichés', 'ظاهرة'), count: shown.length },
            { key: 'hidden', label: L('Masqués', 'مخفية'), count: hidden.length },
          ]} />
          {average !== null && (
            <span className="inline-flex items-center gap-2 text-sm text-ez-subtle">
              <Stars value={Math.round(average)} />
              <b className="text-ez-text">{average.toFixed(1)}</b> / 5
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
        {q.isLoading ? <SkeletonRow /> : q.error ? (
          <EmptyState icon={<Star className="w-6 h-6" />} title={L('Site web indisponible', 'الموقع غير متاح')} description={q.error.message} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Star className="w-6 h-6" />}
            title={tab === 'shown' ? L('Aucun avis pour le moment', 'لا توجد آراء بعد') : L('Aucun avis masqué', 'لا توجد آراء مخفية')}
            description={tab === 'shown' ? L(
              'Les clients donnent leur avis depuis « Suivre ma commande » une fois la livraison passée à Livrée. Envoyez-leur le lien electrozaki.ma/fr/commande/suivi avec leur référence.',
              'يعطي الزبناء رأيهم من صفحة «تتبع طلبي» بعد أن تصبح الحالة «تم التسليم».',
            ) : undefined}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map(r => (
              <div key={r.id} className={`bg-white border border-ez-border rounded-2xl p-4 space-y-2 ${r.hidden ? 'opacity-70' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <Stars value={r.rating} />
                  <span className="text-xs text-ez-subtle">{dateTime(r.createdAt)}</span>
                </div>
                <p className="font-bold text-ez-text">{r.productName}</p>
                {r.comment
                  ? <p dir="auto" className="text-sm text-ez-text whitespace-pre-line">« {r.comment} »</p>
                  : <p className="text-xs text-ez-faint italic">{L('Note sans commentaire', 'تقييم بدون تعليق')}</p>}
                <p className="text-xs text-ez-subtle">
                  {L('Affiché', 'يظهر')} : <b className="text-ez-text">{r.authorName}</b>
                  {' · '}{L('Commande', 'الطلب')} <b className="font-mono select-all">{r.orderRef}</b>
                  {r.hidden && <> {' '}<Chip tone="gray">{L('Masqué', 'مخفي')}</Chip></>}
                </p>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-ez-subtle">{r.customerName}</span>
                  <a href={`tel:${r.customerPhone}`} className="inline-flex items-center gap-1 font-mono"><Phone className="w-3.5 h-3.5" />{r.customerPhone}</a>
                  <a href={whatsappLink(r.customerPhone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>
                </div>
                <Btn variant="secondary" className="w-full" loading={busy === r.id} onClick={() => toggle(r)}>
                  {r.hidden
                    ? <><Eye className="w-4 h-4" />{L('Réafficher sur le site', 'إظهار في الموقع')}</>
                    : <><EyeOff className="w-4 h-4" />{L('Masquer du site', 'إخفاء من الموقع')}</>}
                </Btn>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
