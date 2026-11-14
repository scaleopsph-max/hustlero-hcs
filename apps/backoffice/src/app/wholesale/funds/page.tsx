import { Topbar } from '@/components/Topbar'
import { WholesaleFundsWorkspace } from '@/components/WholesaleFundsWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleFundsPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Fund allocation: where received payments are kept." />
      <WholesaleTabs />
      <WholesaleFundsWorkspace />
    </>
  )
}
