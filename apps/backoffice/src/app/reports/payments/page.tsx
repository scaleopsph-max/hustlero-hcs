import { PaymentReferenceReport } from '@/components/PaymentReferenceReport'
import { Topbar } from '@/components/Topbar'
import Link from 'next/link'
export default function PaymentReportPage() {
  return (
    <>
      <Topbar title="Online payment records" subtitle="POS bank transfers and wallet payments" />
      <nav aria-label="Payment reports" className="flex gap-4 border-b border-ink-900/15 px-6 py-3 text-sm">
        <span aria-current="page" className="font-semibold">
          POS
        </span>
        <Link href="/reports/payments/wholesale">Wholesale</Link>
      </nav>
      <PaymentReferenceReport key="pos" />
    </>
  )
}
