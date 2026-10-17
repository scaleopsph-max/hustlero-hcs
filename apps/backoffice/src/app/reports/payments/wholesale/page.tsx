import { PaymentReferenceReport } from '@/components/PaymentReferenceReport'
import { Topbar } from '@/components/Topbar'
import Link from 'next/link'

export default function WholesalePaymentReportPage() {
  return (
    <>
      <Topbar title="Wholesale online payment records" subtitle="Whole-receipt totals by bank or wallet" />
      <nav aria-label="Payment reports" className="flex gap-4 border-b border-ink-900/15 px-6 py-3 text-sm">
        <Link href="/reports/payments">POS</Link>
        <span aria-current="page" className="font-semibold">
          Wholesale
        </span>
      </nav>
      <PaymentReferenceReport key="wholesale" wholesale />
    </>
  )
}
