import { Topbar } from '@/components/Topbar'
import { WholesalePaymentsWorkspace } from '@/components/WholesalePaymentsWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesalePaymentsPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Payments: record what customers paid and apply it to invoices." />
      <WholesaleTabs />
      <WholesalePaymentsWorkspace />
    </>
  )
}
