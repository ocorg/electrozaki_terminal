import { json, handleError, requireActiveUser, MANAGERS } from '@/lib/api'
import { pushToManagers, telegram } from '@/lib/siteNotify'

// POST — "Tester": a push to the caller's own devices, and a line in the
// Telegram group, so the set-up can be checked without a real order.
export async function POST() {
  try {
    const user = await requireActiveUser(MANAGERS)
    const [push, tg] = await Promise.all([
      pushToManagers({ title: 'Electro Zaki — test', body: 'Les notifications fonctionnent sur cet appareil.', url: '/ez/site/orders', tag: 'test' }, user.id),
      telegram(`✅ Test des notifications Electro Zaki (par ${user.display_name})`),
    ])
    return json({ data: { push: push.sent, pushConfigured: push.configured, telegram: tg } })
  } catch (err) {
    return handleError(err, 'POST /api/push/test')
  }
}
