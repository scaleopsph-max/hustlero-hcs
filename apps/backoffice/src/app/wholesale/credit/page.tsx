import { Topbar } from '@/components/Topbar'
import { WholesaleCreditWorkspace } from '@/components/WholesaleCreditWorkspace'
export default function WholesaleCreditPage() {
  return (
    <>
      <Topbar title="Wholesale credit" subtitle="Customer terms and opening receivables" />
      <WholesaleCreditWorkspace />
    </>
  )
}
