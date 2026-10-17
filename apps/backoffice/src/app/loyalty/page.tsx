import { LoyaltyWorkspace } from '@/components/LoyaltyWorkspace'
import { Topbar } from '@/components/Topbar'

export default function LoyaltyPage() {
  return (
    <>
      <Topbar
        title="Loyalty"
        subtitle="Optional POS earning policy, customer balances, and immutable point activity."
      />
      <LoyaltyWorkspace />
    </>
  )
}
