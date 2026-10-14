import { z } from 'zod'
import {
  wholesaleFundsContextSchema,
  wholesalePaymentsContextSchema,
  wholesaleOrderContextSchema,
} from '@hcs/contracts'
import { restoreWholesalePayment, validateWholesalePaymentReceipt } from './wholesale-payment'
import { restoreFundAllocation } from './wholesale-funds'
import { restoreOrderAction } from './wholesale-order-actions'
import type { RecoveryRequest, RecoveryScope, RecoveryFamily } from './staging-recovery-entry'

export const diagnosticOwner = 'd4bc81e3-3391-4106-88c7-b256661d8f71'
export const diagnosticTenant = 'b3a4f304-7d38-46fe-831e-db0370f9d0c3'
const receipt = '374ffa4a-1fa7-4220-ad2a-36b90c41c8f6'
const customer = '5a3fdf97-3259-42e4-a340-86f045998b35'
const method = 'fc75965f-b614-4a78-a1c1-562a7aad21b5'
const ownerScope = `${diagnosticOwner}:${diagnosticTenant}`
export const diagnosticStorage = `hcs:recovery-uat:historical-v1:${ownerScope}`
export const diagnosticDone = `${diagnosticStorage}:finished`

export const cases = [
  {
    id: 'payment',
    family: 'payment',
    key: 'wholesale-payment-abe311b9-6e33-423d-9335-cbd32067e17b',
    path: '/v1/wholesale/payments',
    storage: `hcs:wholesale-payment:${diagnosticTenant}:${diagnosticOwner}`,
    body: {
      customerId: customer,
      paymentMethodId: method,
      amountMinor: 80000,
      reference: 'AW3-UAT-PARTIAL-20261012',
      allocations: [{ invoiceId: '91733d8e-b0a8-496f-835d-6ec32e8ee191', amountMinor: 80000 }],
    },
    hash: 'b9afed9686e389cdb067b9c05cbc0601e612eb60cbf84bfdc4cc3f3bc6925ec6',
    response: {
      paymentId: receipt,
      customerId: customer,
      recordedAt: '2026-10-12T00:16:28.455255+00:00',
      amountMinor: 80000,
      allocationCount: 1,
    },
  },
  {
    id: 'funds',
    family: 'funds',
    key: 'uat-fund-recovery-20261013-800-500-300',
    path: '/v1/wholesale/funds',
    storage: `hcs-wholesale-funds:${ownerScope}`,
    body: {
      paymentId: receipt,
      capitalMinor: 50000,
      operatingMinor: 30000,
      settledConfirmed: true,
      settlementReference: 'AW3-SYNTHETIC-SETTLED-20261013',
      reason: 'Owner-approved synthetic Staging recovery UAT; no real settlement or Production money',
    },
    hash: '14442a1986e36e9f3eb90980821a7e180f32ec6fea2dd4e5b1768c44f980d2ff',
    response: {
      paymentId: receipt,
      recordedAt: '2026-10-13T07:01:03.35535+00:00',
      capitalMinor: 50000,
      operatingMinor: 30000,
    },
  },
  ...[
    {
      id: 'cod',
      order: 'f57cb63f-46cb-4c46-bf4e-d813639e4a0d',
      line: '79be78ed-d324-4fd0-95d6-6b7fa2a40f55',
      key: '8dc7f7a4-c51a-4b8f-bdee-1b3583a7da40',
      reference: 'AW3-UAT-COD-20261012',
      hash: 'f373704fee9fab125e83d2b21f3ef68df095afbab4e0a65ffcd5039a6569f598',
      saleId: '77fd6c9b-7f92-441b-a84d-f9b64a75110e',
      invoiceId: 'b6ca6bf8-3b48-4e27-b7d8-17aba275b385',
      invoiceNumber: 'INV-20261012-000002',
      issuedAt: '2026-10-12T12:44:11.167502+00:00',
    },
    {
      id: 'prepaid',
      order: 'b9bc46f4-1aad-4d0c-a457-155d28fec90d',
      line: 'bf239a7d-d5d0-488e-a446-7cb939dbb0c5',
      key: 'dac38357-f2ef-4e8e-b3d1-db742603df69',
      reference: 'AW3-UAT-PREPAID-20261012',
      hash: '0071979f86a9c298dcdd5ca0006f0e66a0ec2b58253a0e5ab20c5de3828a345d',
      saleId: '006dc696-1d05-4572-81d2-6f4a82e4cc36',
      invoiceId: '81f8d91e-ccc6-4a99-85da-c2a5d038964e',
      invoiceNumber: 'INV-20261012-000003',
      issuedAt: '2026-10-12T12:45:46.713918+00:00',
    },
  ].map((p) => ({
    id: p.id,
    family: 'orders',
    key: p.key,
    path: `/v1/wholesale/orders/${p.order}/fulfill`,
    storage: `hcs-wholesale-order-action:${ownerScope}`,
    legacyStorage: `hcs-paid-fulfillment:${ownerScope}`,
    order: p.order,
    body: {
      payment: { paymentMethodId: method, amountMinor: 160000, reference: p.reference },
      lines: [{ salesOrderLineId: p.line, quantityMilli: 2000 }],
    },
    hash: p.hash,
    response: {
      saleId: p.saleId,
      issuedAt: p.issuedAt,
      invoiceId: p.invoiceId,
      totalMinor: 160000,
      orderStatus: 'partially_fulfilled',
      salesOrderId: p.order,
      invoiceNumber: p.invoiceNumber,
      fulfilledQuantityMilli: 2000,
    },
  })),
] as const
export type RecoveryCase = (typeof cases)[number]
const counter = z.strictObject({
  attempts: z.number().int().min(0).max(2),
  faulted: z.boolean(),
  completed: z.boolean(),
})
const stateSchema = z.strictObject({
  until: z.string(),
  entries: z.strictObject({ payment: counter, funds: counter, cod: counter, prepaid: counter }),
})
export type DiagnosticState = z.infer<typeof stateSchema>
export type DiagnosticEnvironment = {
  mode: string | undefined
  until: string | undefined
  origin: string
  api: string | undefined
  auth: string | undefined
  now: number
}
export const environment = (): DiagnosticEnvironment => ({
  mode: process.env.NEXT_PUBLIC_HCS_RECOVERY_UAT,
  until: process.env.NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL,
  origin: window.location.origin,
  api: process.env.NEXT_PUBLIC_API_URL,
  auth: process.env.NEXT_PUBLIC_SUPABASE_URL,
  now: Date.now(),
})

export function assertDiagnosticScope(scope: RecoveryScope, env: DiagnosticEnvironment) {
  const until = Date.parse(env.until ?? '')
  if (
    env.mode !== 'historical-v1' ||
    env.origin !== 'https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev' ||
    env.api !== 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev' ||
    env.auth !== 'https://sdfwdhbryjyfufgtfqmf.supabase.co' ||
    scope.user !== diagnosticOwner ||
    scope.tenant !== diagnosticTenant ||
    !Number.isFinite(until) ||
    env.now >= until ||
    env.now < until - 3600000
  )
    throw new Error('Recovery diagnostics are unavailable for this scope or window.')
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export function readDiagnosticState(store: Storage, env: DiagnosticEnvironment): DiagnosticState {
  if (store.getItem(diagnosticDone) !== null) throw new Error('Diagnostic batch already finished.')
  const raw = store.getItem(diagnosticStorage)
  if (raw === null)
    return {
      until: env.until ?? '',
      entries: {
        payment: { attempts: 0, faulted: false, completed: false },
        funds: { attempts: 0, faulted: false, completed: false },
        cod: { attempts: 0, faulted: false, completed: false },
        prepaid: { attempts: 0, faulted: false, completed: false },
      },
    }
  const state = stateSchema.parse(JSON.parse(raw))
  if (
    state.until !== env.until ||
    Object.values(state.entries).some(
      (e) => (e.completed && (!e.faulted || e.attempts !== 2)) || (e.faulted && e.attempts === 0),
    )
  )
    throw new Error('Diagnostic counters need reconciliation.')
  return state
}
function pendingRecord(fixture: RecoveryCase) {
  return fixture.family === 'payment'
    ? { key: fixture.key, request: fixture.body }
    : fixture.family === 'funds'
      ? { key: fixture.key, payload: fixture.body }
      : { kind: 'fulfill', orderId: 'order' in fixture ? fixture.order : '', key: fixture.key, payload: fixture.body }
}
export function verifyContext(fixture: RecoveryCase, context: unknown) {
  if (fixture.family === 'payment') {
    const data = wholesalePaymentsContextSchema.parse(context)
    if (!data.canRecord) throw new Error('Payment permission required.')
    validateWholesalePaymentReceipt(restoreWholesalePayment(JSON.stringify(pendingRecord(fixture)))!, receipt, data)
  } else if (fixture.family === 'funds') {
    const data = wholesaleFundsContextSchema.parse(context)
    if (
      !data.canManage ||
      canonical(data.payments.find((p) => p.paymentId === receipt)?.allocation) !== canonical(fixture.response)
    )
      throw new Error('Historical allocation context differs.')
  } else {
    const data = wholesaleOrderContextSchema.parse(context)
    if (
      !data.canManage ||
      !('order' in fixture) ||
      data.orders.find((o) => o.id === fixture.order)?.status !== 'cancelled' ||
      !data.invoices.some((i) => i.id === fixture.response.invoiceId)
    )
      throw new Error('Historical cancelled delivery context differs.')
  }
}
export function restoreDiagnosticCase(
  id: string,
  scope: RecoveryScope,
  context: unknown,
  store: Storage = sessionStorage,
  env = environment(),
) {
  assertDiagnosticScope(scope, env)
  const fixture = cases.find((c) => c.id === id)
  if (!fixture) throw new Error('Unknown historical case.')
  verifyContext(fixture, context)
  const state = readDiagnosticState(store, env)
  if (state.entries[fixture.id as keyof DiagnosticState['entries']].attempts !== 0)
    throw new Error('Historical case already started; retry its original pending command.')
  if (
    cases.some(
      (c) => store.getItem(c.storage) !== null || ('legacyStorage' in c && store.getItem(c.legacyStorage) !== null),
    )
  )
    throw new Error('Existing pending command must not be overwritten.')
  const value = JSON.stringify(pendingRecord(fixture))
  if (fixture.family === 'payment') restoreWholesalePayment(value)
  else if (fixture.family === 'funds') restoreFundAllocation(value)
  else restoreOrderAction(value, null)
  store.setItem(diagnosticStorage, JSON.stringify(state))
  store.setItem(fixture.storage, value)
}
export async function replayWithFault(
  request: RecoveryRequest,
  send: () => Promise<unknown>,
  store: Storage = sessionStorage,
  env = environment(),
) {
  assertDiagnosticScope(request.scope, env)
  const fixture = cases.find(
    (c) => c.key === request.key && c.path === request.path && canonical(c.body) === canonical(request.body),
  )
  if (!fixture || store.getItem(fixture.storage) !== JSON.stringify(pendingRecord(fixture)))
    throw new Error('Only the exact restored historical command may be replayed.')
  const state = readDiagnosticState(store, env)
  if (store.getItem(diagnosticStorage) === null) throw new Error('Diagnostic restoration required.')
  const count = state.entries[fixture.id as keyof DiagnosticState['entries']]
  if (
    count.attempts >= 2 ||
    (count.attempts === 1 && !count.faulted) ||
    count.completed ||
    Object.values(state.entries).reduce((n, e) => n + e.attempts, 0) >= 8
  )
    throw new Error('Approved diagnostic request budget exhausted.')
  count.attempts++
  store.setItem(diagnosticStorage, JSON.stringify(state))
  const result = await send()
  assertDiagnosticScope(request.scope, { ...env, now: Date.now() })
  if (canonical(result) !== canonical(fixture.response))
    throw new Error('Historical server response differs; stop for reconciliation.')
  if (!count.faulted) {
    count.faulted = true
    store.setItem(diagnosticStorage, JSON.stringify(state))
    throw new Error(
      'Staging UAT: matching historical response withheld once. Reload, then retry the original pending command.',
    )
  }
  count.completed = true
  store.setItem(diagnosticStorage, JSON.stringify(state))
  return result
}
export function finishDiagnostics(scope: RecoveryScope, store: Storage = sessionStorage, env = environment()) {
  assertDiagnosticScope(scope, env)
  const state = readDiagnosticState(store, env)
  if (
    !Object.values(state.entries).every((e) => e.completed) ||
    cases.some(
      (c) => store.getItem(c.storage) !== null || ('legacyStorage' in c && store.getItem(c.legacyStorage) !== null),
    )
  )
    throw new Error('Unresolved recovery; diagnostic cleanup refused.')
  store.setItem(diagnosticDone, env.until ?? '')
  store.removeItem(diagnosticStorage)
}
export function familyCases(family: RecoveryFamily) {
  return cases.filter((c) => c.family === family)
}
