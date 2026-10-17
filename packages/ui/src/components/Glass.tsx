import type { ElementType, HTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const variants = {
  /** Dark: cards and panels. */
  base: 'glass',
  /** Dark: modals, receipts, drawers, the POS cart. */
  strong: 'glass-strong',
  /** Dark or light: selected rows and the one suggested action. */
  gold: 'glass-gold',
  /** Back Office sidebar: near-solid black glass. */
  dark: 'glass-solid-dark',
  /** Light: Back Office cards and toolbars. */
  light: 'glass-light',
  /** Light: tables and long text (84% fill). */
  data: 'glass-data',
} as const

export type GlassVariant = keyof typeof variants

type GlassProps = HTMLAttributes<HTMLElement> & {
  variant?: GlassVariant
  as?: 'div' | 'section' | 'aside' | 'header' | 'nav' | 'article'
}

/** Rule: never stack more than two glass layers. Set the radius from the caller (rounded-glass, -panel, -sheet). */
export function Glass({ variant = 'base', as = 'div', className, ...rest }: GlassProps) {
  const Tag = as as ElementType
  return <Tag className={cn(variants[variant], className)} {...rest} />
}
