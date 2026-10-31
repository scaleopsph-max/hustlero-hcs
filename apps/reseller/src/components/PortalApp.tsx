'use client'

import {
  paymentProofUploadResponseSchema,
  pushPublicKeyResponseSchema,
  pushSubscriptionResponseSchema,
  resellerCreditApplyResponseSchema,
  resellerLoyaltySchema,
  resellerPointsRedeemResponseSchema,
  resellerNotificationReadResponseSchema,
  resellerStatementSchema,
  resellerNotificationsSchema,
  resellerOrderSubmitResponseSchema,
  resellerOrdersSchema,
  resellerPortalCatalogSchema,
  resellerFavoriteResponseSchema,
  resellerStockAlertResponseSchema,
  resellerPortalSessionSchema,
  type ResellerNotification,
  type ResellerCatalogItem,
  type ResellerInvoice,
  resellerInvoiceSchema,
  returnPhotoResponseSchema,
  returnRequestSubmitResponseSchema,
  type ResellerNotifications,
  type ResellerOrder,
  type ResellerOrderSubmitRequest,
  type ResellerPortalCatalog,
  type ResellerPortalSession,
} from '@hcs/contracts'
import {
  Button,
  Glass,
  Logo,
  StateCard,
  Surface,
  cn,
  disablePush,
  formatPeso,
  enablePush,
  preparePhoto,
  pushState,
  pushSupport,
  useToast,
} from '@hcs/ui'
import { Bell, ClipboardList, Store, ShoppingCart, UserRound, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { readCart, setCartQuantity, summarizeCart, writeCart, type CartLine } from '@/lib/cart'
import { applyAccent } from '@/lib/branding'
import {
  PortalApiError,
  fileUrl,
  newIdempotencyKey,
  portalAuth,
  portalRequest,
  readSelectedTenant,
  saveSelectedTenant,
} from '@/lib/portal-api'

import { AccountView } from './AccountView'
import { CartView } from './CartView'
import { CatalogView } from './CatalogView'
import { NotificationsSheet, type PushStatus } from './NotificationsSheet'
import { InvoiceSheet } from './InvoiceSheet'
import { OrdersView } from './OrdersView'
import { ReturnRequestSheet } from './ReturnRequestSheet'
import { SignIn } from './SignIn'

type Tab = 'catalog' | 'cart' | 'orders' | 'account'

const glows = [
  { color: 'gold' as const, className: '-right-40 -top-40 size-[420px] opacity-20' },
  { color: 'gray' as const, className: '-left-40 bottom-0 size-[380px]' },
]

export function PortalApp() {
  const auth = portalAuth()
  const toast = useToast()
  const [token, setToken] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState<ResellerPortalSession | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ResellerPortalCatalog | null>(null)
  const [invoiceView, setInvoiceView] = useState<{
    invoice: ResellerInvoice | null
    loading: boolean
    error: string | null
  } | null>(null)
  const [returnTarget, setReturnTarget] = useState<ResellerOrder['invoices'][number] | null>(null)
  const closeInvoice = useCallback(() => setInvoiceView(null), [])
  // The last return request attempt; a retry reuses its keys so nothing is sent twice.
  const returnAttempt = useRef<{ fingerprint: string; key: string; photoKeys: string[] } | null>(null)
  const [orders, setOrders] = useState<ResellerOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [tab, setTab] = useState<Tab>('catalog')
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<ResellerNotifications>({ unreadCount: 0, items: [] })
  const [inboxOpen, setInboxOpen] = useState(false)
  const [pushStatus, setPushStatus] = useState<PushStatus>('unsupported')
  const [pushKey, setPushKey] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

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

  const loadNotifications = useCallback(async () => {
    if (!token || !tenantId) return
    try {
      setNotifications(
        await portalRequest('/v1/portal/notifications', (value) => resellerNotificationsSchema.parse(value), {
          token,
          tenantId,
        }),
      )
    } catch {
      // Updates are a convenience; the orders list stays the source of truth.
    }
  }, [token, tenantId])

  // New updates arrive when the app opens, every minute while it is open, and when the reseller comes back to it.
  useEffect(() => {
    if (!token || !tenantId) return
    void loadNotifications()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifications()
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadNotifications()
        void loadOrders()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, tenantId, loadNotifications, loadOrders])

  // Phone notifications: what this browser can do, and whether it already gets pushes.
  useEffect(() => {
    if (!token) return
    const support = pushSupport()
    if (support !== 'supported') {
      setPushStatus(support)
      return
    }
    portalRequest('/v1/push/public-key', (value) => pushPublicKeyResponseSchema.parse(value))
      .then(async ({ publicKey }) => {
        setPushKey(publicKey)
        setPushStatus(publicKey ? await pushState() : 'not-configured')
      })
      .catch(() => setPushStatus('not-configured'))
  }, [token])

  // A push that arrives while the portal is open refreshes the badge and orders right away.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'push-received') {
        void loadNotifications()
        void loadOrders()
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [loadNotifications, loadOrders])

  // Opening a push lands on /?order=<id>: show that order.
  useEffect(() => {
    const url = new URL(window.location.href)
    const order = url.searchParams.get('order')
    if (!order) return
    setFocusOrderId(order)
    setTab('orders')
    url.searchParams.delete('order')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  async function turnOnPush() {
    if (!token || !tenantId || !pushKey) return
    setPushBusy(true)
    try {
      const next = await enablePush('/sw.js', pushKey, (subscription) =>
        portalRequest('/v1/portal/push-subscriptions', (value) => pushSubscriptionResponseSchema.parse(value), {
          token,
          tenantId,
          method: 'POST',
          body: subscription,
        }),
      )
      setPushStatus(next)
      if (next === 'on') toast.success('Phone notifications are on.')
      else if (next === 'blocked') toast.error('Notifications are blocked. Allow them in your browser settings.')
    } catch (pushError) {
      toast.error(
        messageOf(pushError) === 'Something went wrong while loading. Please try again.'
          ? 'Notifications could not be turned on. Please try again.'
          : messageOf(pushError),
      )
    } finally {
      setPushBusy(false)
    }
  }

  async function turnOffPush() {
    if (!token || !tenantId) return
    setPushBusy(true)
    try {
      setPushStatus(
        await disablePush((endpoint) =>
          portalRequest(
            '/v1/portal/push-subscriptions/remove',
            (value) => pushSubscriptionResponseSchema.parse(value),
            {
              token,
              tenantId,
              method: 'POST',
              body: { endpoint },
            },
          ),
        ),
      )
      toast.success('Phone notifications are off.')
    } catch {
      toast.error('Notifications could not be turned off. Please try again.')
    } finally {
      setPushBusy(false)
    }
  }

  const loadStatement = useCallback(() => {
    if (!token || !tenantId) return Promise.reject(new Error('Please sign in again.'))
    return portalRequest('/v1/portal/statement', (value) => resellerStatementSchema.parse(value), { token, tenantId })
  }, [token, tenantId])
  const loadLoyalty = useCallback(() => {
    if (!token || !tenantId) return Promise.reject(new Error('Please sign in again.'))
    return portalRequest('/v1/portal/loyalty', (value) => resellerLoyaltySchema.parse(value), { token, tenantId })
  }, [token, tenantId])

  async function markRead(notificationId: string | null) {
    if (!token || !tenantId) return
    setNotifications((current) => ({
      unreadCount: notificationId
        ? current.unreadCount - (current.items.some((item) => item.id === notificationId && !item.readAt) ? 1 : 0)
        : 0,
      items: current.items.map((item) =>
        notificationId === null || item.id === notificationId
          ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
          : item,
      ),
    }))
    await portalRequest(
      '/v1/portal/notifications/read',
      (value) => resellerNotificationReadResponseSchema.parse(value),
      { token, tenantId, method: 'POST', body: notificationId ? { notificationId } : {} },
    ).catch(() => undefined)
  }

  function openNotification(notification: ResellerNotification) {
    void markRead(notification.id)
    setInboxOpen(false)
    if (notification.salesOrderId) {
      setFocusOrderId(notification.salesOrderId)
      setTab('orders')
      void loadOrders()
    } else if (notification.kind === 'back_in_stock') {
      setTab('catalog')
      void refreshCatalog()
    }
  }

  async function refreshCatalog() {
    if (!token || !tenantId) return
    await portalRequest('/v1/portal/catalog', (value) => resellerPortalCatalogSchema.parse(value), { token, tenantId })
      .then(setCatalog)
      .catch(() => undefined)
  }

  function patchCatalog(change: (item: ResellerCatalogItem) => ResellerCatalogItem) {
    setCatalog((current) => (current ? { ...current, items: current.items.map(change) } : current))
  }

  async function saveFavorite(productId: string, favorite: boolean) {
    if (!token || !tenantId) return
    const apply = (value: boolean) =>
      patchCatalog((item) => (item.productId === productId ? { ...item, isFavorite: value } : item))
    apply(favorite)
    try {
      await portalRequest('/v1/portal/favorites', (value) => resellerFavoriteResponseSchema.parse(value), {
        token,
        tenantId,
        method: 'POST',
        body: { productId, favorite },
      })
    } catch (cause) {
      apply(!favorite)
      toast.error(cause instanceof Error ? cause.message : 'Your favorite was not saved. Please try again.')
    }
  }

  async function saveStockAlert(variantId: string, notify: boolean) {
    if (!token || !tenantId) return
    const apply = (value: boolean) =>
      patchCatalog((item) => (item.variantId === variantId ? { ...item, notifyRequested: value } : item))
    apply(notify)
    try {
      await portalRequest('/v1/portal/stock-alerts', (value) => resellerStockAlertResponseSchema.parse(value), {
        token,
        tenantId,
        method: 'POST',
        body: { variantId, notify },
      })
      if (notify)
        toast.success(
          pushStatus === 'on'
            ? "We'll notify you when it's back in stock."
            : "We'll tell you in Updates when it's back. Turn on phone notifications there to get it on your phone.",
        )
    } catch (cause) {
      apply(!notify)
      toast.error(cause instanceof Error ? cause.message : 'The alert was not saved. Please try again.')
      void refreshCatalog()
    }
  }

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

  // The business's accent color recolors the portal.
  useEffect(() => {
    applyAccent(catalog?.branding?.accentColor)
  }, [catalog?.branding?.accentColor])

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

  async function openInvoice(invoiceId: string) {
    if (!token || !tenantId) return
    setInvoiceView({ invoice: null, loading: true, error: null })
    try {
      const invoice = await portalRequest(
        `/v1/portal/invoices/${invoiceId}`,
        (value) => resellerInvoiceSchema.parse(value),
        {
          token,
          tenantId,
        },
      )
      setInvoiceView({ invoice, loading: false, error: null })
    } catch (cause) {
      setInvoiceView({ invoice: null, loading: false, error: cause instanceof Error ? cause.message : null })
    }
  }

  async function sendReturnRequest(
    request: { invoiceId: string; reason: string; lines: { invoiceLineId: string; quantityMilli: number }[] },
    photos: File[],
  ) {
    if (!token || !tenantId) throw new Error('Please sign in again.')
    const fingerprint = JSON.stringify(request)
    if (returnAttempt.current?.fingerprint !== fingerprint)
      returnAttempt.current = {
        fingerprint,
        key: newIdempotencyKey('return'),
        photoKeys: photos.map(() => newIdempotencyKey('rphoto')),
      }
    const attempt = returnAttempt.current
    const created = await portalRequest(
      '/v1/portal/return-requests',
      (value) => returnRequestSubmitResponseSchema.parse(value),
      {
        token,
        tenantId,
        method: 'POST',
        body: request,
        idempotencyKey: attempt.key,
      },
    )
    let failed = 0
    for (const [index, file] of photos.entries()) {
      try {
        const prepared = await preparePhoto(file)
        const body = new FormData()
        body.append('image', prepared.image, prepared.filename)
        body.append('thumb', prepared.thumb, `thumb-${prepared.filename}`)
        await portalRequest(
          `/v1/portal/return-requests/${created.requestId}/photos`,
          (value) => returnPhotoResponseSchema.parse(value),
          {
            token,
            tenantId,
            method: 'POST',
            body,
            idempotencyKey: attempt.photoKeys[index] ?? newIdempotencyKey('rphoto'),
          },
        )
      } catch {
        failed += 1
      }
    }
    returnAttempt.current = null
    setReturnTarget(null)
    toast.success(
      failed > 0
        ? `Return request sent. ${failed} photo${failed === 1 ? '' : 's'} did not upload.`
        : "Return request sent. We'll let you know once it is reviewed.",
    )
    await loadOrders()
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
    toast.success(`Items from ${order.orderNumber} added to your cart.`)
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
          {catalog.branding?.logoUrl ? (
            <img
              src={fileUrl(catalog.branding.logoUrl)}
              alt=""
              className="size-8 flex-none rounded-[10px] object-cover"
            />
          ) : (
            <Logo size={32} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-bold leading-tight">
              {catalog.branding?.portalName ?? catalog.account.businessName}
            </p>
            <p className="truncate text-caption text-ink-400">{catalog.account.priceListName}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setInboxOpen(true)
              void loadNotifications()
            }}
            aria-label={notifications.unreadCount > 0 ? `Updates, ${notifications.unreadCount} new` : 'Updates'}
            className="relative flex size-11 flex-none items-center justify-center rounded-full border border-white/15 bg-white/10"
          >
            <Bell size={20} />
            {notifications.unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-gold-500 px-1 text-[11px] font-bold text-ink-950">
                {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
              </span>
            ) : null}
          </button>
        </header>
        {inboxOpen ? (
          <NotificationsSheet
            items={notifications.items}
            unreadCount={notifications.unreadCount}
            onOpen={openNotification}
            onMarkAllRead={() => void markRead(null)}
            onClose={() => setInboxOpen(false)}
            push={{
              status: pushStatus,
              busy: pushBusy,
              onEnable: () => void turnOnPush(),
              onDisable: () => void turnOffPush(),
            }}
          />
        ) : null}
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
              onFavorite={(productId, favorite) => void saveFavorite(productId, favorite)}
              onNotify={(variantId, notify) => void saveStockAlert(variantId, notify)}
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
              onStockChanged={() =>
                token && tenantId
                  ? portalRequest('/v1/portal/catalog', (value) => resellerPortalCatalogSchema.parse(value), {
                      token,
                      tenantId,
                    })
                      .then(setCatalog)
                      .catch(() => undefined)
                  : undefined
              }
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
              onOpenInvoice={(invoiceId) => void openInvoice(invoiceId)}
              onRequestReturn={(order, invoiceId) =>
                setReturnTarget(order.invoices.find((invoice) => invoice.id === invoiceId) ?? null)
              }
            />
          ) : session && tenantId ? (
            <AccountView
              catalog={catalog}
              session={session}
              tenantId={tenantId}
              onSwitchTenant={setTenantId}
              onSignOut={signOut}
              loadStatement={loadStatement}
              loadLoyalty={loadLoyalty}
              onApplyCredit={async (invoiceId, amountMinor, idempotencyKey) => {
                if (!token || !tenantId) throw new Error('Please sign in again.')
                const result = await portalRequest(
                  '/v1/portal/credit/apply',
                  (value) => resellerCreditApplyResponseSchema.parse(value),
                  { token, tenantId, method: 'POST', body: { invoiceId, amountMinor }, idempotencyKey },
                )
                toast.success(
                  `${formatPeso(result.amountMinor)} credit applied. ${formatPeso(result.balanceMinor)} left to pay.`,
                )
              }}
              onRedeemPoints={async (invoiceId, points, idempotencyKey) => {
                if (!token || !tenantId) throw new Error('Please sign in again.')
                const result = await portalRequest(
                  '/v1/portal/points/redeem',
                  (value) => resellerPointsRedeemResponseSchema.parse(value),
                  { token, tenantId, method: 'POST', body: { invoiceId, points }, idempotencyKey },
                )
                toast.success(
                  `${result.points} points paid ${formatPeso(result.amountMinor)}. ${formatPeso(result.balanceMinor)} left to pay.`,
                )
              }}
              onOpenOrder={(salesOrderId) => {
                setFocusOrderId(salesOrderId)
                setTab('orders')
                void loadOrders()
              }}
            />
          ) : null}
        </main>
        {invoiceView ? (
          <InvoiceSheet
            invoice={invoiceView.invoice}
            loading={invoiceView.loading}
            error={invoiceView.error}
            onClose={closeInvoice}
          />
        ) : null}
        {returnTarget ? (
          <ReturnRequestSheet
            invoice={returnTarget}
            onSubmit={sendReturnRequest}
            onClose={() => setReturnTarget(null)}
          />
        ) : null}
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
