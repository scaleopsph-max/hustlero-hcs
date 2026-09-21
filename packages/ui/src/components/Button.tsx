import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export type ButtonVariant = 'primary' | 'confirm' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'xl'

const variantClass: Record<ButtonVariant, string> = {
  /** Gold. ONE per screen. Charge, Start free, Complete sale. */
  primary: 'btn-primary',
  /** White on dark, black on light (inside .surface-light). */
  confirm: 'btn-confirm',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-touch px-4 text-sm',
  md: '',
  /** Full-width POS action, 64px tall. */
  xl: 'min-h-touch-xl w-full rounded-[18px] text-xl',
}

/** Use on next/link or <a> so links look identical to buttons: <Link className={buttonClasses({ variant: 'primary' })}>. */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string | undefined } = {}): string {
  return cn(variantClass[variant], sizeClass[size], className)
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClasses({ variant, size, className })} {...rest} />
})
