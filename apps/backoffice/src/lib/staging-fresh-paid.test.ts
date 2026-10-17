import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoveryBuildEnv } from '../../recovery-build.mjs'
import { diagnosticOwner, diagnosticTenant, type DiagnosticEnvironment } from './staging-recovery-policy'
import {
  paidPlan,
  paidOrderNumber,
  paidCases,
  paidBody,
  paidSlot,
  paidStorage,
  paidDone,
  armPaidCase,
  freshPaidRequest,
  readPaidState,
  closePaidCase,
  finishPaidCases,
  type PaidCase,
} from './staging-fresh-paid'
const scope = { user: diagnosticOwner, tenant: diagnosticTenant }
const now = Date.parse('2026-10-14T10:30:00Z')
const env: DiagnosticEnvironment = {
  mode: 'fresh-paid-v1',
  until: '2026-10-14T11:30:00Z',
  origin: 'https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev',
  api: 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev',
  auth: 'https://sdfwdhbryjyfufgtfqmf.supabase.co',
  now,
}
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
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
    key: (n) => [...map.keys()][n] ?? null,
  }
}
function fixture(id: PaidCase) {
  const orderId = uuid(id === 'cod' ? 1 : 2),
    lineId = uuid(id === 'cod' ? 3 : 4),
    otherId = uuid(id === 'cod' ? 5 : 6)
  const result = {
    salesOrderId: orderId,
    orderStatus: 'partially_fulfilled',
    invoiceId: uuid(id === 'cod' ? 7 : 8),
    invoiceNumber: `SYN-${id}`,
    saleId: uuid(id === 'cod' ? 9 : 10),
    fulfilledQuantityMilli: 1000,
    totalMinor: 80000,
    issuedAt: '2026-10-14T10:30:00Z',
  }
  const order = {
    id: orderId,
    orderNumber: paidOrderNumber(id),
    customerId: paidPlan.customer,
    customerName: 'Synthetic',
    locationId: paidPlan.location,
    locationName: 'Main',
    priceListId: paidPlan.priceList,
    pricingType: 'wholesale',
    status: 'draft',
    notes: paidPlan.reason,
    subtotalMinor: 480000,
    totalMinor: 480000,
    confirmedAt: null,
    createdAt: result.issuedAt,
    lines: [
      {
        id: lineId,
        variantId: paidPlan.first,
        productName: 'Synthetic',
        variantName: 'First',
        sku: 'P-00001',
        orderedQuantityMilli: 2000,
        fulfilledQuantityMilli: 0,
        cancelledQuantityMilli: 0,
        unitPriceMinor: 80000,
        lineTotalMinor: 160000,
      },
      {
        id: otherId,
        variantId: paidPlan.second,
        productName: 'Synthetic',
        variantName: 'Second',
        sku: 'P-00002',
        orderedQuantityMilli: 4000,
        fulfilledQuantityMilli: 0,
        cancelledQuantityMilli: 0,
        unitPriceMinor: 80000,
        lineTotalMinor: 320000,
      },
    ],
  }
  const context = {
    canManage: true,
    customers: [],
    locations: [],
    variants: [],
    priceLists: [],
    inventory: [
      {
        locationId: paidPlan.location,
        variantId: paidPlan.first,
        onHandMilli: id === 'cod' ? 3000 : 2000,
        availableMilli: id === 'cod' ? 3000 : 2000,
        reservedMilli: 0,
      },
      {
        locationId: paidPlan.location,
        variantId: paidPlan.second,
        onHandMilli: 4000,
        availableMilli: 4000,
        reservedMilli: 0,
      },
      {
        locationId: paidPlan.branch,
        variantId: paidPlan.second,
        onHandMilli: 2000,
        availableMilli: 2000,
        reservedMilli: 0,
      },
    ],
    orders: [order],
    invoices: [],
  }
  const invoice = {
    id: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    salesOrderId: orderId,
    orderNumber: order.orderNumber,
    saleId: result.saleId,
    customerId: paidPlan.customer,
    customerName: 'Synthetic',
    locationId: paidPlan.location,
    locationName: 'Main',
    totalMinor: 80000,
    issuedAt: result.issuedAt,
    lines: [
      {
        id: uuid(11),
        salesOrderLineId: lineId,
        saleLineId: uuid(12),
        variantId: paidPlan.first,
        productName: 'Synthetic',
        variantName: 'First',
        sku: 'P-00001',
        quantityMilli: 1000,
        unitPriceMinor: 80000,
        lineTotalMinor: 80000,
      },
    ],
  }
  const closed = {
    ...context,
    inventory: context.inventory.map((v) =>
      v.variantId === paidPlan.first
        ? { ...v, onHandMilli: v.onHandMilli - 1000, availableMilli: v.availableMilli - 1000 }
        : v,
    ),
    orders: [
      {
        ...order,
        status: 'cancelled',
        lines: order.lines.map((l) => ({
          ...l,
          fulfilledQuantityMilli: l.id === lineId ? 1000 : 0,
          cancelledQuantityMilli: l.id === lineId ? 1000 : 4000,
        })),
      },
    ],
    invoices: [invoice],
  }
  const fulfill = { kind: 'fulfill', orderId, key: uuid(13), payload: paidBody(id, lineId) }
  const confirm = { kind: 'confirm', orderId, key: uuid(14), payload: {} }
  return { context, closed, result, orderId, lineId, confirm, fulfill }
}
const request = (command: ReturnType<typeof fixture>['confirm'] | ReturnType<typeof fixture>['fulfill']) => ({
  scope,
  path: `/v1/wholesale/orders/${command.orderId}/${command.kind}`,
  key: command.key,
  body: command.payload,
})
async function confirmCase(store: Storage, f: ReturnType<typeof fixture>) {
  store.setItem(paidSlot, JSON.stringify(f.confirm))
  await freshPaidRequest(
    request(f.confirm),
    async () => ({ salesOrderId: f.orderId, status: 'confirmed', reservedLineCount: 2, totalMinor: 480000 }),
    store,
    env,
  )
  store.removeItem(paidSlot)
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())
it('allows exact staging paid mode and rejects production or excessive window', () => {
  const config = {
    CLOUDFLARE_ENV: 'staging',
    NEXT_PUBLIC_API_URL: env.api,
    NEXT_PUBLIC_SUPABASE_URL: env.auth,
    NEXT_PUBLIC_HCS_RECOVERY_UAT: 'fresh-paid-v1',
    NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: env.until,
  }
  expect(recoveryBuildEnv(config, now).NEXT_PUBLIC_HCS_RECOVERY_UAT).toBe('fresh-paid-v1')
  expect(() => recoveryBuildEnv({ ...config, CLOUDFLARE_ENV: 'production' }, now)).toThrow()
  expect(() =>
    recoveryBuildEnv({ ...config, NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: '2026-10-14T11:30:01Z' }, now),
  ).toThrow()
})
it('arming writes only diagnostic metadata, never pending or Auth records', () => {
  const store = storage()
  store.setItem('auth-existing', 'unchanged')
  armPaidCase('cod', scope, fixture('cod').context, store, env)
  expect(store.length).toBe(2)
  expect(store.getItem(paidSlot)).toBeNull()
  expect(store.getItem('auth-existing')).toBe('unchanged')
})
it('two fresh confirmations and four paid POSTs produce one response/effect per case, with guarded cleanup', async () => {
  const store = storage()
  let effects = 0,
    calls = 0
  for (const id of paidCases) {
    const f = fixture(id)
    armPaidCase(id, scope, f.context, store, env)
    await confirmCase(store, f)
    store.setItem(paidSlot, JSON.stringify(f.fulfill))
    let committed = false
    const send = async () => {
      calls++
      if (!committed) {
        effects++
        committed = true
      }
      return f.result
    }
    await expect(freshPaidRequest(request(f.fulfill), send, store, env)).rejects.toThrow(/withheld/)
    expect(readPaidState(store, env)[id]?.phase).toBe('withheld')
    expect(store.getItem(paidSlot)).toBe(JSON.stringify(f.fulfill))
    expect(await freshPaidRequest(request(f.fulfill), send, store, env)).toEqual(f.result)
    expect(() => closePaidCase(id, scope, f.closed, store, env)).toThrow(/Resolve/)
    store.removeItem(paidSlot)
    closePaidCase(id, scope, f.closed, store, env)
  }
  expect(calls).toBe(4)
  expect(effects).toBe(2)
  finishPaidCases(scope, store, env)
  expect(store.getItem(paidStorage)).toBeNull()
  expect(store.getItem(paidDone)).not.toBeNull()
  expect(() => armPaidCase('cod', scope, fixture('cod').context, store, env)).toThrow(/finished/)
})
it.each([
  { mode: 'off' },
  { origin: 'http://localhost:3001' },
  { api: 'https://production.invalid' },
  { auth: 'https://production.invalid' },
  { now: now - 1 },
  { now: now + 3600000 },
])('rejects wrong runtime %j', (delta) =>
  expect(() => armPaidCase('cod', scope, fixture('cod').context, storage(), { ...env, ...delta })).toThrow(),
)
it.each([
  { user: 'other', tenant: diagnosticTenant },
  { user: diagnosticOwner, tenant: 'other' },
])('rejects changed actor/tenant %j', (other) =>
  expect(() => armPaidCase('cod', other, fixture('cod').context, storage(), env)).toThrow(),
)
it('rejects wrong draft, quantity, pricing, notes, stock or preexisting history before arming', () => {
  const f = fixture('cod'),
    o = f.context.orders[0]!
  for (const change of [
    { status: 'confirmed' },
    { customerId: uuid(99) },
    { locationId: uuid(99) },
    { priceListId: uuid(99) },
    { totalMinor: 1 },
    { notes: 'changed' },
    { lines: [{ ...o.lines[0], orderedQuantityMilli: 1000 }, o.lines[1]] },
  ])
    expect(() => armPaidCase('cod', scope, { ...f.context, orders: [{ ...o, ...change }] }, storage(), env)).toThrow()
  expect(() => armPaidCase('cod', scope, { ...f.context, inventory: [] }, storage(), env)).toThrow()
  expect(() => armPaidCase('cod', scope, { ...f.context, invoices: f.closed.invoices }, storage(), env)).toThrow()
  expect(() => armPaidCase('cod', scope, { ...f.context, canManage: false }, storage(), env)).toThrow()
})
it('requires ordinary original pending before any send and rejects altered confirmation', async () => {
  const store = storage(),
    f = fixture('cod'),
    send = vi.fn()
  armPaidCase('cod', scope, f.context, store, env)
  await expect(freshPaidRequest(request(f.confirm), send, store, env)).rejects.toThrow(/persist/)
  store.setItem(paidSlot, JSON.stringify({ ...f.confirm, payload: { creditOverrideId: uuid(99) } }))
  await expect(
    freshPaidRequest({ ...request(f.confirm), body: { creditOverrideId: uuid(99) } }, send, store, env),
  ).rejects.toThrow(/one exact/)
  expect(send).not.toHaveBeenCalled()
})
it('unknown confirmation or invalid response forbids additional confirmation attempts', async () => {
  for (const send of [
    async () => {
      throw Error('unknown')
    },
    async () => ({ salesOrderId: fixture('cod').orderId, status: 'confirmed', reservedLineCount: 2, totalMinor: 1 }),
  ]) {
    const store = storage(),
      f = fixture('cod')
    armPaidCase('cod', scope, f.context, store, env)
    store.setItem(paidSlot, JSON.stringify(f.confirm))
    await expect(freshPaidRequest(request(f.confirm), send, store, env)).rejects.toThrow()
    const retry = vi.fn()
    await expect(freshPaidRequest(request(f.confirm), retry, store, env)).rejects.toThrow()
    expect(retry).not.toHaveBeenCalled()
    expect(store.getItem(paidSlot)).not.toBeNull()
  }
})
it('requires completed confirmation and exact one-unit payment before fulfillment', async () => {
  const store = storage(),
    f = fixture('cod'),
    send = vi.fn()
  armPaidCase('cod', scope, f.context, store, env)
  store.setItem(paidSlot, JSON.stringify(f.fulfill))
  await expect(freshPaidRequest(request(f.fulfill), send, store, env)).rejects.toThrow(/confirmed/)
  store.removeItem(paidSlot)
  await confirmCase(store, f)
  for (const body of [
    { ...f.fulfill.payload, payment: { ...f.fulfill.payload.payment, amountMinor: 80001 } },
    { ...f.fulfill.payload, lines: [{ salesOrderLineId: f.lineId, quantityMilli: 2000 }] },
  ]) {
    store.setItem(paidSlot, JSON.stringify({ ...f.fulfill, payload: body }))
    await expect(freshPaidRequest({ ...request(f.fulfill), body }, send, store, env)).rejects.toThrow()
  }
  expect(send).not.toHaveBeenCalled()
})
it('unknown first or retry response cannot create a third fulfillment request', async () => {
  for (const failFirst of [true, false]) {
    const store = storage(),
      f = fixture('cod')
    armPaidCase('cod', scope, f.context, store, env)
    await confirmCase(store, f)
    store.setItem(paidSlot, JSON.stringify(f.fulfill))
    await expect(
      freshPaidRequest(
        request(f.fulfill),
        async () => {
          if (failFirst) throw Error('unknown')
          return f.result
        },
        store,
        env,
      ),
    ).rejects.toThrow()
    if (!failFirst)
      await expect(
        freshPaidRequest(request(f.fulfill), async () => ({ ...f.result, invoiceId: uuid(99) }), store, env),
      ).rejects.toThrow(/identity/)
    const send = vi.fn()
    await expect(freshPaidRequest(request(f.fulfill), send, store, env)).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
    expect(store.getItem(paidSlot)).not.toBeNull()
  }
})
it('changed keys/routes or historical invoice cannot become fresh proof', async () => {
  const store = storage(),
    f = fixture('cod')
  armPaidCase('cod', scope, f.context, store, env)
  await confirmCase(store, f)
  store.setItem(paidSlot, JSON.stringify(f.fulfill))
  const send = vi.fn()
  await expect(freshPaidRequest({ ...request(f.fulfill), key: uuid(90) }, send, store, env)).rejects.toThrow()
  await expect(
    freshPaidRequest({ ...request(f.fulfill), path: '/v1/wholesale/payments' }, send, store, env),
  ).rejects.toThrow()
  expect(send).not.toHaveBeenCalled()
  const state = readPaidState(store, env)
  state.cod!.oldInvoices = [f.result.invoiceId]
  store.setItem(paidStorage, JSON.stringify(state))
  await expect(freshPaidRequest(request(f.fulfill), async () => f.result, store, env)).rejects.toThrow(/Fresh/)
})
it('refuses rearming, premature second case, corrupt counters/window and unfinished cleanup', () => {
  const store = storage(),
    f = fixture('cod')
  expect(() => armPaidCase('prepaid', scope, fixture('prepaid').context, store, env)).toThrow(/COD/)
  armPaidCase('cod', scope, f.context, store, env)
  expect(() => armPaidCase('cod', scope, f.context, store, env)).toThrow()
  expect(() => finishPaidCases(scope, store, env)).toThrow()
  expect(() => readPaidState(store, { ...env, until: '2026-10-14T11:29:00Z' })).toThrow()
  store.setItem(paidStorage, '')
  expect(() => readPaidState(store, env)).toThrow()
  expect(store.getItem(paidStorage)).toBe('')
})
it('refuses closing before exact cancelled remainder/stock/invoice reconciliation', async () => {
  const store = storage(),
    f = fixture('cod')
  armPaidCase('cod', scope, f.context, store, env)
  await confirmCase(store, f)
  store.setItem(paidSlot, JSON.stringify(f.fulfill))
  await expect(freshPaidRequest(request(f.fulfill), async () => f.result, store, env)).rejects.toThrow()
  await freshPaidRequest(request(f.fulfill), async () => f.result, store, env)
  store.removeItem(paidSlot)
  expect(() =>
    closePaidCase(
      'cod',
      scope,
      { ...f.closed, orders: [{ ...f.closed.orders[0], status: 'partially_fulfilled' }] },
      store,
      env,
    ),
  ).toThrow(/remainder/)
  expect(() => closePaidCase('cod', scope, { ...f.closed, inventory: f.context.inventory }, store, env)).toThrow(
    /stock/,
  )
  expect(() => closePaidCase('cod', scope, { ...f.closed, invoices: [] }, store, env)).toThrow(/invoice history/)
})
