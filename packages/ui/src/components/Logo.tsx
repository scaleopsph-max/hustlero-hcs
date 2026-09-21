import { cn } from '../lib/cn'

/** HCS mark: gold tile, black H with the crossbar as a ledger line. */
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="HCS logo"
      width={size}
      height={size}
      className={cn('flex-none', className)}
    >
      <rect width="32" height="32" rx="8" className="fill-gold-500" />
      <path
        d="M10 8v16M22 8v16M10 16h12"
        className="fill-none stroke-ink-950"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
