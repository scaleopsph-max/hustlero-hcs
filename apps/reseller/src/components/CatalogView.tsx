'use client'

import type { ResellerPortalCatalog } from '@hcs/contracts'
import { Chip, Glass, cn, formatPeso } from '@hcs/ui'
import { ChevronRight, Heart, Package, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { quantityInCart, type CartLine } from '@/lib/cart'
import { filterGroups, groupCatalog, showNewBadges, type ProductGroup } from '@/lib/catalog'
import { stockLabel } from '@/lib/labels'
import { fileUrl } from '@/lib/portal-api'

import { NotifyButton } from './NotifyButton'
import { QuantityStepper } from './QuantityStepper'
import { VariantSheet, priceRange } from './VariantSheet'

export function CatalogView({
  catalog,
  cart,
  onQuantity,
  onFavorite,
  onNotify,
}: {
  catalog: ResellerPortalCatalog
  cart: CartLine[]
  onQuantity: (variantId: string, quantityMilli: number) => void
  onFavorite: (productId: string, favorite: boolean) => void
  onNotify: (variantId: string, notify: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [availableOnly, setAvailableOnly] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [newOnly, setNewOnly] = useState(false)
  const [openProductId, setOpenProductId] = useState<string | null>(null)

  const groups = useMemo(() => groupCatalog(catalog.items), [catalog.items])
  const categories = useMemo(
    () =>
      [...new Set(groups.map((group) => group.categoryName).filter((name): name is string => Boolean(name)))].sort(),
    [groups],
  )
  const showNew = useMemo(() => showNewBadges(groups), [groups])
  const visible = useMemo(
    () => filterGroups(groups, { search, category, availableOnly, favoritesOnly, newOnly: showNew && newOnly }),
    [groups, search, category, availableOnly, favoritesOnly, newOnly, showNew],
  )
  const openGroup = groups.find((group) => group.productId === openProductId) ?? null
  const closeSheet = useCallback(() => setOpenProductId(null), [])

  return (
    <section className="flex flex-col gap-4">
      <label className="relative block">
        <span className="sr-only">Search products</span>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          className="field w-full pl-10"
          placeholder="Search product or SKU"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <FilterChip
          active={category === null && !availableOnly && !favoritesOnly && !newOnly}
          onClick={() => {
            setCategory(null)
            setAvailableOnly(false)
            setFavoritesOnly(false)
            setNewOnly(false)
          }}
        >
          All
        </FilterChip>
        <FilterChip active={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}>
          Favorites
        </FilterChip>
        {showNew ? (
          <FilterChip active={newOnly} onClick={() => setNewOnly((value) => !value)}>
            New
          </FilterChip>
        ) : null}
        <FilterChip active={availableOnly} onClick={() => setAvailableOnly((value) => !value)}>
          In stock
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

      {visible.length === 0 ? (
        <p className="py-10 text-center text-ink-300">
          {favoritesOnly && !groups.some((group) => group.isFavorite)
            ? 'No favorites yet. Tap the heart on a product you order often.'
            : 'No products match your search.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((group) => (
            <li key={group.productId}>
              {group.variants.length === 1 ? (
                <SingleProductCard
                  group={group}
                  cart={cart}
                  showNew={showNew}
                  onQuantity={onQuantity}
                  onFavorite={onFavorite}
                  onNotify={onNotify}
                />
              ) : (
                <ProductCard
                  group={group}
                  cart={cart}
                  showNew={showNew}
                  onOpen={() => setOpenProductId(group.productId)}
                  onFavorite={onFavorite}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {openGroup ? (
        <VariantSheet group={openGroup} cart={cart} onQuantity={onQuantity} onNotify={onNotify} onClose={closeSheet} />
      ) : null}
    </section>
  )
}

function ProductPhoto({ group }: { group: ProductGroup }) {
  return group.thumbUrl ? (
    <img
      src={fileUrl(group.thumbUrl)}
      alt=""
      loading="lazy"
      className="size-16 flex-none rounded-[14px] object-cover"
    />
  ) : (
    <span className="flex size-16 flex-none items-center justify-center rounded-[14px] bg-white/10 text-ink-300">
      <Package size={22} />
    </span>
  )
}

/** A product with several variants: one card that opens the variant sheet. */
function ProductCard({
  group,
  cart,
  showNew,
  onOpen,
  onFavorite,
}: {
  group: ProductGroup
  cart: CartLine[]
  showNew: boolean
  onOpen: () => void
  onFavorite: (productId: string, favorite: boolean) => void
}) {
  const stock = stockLabel[group.stockStatus]
  const inCartMilli = group.variants.reduce((sum, variant) => sum + quantityInCart(cart, variant.variantId), 0)
  return (
    <Glass className="relative rounded-glass">
      <FavoriteButton group={group} onFavorite={onFavorite} className="absolute left-1 top-1 z-10" />
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${group.productName}, ${group.variants.length} variants. Choose a variant.`}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <ProductPhoto group={group} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {group.productName}
            {showNew && group.isNew ? <NewBadge /> : null}
          </p>
          <p className="text-small text-ink-300">{group.variants.length} variants</p>
          <p className="mt-1 text-h4 text-gold-300">{priceRange(group)}</p>
        </div>
        <div className="flex flex-none flex-col items-end gap-2">
          <Chip tone={stock.tone}>{stock.text}</Chip>
          {inCartMilli > 0 ? (
            <span className="rounded-full bg-gold-500 px-2.5 py-0.5 text-caption font-semibold text-ink-950">
              {inCartMilli / 1000} in cart
            </span>
          ) : (
            <ChevronRight size={20} className="text-ink-400" aria-hidden />
          )}
        </div>
      </button>
    </Glass>
  )
}

/** A product with one variant keeps its quantity controls on the card. */
function SingleProductCard({
  group,
  cart,
  showNew,
  onQuantity,
  onFavorite,
  onNotify,
}: {
  group: ProductGroup
  cart: CartLine[]
  showNew: boolean
  onQuantity: (variantId: string, quantityMilli: number) => void
  onFavorite: (productId: string, favorite: boolean) => void
  onNotify: (variantId: string, notify: boolean) => void
}) {
  const item = group.variants[0]!
  const stock = stockLabel[item.stockStatus]
  const marginMinor = item.srpMinor - item.unitPriceMinor
  return (
    <Glass className="relative flex flex-col gap-3 rounded-glass p-4">
      <FavoriteButton group={group} onFavorite={onFavorite} className="absolute left-1 top-1 z-10" />
      <div className="flex items-start justify-between gap-3">
        <ProductPhoto group={group} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {item.productName}
            {showNew && group.isNew ? <NewBadge /> : null}
          </p>
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
            {marginMinor > 0 ? ` · profit ${formatPeso(marginMinor)}/pc` : ''}
          </p>
          {item.thresholdMilli > 1000 ? (
            <p className="text-caption text-ink-400">
              Min. {item.thresholdMilli / 1000} pcs in {item.pricingGroupName}
            </p>
          ) : null}
        </div>
        <QuantityStepper
          label={`${item.productName} ${item.variantName}`}
          quantityMilli={quantityInCart(cart, item.variantId)}
          canIncrease={item.stockStatus !== 'out_of_stock'}
          onChange={(quantityMilli) => onQuantity(item.variantId, quantityMilli)}
        />
      </div>
      {item.stockStatus === 'out_of_stock' ? <NotifyButton item={item} onNotify={onNotify} /> : null}
    </Glass>
  )
}

function NewBadge() {
  return (
    <span className="ml-2 inline-block rounded-full bg-gold-500 px-2 py-0.5 align-middle text-caption font-bold uppercase tracking-wide text-ink-950">
      New
    </span>
  )
}

/** Heart toggle that saves the product to the reseller's favorites. */
function FavoriteButton({
  group,
  onFavorite,
  className,
}: {
  group: ProductGroup
  onFavorite: (productId: string, favorite: boolean) => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={group.isFavorite}
      aria-label={
        group.isFavorite ? `Remove ${group.productName} from favorites` : `Add ${group.productName} to favorites`
      }
      onClick={() => onFavorite(group.productId, !group.isFavorite)}
      className={cn('flex size-11 items-center justify-center rounded-full', className)}
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-ink-950/70 backdrop-blur">
        <Heart size={15} className={group.isFavorite ? 'fill-rose-500 text-rose-500' : 'text-white'} aria-hidden />
      </span>
    </button>
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
