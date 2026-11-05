// Asks the website to refresh its cached pages now. Best effort: a failure
// only delays the update on the site (the daily check refreshes everything).
// `productIds`: only those products' pages and the lists showing them
// (owner, 2026-11-05: refreshing the whole site on every change used up the
// hosting's processor time). `all`: the whole site.
export async function revalidateStorefront(scope: { productIds?: string[]; all?: boolean } = { all: true }): Promise<void> {
  const url    = process.env.STOREFRONT_URL
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET
  if (!url || !secret) return
  if (!scope.all && !scope.productIds?.length) return
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/revalidate`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(scope.all ? { all: true } : { productIds: scope.productIds }),
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error('[revalidateStorefront] status', res.status)
  } catch (err) {
    console.error('[revalidateStorefront] failed silently:', err)
  }
}
