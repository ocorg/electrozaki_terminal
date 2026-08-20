import { Metadata } from 'next'
import { DocumentGenerator } from '@/components/documents/DocumentGenerator'

export const metadata: Metadata = {
  title: 'Documents — Electro Zaki',
}

export default function DocumentsPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Documents
          <span className="text-white/30 font-normal text-xl mr-2 ml-3" dir="rtl">
            الوثائق
          </span>
        </h1>
        <p className="text-white/40 text-sm mt-1">
          Factures · Acquisitions · SAV Garantie
        </p>
      </div>

      <DocumentGenerator />
    </div>
  )
}