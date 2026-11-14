import { Topbar } from '@/components/Topbar'
import { WholesaleReturnsWorkspace } from '@/components/WholesaleReturnsWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleReturnsPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Returns and credits: credit notes, customer credit, and payouts." />
      <WholesaleTabs />
      <WholesaleReturnsWorkspace />
    </>
  )
}
