import { Topbar } from '@/components/Topbar'
import { WholesaleOrdersWorkspace } from '@/components/WholesaleOrdersWorkspace'
import Link from 'next/link'
import { Wallet } from 'lucide-react'

export default function WholesaleOrdersPage() {
  return (
    <>
      <Topbar
        title="Advanced wholesale"
        subtitle="Prepare reseller orders and reserve the same inventory used by retail when an order is confirmed."
      />
      <Link
        href="/wholesale/payments"
        className="mx-6 mb-6 inline-flex items-center gap-2 border-b border-ink-900/20 py-3 font-semibold"
      >
        <Wallet size={18} />
        Payments
      </Link>
      <WholesaleOrdersWorkspace />
    </>
  )
}
