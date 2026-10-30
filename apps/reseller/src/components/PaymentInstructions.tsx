'use client'

import type { ResellerPaymentAccount } from '@hcs/contracts'
import { cn, useToast } from '@hcs/ui'
import { Check, Copy, Wallet } from 'lucide-react'
import { useState } from 'react'

import { paymentLabel } from '@/lib/labels'
import { fileUrl } from '@/lib/portal-api'

type Method = ResellerPaymentAccount['method']

/**
 * Where to send money. The reseller picks GCash or Bank and sees that method's QR codes and
 * account details, as set by the business in Back Office.
 */
export function PaymentInstructions({
  accounts = [],
  instructions,
  defaultMethod,
}: {
  accounts?: ResellerPaymentAccount[] | undefined
  instructions?: string | null | undefined
  defaultMethod?: Method | null | undefined
}) {
  const methods = (['gcash', 'bank_transfer'] as const).filter((method) =>
    accounts.some((account) => account.method === method),
  )
  const [chosen, setChosen] = useState<Method | null>(null)
  const method = chosen ?? (defaultMethod && methods.includes(defaultMethod) ? defaultMethod : methods[0]) ?? null
  const shown = accounts.filter((account) => account.method === method)

  return (
    <div className="flex flex-col gap-3 rounded-control border border-gold-500/40 bg-gold-500/10 p-3 text-left">
      <p className="flex items-center gap-2 text-small font-semibold text-gold-200">
        <Wallet size={18} className="flex-none text-gold-300" />
        Where to pay
      </p>

      {methods.length > 1 ? (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
          {methods.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={method === option}
              onClick={() => setChosen(option)}
              className={cn(
                'min-h-touch rounded-control border text-small font-semibold',
                method === option
                  ? 'border-gold-500 bg-gold-500 text-ink-950'
                  : 'border-white/20 bg-white/5 text-ink-100',
              )}
            >
              {paymentLabel[option]}
            </button>
          ))}
        </div>
      ) : null}

      {shown.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}

      {instructions ? <p className="whitespace-pre-line text-small text-ink-200">{instructions}</p> : null}
      {!accounts.length && !instructions ? (
        <p className="text-small text-ink-300">Ask the business for their GCash or bank details.</p>
      ) : null}
    </div>
  )
}

function AccountCard({ account }: { account: ResellerPaymentAccount }) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()
  return (
    <div className="flex flex-col items-center gap-3 rounded-control bg-ink-950/40 p-3 text-center">
      {account.qrUrl ? (
        <a
          href={fileUrl(account.qrUrl)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open the ${account.providerName} QR code`}
          className="block rounded-[14px] bg-white p-2"
        >
          <img
            src={fileUrl(account.qrUrl)}
            alt={`${account.providerName} QR code for ${account.accountName}`}
            className="size-52 object-contain"
          />
        </a>
      ) : null}
      <div className="flex w-full flex-col gap-0.5">
        <p className="text-caption font-semibold uppercase tracking-wide text-gold-300">{account.providerName}</p>
        <p className="font-semibold text-ink-50">{account.accountName}</p>
        <div className="flex items-center justify-center gap-2">
          <p className="font-display text-h4 tracking-wide text-ink-50">{account.accountNumber}</p>
          <button
            type="button"
            aria-label={`Copy ${account.providerName} account number`}
            className="flex size-9 items-center justify-center rounded-full border border-white/20 bg-white/5"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(account.accountNumber.replace(/\s+/g, ''))
                .then(() => {
                  setCopied(true)
                  toast.success(`${account.providerName} number copied.`)
                })
                .catch(() => undefined)
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
