import { ResellerPortalWorkspace } from '@/components/ResellerPortalWorkspace'
import { Topbar } from '@/components/Topbar'

export default function ResellerPortalPage() {
  return (
    <>
      <Topbar
        title="Reseller portal"
        subtitle="Approve resellers, review held portal orders, and set how the portal confirms orders."
      />
      <ResellerPortalWorkspace />
    </>
  )
}
