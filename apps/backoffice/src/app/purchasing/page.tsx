import { PurchasingWorkspace } from '@/components/PurchasingWorkspace'
import { Topbar } from '@/components/Topbar'

export default function PurchasingPage() {
  return (
    <>
      <Topbar title="Purchasing" subtitle="Suppliers, purchase orders, and receiving for every branch." />
      <PurchasingWorkspace />
    </>
  )
}
