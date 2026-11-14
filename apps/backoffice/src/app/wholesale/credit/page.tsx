import { Topbar } from '@/components/Topbar'
import { WholesaleCreditWorkspace } from '@/components/WholesaleCreditWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleCreditPage() {
  return (
    <>
      <Topbar
        title="Advanced wholesale"
        subtitle="Terms and credit: payment terms, credit limits, and opening balances."
      />
      <WholesaleTabs />
      <WholesaleCreditWorkspace />
    </>
  )
}
