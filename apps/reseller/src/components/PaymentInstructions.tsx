import { Wallet } from 'lucide-react'

/** Where to send money, as written by the business in Back Office. */
export function PaymentInstructions({ instructions }: { instructions: string | null | undefined }) {
  return (
    <div className="flex gap-3 rounded-control border border-gold-500/40 bg-gold-500/10 p-3 text-left">
      <Wallet size={18} className="mt-0.5 flex-none text-gold-300" />
      <div className="min-w-0 text-small">
        <p className="font-semibold text-gold-200">Where to pay</p>
        {instructions ? (
          <p className="whitespace-pre-line text-ink-100">{instructions}</p>
        ) : (
          <p className="text-ink-300">Ask the business for their GCash or bank details.</p>
        )}
      </div>
    </div>
  )
}
