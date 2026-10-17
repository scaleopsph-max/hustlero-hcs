import { Topbar } from '@/components/Topbar'
import { WorkforceWorkspace } from '@/components/WorkforceWorkspace'
export default function EmployeesPage() {
  return (
    <>
      <Topbar title="Employees" subtitle="Roles, branch access, and POS credentials." />
      <WorkforceWorkspace focus="employees" />
    </>
  )
}
