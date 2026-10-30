'use client'

import {
  resellerAccountInviteResponseSchema,
  resellerAccountStatusResponseSchema,
  resellerApplicationDecisionResponseSchema,
  resellerOrderReviewResponseSchema,
  resellerPortalAdminSchema,
  resellerPortalSettingsResponseSchema,
  resellerPaymentAccountSaveResponseSchema,
  paymentQrUploadResponseSchema,
  paymentProofReviewResponseSchema,
  pendingPaymentProofsSchema,
  sessionContextResponseSchema,
  type PendingPaymentProof,
  type ResellerOrderReviewRequest,
  type ResellerPortalAdmin,
} from '@hcs/contracts'
import { Button, Chip, Glass, cn, formatPeso, useToast } from '@hcs/ui'
import { Check, Copy, RefreshCw, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { selectActiveTenant } from '@/lib/active-tenant'
import { PaymentAccountsCard } from './PaymentAccountsCard'
import { fileUrl } from './ProductPhotos'
import {
  applicationLink,
  approvalRequest,
  commandKey,
  orderReviewRequest,
  rejectionRequest,
  reviewReasonText,
} from '@/lib/reseller-portal-admin'
import { createClient } from '@/lib/supabase-browser'

const api = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const portalOrigin = process.env.NEXT_PUBLIC_RESELLER_PORTAL_URL
const control =
  'min-h-10 w-full min-w-0 rounded-control border border-ink-900/15 bg-white px-3 text-sm outline-none focus:border-ink-900'
const terms = [
  ['prepaid', 'Prepaid'],
  ['cod', 'Cash on delivery'],
  ['net_7', 'Net 7'],
  ['net_15', 'Net 15'],
  ['net_30', 'Net 30'],
] as const
const stockTone = { in_stock: 'success', low_stock: 'warning', out_of_stock: 'critical' } as const
const stockText = { in_stock: 'In stock', low_stock: 'Low', out_of_stock: 'Out' } as const

type Scope = { token: string; tenantId: string }
type PortalTab = 'orders' | 'payments' | 'resellers' | 'settings'
const portalTabs: PortalTab[] = ['orders', 'payments', 'resellers', 'settings']

/** The tab named in the URL hash, so a refresh or shared link opens the same section. */
function readTab(): PortalTab {
  if (typeof window === 'undefined') return 'orders'
  const hash = window.location.hash.replace('#', '') as PortalTab
  return portalTabs.includes(hash) ? hash : 'orders'
}

async function call(path: string, scope: Scope, body?: unknown, idempotencyKey?: string) {
  if (!api) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${scope.token}`,
      'X-Tenant-Id': scope.tenantId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } } | null)?.error?.message ?? 'Request failed.')
  return data
}

export function ResellerPortalWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [scope, setScope] = useState<Scope | null>(null)
  const [admin, setAdmin] = useState<ResellerPortalAdmin | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const keys = useRef(new Map<string, string>())
  const [tab, setTab] = useState<PortalTab>('orders')
  // Read the hash after mounting so the server and first client render agree.
  useEffect(() => {
    setTab(readTab())
  }, [])
  function chooseTab(next: PortalTab) {
    setTab(next)
    try {
      window.history.replaceState(null, '', `#${next}`)
    } catch {
      // The hash only remembers the tab; ignore environments without history.
    }
  }

  const [proofs, setProofs] = useState<PendingPaymentProof[] | null>(null)
  const load = useCallback(async (next: Scope) => {
    setAdmin(resellerPortalAdminSchema.parse(await call('/v1/reseller-portal/admin', next)))
    // Proofs need file storage; the rest of the screen works without it.
    try {
      setProofs(pendingPaymentProofsSchema.parse(await call('/v1/reseller-portal/payment-proofs', next)).proofs)
    } catch {
      setProofs(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data } = await auth.auth.getSession()
        if (!data.session) throw new Error('Sign in to manage the reseller portal.')
        const token = data.session.access_token
        const access = sessionContextResponseSchema.parse(await call('/v1/me', { token, tenantId: '' }))
        const tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const next = { token, tenantId: tenant.tenantId }
        if (!active) return
        setScope(next)
        await load(next)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load the reseller portal.')
      } finally {
        if (active) setBusy(null)
      }
    })()
    return () => {
      active = false
    }
  }, [auth, load])

  /** Runs one command with a stable idempotency key per target, then reloads. */
  async function run(
    target: string,
    path: string,
    body: unknown,
    parse: (value: unknown) => unknown,
    done: string,
  ): Promise<boolean> {
    if (!scope) return false
    setBusy(target)
    setError(null)
    try {
      parse(await call(path, scope, body, commandKey(keys.current, `${target}:${JSON.stringify(body)}`)))
      keys.current.delete(`${target}:${JSON.stringify(body)}`)
      await load(scope)
      if (done) toast.success(done)
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The change was not saved. Try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!admin)
    return (
      <div className="px-6 pb-10">
        {error ? <ErrorBanner text={error} /> : <p className="text-ink-500">Loading reseller portal…</p>}
      </div>
    )

  const link = applicationLink(portalOrigin, admin.tenantSlug)
  const pendingApplications = admin.applications.filter((application) => application.status === 'pending')
  const awaiting = admin.awaitingPayment ?? []
  const tabs: { id: PortalTab; label: string; count: number }[] = [
    { id: 'orders', label: 'Orders', count: admin.reviewQueue.length },
    { id: 'payments', label: 'Balance payments', count: proofs?.length ?? 0 },
    { id: 'resellers', label: 'Resellers', count: pendingApplications.length },
    { id: 'settings', label: 'Settings', count: admin.settings ? 0 : 1 },
  ]

  return (
    <div className="flex flex-col gap-6 px-6 pb-10">
      {error ? <ErrorBanner text={error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex max-w-full gap-1 overflow-x-auto rounded-control border border-ink-900/15 bg-white/70 p-1"
          role="tablist"
          aria-label="Reseller portal sections"
        >
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`portal-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`portal-panel-${entry.id}`}
              onClick={() => chooseTab(entry.id)}
              className={cn(
                'inline-flex h-9 flex-none items-center gap-2 rounded-control px-4 text-sm font-semibold',
                tab === entry.id ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-900/5',
              )}
            >
              {entry.label}
              {entry.count ? (
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 text-xs leading-5',
                    tab === entry.id
                      ? 'bg-gold-500 text-ink-950'
                      : 'bg-signal-light-attention-bg text-signal-light-attention-fg',
                  )}
                >
                  {entry.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy !== null || !scope}
          onClick={() =>
            scope && void run('refresh', '/v1/reseller-portal/admin', undefined, () => null, 'Up to date.')
          }
        >
          <RefreshCw size={16} className="mr-2" />
          Refresh
        </Button>
      </div>

      {tab === 'orders' ? (
        <div
          role="tabpanel"
          id="portal-panel-orders"
          aria-labelledby="portal-tab-orders"
          className="flex flex-col gap-6"
        >
          <p className="text-sm text-ink-500">
            New portal orders hold stock for 4 hours. They move to Paid orders once the reseller uploads a payment
            proof.
          </p>
          <Section
            title="Paid orders to confirm"
            empty="No paid orders are waiting. Orders appear here once the reseller uploads a payment proof."
          >
            {admin.reviewQueue.map((order) => (
              <ReviewCard
                key={order.id}
                order={order}
                busy={busy === `review:${order.id}`}
                onDecide={(body) =>
                  run(
                    `review:${order.id}`,
                    `/v1/reseller-portal/orders/${order.id}/review`,
                    body,
                    (v) => resellerOrderReviewResponseSchema.parse(v),
                    body.decision === 'approve'
                      ? `${order.orderNumber} confirmed and its payment proofs verified. Record the payment in Wholesale payments using the proof reference.`
                      : `${order.orderNumber} rejected and its stock released. The reseller sees your reason.`,
                  )
                }
              />
            ))}
          </Section>

          <Section
            title="Awaiting payment"
            empty="No orders are waiting for payment. New portal orders hold stock for 4 hours until the reseller pays."
          >
            {awaiting.map((order) => (
              <Glass
                key={order.id}
                variant="data"
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel px-5 py-3"
              >
                <div>
                  <p className="font-semibold">
                    {order.orderNumber} · {order.customerName}
                  </p>
                  <p className="text-sm text-ink-500">
                    Stock on hold until{' '}
                    {new Date(order.paymentDueAt).toLocaleString('en-PH', {
                      timeZone: 'Asia/Manila',
                      hour: 'numeric',
                      minute: '2-digit',
                      month: 'short',
                      day: 'numeric',
                    })}
                    . Cancelled automatically if no proof arrives.
                  </p>
                </div>
                <p className="font-semibold">{formatPeso(order.totalMinor)}</p>
              </Glass>
            ))}
          </Section>
        </div>
      ) : null}

      {tab === 'payments' ? (
        <div
          role="tabpanel"
          id="portal-panel-payments"
          aria-labelledby="portal-tab-payments"
          className="flex flex-col gap-6"
        >
          <p className="text-sm text-ink-500">
            Proofs for the remaining balance of confirmed orders. Check each one in your GCash or bank app.
          </p>
          {proofs ? (
            <Section
              title="Balance payments to verify"
              empty="No balance payments are waiting. Proofs sent before confirmation are checked in the Orders tab."
            >
              {proofs.map((proof) => (
                <ProofCard
                  key={proof.id}
                  proof={proof}
                  busy={busy === `proof:${proof.id}`}
                  onDecide={(body) =>
                    run(
                      `proof:${proof.id}`,
                      `/v1/reseller-portal/payment-proofs/${proof.id}/review`,
                      body,
                      (v) => paymentProofReviewResponseSchema.parse(v),
                      body.decision === 'accept'
                        ? `Proof for ${proof.orderNumber} verified. Record the payment in Wholesale payments or at paid fulfillment using reference ${proof.reference}.`
                        : `Proof for ${proof.orderNumber} rejected. The reseller sees your reason.`,
                    )
                  }
                />
              ))}
            </Section>
          ) : (
            <p className="text-sm text-ink-500">
              Balance payments need file storage, which is not set up for this environment.
            </p>
          )}
        </div>
      ) : null}

      {tab === 'resellers' ? (
        <div
          role="tabpanel"
          id="portal-panel-resellers"
          aria-labelledby="portal-tab-resellers"
          className="flex flex-col gap-6"
        >
          <p className="text-sm text-ink-500">Approve applications and manage who can sign in to the portal.</p>
          <Section
            title="Applications"
            empty="No applications yet. Share the application link with prospective resellers."
          >
            {admin.applications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                admin={admin}
                busy={busy === `application:${application.id}`}
                onDecide={(body) =>
                  run(
                    `application:${application.id}`,
                    `/v1/reseller-portal/applications/${application.id}/decision`,
                    body,
                    (v) => resellerApplicationDecisionResponseSchema.parse(v),
                    body.decision === 'approve'
                      ? `${application.fullName} approved. They can now sign in with ${application.email}.`
                      : `${application.fullName} rejected.`,
                  )
                }
              />
            ))}
          </Section>

          <AccountsCard
            admin={admin}
            busy={busy}
            onInvite={(body) =>
              run(
                'invite',
                '/v1/reseller-portal/accounts',
                body,
                (v) => resellerAccountInviteResponseSchema.parse(v),
                'Invitation saved. The reseller signs in with that email.',
              )
            }
            onStatus={(accountId, status) =>
              run(
                `account:${accountId}`,
                `/v1/reseller-portal/accounts/${accountId}/status`,
                { status },
                (v) => resellerAccountStatusResponseSchema.parse(v),
                status === 'suspended' ? 'Portal access suspended.' : 'Portal access restored.',
              )
            }
          />
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div
          role="tabpanel"
          id="portal-panel-settings"
          aria-labelledby="portal-tab-settings"
          className="flex flex-col gap-6"
        >
          <p className="text-sm text-ink-500">
            Where portal orders are filled, and the GCash and bank accounts resellers pay into.
          </p>
          <SettingsCard
            admin={admin}
            busy={busy !== null}
            saving={busy === 'settings'}
            link={link}
            onSave={(body) =>
              run(
                'settings',
                '/v1/reseller-portal/settings',
                body,
                (v) => resellerPortalSettingsResponseSchema.parse(v),
                'Portal settings saved.',
              )
            }
          />

          <PaymentAccountsCard
            accounts={admin.paymentAccounts ?? []}
            busy={busy !== null}
            onSave={(body, target, done) =>
              run(
                target,
                '/v1/reseller-portal/payment-accounts',
                body,
                (v) => resellerPaymentAccountSaveResponseSchema.parse(v),
                done,
              )
            }
            onUploadQr={async (accountId, body) => {
              if (!scope || !api) throw new Error('Sign in again to upload.')
              const response = await fetch(
                `${api.replace(/\/$/, '')}/v1/reseller-portal/payment-accounts/${accountId}/qr`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${scope.token}`,
                    'X-Tenant-Id': scope.tenantId,
                    'Idempotency-Key': `payment-qr-${crypto.randomUUID()}`,
                  },
                  body,
                },
              )
              const data: unknown = await response.json().catch(() => null)
              if (!response.ok)
                throw new Error(
                  (data as { error?: { message?: string } } | null)?.error?.message ?? 'The QR code was not uploaded.',
                )
              paymentQrUploadResponseSchema.parse(data)
              await load(scope)
              toast.success('QR code saved. Resellers see it when they pay.')
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function ProofCard({
  proof,
  busy,
  onDecide,
}: {
  proof: PendingPaymentProof
  busy: boolean
  onDecide: (body: { decision: 'accept' } | { decision: 'reject'; reason: string }) => void
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const mismatch = proof.amountMinor !== proof.orderTotalMinor
  const [acting, setActing] = useState<'accept' | 'reject' | null>(null)
  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5 md:flex-row">
      <a
        href={fileUrl(proof.url)}
        target="_blank"
        rel="noreferrer"
        className="flex-none self-start"
        aria-label={`Open proof for ${proof.orderNumber}`}
      >
        {proof.thumbUrl ? (
          <img
            src={fileUrl(proof.thumbUrl)}
            alt={`Payment proof for ${proof.orderNumber}`}
            className="h-40 w-32 rounded-control object-cover"
          />
        ) : (
          <span className="flex h-40 w-32 items-center justify-center rounded-control bg-ink-900/5 text-sm font-semibold text-ink-600">
            Open PDF
          </span>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">
              {proof.orderNumber} · {proof.customerName}
            </p>
            <p className="text-sm text-ink-500">
              {proof.method === 'gcash' ? 'GCash' : 'Bank transfer'} · Ref {proof.reference} ·{' '}
              {new Date(proof.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-h4">{formatPeso(proof.amountMinor)}</p>
            <p className={mismatch ? 'text-sm text-signal-light-warning-fg' : 'text-sm text-ink-500'}>
              Order total {formatPeso(proof.orderTotalMinor)}
            </p>
          </div>
        </div>
        <p className="text-caption text-ink-500">
          Check the amount and reference in your GCash or bank app before accepting. Accepting only marks the proof as
          verified; it does not record the payment.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-semibold">
            Reason (required to reject)
            <input
              className={control}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button
            variant="confirm"
            disabled={busy}
            onClick={() => {
              setActing('accept')
              onDecide({ decision: 'accept' })
            }}
          >
            <Check size={16} className="mr-2" />
            {busy && acting === 'accept' ? 'Verifying…' : 'Mark verified'}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (reason.trim().length < 2) return setProblem('Tell the reseller why the proof is rejected.')
              setProblem(null)
              setActing('reject')
              onDecide({ decision: 'reject', reason: reason.trim() })
            }}
          >
            <X size={16} className="mr-2" />
            {busy && acting === 'reject' ? 'Rejecting…' : 'Reject'}
          </Button>
        </div>
        {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
      </div>
    </Glass>
  )
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="rounded-control bg-signal-light-critical-bg px-4 py-3 text-sm text-signal-light-critical-fg"
    >
      {text}
    </p>
  )
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h4">{title}</h2>
      {children.length === 0 ? <p className="text-sm text-ink-500">{empty}</p> : children}
    </section>
  )
}

function SettingsCard({
  admin,
  busy,
  saving,
  link,
  onSave,
}: {
  admin: ResellerPortalAdmin
  busy: boolean
  saving: boolean
  link: string | null
  onSave: (body: unknown) => void
}) {
  const [location, setLocation] = useState(admin.settings?.fulfillmentLocationId ?? admin.locations[0]?.id ?? '')
  const [priceList, setPriceList] = useState(admin.settings?.defaultPriceListId ?? '')
  const [open, setOpen] = useState(admin.settings?.applicationsOpen ?? true)
  const [instructions, setInstructions] = useState(admin.settings?.paymentInstructions ?? '')
  const [copied, setCopied] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({
      fulfillmentLocationId: location,
      applicationsOpen: open,
      paymentInstructions: instructions.trim() ? instructions.trim() : null,
      ...(priceList ? { defaultPriceListId: priceList } : {}),
    })
  }

  return (
    <Glass variant="light" className="rounded-panel p-5">
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <div className="md:col-span-2">
          <h2 className="text-h4">Portal settings</h2>
          {!admin.settings ? (
            <p className="text-sm text-signal-light-warning-fg">
              Save these settings to open the portal and the application form.
            </p>
          ) : null}
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Branch that fills portal orders
          <select className={control} value={location} onChange={(event) => setLocation(event.target.value)} required>
            {admin.locations.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="font-normal text-ink-500">Stock badges and reservations use this branch.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Default price list for approvals
          <select className={control} value={priceList} onChange={(event) => setPriceList(event.target.value)}>
            <option value="">Choose on each approval</option>
            {admin.priceLists.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold md:row-span-2">
          Extra payment notes (optional)
          <textarea
            className={`${control} min-h-28 py-2 font-normal`}
            maxLength={1000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="e.g. Send the screenshot right after paying. Downpayment is at least 50%."
          />
          <span className="font-normal text-ink-500">
            Shown under the GCash and bank details. Every portal order holds its stock for 4 hours until the reseller
            uploads a payment proof.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={open}
            onChange={(event) => setOpen(event.target.checked)}
          />
          <span>
            <span className="font-semibold">Accept new applications</span>
            <span className="block text-ink-500">
              Anyone with the link can apply. Nobody gets access until you approve them.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit" variant="confirm" disabled={busy || !location}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {link ? (
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true))
              }}
            >
              <Copy size={16} className="mr-2" />
              {copied ? 'Link copied' : 'Copy application link'}
            </Button>
          ) : (
            <span className="text-sm text-ink-500">
              Application link: /apply?b={admin.tenantSlug} on the reseller portal
            </span>
          )}
        </div>
      </form>
    </Glass>
  )
}

function ReviewCard({
  order,
  busy,
  onDecide,
}: {
  order: ResellerPortalAdmin['reviewQueue'][number]
  busy: boolean
  onDecide: (body: ResellerOrderReviewRequest) => void
}) {
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const proofs = order.paymentProofs ?? []
  const paidMinor = proofs
    .filter((proof) => proof.status !== 'rejected')
    .reduce((sum, proof) => sum + proof.amountMinor, 0)
  const balanceMinor = Math.max(0, order.totalMinor - paidMinor)
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  function decide(decision: 'approve' | 'reject') {
    const request = orderReviewRequest(decision, note)
    if (typeof request === 'string') return setProblem(request)
    setProblem(null)
    setActing(decision)
    onDecide(request)
  }
  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {order.orderNumber} · {order.customerName}
          </p>
          <p className="text-sm text-ink-500">
            {new Date(order.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} ·{' '}
            {order.fulfillmentMethod === 'pickup'
              ? `Pickup at ${order.locationName}`
              : `Deliver to ${order.deliveryAddress ?? '—'}`}{' '}
            · {order.paymentPreference === 'gcash' ? 'GCash' : 'Bank transfer'}
          </p>
        </div>
        <p className="text-h4">{formatPeso(order.totalMinor)}</p>
      </div>
      {order.reviewReason ? (
        <p className="rounded-control bg-signal-light-attention-bg px-3 py-2 text-sm text-signal-light-attention-fg">
          {reviewReasonText[order.reviewReason]}
        </p>
      ) : null}
      <table className="w-full text-sm">
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id} className="border-t border-ink-900/10">
              <td className="py-2">
                {line.productName} {line.variantName} <span className="text-ink-500">{line.sku}</span>
              </td>
              <td className="py-2 text-right">{line.orderedQuantityMilli / 1000}</td>
              <td className="py-2 text-right">{formatPeso(line.lineTotalMinor)}</td>
              <td className="py-2 pl-3 text-right">
                {line.stockStatus ? (
                  <Chip surface="light" tone={stockTone[line.stockStatus]}>
                    {stockText[line.stockStatus]}
                  </Chip>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.notes ? <p className="text-sm text-ink-600">Reseller note: {order.notes}</p> : null}
      {proofs.length ? (
        <div className="flex flex-col gap-2 rounded-control border border-ink-900/10 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <p className="font-semibold">Payment proofs</p>
            <p>
              Sent {formatPeso(paidMinor)} of {formatPeso(order.totalMinor)}
              {balanceMinor > 0 ? (
                <span className="text-signal-light-warning-fg"> · Balance {formatPeso(balanceMinor)}</span>
              ) : (
                <span className="text-signal-light-success-fg"> · Paid in full</span>
              )}
            </p>
          </div>
          <ul className="flex flex-wrap gap-3">
            {proofs.map((proof) => (
              <li key={proof.id} className="flex items-center gap-3 rounded-control bg-ink-900/5 p-2 pr-3 text-sm">
                <a
                  href={fileUrl(proof.url)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open payment proof ${proof.reference}`}
                >
                  {proof.thumbUrl ? (
                    <img
                      src={fileUrl(proof.thumbUrl)}
                      alt={`Payment proof ${proof.reference}`}
                      className="h-20 w-16 rounded-control object-cover"
                    />
                  ) : (
                    <span className="flex h-20 w-16 items-center justify-center rounded-control bg-white text-xs font-semibold">
                      PDF
                    </span>
                  )}
                </a>
                <span>
                  <span className="block font-semibold">{formatPeso(proof.amountMinor)}</span>
                  <span className="block text-ink-500">
                    {proof.method === 'gcash' ? 'GCash' : 'Bank'} · Ref {proof.reference}
                  </span>
                  {proof.status !== 'pending' ? (
                    <span className="block text-ink-500 capitalize">{proof.status}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-semibold">
          Note to reseller (required to reject)
          <input className={control} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <Button variant="confirm" disabled={busy} onClick={() => decide('approve')}>
          <Check size={16} className="mr-2" />
          {busy && acting === 'approve'
            ? 'Confirming…'
            : proofs.length
              ? 'Verify payment & confirm order'
              : 'Confirm order'}
        </Button>
        <Button disabled={busy} onClick={() => decide('reject')}>
          <X size={16} className="mr-2" />
          {busy && acting === 'reject' ? 'Rejecting…' : 'Reject order'}
        </Button>
      </div>
      {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
      <p className="text-caption text-ink-500">
        Check the amount and reference in your GCash or bank app first. Confirming verifies the proofs and reserves the
        stock; it does not record the payment. A remaining balance follows the reseller&apos;s payment terms and credit
        limit. Rejecting releases the stock and rejects the proofs.
      </p>
    </Glass>
  )
}

function ApplicationCard({
  application,
  admin,
  busy,
  onDecide,
}: {
  application: ResellerPortalAdmin['applications'][number]
  admin: ResellerPortalAdmin
  busy: boolean
  onDecide: (body: Exclude<ReturnType<typeof approvalRequest>, string>) => void
}) {
  const matchingCustomer = admin.resellerCustomers.find(
    (customer) => customer.email?.toLowerCase() === application.email.toLowerCase(),
  )
  const [form, setForm] = useState({
    customerId: matchingCustomer?.id ?? '',
    priceListId: admin.settings?.defaultPriceListId ?? '',
    paymentTerm: 'prepaid',
    creditLimit: '0',
    note: '',
  })
  const [problem, setProblem] = useState<string | null>(null)
  const pending = application.status === 'pending'

  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  function decide(decision: 'approve' | 'reject') {
    const request = decision === 'approve' ? approvalRequest(form) : rejectionRequest(form.note)
    if (typeof request === 'string') return setProblem(request)
    setProblem(null)
    setActing(decision)
    onDecide(request)
  }

  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {application.fullName}
            {application.businessName ? ` · ${application.businessName}` : ''}
          </p>
          <p className="text-sm text-ink-500">
            {application.email} · {application.phone}
            {application.city ? ` · ${application.city}` : ''}
          </p>
          {application.message ? <p className="mt-1 text-sm text-ink-700">“{application.message}”</p> : null}
        </div>
        <Chip surface="light" tone={pending ? 'info' : application.status === 'approved' ? 'success' : 'neutral'}>
          {pending ? 'Pending' : application.status === 'approved' ? 'Approved' : 'Rejected'}
        </Chip>
      </div>
      {pending ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Customer record
              <select
                className={control}
                value={form.customerId}
                onChange={(event) => setForm({ ...form, customerId: event.target.value })}
              >
                <option value="">Create a new reseller customer</option>
                {admin.resellerCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.fullName} ({customer.customerNumber})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Price list
              <select
                className={control}
                value={form.priceListId}
                onChange={(event) => setForm({ ...form, priceListId: event.target.value })}
              >
                <option value="">Choose…</option>
                {admin.priceLists.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Payment terms
              <select
                className={control}
                value={form.paymentTerm}
                onChange={(event) => setForm({ ...form, paymentTerm: event.target.value })}
              >
                {terms.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Credit limit (₱)
              <input
                className={control}
                inputMode="decimal"
                value={form.creditLimit}
                onChange={(event) => setForm({ ...form, creditLimit: event.target.value })}
              />
            </label>
          </div>
          <p className="text-caption text-ink-500">
            The credit limit caps confirmed orders whose payment is not yet recorded in Wholesale payments, even for
            prepaid terms. Verified proofs do not count until the payment is recorded, so set it at least as high as the
            orders you confirm before recording payment.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-semibold">
              Note (required to reject)
              <input
                className={control}
                maxLength={500}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </label>
            <Button variant="confirm" disabled={busy} onClick={() => decide('approve')}>
              <Check size={16} className="mr-2" />
              {busy && acting === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
            <Button disabled={busy} onClick={() => decide('reject')}>
              <X size={16} className="mr-2" />
              {busy && acting === 'reject' ? 'Rejecting…' : 'Reject'}
            </Button>
          </div>
          {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
        </>
      ) : application.decisionReason ? (
        <p className="text-sm text-ink-600">Note: {application.decisionReason}</p>
      ) : null}
    </Glass>
  )
}

function AccountsCard({
  admin,
  busy,
  onInvite,
  onStatus,
}: {
  admin: ResellerPortalAdmin
  busy: string | null
  onInvite: (body: unknown) => void
  onStatus: (accountId: string, status: 'active' | 'suspended') => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [email, setEmail] = useState('')
  const [priceListId, setPriceListId] = useState(admin.settings?.defaultPriceListId ?? '')
  const statusTone = { invited: 'info', active: 'success', suspended: 'neutral' } as const

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h4">Reseller accounts</h2>
      <Glass variant="data" className="overflow-x-auto rounded-panel">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-ink-500">
            <tr>
              <th className="px-4 py-3">Reseller</th>
              <th className="px-4 py-3">Sign-in email</th>
              <th className="px-4 py-3">Price list</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {admin.accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-ink-500">
                  No reseller accounts yet.
                </td>
              </tr>
            ) : (
              admin.accounts.map((account) => (
                <tr key={account.id} className="border-t border-ink-900/10">
                  <td className="px-4 py-3 font-semibold">
                    {account.customerName} <span className="font-normal text-ink-500">{account.customerNumber}</span>
                  </td>
                  <td className="px-4 py-3">{account.email}</td>
                  <td className="px-4 py-3">{account.priceListName}</td>
                  <td className="px-4 py-3">
                    <Chip surface="light" tone={statusTone[account.status]}>
                      {account.status === 'invited'
                        ? 'Invited, not signed in'
                        : account.status === 'active'
                          ? 'Active'
                          : 'Suspended'}
                    </Chip>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => onStatus(account.id, account.status === 'suspended' ? 'active' : 'suspended')}
                    >
                      {busy === `account:${account.id}`
                        ? 'Saving…'
                        : account.status === 'suspended'
                          ? 'Restore access'
                          : 'Suspend'}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Glass>
      {admin.resellerCustomers.length > 0 ? (
        <Glass variant="light" className="rounded-panel p-5">
          <form
            className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              onInvite({ customerId, email: email.trim(), priceListId })
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Invite an existing reseller
              <select
                className={control}
                required
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value)
                  setEmail(admin.resellerCustomers.find((customer) => customer.id === event.target.value)?.email ?? '')
                }}
              >
                <option value="">Choose a customer…</option>
                {admin.resellerCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.fullName} ({customer.customerNumber})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Sign-in email
              <input
                className={control}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Price list
              <select
                className={control}
                required
                value={priceListId}
                onChange={(event) => setPriceListId(event.target.value)}
              >
                <option value="">Choose…</option>
                {admin.priceLists.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="confirm" disabled={busy !== null}>
              <UserPlus size={16} className="mr-2" />
              {busy === 'invite' ? 'Inviting…' : 'Invite'}
            </Button>
          </form>
          <p className="mt-2 text-caption text-ink-500">
            Set credit settings in Wholesale credit before you confirm their orders.
          </p>
        </Glass>
      ) : null}
    </section>
  )
}
