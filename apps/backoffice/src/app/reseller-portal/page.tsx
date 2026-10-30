import { ResellerPortalWorkspace } from '@/components/ResellerPortalWorkspace'
import { Topbar } from '@/components/Topbar'

export default function ResellerPortalPage() {
  return (
    <>
      <Topbar
        title="Reseller portal"
        subtitle="Approve resellers, confirm paid portal orders, and set where resellers send payment."
      />
      <ResellerPortalWorkspace />
    </>
  )
}
