import { NotificationCenter } from '@/components/NotificationCenter'
import { Topbar } from '@/components/Topbar'

export default function NotificationsPage() {
  return (
    <>
      <Topbar title="Notifications" subtitle="Your role-aware operational alerts and approval updates." />
      <NotificationCenter />
    </>
  )
}
