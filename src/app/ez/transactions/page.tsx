'use client'
import TransactionsListPage from '@/components/transactions/TransactionsListPage'

export default function EZTransactionsPage() {
  return (
    <TransactionsListPage
      scope="store"
      storeId="EZ-001"
      title={{ ar: 'المعاملات', fr: 'Transactions — Electro Zaki' }}
    />
  )
}
