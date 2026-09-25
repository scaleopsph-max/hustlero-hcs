import { RegisterOperationsWorkspace } from '@/components/RegisterOperationsWorkspace'
import { Topbar } from '@/components/Topbar'

export default function PaymentMethodsPage() {
  return (
    <>
      <Topbar title="Payment methods" subtitle="Cash and externally confirmed payment options." />
      <RegisterOperationsWorkspace focus="payments" />
    </>
  )
}
