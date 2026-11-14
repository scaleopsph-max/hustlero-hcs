'use client'

import type {
  ResellerLoyalty,
  ResellerPortalCatalog,
  ResellerPortalSession,
  ResellerStatement,
  ResellerTier,
  ResellerWallet,
} from '@hcs/contracts'
import { Button, Glass, cn, formatPeso } from '@hcs/ui'
import {
  ArrowLeft,
  Award,
  Building2,
  ChevronRight,
  FileText,
  LogOut,
  Star,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { compactPeso, paymentTermLabel } from '@/lib/labels'
import { formatAddress } from '@/lib/ph-address'
import { nextTierProgress, tierLabel, tierStyle } from '@/lib/tiers'

import { LoyaltyCard } from './LoyaltyCard'
import { StatementCard } from './StatementCard'
import { TierCard } from './TierCard'
import { WalletCard } from './WalletCard'

type Section = 'statement' | 'wallet' | 'tier' | 'referrals' | 'points' | 'details'

const sectionTitle: Record<Section, string> = {
  statement: 'Statement of account',
  wallet: 'Wallet',
  tier: 'Tier & credit',
  referrals: 'Invite resellers',
  points: 'Points',
  details: 'Account details',
}

/** Three tiles share a phone's width: amounts of ₱100,000 and up are shortened (₱155k). */
const tileAmount = (minor: number) => (minor >= 10_000_000 ? compactPeso(minor) : formatPeso(minor))

/** Account hub: a short summary, then one row per section; each section opens on its own page. */
export function AccountView({
  catalog,
  session,
  tenantId,
  onSwitchTenant,
  onSignOut,
  loadStatement,
  loadLoyalty,
  loadTier,
  loadWallet,
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
  loadWallet: () => Promise<ResellerWallet>
  onOpenOrder: (salesOrderId: string) => void
  onApplyCredit: (invoiceId: string, amountMinor: number, key: string) => Promise<unknown>
  onRedeemPoints: (invoiceId: string, points: number, key: string) => Promise<unknown>
}) {
  const { account } = catalog
  const [section, setSection] = useState<Section | null>(null)
  const [tier, setTier] = useState<ResellerTier | null>(null)
  const [statement, setStatement] = useState<ResellerStatement | null>(null)

  // The hub only needs the headline numbers; each section loads its own details.
  useEffect(() => {
    if (section) return
    loadTier()
      .then(setTier)
      .catch(() => setTier(null))
    loadStatement()
      .then(setStatement)
      .catch(() => setStatement(null))
  }, [section, loadTier, loadStatement])

  function open(next: Section | null) {
    setSection(next)
    window.scrollTo({ top: 0 })
  }

  if (section)
    return (
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => open(null)}
            aria-label="Back to account"
            className="-ml-2 flex size-11 flex-none items-center justify-center rounded-full"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-h4 font-semibold">{sectionTitle[section]}</h1>
        </div>
        {section === 'statement' ? (
          <StatementCard
            load={loadStatement}
            onOpenOrder={onOpenOrder}
            onApplyCredit={onApplyCredit}
            onRedeemPoints={onRedeemPoints}
          />
        ) : section === 'wallet' ? (
          <WalletCard load={loadWallet} fallbackMinor={account.walletMinor ?? 0} />
        ) : section === 'tier' ? (
          <TierCard load={loadTier} view="tier" />
        ) : section === 'referrals' ? (
          <TierCard load={loadTier} view="referrals" />
        ) : section === 'points' ? (
          <LoyaltyCard load={loadLoyalty} fallbackPoints={account.pointsBalance} />
        ) : (
          <Glass className="flex flex-col gap-4 rounded-glass p-4">
            <Detail label="Business" value={account.businessName} />
            <Detail
              label="Payment terms"
              value={account.paymentTerm ? paymentTermLabel[account.paymentTerm] : 'Not set yet'}
            />
            <Detail label="Price list" value={account.priceListName} />
            <Detail
              label="Delivery address"
              value={account.deliveryAddress ? formatAddress(account.deliveryAddress) : 'Not set yet'}
            />
            <Detail label="Pickup and dispatch" value={catalog.fulfillmentLocationName} />
          </Glass>
        )}
      </section>
    )

  const progress = tier ? nextTierProgress(tier) : null
  const toPay = statement?.summary.outstandingMinor
  const overdue = statement?.summary.overdueMinor ?? 0
  return (
    <section className="flex flex-col gap-4">
      <Glass className="flex items-center gap-4 rounded-glass p-4">
        <div
          className={cn(
            'flex size-14 flex-none items-center justify-center rounded-full bg-gradient-to-br ring-4',
            tierStyle[tier?.tier ?? account.tier ?? 'silver'].medal,
            tierStyle[tier?.tier ?? account.tier ?? 'silver'].ring,
          )}
          aria-hidden
        >
          <span className="text-small font-black uppercase text-ink-950">
            {(tier?.tier ?? account.tier ?? 'silver').slice(0, 1)}
          </span>
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-h4 font-semibold">{account.customerName}</h1>
          <p className="text-small text-ink-300">
            {tierLabel[tier?.tier ?? account.tier ?? 'silver']} reseller · {account.businessName}
          </p>
        </div>
      </Glass>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <button type="button" onClick={() => open('statement')} className="text-left">
          <Glass className="flex h-full flex-col gap-1 rounded-glass p-3">
            <span className="text-caption text-ink-400">To pay</span>
            <span className={cn('text-lg font-semibold', overdue > 0 ? 'text-signal-dark-critical-fg' : '')}>
              {toPay === undefined ? '—' : tileAmount(toPay)}
            </span>
            <span className="text-caption text-ink-400">
              {overdue > 0 ? `${formatPeso(overdue)} overdue` : toPay ? 'See invoices' : 'All paid up'}
            </span>
          </Glass>
        </button>
        <button type="button" onClick={() => open('wallet')} className="text-left">
          <Glass className="flex h-full flex-col gap-1 rounded-glass p-3">
            <span className="text-caption text-ink-400">Wallet</span>
            <span className="text-lg font-semibold">{tileAmount(account.walletMinor ?? 0)}</span>
            <span className="text-caption text-ink-400">
              {account.walletMinor ? 'Use at checkout' : 'From returns'}
            </span>
          </Glass>
        </button>
        <button type="button" onClick={() => open('points')} className="text-left">
          <Glass variant="gold" className="flex h-full flex-col gap-1 rounded-glass p-3">
            <span className="text-caption text-ink-200">Points</span>
            <span className="text-lg font-semibold">{account.pointsBalance.toLocaleString('en-PH')}</span>
            <span className="text-caption text-ink-200">See history</span>
          </Glass>
        </button>
      </div>

      <Glass className="flex flex-col divide-y divide-white/10 rounded-glass">
        <Row
          icon={Award}
          title="Tier & credit"
          subtitle={
            !tier
              ? 'Your tier and how to move up'
              : progress
                ? `${tierLabel[tier.tier]} · ${compactPeso(progress.sales.haveMinor)} of ${compactPeso(progress.sales.needMinor)} to ${tierLabel[progress.next]}`
                : tier.credit.availableMinor !== null
                  ? `Platinum · ${formatPeso(tier.credit.availableMinor)} credit available`
                  : 'Platinum'
          }
          onClick={() => open('tier')}
        />
        <Row
          icon={Users}
          title="Invite resellers"
          subtitle={
            tier
              ? `${tier.activeReferrals} active of ${tier.totalReferrals} referred · share your link`
              : 'Your referral link'
          }
          onClick={() => open('referrals')}
        />
        <Row
          icon={FileText}
          title="Statement of account"
          subtitle="Invoices, payments, returns"
          onClick={() => open('statement')}
        />
        <Row
          icon={Wallet}
          title="Wallet"
          subtitle={
            account.walletMinor ? `${formatPeso(account.walletMinor)} to spend at checkout` : 'Credit from your returns'
          }
          onClick={() => open('wallet')}
        />
        <Row icon={Star} title="Points" subtitle="How you earn and history" onClick={() => open('points')} />
        <Row
          icon={UserRound}
          title="Account details"
          subtitle={`${account.paymentTerm ? paymentTermLabel[account.paymentTerm] : 'Terms not set'} · ${account.priceListName}`}
          onClick={() => open('details')}
        />
      </Glass>

      {session.accounts.length > 1 ? (
        <Glass className="flex flex-col gap-2 rounded-glass p-4">
          <p className="flex items-center gap-2 text-small font-semibold">
            <Building2 size={16} className="text-gold-300" />
            Switch business
          </p>
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

function Row({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left">
      <span className="flex size-10 flex-none items-center justify-center rounded-full bg-white/10 text-gold-300">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-small text-ink-300">{subtitle}</span>
      </span>
      <ChevronRight size={18} className="flex-none text-ink-400" aria-hidden />
    </button>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption text-ink-400">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  )
}
