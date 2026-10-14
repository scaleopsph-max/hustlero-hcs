import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { recoveryBuildEnv } from '../../recovery-build.mjs'
import {
  cases,
  diagnosticOwner,
  diagnosticTenant,
  diagnosticStorage,
  diagnosticDone,
  assertDiagnosticScope,
  readDiagnosticState,
  restoreDiagnosticCase,
  replayWithFault,
  finishDiagnostics,
  type DiagnosticEnvironment,
} from './staging-recovery-diagnostics'

const scope = { user: diagnosticOwner, tenant: diagnosticTenant }
const now = Date.parse('2026-10-14T05:00:00Z')
const env: DiagnosticEnvironment = {
  mode: 'historical-v1',
  until: '2026-10-14T06:00:00Z',
  origin: 'https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev',
  api: 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev',
  auth: 'https://sdfwdhbryjyfufgtfqmf.supabase.co',
  now,
}
function storage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
    removeItem: (k) => {
      data.delete(k)
    },
    clear: () => data.clear(),
    key: (n) => Array.from(data.keys())[n] ?? null,
  }
}
const fund = cases[1]
const fundContext = {
  canManage: true,
  funds: [],
  payments: [
    {
      paymentId: fund.body.paymentId,
      reference: 'Historical synthetic',
      amountMinor: 80000,
      allocation: fund.response,
    },
  ],
}
const request = { scope, path: fund.path, key: fund.key, body: fund.body }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

it.each(cases)('restores and recovers the exact $id fixture through its normal schema', async (fixture) => {
  const store = storage()
  const context =
    fixture.family === 'funds'
      ? fundContext
      : fixture.family === 'payment'
        ? {
            canRecord: true,
            invoices: [],
            paymentMethods: [],
            payments: [
              {
                ...fixture.response,
                customerName: 'Synthetic',
                paymentMethodName: 'Cash',
                reference: 'reference' in fixture.body ? fixture.body.reference : '',
                allocations:
                  'allocations' in fixture.body
                    ? fixture.body.allocations.map((a) => ({ ...a, invoiceNumber: 'INV-UAT' }))
                    : [],
              },
            ],
          }
        : 'order' in fixture
          ? {
              canManage: true,
              customers: [],
              locations: [],
              variants: [],
              inventory: [],
              priceLists: [],
              orders: [
                {
                  id: fixture.order,
                  orderNumber: 'Historical',
                  customerId: diagnosticTenant,
                  customerName: 'Synthetic',
                  locationId: diagnosticTenant,
                  locationName: 'Main',
                  priceListId: diagnosticTenant,
                  pricingType: 'wholesale',
                  status: 'cancelled',
                  notes: null,
                  subtotalMinor: 160000,
                  totalMinor: 160000,
                  confirmedAt: null,
                  createdAt: fixture.response.issuedAt,
                  lines: [],
                },
              ],
              invoices: [
                {
                  id: fixture.response.invoiceId,
                  invoiceNumber: fixture.response.invoiceNumber,
                  salesOrderId: fixture.order,
                  orderNumber: 'Historical',
                  saleId: fixture.response.saleId,
                  customerId: diagnosticTenant,
                  customerName: 'Synthetic',
                  locationId: diagnosticTenant,
                  locationName: 'Main',
                  totalMinor: 160000,
                  issuedAt: fixture.response.issuedAt,
                  lines: [],
                },
              ],
            }
          : null
  restoreDiagnosticCase(fixture.id, scope, context, store, env)
  const command = { scope, path: fixture.path, key: fixture.key, body: fixture.body }
  const send = vi.fn(async () => fixture.response)
  await expect(replayWithFault(command, send, store, env)).rejects.toThrow(/withheld once/)
  await expect(replayWithFault(command, send, store, env)).resolves.toEqual(fixture.response)
  expect(send).toHaveBeenCalledTimes(2)
})

it('reconstructs four original actor-bound hashes without a credential or request', () => {
  for (const fixture of cases) {
    const input =
      'order' in fixture
        ? { salesOrderId: fixture.order, ...fixture.body, userId: diagnosticOwner }
        : { userId: diagnosticOwner, ...fixture.body }
    expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(fixture.hash)
  }
})
it('normal build is off and diagnostic build refuses wrong environment/window', () => {
  expect(recoveryBuildEnv({}, now)).toEqual({
    NEXT_PUBLIC_HCS_RECOVERY_UAT: 'off',
    NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: '',
  })
  const config = {
    NEXT_PUBLIC_HCS_RECOVERY_UAT: 'historical-v1',
    NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: env.until,
    CLOUDFLARE_ENV: 'staging',
    NEXT_PUBLIC_API_URL: env.api,
    NEXT_PUBLIC_SUPABASE_URL: env.auth,
  }
  expect(recoveryBuildEnv(config, now).NEXT_PUBLIC_HCS_RECOVERY_UAT).toBe('historical-v1')
  for (const delta of [
    { CLOUDFLARE_ENV: 'production' },
    { NEXT_PUBLIC_API_URL: 'https://production.invalid' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' },
    { NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: 'invalid' },
    { NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: new Date(now + 3600001).toISOString() },
    { NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: new Date(now).toISOString() },
  ])
    expect(() => recoveryBuildEnv({ ...config, ...delta }, now)).toThrow()
})
it.each([
  { mode: 'off' },
  { origin: 'http://localhost:3001' },
  { api: 'https://hustlero-hcs-api.scaleopsph.workers.dev' },
  { auth: 'https://production.supabase.co' },
  { until: '' },
  { now: now - 1 },
  { now: now + 3600000 },
])('rejects runtime environment %j', (delta) => {
  expect(() => assertDiagnosticScope(scope, { ...env, ...delta })).toThrow()
})
it.each([
  { user: 'other', tenant: diagnosticTenant },
  { user: diagnosticOwner, tenant: 'other' },
])('rejects changed actor/tenant %j', (other) => expect(() => assertDiagnosticScope(other, env)).toThrow())
it('restores fixed pending, preserves unrelated storage and refuses occupied slot', () => {
  const store = storage()
  store.setItem('unrelated', 'private value')
  restoreDiagnosticCase('funds', scope, fundContext, store, env)
  expect(JSON.parse(store.getItem(fund.storage)!)).toEqual({ key: fund.key, payload: fund.body })
  expect(store.getItem('unrelated')).toBe('private value')
  expect(() => restoreDiagnosticCase('funds', scope, fundContext, store, env)).toThrow(/overwritten/)
  expect(() => restoreDiagnosticCase('unknown', scope, fundContext, storage(), env)).toThrow()
})
it('refuses wrong history/read-only context before storage writes', () => {
  const store = storage()
  for (const context of [
    { ...fundContext, canManage: false },
    { ...fundContext, payments: [] },
    { ...fundContext, payments: [{ ...fundContext.payments[0], allocation: { ...fund.response, capitalMinor: 1 } }] },
  ])
    expect(() => restoreDiagnosticCase('funds', scope, context, store, env)).toThrow()
  expect(store.length).toBe(0)
})
it('refuses existing payment/order/legacy slots including empty records', () => {
  for (const fixture of cases) {
    const keys = [fixture.storage, ...('legacyStorage' in fixture ? [fixture.legacyStorage] : [])]
    for (const key of keys) {
      const store = storage()
      store.setItem(key, '')
      expect(() => restoreDiagnosticCase('funds', scope, fundContext, store, env)).toThrow(/overwritten/)
      expect(store.getItem(key)).toBe('')
    }
  }
})
it('withholds once, preserves pending across restoration, returns exact original once, then rejects a third request', async () => {
  const store = storage()
  restoreDiagnosticCase('funds', scope, fundContext, store, env)
  const original = store.getItem(fund.storage)
  const send = vi.fn(async () => fund.response)
  await expect(replayWithFault(request, send, store, env)).rejects.toThrow(/withheld once/)
  expect(store.getItem(fund.storage)).toBe(original)
  expect(readDiagnosticState(store, env).entries.funds).toEqual({ attempts: 1, faulted: true, completed: false })
  await expect(replayWithFault(request, send, store, env)).resolves.toEqual(fund.response)
  expect(readDiagnosticState(store, env).entries.funds).toEqual({ attempts: 2, faulted: true, completed: true })
  await expect(replayWithFault(request, send, store, env)).rejects.toThrow(/budget/)
  expect(send).toHaveBeenCalledTimes(2)
})
it.each([{ key: 'different-key' }, { path: '/v1/wholesale/orders' }, { body: { ...fund.body, capitalMinor: 50001 } }])(
  'denies changed command %j before transport',
  async (delta) => {
    const store = storage()
    restoreDiagnosticCase('funds', scope, fundContext, store, env)
    const send = vi.fn(async () => fund.response)
    await expect(replayWithFault({ ...request, ...delta }, send, store, env)).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  },
)
it('retains pending and refuses another send after uncertain transport or mismatched response', async () => {
  for (const send of [
    async () => {
      throw new Error('network failed')
    },
    async () => ({ ...fund.response, capitalMinor: 1 }),
  ]) {
    const store = storage()
    restoreDiagnosticCase('funds', scope, fundContext, store, env)
    const original = store.getItem(fund.storage)
    await expect(replayWithFault(request, send, store, env)).rejects.toThrow()
    const retry = vi.fn(async () => fund.response)
    await expect(replayWithFault(request, retry, store, env)).rejects.toThrow(/budget/)
    expect(retry).not.toHaveBeenCalled()
    expect(store.getItem(fund.storage)).toBe(original)
  }
})
it('rejects corrupt counters/changed expiry/finished marker and premature cleanup', () => {
  const store = storage()
  store.setItem(diagnosticStorage, '')
  expect(() => readDiagnosticState(store, env)).toThrow()
  store.removeItem(diagnosticStorage)
  restoreDiagnosticCase('funds', scope, fundContext, store, env)
  expect(() => readDiagnosticState(store, { ...env, until: '2026-10-14T05:59:00Z' })).toThrow()
  expect(() => finishDiagnostics(scope, store, env)).toThrow(/Unresolved/)
  store.setItem(diagnosticDone, 'finished')
  expect(() => readDiagnosticState(store, env)).toThrow(/finished/)
})
it('eight is the aggregate budget; cleanup preserves unrelated keys and prevents rearming', () => {
  const store = storage()
  const state = readDiagnosticState(store, env)
  for (const entry of Object.values(state.entries))
    Object.assign(entry, { attempts: 2, faulted: true, completed: true })
  store.setItem(diagnosticStorage, JSON.stringify(state))
  store.setItem('unrelated', 'keep')
  expect(Object.values(readDiagnosticState(store, env).entries).reduce((n, e) => n + e.attempts, 0)).toBe(8)
  finishDiagnostics(scope, store, env)
  expect(store.getItem(diagnosticStorage)).toBeNull()
  expect(store.getItem('unrelated')).toBe('keep')
  expect(() => restoreDiagnosticCase('funds', scope, fundContext, store, env)).toThrow(/finished/)
})
