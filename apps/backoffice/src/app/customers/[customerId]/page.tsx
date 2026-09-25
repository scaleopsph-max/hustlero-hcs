import { CustomerDetailWorkspace } from '@/components/CustomerDetailWorkspace'
import { Topbar } from '@/components/Topbar'

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params
  return (
    <>
      <Topbar title="Customer profile" subtitle="Customer identity, consent, notes, and transaction history." />
      <CustomerDetailWorkspace customerId={customerId} />
    </>
  )
}
