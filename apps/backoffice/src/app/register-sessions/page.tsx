import { RegisterOperationsWorkspace } from '@/components/RegisterOperationsWorkspace'
import { Topbar } from '@/components/Topbar'

export default function RegisterSessionsPage() {
  return (
    <>
      <Topbar title="Register sessions" subtitle="Open, close, and reconcile branch registers." />
      <RegisterOperationsWorkspace focus="sessions" />
    </>
  )
}
