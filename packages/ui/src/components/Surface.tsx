import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type Glow = {
  color: 'gold' | 'gray'
  /** Position and size, e.g. "-left-40 -top-32 size-[560px]". Add opacity-* to override the default. */
  className: string
}

/**
 * Screen root. Glass needs something behind it to blur, so every screen is a solid base
 * plus 2 to 3 soft glows. Dark: POS, landing, Super Admin. Light: Back Office.
 */
export function Surface({
  tone,
  glows = [],
  className,
  children,
}: {
  tone: 'dark' | 'light'
  glows?: Glow[]
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn(tone === 'dark' ? 'surface-dark' : 'surface-light', className)}>
      {glows.map((g, i) => (
        <span key={i} aria-hidden="true" className={cn(g.color === 'gold' ? 'glow-gold' : 'glow-gray', g.className)} />
      ))}
      {children}
    </div>
  )
}
