'use client'

import type {
  ResellerLoyalty,
  ResellerPortalCatalog,
  ResellerPortalSession,
  ResellerStatement,
  ResellerTier,
} from '@hcs/contracts'
import { Button, Glass } from '@hcs/ui'
import { LogOut } from 'lucide-react'

import { paymentTermLabel } from '@/lib/labels'

import { LoyaltyCard } from './LoyaltyCard'
import { StatementCard } from './StatementCard'
import { TierCard } from './TierCard'

export function AccountView({
  catalog,
  session,
  tenantId,
  onSwitchTenant,
  onSignOut,
  loadStatement,
  loadLoyalty,
  loadTier,
  onOpenOrder,
  onApplyCredit,
  onRedeemPoints,
}: {
  catalog: ResellerPortalCatalog
  session: ResellerPortalSession
  tenantId: string
  onSwitchTenant: (tenantId: string) => void
  onSignOut: () => void
  loadStatement: () => Promise<ResellerStatement>
  loadLoyalty: () => Promise<ResellerLoyalty>
  loadTier: () => Promise<ResellerTier>
  onOpenOrder: (salesOrderId: string) => void
  onApplyCredit: (invoiceId: string, amountMinor: number, key: string) => Promise<unknown>
  onRedeemPoints: (invoiceId: string, points: number, key: string) => Promise<unknown>
}) {
  const { account } = catalog
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-h3">{account.customerName}</h1>
        <p className="text-ink-300">Reseller of {account.businessName}</p>
      </div>

      <TierCard load={loadTier} />

      <Glass className="grid grid-cols-2 gap-4 rounded-glass p-4">
        <Stat
          label="Payment terms"
          value={account.paymentTerm ? paymentTermLabel[account.paymentTerm] : 'Not set yet'}
        />
        <Stat label="Price list" value={account.priceListName} />
      </Glass>

      <StatementCard
        load={loadStatement}
        onOpenOrder={onOpenOrder}
        onApplyCredit={onApplyCredit}
        onRedeemPoints={onRedeemPoints}
      />

      <LoyaltyCard load={loadLoyalty} fallbackPoints={account.pointsBalance} />

      {session.accounts.length > 1 ? (
        <Glass className="flex flex-col gap-2 rounded-glass p-4">
          <p className="text-small font-semibold">Other businesses</p>
          {session.accounts.map((entry) => (
            <Button
              key={entry.tenantId}
              size="sm"
              variant={entry.tenantId === tenantId ? 'confirm' : 'secondary'}
              onClick={() => onSwitchTenant(entry.tenantId)}
            >
              {entry.businessName}
            </Button>
          ))}
        </Glass>
      ) : null}

      <Button onClick={onSignOut}>
        <LogOut size={18} className="mr-2" />
        Sign out
      </Button>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption text-ink-400">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  )
}
