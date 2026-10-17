import { PaymentReferenceReport } from '@/components/PaymentReferenceReport'
import { Topbar } from '@/components/Topbar'
export default function PaymentReportPage() {
  return (
    <>
      <Topbar title="Online payment records" subtitle="POS bank transfers and wallet payments" />
      <PaymentReferenceReport />
    </>
  )
}
