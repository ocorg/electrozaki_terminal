'use client'
import { SessionProvider } from 'next-auth/react'

// Pages stay static (served from the CDN): the session is fetched once in the browser
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>
}
