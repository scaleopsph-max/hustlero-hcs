'use client'

import { Button, Chip, formatPeso } from '@hcs/ui'
import { Package, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { lineAmountMinor, quantityInCart, type CartLine } from '@/lib/cart'
import type { ProductGroup } from '@/lib/catalog'
import { stockLabel } from '@/lib/labels'
import { fileUrl } from '@/lib/portal-api'

import { QuantityStepper } from './QuantityStepper'

/** Glass bottom sheet listing one product's variants, each with its own price, stock, and quantity. */
export function VariantSheet({
  group,
  cart,
  onQuantity,
  onClose,
}: {
  group: ProductGroup
  cart: CartLine[]
  onQuantity: (variantId: string, quantityMilli: number) => void
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const quantityMilli = group.variants.reduce((sum, variant) => sum + quantityInCart(cart, variant.variantId), 0)
  const subtotalMinor = group.variants.reduce(
    (sum, variant) => sum + lineAmountMinor(variant.unitPriceMinor, quantityInCart(cart, variant.variantId)),
    0,
  )
  const titleId = `variants-${group.productId}`
  const photo = group.imageUrl ?? group.thumbUrl

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label="Isara"
        tabIndex={-1}
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-strong relative flex bg-ink-900/80 max-h-[88dvh] w-full max-w-md flex-col rounded-t-sheet border-x border-t border-white/15 motion-safe:animate-[sheet-up_220ms_ease-out]"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-white/25" aria-hidden />
        <header className="flex flex-none items-start gap-3 px-5 pb-4 pt-3">
          {photo ? (
            <img src={fileUrl(photo)} alt="" className="size-20 flex-none rounded-[18px] object-cover" />
          ) : (
            <span className="flex size-20 flex-none items-center justify-center rounded-[18px] bg-white/10 text-ink-300">
              <Package size={28} />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={titleId} className="text-h4 font-semibold leading-tight">
              {group.productName}
            </h2>
            <p className="text-small text-ink-300">
              {group.variants.length} variants{group.categoryName ? ` · ${group.categoryName}` : ''}
            </p>
            <p className="mt-1 text-small font-semibold text-gold-300">{priceRange(group)}</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Isara ang variants"
            className="flex size-11 flex-none items-center justify-center rounded-full border border-white/15 bg-white/10"
          >
            <X size={18} />
          </button>
        </header>

        <ul className="flex-1 overflow-y-auto overscroll-contain border-t border-white/10 px-5">
          {group.variants.map((variant) => {
            const stock = stockLabel[variant.stockStatus]
            const marginMinor = variant.srpMinor - variant.unitPriceMinor
            return (
              <li
                key={variant.variantId}
                className="flex flex-col gap-2.5 border-b border-white/10 py-4 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{variant.variantName}</p>
                    <p className="text-caption text-ink-400">{variant.sku}</p>
                  </div>
                  <Chip tone={stock.tone} className="flex-none">
                    {stock.text}
                  </Chip>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-h4 text-gold-300">{formatPeso(variant.unitPriceMinor)}</p>
                    <p className="text-caption text-ink-400">
                      SRP {formatPeso(variant.srpMinor)}
                      {marginMinor > 0 ? ` · kita ${formatPeso(marginMinor)}/pc` : ''}
                    </p>
                    {variant.thresholdMilli > 1000 ? (
                      <p className="text-caption text-ink-400">
                        Min. {variant.thresholdMilli / 1000} pcs sa {variant.pricingGroupName}
                      </p>
                    ) : null}
                  </div>
                  <QuantityStepper
                    label={`${group.productName} ${variant.variantName}`}
                    quantityMilli={quantityInCart(cart, variant.variantId)}
                    onChange={(next) => onQuantity(variant.variantId, next)}
                  />
                </div>
              </li>
            )
          })}
        </ul>

        <footer className="flex flex-none items-center justify-between gap-3 border-t border-white/10 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
          <div aria-live="polite">
            <p className="text-small text-ink-300">{quantityMilli / 1000} pcs sa cart</p>
            <p className="font-semibold">{formatPeso(subtotalMinor)}</p>
          </div>
          <Button variant="primary" onClick={onClose} className="min-w-32">
            Tapos na
          </Button>
        </footer>
      </div>
    </div>
  )
}

export function priceRange(group: ProductGroup): string {
  return group.minPriceMinor === group.maxPriceMinor
    ? formatPeso(group.minPriceMinor)
    : `${formatPeso(group.minPriceMinor)} – ${formatPeso(group.maxPriceMinor)}`
}
