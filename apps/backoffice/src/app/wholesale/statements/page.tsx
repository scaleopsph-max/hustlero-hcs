import { Topbar } from '@/components/Topbar'
import { WholesaleStatementsWorkspace } from '@/components/WholesaleStatementsWorkspace'
export default function WholesaleStatementsPage() {
  return (
    <>
      <Topbar title="Statements and aging" subtitle="Wholesale receivables" />
      <WholesaleStatementsWorkspace />
    </>
  )
}
