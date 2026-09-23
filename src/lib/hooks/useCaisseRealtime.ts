'use client'
import { useEffect, useRef } from 'react'
import PusherClient from 'pusher-js'
import { caisseChannel } from '@/lib/realtime-channels'

let client: PusherClient | null = null
function getClient() {
  client ??= new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  })
  return client
}

// Calls onChange whenever the server reports a change affecting this store's caisse.
export function useCaisseRealtime(storeId: string | null | undefined, onChange: () => void) {
  const callback = useRef(onChange)
  callback.current = onChange

  useEffect(() => {
    if (!storeId) return
    const name    = caisseChannel(storeId)
    const channel = getClient().subscribe(name)
    const handler = () => callback.current()
    channel.bind('changed', handler)
    return () => {
      channel.unbind('changed', handler)
      getClient().unsubscribe(name)
    }
  }, [storeId])
}
