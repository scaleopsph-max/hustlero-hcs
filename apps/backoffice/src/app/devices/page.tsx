import { PosDevicesWorkspace } from '@/components/PosDevicesWorkspace'
import { Topbar } from '@/components/Topbar'

export default function DevicesPage() {
  return (
    <>
      <Topbar title="POS devices" subtitle="Activate trusted devices for a branch register." />
      <PosDevicesWorkspace />
    </>
  )
}
