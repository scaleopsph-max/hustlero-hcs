import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { recoveryBuildEnv } from '../../recovery-build.mjs'
import { diagnosticOwner, diagnosticTenant, type DiagnosticEnvironment } from './staging-recovery-policy'
import {
  freshPaymentBody,
  freshFundBody,
  freshStorage,
  freshDone,
  paymentSlot,
  fundSlot,
  readFreshState,
  armFreshCase,
  freshRequestWithFault,
  finishFreshCases,
} from './staging-fresh-recovery'

const scope = { user: diagnosticOwner, tenant: diagnosticTenant }
const now = Date.parse('2026-10-14T06:00:00Z')
const env: DiagnosticEnvironment = {
  mode: 'fresh-payment-funds-v1',
  until: '2026-10-14T07:00:00Z',
  origin: 'https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev',
  api: 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev',
  auth: 'https://sdfwdhbryjyfufgtfqmf.supabase.co',
  now,
}
const key = 'wholesale-payment-11111111-1111-4111-8111-111111111111'
const fundKey = '22222222-2222-4222-8222-222222222222'
const newReceipt = '33333333-3333-4333-8333-333333333333'
const oldReceipt = '374ffa4a-1fa7-4220-ad2a-36b90c41c8f6'
const paymentResult = {
  paymentId: newReceipt,
  customerId: freshPaymentBody.customerId,
  amountMinor: 160000,
  allocationCount: 1,
  recordedAt: '2026-10-14T06:00:00Z',
}
const fundResult = {
  paymentId: newReceipt,
  capitalMinor: 100000,
  operatingMinor: 60000,
  recordedAt: '2026-10-14T06:01:00Z',
}
const context = {
  canRecord: true,
  invoices: [
    {
      invoiceId: freshPaymentBody.allocations[0]!.invoiceId,
      invoiceNumber: 'INV-20261012-000001',
      customerId: freshPaymentBody.customerId,
      customerName: 'Synthetic',
      locationId: diagnosticTenant,
      locationName: 'Main',
      totalMinor: 160000,
      classification: 'invoice',
      eligibleForOpening: false,
      openBalanceMinor: 160000,
      dueDate: '2026-10-19',
      canAllocate: true,
    },
  ],
  paymentMethods: [{ id: freshPaymentBody.paymentMethodId, name: 'Cash' }],
  payments: [
    {
      paymentId: oldReceipt,
      customerId: freshPaymentBody.customerId,
      customerName: 'Synthetic',
      paymentMethodName: 'Cash',
      amountMinor: 80000,
      reference: 'Historical synthetic',
      recordedAt: '2026-10-12T00:00:00Z',
      allocations: [
        { invoiceId: freshPaymentBody.allocations[0]!.invoiceId, invoiceNumber: 'Old fixture', amountMinor: 80000 },
      ],
    },
  ],
}
const fundsContext = {
  canManage: true,
  funds: [
    { fundType: 'capital_cogs', name: 'Capital', balanceMinor: 50000 },
    { fundType: 'operating', name: 'Operating', balanceMinor: 30000 },
  ],
  payments: [{ paymentId: newReceipt, reference: freshPaymentBody.reference, amountMinor: 160000, allocation: null }],
}
function storage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (n) => Array.from(map.keys())[n] ?? null,
  }
}
const paymentRequest = { scope, path: '/v1/wholesale/payments', key, body: freshPaymentBody }
const fundRequest = { scope, path: '/v1/wholesale/funds', key: fundKey, body: freshFundBody(newReceipt) }
function persistPayment(store: Storage) {
  store.setItem(paymentSlot, JSON.stringify({ key, request: freshPaymentBody }))
}
function persistFund(store: Storage) {
  store.setItem(fundSlot, JSON.stringify({ key: fundKey, payload: freshFundBody(newReceipt) }))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

it('fresh opt-in builds require the same exact Staging endpoint/window guard', () => {
  const config = {
    CLOUDFLARE_ENV: 'staging',
    NEXT_PUBLIC_HCS_RECOVERY_UAT: env.mode,
    NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: env.until,
    NEXT_PUBLIC_API_URL: env.api,
    NEXT_PUBLIC_SUPABASE_URL: env.auth,
  }
  expect(recoveryBuildEnv(config, now).NEXT_PUBLIC_HCS_RECOVERY_UAT).toBe(env.mode)
  expect(() => recoveryBuildEnv({ ...config, CLOUDFLARE_ENV: 'production' }, now)).toThrow()
  expect(recoveryBuildEnv({}, now).NEXT_PUBLIC_HCS_RECOVERY_UAT).toBe('off')
})
it('arming never seeds application pending or Auth records; the normal form must persist first', async () => {
  const store = storage()
  store.setItem('unrelated-auth-like-test-key', 'dummy-not-a-credential')
  armFreshCase('payment', scope, context, store, env)
  expect(store.getItem(paymentSlot)).toBeNull()
  expect(store.getItem(fundSlot)).toBeNull()
  expect(store.getItem('unrelated-auth-like-test-key')).toBe('dummy-not-a-credential')
  const send = vi.fn(async () => paymentResult)
  await expect(freshRequestWithFault(paymentRequest, send, store, env)).rejects.toThrow(/persist/)
  expect(send).not.toHaveBeenCalled()
})
it('fresh payment and dependent funds withhold first committed results and replay exactly once each', async () => {
  const store = storage()
  armFreshCase('payment', scope, context, store, env)
  persistPayment(store)
  let receipts = 0
  let allocations = 0
  const committed = new Map<string, unknown>()
  const paymentSend = vi.fn(async () => {
    if (!committed.has(key)) {
      receipts++
      committed.set(key, paymentResult)
    }
    return committed.get(key)
  })
  await expect(freshRequestWithFault(paymentRequest, paymentSend, store, env)).rejects.toThrow(
    /first fresh success withheld/,
  )
  expect(readFreshState(store, env).payment?.phase).toBe('withheld')
  expect(store.getItem(paymentSlot)).not.toBeNull()
  await expect(freshRequestWithFault(paymentRequest, paymentSend, store, env)).resolves.toEqual(paymentResult)
  expect(receipts).toBe(1)
  expect(() => armFreshCase('funds', scope, fundsContext, store, env)).toThrow(/overwritten/)
  // The real workspace clears this only after authorized receipt-history validation.
  store.removeItem(paymentSlot)
  armFreshCase('funds', scope, fundsContext, store, env)
  persistFund(store)
  const fundSend = vi.fn(async () => {
    if (!committed.has(fundKey)) {
      allocations++
      committed.set(fundKey, fundResult)
    }
    return committed.get(fundKey)
  })
  await expect(freshRequestWithFault(fundRequest, fundSend, store, env)).rejects.toThrow(/first fresh success withheld/)
  await expect(freshRequestWithFault(fundRequest, fundSend, store, env)).resolves.toEqual(fundResult)
  expect(allocations).toBe(1)
  expect(paymentSend).toHaveBeenCalledTimes(2)
  expect(fundSend).toHaveBeenCalledTimes(2)
  expect(() => finishFreshCases(scope, store, env)).toThrow(/Unresolved/)
  store.removeItem(fundSlot)
  finishFreshCases(scope, store, env)
  expect(store.getItem(freshStorage)).toBeNull()
  expect(store.getItem(freshDone)).not.toBeNull()
  expect(() => armFreshCase('payment', scope, context, store, env)).toThrow(/finished/)
})
it.each([
  { mode: 'historical-v1' },
  { mode: 'off' },
  { origin: 'http://localhost:3001' },
  { api: 'https://production.invalid' },
  { auth: 'https://production.invalid' },
  { now: now - 1 },
  { now: now + 3600000 },
])('rejects wrong runtime scope %j before arming', (delta) =>
  expect(() => armFreshCase('payment', scope, context, storage(), { ...env, ...delta })).toThrow(),
)
it.each([
  { user: 'other', tenant: diagnosticTenant },
  { user: diagnosticOwner, tenant: 'other' },
])('rejects changed account/business %j', (other) =>
  expect(() => armFreshCase('payment', other, context, storage(), env)).toThrow(),
)
it('rejects historical-only/order modes, changed history/balance/method and preexisting pending', () => {
  expect(() => armFreshCase('orders', scope, context, storage(), env)).toThrow()
  for (const data of [
    { ...context, canRecord: false },
    { ...context, paymentMethods: [] },
    { ...context, invoices: [{ ...context.invoices[0], openBalanceMinor: 159999 }] },
    { ...context, payments: [{ ...context.payments[0], reference: freshPaymentBody.reference }] },
  ])
    expect(() => armFreshCase('payment', scope, data, storage(), env)).toThrow()
  const store = storage()
  store.setItem(paymentSlot, '')
  expect(() => armFreshCase('payment', scope, context, store, env)).toThrow()
  expect(store.getItem(paymentSlot)).toBe('')
})
it.each([
  { key: 'wholesale-payment-44444444-4444-4444-8444-444444444444' },
  { body: { ...freshPaymentBody, amountMinor: 160001 } },
  { path: '/v1/wholesale/orders' },
  { body: { ...freshPaymentBody, reference: 'changed' } },
])('rejects altered request %j before transport', async (delta) => {
  const store = storage()
  armFreshCase('payment', scope, context, store, env)
  persistPayment(store)
  const send = vi.fn(async () => paymentResult)
  await expect(freshRequestWithFault({ ...paymentRequest, ...delta }, send, store, env)).rejects.toThrow()
  expect(send).not.toHaveBeenCalled()
})
it('unknown first transport or mismatched/historical success cannot be retried under the diagnostic budget', async () => {
  for (const send of [
    async () => {
      throw new Error('lost before status')
    },
    async () => ({ ...paymentResult, amountMinor: 1 }),
    async () => ({ ...paymentResult, paymentId: oldReceipt }),
  ]) {
    const store = storage()
    armFreshCase('payment', scope, context, store, env)
    persistPayment(store)
    const original = store.getItem(paymentSlot)
    await expect(freshRequestWithFault(paymentRequest, send, store, env)).rejects.toThrow()
    const retry = vi.fn(async () => paymentResult)
    await expect(freshRequestWithFault(paymentRequest, retry, store, env)).rejects.toThrow()
    expect(retry).not.toHaveBeenCalled()
    expect(store.getItem(paymentSlot)).toBe(original)
  }
})
it('second-response mismatch leaves visible retrying evidence and the original pending identity', async () => {
  const store = storage()
  armFreshCase('payment', scope, context, store, env)
  persistPayment(store)
  await expect(freshRequestWithFault(paymentRequest, async () => paymentResult, store, env)).rejects.toThrow(/withheld/)
  await expect(
    freshRequestWithFault(paymentRequest, async () => ({ ...paymentResult, paymentId: oldReceipt }), store, env),
  ).rejects.toThrow(/identity differs/)
  expect(readFreshState(store, env).payment?.phase).toBe('retrying')
  expect(store.getItem(paymentSlot)).not.toBeNull()
  const send = vi.fn(async () => paymentResult)
  await expect(freshRequestWithFault(paymentRequest, send, store, env)).rejects.toThrow()
  expect(send).not.toHaveBeenCalled()
})
it('funds cannot start without recovered payment, and corrupt counters remain untouched', () => {
  const store = storage()
  expect(() => armFreshCase('funds', scope, fundsContext, store, env)).toThrow(/Recover/)
  store.setItem(freshStorage, '')
  expect(() => readFreshState(store, env)).toThrow()
  expect(store.getItem(freshStorage)).toBe('')
  store.removeItem(freshStorage)
  armFreshCase('payment', scope, context, store, env)
  expect(() => readFreshState(store, { ...env, until: '2026-10-14T06:59:00Z' })).toThrow()
})
