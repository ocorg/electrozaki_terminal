'use client'
import TransactionsListPage from '@/components/transactions/TransactionsListPage'

export default function BZGTransactionsPage() {
  return (
    <TransactionsListPage
      scope="all"
      title={{ ar: 'المعاملات', fr: 'Transactions' }}
    />
  )
}
