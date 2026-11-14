'use client'

import type { ResellerWallet } from '@hcs/contracts'
import { Glass, cn, formatPeso } from '@hcs/ui'
import { Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatDateTime } from '@/lib/labels'

/**
 * The wallet: credit from approved returns. It pays for orders at checkout; the business can also refund it.
 * Amounts set aside for orders that are not invoiced yet show as held.
 */
export function WalletCard({ load, fallbackMinor }: { load: () => Promise<ResellerWallet>; fallbackMinor: number }) {
  const [wallet, setWallet] = useState<ResellerWallet | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
      .then(setWallet)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The wallet did not load.'))
  }, [load])

  const balance = wallet?.balanceMinor ?? fallbackMinor
  return (
    <div className="flex flex-col gap-4">
      <Glass variant="gold" className="flex flex-col gap-2 rounded-glass p-4">
        <div className="flex items-center gap-3">
          <Wallet size={24} className="flex-none text-gold-300" />
          <div className="min-w-0 flex-1">
            <p className="text-caption text-ink-200">Available to spend</p>
            <p className="text-h3 font-semibold">{formatPeso(balance)}</p>
          </div>
        </div>
        <p className="text-small text-ink-200">
          Credit from your approved returns. Use it at checkout to pay for your next order. To get it back as money, ask
          the business for a refund.
        </p>
      </Glass>

      {error ? <p className="text-small text-signal-dark-critical-fg">{error}</p> : null}

      {wallet && wallet.held.length > 0 ? (
        <Glass className="flex flex-col gap-2 rounded-glass p-4">
          <p className="font-semibold">Set aside for orders</p>
          <p className="text-small text-ink-300">Used when these orders are invoiced.</p>
          {wallet.held.map((entry) => (
            <div key={entry.orderNumber} className="flex items-center justify-between text-small">
              <span>{entry.orderNumber}</span>
              <span className="font-semibold">{formatPeso(entry.amountMinor)}</span>
            </div>
          ))}
        </Glass>
      ) : null}

      <Glass className="flex flex-col rounded-glass">
        <p className="px-4 pb-2 pt-4 font-semibold">History</p>
        {!wallet ? (
          <p className="px-4 pb-4 text-small text-ink-300">{error ? '' : 'Loading…'}</p>
        ) : wallet.history.length === 0 ? (
          <p className="px-4 pb-4 text-small text-ink-300">
            Nothing yet. Credit appears here when the business approves a return.
          </p>
        ) : (
          <ul className="divide-y divide-white/10">
            {wallet.history.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-small font-semibold">{entry.label}</span>
                  <span className="block text-caption text-ink-400">{formatDateTime(entry.at)}</span>
                </span>
                <span
                  className={cn(
                    'flex-none text-small font-semibold',
                    entry.amountMinor > 0 ? 'text-signal-dark-success-fg' : 'text-ink-100',
                  )}
                >
                  {entry.amountMinor > 0 ? '+' : '−'}
                  {formatPeso(Math.abs(entry.amountMinor))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Glass>
    </div>
  )
}
