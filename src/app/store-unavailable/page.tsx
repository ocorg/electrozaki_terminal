'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

const STORE_NAMES: Record<string, string> = {
  'EZ-001': 'Electro Zaki',
  'HP-001': 'Hamid Phone',
}

function Content() {
  const params    = useSearchParams()
  const storeId   = params?.get('store') ?? ''
  const storeName = STORE_NAMES[storeId] ?? storeId

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F7F4] p-6">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-3xl bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">🔒</span>
        </div>
        <h1
          className="text-2xl font-bold text-[#1A1A1A] mb-2"
          style={{
            fontFamily:    "'Barlow Condensed', sans-serif",
            letterSpacing: '0.05em',
          }}
        >
          Boutique Indisponible
        </h1>
        <p className="text-[#6B6860] mb-1">
          <strong>{storeName}</strong> est temporairement hors service.
        </p>
        <p className="text-sm text-[#B0ADA6] mb-8">
          Veuillez contacter l'administrateur pour plus d'informations.
        </p>
        <Link
          href="/select-store"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1A1A1A] text-white text-sm font-bold hover:bg-[#333] transition-all"
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