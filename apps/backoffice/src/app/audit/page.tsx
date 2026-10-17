import { AuditWorkspace } from '@/components/ControlCenter'
import { Topbar } from '@/components/Topbar'

export default function AuditPage() {
  return (
    <>
      <Topbar title="Audit and activity" subtitle="Trace who changed what, where and when." />
      <AuditWorkspace />
    </>
  )
}
