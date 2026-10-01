'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'

const STORE_NAMES: Record<string, string> = {
  'EZ-001': 'Electro Zaki',
}

function Content() {
  const params    = useSearchParams()
  const storeId   = params?.get('store') ?? ''
  const storeName = STORE_NAMES[storeId] ?? storeId

  return (
    <div className="min-h-screen flex items-center justify-center bg-ez-bg p-6">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-3xl bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-6">
          <Lock className="w-9 h-9 text-red-500" />
        </div>
        <h1
          className="text-2xl font-bold text-ez-text mb-2"
          style={{
            fontFamily:    "'Barlow Condensed', sans-serif",
            letterSpacing: '0.05em',
          }}
        >
          Boutique Indisponible
        </h1>
        <p className="text-ez-subtle mb-1">
          <strong>{storeName}</strong> est temporairement hors service.
        </p>
        <p className="text-sm text-ez-faint mb-8">
          Veuillez contacter l'administrateur pour plus d'informations.
        </p>
        <Link
          href="/select-store"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-ez-dark text-white text-sm font-bold hover:bg-[#333] transition-all"
        >
          ← Retour au sélecteur
        </Link>
      </div>
    </div>
  )
}

export default function StoreUnavailablePage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  )
}