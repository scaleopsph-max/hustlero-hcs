import { AlertsWorkspace } from '@/components/ControlCenter'
import { Topbar } from '@/components/Topbar'

export default function AlertsPage() {
  return (
    <>
      <Topbar title="Alerts" subtitle="Review conditions that need operational attention." />
      <AlertsWorkspace />
    </>
  )
}
