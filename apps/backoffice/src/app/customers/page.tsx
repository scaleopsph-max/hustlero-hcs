import { CustomersWorkspace } from '@/components/CustomersWorkspace'
import { Topbar } from '@/components/Topbar'

export default function CustomersPage() {
  return (
    <>
      <Topbar title="Customers" subtitle="Profiles, consent, purchase history, and relationship value." />
      <CustomersWorkspace />
    </>
  )
}
