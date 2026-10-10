// Notifications for what arrives from the website (owner, 2026-10-04): a new
// web order or a new request (repair, quote) is announced ONCE, three ways —
// open ERP screens (sound + message), push notifications on the devices that
// asked for them, and the store's Telegram group. Managers and owner only.
import webpush from 'web-push'
import { prisma } from '@/lib/db'
import { notifyChange } from '@/lib/realtime'
import { storefrontConfigured } from '@/lib/storefront/db'
import { site, orderRef } from '@/lib/storefront/access'

const LOOKBACK_MS = 24 * 3_600_000   // older items are never announced (first deploy, long outage)

type Notice = { kind: 'order' | 'request'; id: string; title: string; body: string; path: string }

const erpUrl = () => {
  const host = process.env.ERP_PUBLIC_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
  return host ? (host.startsWith('http') ? host : `https://${host}`).replace(/\/$/, '') : ''
}
const dh = (v: unknown) => `${Number(v ?? 0).toLocaleString('fr-FR')} DH`

function pushReady() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  webpush.setVapidDetails(erpUrl() || 'https://electrozakiterminal.vercel.app', pub, priv)
  return true
}

/** Sends one push message to every device of the managers / owner; dead subscriptions are removed. */
export async function pushToManagers(payload: { title: string; body: string; url: string; tag?: string }, onlyUserId?: string) {
  if (!pushReady()) return { sent: 0, configured: false }
  const users = await prisma.user_profiles.findMany({
    where: { is_active: true, role: { in: ['gerant', 'proprietaire'] }, ...(onlyUserId && { id: onlyUserId }) }, select: { id: true },
  })
  const subs = await prisma.push_subscriptions.findMany({ where: { user_id: { in: users.map(u => u.id) } } })
  let sent = 0
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' })
      sent++
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await prisma.push_subscriptions.delete({ where: { id: s.id } }).catch(() => {})
      else console.error('[push] failed:', code ?? err)
    }
  }))
  return { sent, configured: true }
}

/** Marks a part of a Telegram message to show in bold (amounts, titles). */
export const bold = (s: string | number) => `\u27e6${s}\u27e7`
const MARKS = /\u27e6([^\u27e6\u27e7]*)\u27e7/g

/** Posts in the store's Telegram group. No customer name or number leaves the ERP. */
export async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) return false
  const send = (body: Record<string, unknown>) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, disable_web_page_preview: true, ...body }),
  })
  try {
    // bold() parts become <b>…</b>; everything else is escaped, so a name or a
    // reason typed by someone can never break the message
    const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(MARKS, '<b>$1</b>')
    let res = await send({ text: html, parse_mode: 'HTML' })
    // refused formatting: the plain text still goes out
    if (res.status === 400) res = await send({ text: text.replace(MARKS, '$1') })
    if (!res.ok) console.error('[telegram] failed:', res.status)
    return res.ok
  } catch (err) {
    console.error('[telegram] failed:', err)
    return false
  }
}

/**
 * Looks at the website for orders / requests nobody was told about yet and
 * announces each one once. Safe to call often and from several places at the
 * same time: the insert into site_notified decides who announces.
 */
export async function announceNewSiteItems(): Promise<number> {
  if (!storefrontConfigured()) return 0
  const since = new Date(Date.now() - LOOKBACK_MS)
  const [orders, requests] = await Promise.all([
    site().orderRequest.findMany({
      where: { status: 'NEW', createdAt: { gte: since } },
      select: { id: true, totalEstimate: true, deliveryCity: true, _count: { select: { items: true } } },
    }),
    site().repairRequest.findMany({
      where: { status: 'NEW', createdAt: { gte: since } },
      select: { id: true, ref: true, deviceBrand: true, deviceModel: true },
    }),
  ])
  const notices: Notice[] = [
    ...orders.map(o => ({
      kind: 'order' as const, id: o.id, title: 'Nouvelle commande web',
      body: `${orderRef(o.id)} — ${o._count.items} article(s), ${dh(o.totalEstimate)}${o.deliveryCity ? ` · ${o.deliveryCity}` : ''}`,
      path: '/ez/site/orders',
    })),
    ...requests.map(r => ({
      kind: 'request' as const, id: r.id, title: 'Nouvelle demande du site',
      body: `${r.ref} — ${r.deviceBrand} ${r.deviceModel}`,
      path: '/ez/site/requests',
    })),
  ]
  if (!notices.length) return 0

  const known = await prisma.site_notified.findMany({ where: { ref_id: { in: notices.map(n => n.id) } }, select: { kind: true, ref_id: true } })
  const seen = new Set(known.map(k => `${k.kind}:${k.ref_id}`))
  let announced = 0
  for (const n of notices.filter(x => !seen.has(`${x.kind}:${x.id}`))) {
    // The row is the lock: only the caller who inserts it announces
    const won = await prisma.site_notified.createMany({ data: [{ kind: n.kind, ref_id: n.id }], skipDuplicates: true })
    if (!won.count) continue
    announced++
    const base = erpUrl()
    await Promise.all([
      pushToManagers({ title: n.title, body: n.body, url: n.path, tag: `${n.kind}:${n.id}` }),
      telegram(`🔔 ${n.title}\n${n.body}${base ? `\n${base}${n.path}` : ''}`),
    ])
  }
  // Open screens: badges refresh at once, and they ring when the count went up
  if (announced) await notifyChange(null, ['site'])
  return announced
}
