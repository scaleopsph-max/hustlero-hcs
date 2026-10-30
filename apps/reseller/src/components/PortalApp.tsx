'use client'

import {
  paymentProofUploadResponseSchema,
  resellerOrderSubmitResponseSchema,
  resellerOrdersSchema,
  resellerPortalCatalogSchema,
  resellerPortalSessionSchema,
  type ResellerOrder,
  type ResellerOrderSubmitRequest,
  type ResellerPortalCatalog,
  type ResellerPortalSession,
} from '@hcs/contracts'
import { Button, Glass, Logo, StateCard, Surface, cn } from '@hcs/ui'
import { ClipboardList, Store, ShoppingCart, UserRound, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { readCart, setCartQuantity, summarizeCart, writeCart, type CartLine } from '@/lib/cart'
import { PortalApiError, portalAuth, portalRequest, readSelectedTenant, saveSelectedTenant } from '@/lib/portal-api'

import { AccountView } from './AccountView'
import { CartView } from './CartView'
import { CatalogView } from './CatalogView'
import { OrdersView } from './OrdersView'
import { SignIn } from './SignIn'

type Tab = 'catalog' | 'cart' | 'orders' | 'account'

const glows = [
  { color: 'gold' as const, className: '-right-40 -top-40 size-[420px] opacity-20' },
  { color: 'gray' as const, className: '-left-40 bottom-0 size-[380px]' },
]

export function PortalApp() {
  const auth = portalAuth()
  const [token, setToken] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState<ResellerPortalSession | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ResellerPortalCatalog | null>(null)
  const [orders, setOrders] = useState<ResellerOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [tab, setTab] = useState<Tab>('catalog')
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) {
      setAuthReady(true)
      return
    }
    void auth.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null)
      setAuthReady(true)
    })
    const { data } = auth.auth.onAuthStateChange((_event, next) => setToken(next?.access_token ?? null))
    return () => data.subscription.unsubscribe()
  }, [auth])

  // Session: which businesses this verified email may order from.
  useEffect(() => {
    if (!token) {
      setSession(null)
      setCatalog(null)
      return
    }
    setError(null)
    portalRequest('/v1/portal/session', (value) => resellerPortalSessionSchema.parse(value), { token })
      .then((next) => {
        setSession(next)
        const stored = readSelectedTenant()
        const chosen = next.accounts.find((entry) => entry.tenantId === stored) ?? next.accounts[0]
        setTenantId(chosen?.tenantId ?? null)
      })
      .catch((sessionError: unknown) => setError(messageOf(sessionError)))
  }, [token])

  const loadOrders = useCallback(async () => {
    if (!token || !tenantId) return
    setOrdersLoading(true)
    try {
      const next = await portalRequest('/v1/portal/orders', (value) => resellerOrdersSchema.parse(value), {
        token,
        tenantId,
      })
      setOrders(next.orders)
    } catch (ordersError) {
      setError(messageOf(ordersError))
    } finally {
      setOrdersLoading(false)
    }
  }, [token, tenantId])

  useEffect(() => {
    if (!token || !tenantId) return
    saveSelectedTenant(tenantId)
    setCart(readCart(tenantId))
    setCatalog(null)
    portalRequest('/v1/portal/catalog', (value) => resellerPortalCatalogSchema.parse(value), { token, tenantId })
      .then(setCatalog)
      .catch((catalogError: unknown) => setError(messageOf(catalogError)))
    void loadOrders()
  }, [token, tenantId, loadOrders])

  const updateCart = useCallback(
    (next: CartLine[]) => {
      setCart(next)
      if (tenantId) writeCart(tenantId, next)
    },
    [tenantId],
  )

  const cartCount = useMemo(() => (catalog ? summarizeCart(cart, catalog.items).itemCount : 0), [cart, catalog])

  async function submitOrder(request: ResellerOrderSubmitRequest, idempotencyKey: string) {
    if (!token || !tenantId) throw new Error('Please sign in again.')
    const response = await portalRequest(
      '/v1/portal/orders',
      (value) => resellerOrderSubmitResponseSchema.parse(value),
      {
        token,
        tenantId,
        method: 'POST',
        body: request,
        idempotencyKey,
      },
    )
    updateCart([])
    void loadOrders()
    // Refresh badges after the stock hold.
    portalRequest('/v1/portal/catalog', (value) => resellerPortalCatalogSchema.parse(value), { token, tenantId })
      .then(setCatalog)
      .catch(() => undefined)
    return response
  }

  async function uploadProof(orderId: string, body: FormData, idempotencyKey: string) {
    if (!token || !tenantId) throw new Error('Please sign in again.')
    await portalRequest(
      `/v1/portal/orders/${orderId}/payment-proofs`,
      (value) => paymentProofUploadResponseSchema.parse(value),
      {
        token,
        tenantId,
        method: 'POST',
        body,
        idempotencyKey,
      },
    )
    await loadOrders()
  }

  function reorder(order: ResellerOrder) {
    const available = new Set(catalog?.items.map((item) => item.variantId))
    updateCart(
      order.lines
        .filter((line) => available.has(line.variantId))
        .map((line) => ({ variantId: line.variantId, quantityMilli: line.orderedQuantityMilli })),
    )
    setTab('cart')
  }

  async function signOut() {
    await auth?.auth.signOut()
    setTab('catalog')
  }

  let body: ReactNode
  if (!authReady) body = <Loading />
  else if (!token) body = <SignIn />
  else if (error && !catalog)
    body = (
      <Centered>
        <StateCard
          kind="restricted"
          title="The portal could not load"
          why={error}
          action={
            <Button variant="confirm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        />
      </Centered>
    )
  else if (session && session.accounts.length === 0)
    body = (
      <Centered>
        <StateCard
          kind="locked"
          title="This email has no reseller access yet"
          why="Once the business approves your application, sign in again with the same email."
          action={<Button onClick={signOut}>Use another email</Button>}
        />
      </Centered>
    )
  else if (!catalog) body = <Loading />
  else
    body = (
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 bg-ink-950/80 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur-glass">
          <Logo size={32} />
          <div className="min-w-0">
            <p className="truncate font-display font-bold leading-tight">{catalog.account.businessName}</p>
            <p className="truncate text-caption text-ink-400">{catalog.account.priceListName}</p>
          </div>
        </header>
        <main className="flex-1 px-4 pb-28 pt-2">
          {error ? (
            <p className="mb-3 rounded-control bg-signal-dark-critical-bg px-3 py-2 text-small text-signal-dark-critical-fg">
              {error}
            </p>
          ) : null}
          {tab === 'catalog' ? (
            <CatalogView
              catalog={catalog}
              cart={cart}
              onQuantity={(id, qty) => updateCart(setCartQuantity(cart, id, qty))}
            />
          ) : tab === 'cart' ? (
            <CartView
              catalog={catalog}
              cart={cart}
              onQuantity={(id, qty) => updateCart(setCartQuantity(cart, id, qty))}
              onSubmit={submitOrder}
              onOrderPlaced={(salesOrderId) => {
                setFocusOrderId(salesOrderId)
                setTab('orders')
              }}
              onBrowse={() => setTab('catalog')}
            />
          ) : tab === 'orders' ? (
            <OrdersView
              orders={orders}
              loading={ordersLoading}
              onRefresh={() => void loadOrders()}
              onReorder={reorder}
              onUploadProof={uploadProof}
              focusOrderId={focusOrderId}
              paymentInstructions={catalog.payment?.instructions ?? null}
              paymentAccounts={catalog.payment?.accounts}
            />
          ) : session && tenantId ? (
            <AccountView
              catalog={catalog}
              session={session}
              tenantId={tenantId}
              onSwitchTenant={setTenantId}
              onSignOut={signOut}
            />
          ) : null}
        </main>
        <BottomNav tab={tab} onTab={setTab} cartCount={cartCount} />
      </div>
    )

  return (
    <Surface tone="dark" glows={glows} className="min-h-dvh">
      {body}
    </Surface>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof PortalApiError) return error.message
  return 'Something went wrong while loading. Please try again.'
}

function Loading() {
  return (
    <Centered>
      <p className="text-ink-300" role="status">
        Loading…
      </p>
    </Centered>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5">{children}</div>
}

const tabs: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'catalog', label: 'Products', Icon: Store },
  { id: 'cart', label: 'Cart', Icon: ShoppingCart },
  { id: 'orders', label: 'Orders', Icon: ClipboardList },
  { id: 'account', label: 'Account', Icon: UserRound },
]

function BottomNav({ tab, onTab, cartCount }: { tab: Tab; onTab: (tab: Tab) => void; cartCount: number }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(env(safe-area-inset-bottom),12px)]" aria-label="Portal">
      <Glass variant="strong" className="mx-auto grid max-w-xl grid-cols-4 rounded-sheet p-1.5">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => onTab(id)}
            className={cn(
              'relative flex min-h-touch-lg flex-col items-center justify-center gap-0.5 rounded-[20px] text-caption font-semibold',
              tab === id ? 'bg-gold-500 text-ink-950' : 'text-ink-200',
            )}
          >
            <Icon size={20} />
            {label}
            {id === 'cart' && cartCount > 0 ? (
              <span className="absolute right-3 top-1.5 flex size-5 items-center justify-center rounded-full bg-ink-50 text-[11px] text-ink-950">
                {cartCount}
              </span>
            ) : null}
          </button>
        ))}
      </Glass>
    </nav>
  )
}
