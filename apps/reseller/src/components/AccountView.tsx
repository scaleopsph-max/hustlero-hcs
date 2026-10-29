'use client'

import type { ResellerPortalCatalog, ResellerPortalSession } from '@hcs/contracts'
import { Button, Glass, formatPeso } from '@hcs/ui'
import { LogOut, Star } from 'lucide-react'

import { paymentTermLabel } from '@/lib/labels'

export function AccountView({
  catalog,
  session,
  tenantId,
  onSwitchTenant,
  onSignOut,
}: {
  catalog: ResellerPortalCatalog
  session: ResellerPortalSession
  tenantId: string
  onSwitchTenant: (tenantId: string) => void
  onSignOut: () => void
}) {
  const { account } = catalog
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-h3">{account.customerName}</h1>
        <p className="text-ink-300">Reseller ng {account.businessName}</p>
      </div>

      <Glass className="grid grid-cols-2 gap-4 rounded-glass p-4">
        <Stat
          label="Payment terms"
          value={account.paymentTerm ? paymentTermLabel[account.paymentTerm] : 'Hindi pa naka-set'}
        />
        <Stat label="Price list" value={account.priceListName} />
        <Stat
          label="Credit limit"
          value={account.creditLimitMinor === null ? '—' : formatPeso(account.creditLimitMinor)}
        />
        <Stat
          label="Available credit"
          value={account.availableCreditMinor === null ? '—' : formatPeso(account.availableCreditMinor)}
        />
      </Glass>

      <Glass variant="gold" className="flex items-center gap-3 rounded-glass p-4">
        <Star size={24} className="flex-none text-gold-300" />
        <div>
          <p className="font-semibold">{account.pointsBalance.toLocaleString('en-PH')} points</p>
          <p className="text-small text-ink-200">Sa susunod na update, kikita ka ng 1 point sa bawat ₱100 na order.</p>
        </div>
      </Glass>

      {session.accounts.length > 1 ? (
        <Glass className="flex flex-col gap-2 rounded-glass p-4">
          <p className="text-small font-semibold">Ibang business</p>
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
        Mag-sign out
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
