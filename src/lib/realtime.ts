import Pusher from 'pusher'
import { caisseChannel } from '@/lib/realtime-channels'

const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID!,
  key:     process.env.PUSHER_KEY!,
  secret:  process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS:  true,
})

// Tells open cash-register screens of a store to refetch. Carries no data, so a
// public channel is fine. Call after any write that changes the day's totals
// (transactions, expenses, repairs, cash drops, caisse itself).
export async function notifyCaisseChange(storeId: string | null | undefined) {
  if (!storeId) return
  try {
    await pusher.trigger(caisseChannel(storeId), 'changed', {})
  } catch (err) {
    console.error('[notifyCaisseChange] failed silently:', err)
  }
}
