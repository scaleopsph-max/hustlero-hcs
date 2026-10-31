'use client'

import type { ResellerTier } from '@hcs/contracts'
import { Button, Chip, Glass, cn, formatPeso, useToast } from '@hcs/ui'
import { Copy, CreditCard, QrCode as QrIcon, Share2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatDateTime, paymentTermLabel } from '@/lib/labels'
import { creditBlockedText, nextTierProgress, referralLink, tierLabel, tierStyle } from '@/lib/tiers'

import { QrCode } from './QrCode'

/** The reseller's tier, the way up, Platinum credit, and their referral link and referrals. */
export function TierCard({ load }: { load: () => Promise<ResellerTier> }) {
  const toast = useToast()
  const [card, setCard] = useState<ResellerTier | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
    load()
      .then(setCard)
      .catch(() => setCard(null))
  }, [load])

  if (!card) return null
  const style = tierStyle[card.tier]
  const rule = card.tiers.find((entry) => entry.tier === card.tier)
  const progress = nextTierProgress(card)
  const link = origin ? referralLink(origin, card) : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Referral link copied.')
    } catch {
      toast.error('Copy did not work. Long-press the link to copy it.')
    }
  }
  async function share() {
    if (!navigator.share) return copy()
    await navigator
      .share({ title: 'Become a reseller', text: 'Apply as a reseller with my link:', url: link })
      .catch(() => undefined)
  }

  return (
    <Glass className="flex flex-col gap-4 rounded-glass p-4">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'flex size-16 flex-none items-center justify-center rounded-full bg-gradient-to-br shadow-lg ring-4',
            style.medal,
            style.ring,
          )}
          aria-hidden
        >
          <span className="text-caption font-black uppercase tracking-widest text-ink-950">
            {card.tier.slice(0, 1)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-widest text-ink-300">Your tier</p>
          <p className="text-h3 font-bold">{tierLabel[card.tier]}</p>
          {rule ? (
            <p className="text-small text-ink-300">1 point for every {formatPeso(rule.spendPerPointMinor)}</p>
          ) : null}
        </div>
      </div>

      {progress ? (
        <div className="flex flex-col gap-3 rounded-control border border-white/10 bg-white/5 p-3">
          <p className="text-small font-semibold">
            Reach {tierLabel[progress.next]} with either one
            {progress.next === 'platinum' ? ' and order on credit' : ''}:
          </p>
          <Progress
            label="Active resellers you referred"
            value={`${progress.referrals.have} of ${progress.referrals.need}`}
            percent={progress.referrals.percent}
          />
          <Progress
            label="Your total sales"
            value={`${formatPeso(progress.sales.haveMinor)} of ${formatPeso(progress.sales.needMinor)}`}
            percent={progress.sales.percent}
          />
          <p className="text-caption text-ink-400">
            A referral is active once they have an order delivered in the last {card.activeDays} days.
          </p>
        </div>
      ) : (
        <p className="rounded-control border border-white/10 bg-white/5 p-3 text-small text-ink-200">
          You are at the top tier. Keep your referrals active to stay Platinum.
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-control border border-white/10 bg-white/5 p-3">
        <p className="flex items-center gap-2 text-small font-semibold">
          <CreditCard size={16} className="text-gold-300" />
          Credit
        </p>
        {card.credit.limitMinor !== null && card.credit.paymentTerm && card.credit.paymentTerm !== 'prepaid' ? (
          <dl className="grid grid-cols-3 gap-2 text-small">
            <Stat label="Limit" value={formatPeso(card.credit.limitMinor)} />
            <Stat
              label="Available"
              value={card.credit.availableMinor === null ? '—' : formatPeso(card.credit.availableMinor)}
            />
            <Stat label="Terms" value={paymentTermLabel[card.credit.paymentTerm]} />
          </dl>
        ) : null}
        {card.credit.blockedReason ? (
          <p className="text-small text-ink-300">{creditBlockedText[card.credit.blockedReason]}</p>
        ) : (
          <p className="text-small text-ink-300">Orders within your available credit are confirmed right away.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-small font-semibold">
          <Users size={16} className="text-gold-300" />
          Your referral link
        </p>
        <p className="break-all rounded-control bg-black/30 px-3 py-2 font-mono text-caption text-ink-200">{link}</p>
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" onClick={() => void copy()}>
            <Copy size={15} className="mr-1.5" />
            Copy
          </Button>
          <Button size="sm" onClick={() => void share()}>
            <Share2 size={15} className="mr-1.5" />
            Share
          </Button>
          <Button size="sm" aria-pressed={showQr} onClick={() => setShowQr((value) => !value)}>
            <QrIcon size={15} className="mr-1.5" />
            QR
          </Button>
        </div>
        {showQr && link ? (
          <div className="flex justify-center">
            <QrCode value={link} label="QR code of your referral link" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-small font-semibold">
          Resellers you referred ({card.activeReferrals} active of {card.totalReferrals})
        </p>
        {card.referrals.length === 0 ? (
          <p className="text-small text-ink-400">No referrals yet. Share your link with people who want to resell.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-white/10">
            {card.referrals.map((referral, index) => (
              <li key={`${referral.name}-${index}`} className="flex items-center justify-between gap-3 py-2 text-small">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{referral.name}</span>
                  <span className="text-caption text-ink-400">Joined {formatDateTime(referral.joinedAt)}</span>
                </span>
                <Chip tone={referral.active ? 'success' : 'neutral'}>{referral.active ? 'Active' : 'Not active'}</Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Glass>
  )
}

function Progress({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-3 text-caption">
        <span className="text-ink-300">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-gold-400" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-400">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}
