import { Topbar } from '@/components/Topbar'
import { WholesaleStatementsWorkspace } from '@/components/WholesaleStatementsWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleStatementsPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Statements and aging: what each customer owes, and for how long." />
      <WholesaleTabs />
      <WholesaleStatementsWorkspace />
    </>
  )
}
