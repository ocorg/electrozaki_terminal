// Asks the website to refresh its cached pages now (its own cache would
// otherwise take up to a minute). Best effort: a failure only delays the
// update on the site.
export async function revalidateStorefront(): Promise<void> {
  const url    = process.env.STOREFRONT_URL
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET
  if (!url || !secret) return
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/revalidate`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal:  AbortSignal.timeout(5000),
    })
    if (!res.ok) console.error('[revalidateStorefront] status', res.status)
  } catch (err) {
    console.error('[revalidateStorefront] failed silently:', err)
  }
}
