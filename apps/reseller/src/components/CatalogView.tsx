'use client'

import type { ResellerPortalCatalog } from '@hcs/contracts'
import { Chip, Glass, cn, formatPeso } from '@hcs/ui'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { quantityInCart, type CartLine } from '@/lib/cart'
import { stockLabel } from '@/lib/labels'

import { QuantityStepper } from './QuantityStepper'

export function CatalogView({
  catalog,
  cart,
  onQuantity,
}: {
  catalog: ResellerPortalCatalog
  cart: CartLine[]
  onQuantity: (variantId: string, quantityMilli: number) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [availableOnly, setAvailableOnly] = useState(false)

  const categories = useMemo(
    () =>
      [
        ...new Set(catalog.items.map((item) => item.categoryName).filter((name): name is string => Boolean(name))),
      ].sort(),
    [catalog.items],
  )
  const items = useMemo(() => {
    const term = search.trim().toLowerCase()
    return catalog.items.filter(
      (item) =>
        (!term || `${item.productName} ${item.variantName} ${item.sku}`.toLowerCase().includes(term)) &&
        (!category || item.categoryName === category) &&
        (!availableOnly || item.stockStatus !== 'out_of_stock'),
    )
  }, [catalog.items, search, category, availableOnly])

  return (
    <section className="flex flex-col gap-4">
      <label className="relative block">
        <span className="sr-only">Hanapin ang produkto</span>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          className="field w-full pl-10"
          placeholder="Hanapin ang produkto o SKU"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <FilterChip
          active={category === null && !availableOnly}
          onClick={() => {
            setCategory(null)
            setAvailableOnly(false)
          }}
        >
          Lahat
        </FilterChip>
        <FilterChip active={availableOnly} onClick={() => setAvailableOnly((value) => !value)}>
          May stock
        </FilterChip>
        {categories.map((name) => (
          <FilterChip
            key={name}
            active={category === name}
            onClick={() => setCategory(category === name ? null : name)}
          >
            {name}
          </FilterChip>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="py-10 text-center text-ink-300">Walang produktong tugma sa hinahanap mo.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const stock = stockLabel[item.stockStatus]
            const marginMinor = item.srpMinor - item.unitPriceMinor
            const label = `${item.productName} ${item.variantName}`
            return (
              <li key={item.variantId}>
                <Glass className="flex flex-col gap-3 rounded-glass p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{item.productName}</p>
                      <p className="text-small text-ink-300">
                        {item.variantName} · {item.sku}
                      </p>
                    </div>
                    <Chip tone={stock.tone} className="flex-none">
                      {stock.text}
                    </Chip>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-h4 text-gold-300">{formatPeso(item.unitPriceMinor)}</p>
                      <p className="text-caption text-ink-400">
                        SRP {formatPeso(item.srpMinor)}
                        {marginMinor > 0 ? ` · kita ${formatPeso(marginMinor)}/pc` : ''}
                      </p>
                      {item.thresholdMilli > 1000 ? (
                        <p className="text-caption text-ink-400">
                          Min. {item.thresholdMilli / 1000} pcs sa {item.pricingGroupName}
                        </p>
                      ) : null}
                    </div>
                    <QuantityStepper
                      label={label}
                      quantityMilli={quantityInCart(cart, item.variantId)}
                      onChange={(quantityMilli) => onQuantity(item.variantId, quantityMilli)}
                    />
                  </div>
                </Glass>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-9 flex-none rounded-full border px-4 text-small font-semibold',
        active ? 'border-gold-500 bg-gold-500 text-ink-950' : 'border-white/20 bg-white/5 text-ink-100',
      )}
    >
      {children}
    </button>
  )
}
