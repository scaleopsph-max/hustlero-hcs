import { z } from 'zod'
import { wholesaleOrderContextSchema } from '@hcs/contracts'
import {
  restoreOrderAction,
  validateOrderActionResponse,
  validatePaidFulfillmentInvoice,
} from './wholesale-order-actions'
import {
  assertRecoveryScope,
  canonical,
  diagnosticOwner,
  diagnosticTenant,
  environment,
} from './staging-recovery-policy'
import type { RecoveryRequest, RecoveryScope } from './staging-recovery-entry'

export const paidPlan = {
  customer: '5a3fdf97-3259-42e4-a340-86f045998b35',
  location: '4f195522-b451-4949-aed5-4bd6a75de229',
  branch: 'e45f8325-1628-458a-8c3a-8fa6b4ce8289',
  first: '0df89c7a-accc-4b58-af58-19936d0d39bf',
  second: '6e2c9331-1bd3-47a5-ab37-ffb0230b1e59',
  priceList: '1b081c72-989f-466a-9090-74a95c597b42',
  method: 'fc75965f-b614-4a78-a1c1-562a7aad21b5',
  reason: 'Owner-approved synthetic Staging fresh paid recovery UAT; no real cash or delivery',
} as const
export const paidCases = ['cod', 'prepaid'] as const
export type PaidCase = (typeof paidCases)[number]
export const paidOrderNumber = (id: PaidCase) => `SO-AW3-FRESH-${id.toUpperCase()}-20261014-R1`
export const paidReference = (id: PaidCase) => `AW3-FIRSTCOMMIT-${id.toUpperCase()}-20261014-R1`
const prefix = `${diagnosticOwner}:${diagnosticTenant}`
export const paidSlot = `hcs-wholesale-order-action:${prefix}`
export const paidLegacy = `hcs-paid-fulfillment:${prefix}`
export const paidStorage = `hcs:recovery-uat:fresh-paid-v1:${prefix}`
export const paidDone = `${paidStorage}:finished`
const slots = [
  paidSlot,
  paidLegacy,
  `hcs:wholesale-payment:${diagnosticTenant}:${diagnosticOwner}`,
  `hcs-wholesale-funds:${prefix}`,
]
const entrySchema = z.strictObject({
  orderId: z.uuid(),
  lineId: z.uuid(),
  otherLineId: z.uuid(),
  oldInvoices: z.array(z.uuid()),
  confirmation: z.enum(['required', 'sending', 'done']),
  confirmationKey: z.string().nullable(),
  key: z.string().nullable(),
  attempts: z.number().int().min(0).max(2),
  phase: z.enum(['armed', 'sending', 'withheld', 'retrying', 'recovered', 'closed']),
  response: z.unknown().nullable(),
})
const stateSchema = z.strictObject({
  until: z.string(),
  active: z.enum(paidCases).nullable(),
  cod: entrySchema.nullable(),
  prepaid: entrySchema.nullable(),
})
export type PaidState = z.infer<typeof stateSchema>
type Entry = z.infer<typeof entrySchema>
export const paidBody = (id: PaidCase, lineId: string) => ({
  lines: [{ salesOrderLineId: lineId, quantityMilli: 1000 }],
  payment: { paymentMethodId: paidPlan.method, amountMinor: 80000, reference: paidReference(id) },
})
function commandFor(id: PaidCase, e: Entry) {
  return { kind: 'fulfill' as const, orderId: e.orderId, key: e.key ?? '', payload: paidBody(id, e.lineId) }
}
const guard = (scope: RecoveryScope, env: ReturnType<typeof environment>) =>
  assertRecoveryScope(scope, env, 'fresh-paid-v1')
export function readPaidState(store: Storage, env: ReturnType<typeof environment>): PaidState {
  if (store.getItem(paidDone) !== null) throw new Error('Paid diagnostic batch already finished.')
  const raw = store.getItem(paidStorage)
  if (raw === null) return { until: env.until ?? '', active: null, cod: null, prepaid: null }
  const state = stateSchema.parse(JSON.parse(raw))
  if (state.until !== env.until || (state.prepaid && state.cod?.phase !== 'closed'))
    throw new Error('Paid diagnostic state differs.')
  for (const id of paidCases) {
    const e = state[id]
    if (!e) continue
    if (
      (e.confirmation === 'required' ? e.confirmationKey !== null : !e.confirmationKey) ||
      (e.phase === 'armed' && (e.attempts !== 0 || e.key !== null || e.response !== null)) ||
      (e.phase === 'sending' && (e.attempts !== 1 || !e.key || e.response !== null)) ||
      (e.phase === 'withheld' && (e.attempts !== 1 || !e.key || e.response === null)) ||
      (['retrying', 'recovered', 'closed'].includes(e.phase) && (e.attempts !== 2 || !e.key || e.response === null)) ||
      (e.phase !== 'armed' && e.confirmation !== 'done') ||
      (e.phase === 'closed' ? state.active === id : state.active !== id)
    )
      throw new Error('Paid counters require reconciliation.')
    if (e.response !== null) {
      const result = validateOrderActionResponse(commandFor(id, e), e.response)
      if (
        !('invoiceId' in result) ||
        result.orderStatus !== 'partially_fulfilled' ||
        e.oldInvoices.includes(result.invoiceId)
      )
        throw new Error('Fresh partial invoice required, not historical replay.')
    }
  }
  return state
}
function assertStock(context: z.infer<typeof wholesaleOrderContextSchema>, firstMilli: number) {
  for (const [locationId, variantId, qty] of [
    [paidPlan.location, paidPlan.first, firstMilli],
    [paidPlan.location, paidPlan.second, 4000],
    [paidPlan.branch, paidPlan.second, 2000],
  ] as const) {
    const row = context.inventory.find((v) => v.locationId === locationId && v.variantId === variantId)
    if (!row || row.onHandMilli !== qty || row.availableMilli !== qty || row.reservedMilli !== 0)
      throw new Error('Paid diagnostic shared-stock baseline differs.')
  }
}
export function armPaidCase(
  id: PaidCase,
  scope: RecoveryScope,
  history: unknown,
  store: Storage = sessionStorage,
  env = environment(),
) {
  guard(scope, env)
  const state = readPaidState(store, env)
  if (!paidCases.includes(id) || state.active || state[id] || slots.some((s) => store.getItem(s) !== null))
    throw new Error('Existing command or case must not be overwritten.')
  if (id === 'prepaid' && state.cod?.phase !== 'closed') throw new Error('Close and reconcile COD first.')
  const context = wholesaleOrderContextSchema.parse(history)
  const orders = context.orders.filter((o) => o.orderNumber === paidOrderNumber(id))
  const order = orders[0]
  const first = order?.lines.find((l) => l.variantId === paidPlan.first)
  const second = order?.lines.find((l) => l.variantId === paidPlan.second)
  if (
    !context.canManage ||
    orders.length !== 1 ||
    !order ||
    order.status !== 'draft' ||
    order.customerId !== paidPlan.customer ||
    order.locationId !== paidPlan.location ||
    order.priceListId !== paidPlan.priceList ||
    order.pricingType !== 'wholesale' ||
    order.totalMinor !== 480000 ||
    order.notes !== paidPlan.reason ||
    order.lines.length !== 2 ||
    !first ||
    !second ||
    first.id === second.id ||
    first.orderedQuantityMilli !== 2000 ||
    second.orderedQuantityMilli !== 4000 ||
    [first, second].some(
      (l) => l.unitPriceMinor !== 80000 || l.fulfilledQuantityMilli !== 0 || l.cancelledQuantityMilli !== 0,
    ) ||
    context.invoices.some((i) => i.salesOrderId === order.id)
  )
    throw new Error('Exact fresh draft required.')
  assertStock(context, id === 'cod' ? 3000 : 2000)
  state[id] = {
    orderId: order.id,
    lineId: first.id,
    otherLineId: second.id,
    oldInvoices: context.invoices.map((i) => i.id),
    confirmation: 'required',
    confirmationKey: null,
    key: null,
    attempts: 0,
    phase: 'armed',
    response: null,
  }
  state.active = id
  store.setItem(paidStorage, JSON.stringify(state))
}
export async function freshPaidRequest(
  request: RecoveryRequest,
  send: () => Promise<unknown>,
  store: Storage = sessionStorage,
  env = environment(),
) {
  guard(request.scope, env)
  const state = readPaidState(store, env)
  const id = state.active
  const e = id ? state[id] : null
  const pending = restoreOrderAction(store.getItem(paidSlot), store.getItem(paidLegacy))
  if (
    !id ||
    !e ||
    !pending ||
    pending.key !== request.key ||
    pending.orderId !== e.orderId ||
    canonical(pending.payload) !== canonical(request.body) ||
    request.path !== `/v1/wholesale/orders/${e.orderId}/${pending.kind}`
  )
    throw new Error('Arm the exact case; ordinary form must persist its original pending command first.')
  if (pending.kind === 'confirm') {
    if (e.confirmation !== 'required' || e.phase !== 'armed' || canonical(request.body) !== '{}')
      throw new Error('Only one exact fresh confirmation permitted; uncertain outcome requires reconciliation.')
    e.confirmation = 'sending'
    e.confirmationKey = request.key
    store.setItem(paidStorage, JSON.stringify(state))
    const result = validateOrderActionResponse(pending, await send())
    guard(request.scope, { ...env, now: Date.now() })
    if (!('reservedLineCount' in result) || result.reservedLineCount !== 2 || result.totalMinor !== 480000)
      throw new Error('Fresh confirmation identity differs.')
    e.confirmation = 'done'
    store.setItem(paidStorage, JSON.stringify(state))
    return result
  }
  if (e.confirmation !== 'done' || canonical(request.body) !== canonical(paidBody(id, e.lineId)))
    throw new Error('Exact confirmed one-unit paid fulfillment required.')
  if (e.phase === 'armed') {
    e.key = request.key
    e.attempts = 1
    e.phase = 'sending'
  } else if (e.phase === 'withheld' && e.attempts === 1 && e.key === request.key) {
    e.attempts = 2
    e.phase = 'retrying'
  } else throw new Error('Only the original withheld request may retry; uncertain outcome requires reconciliation.')
  store.setItem(paidStorage, JSON.stringify(state))
  const result = validateOrderActionResponse(pending, await send())
  guard(request.scope, { ...env, now: Date.now() })
  if (
    !('invoiceId' in result) ||
    result.orderStatus !== 'partially_fulfilled' ||
    e.oldInvoices.includes(result.invoiceId)
  )
    throw new Error('Fresh partial invoice required.')
  if (e.attempts === 1) {
    e.response = result
    e.phase = 'withheld'
    store.setItem(paidStorage, JSON.stringify(state))
    throw new Error(
      'Staging UAT: first fresh paid success withheld. Reconcile, reload and retry original pending command.',
    )
  }
  if (canonical(e.response) !== canonical(result)) throw new Error('Paid replay response identity differs.')
  e.phase = 'recovered'
  store.setItem(paidStorage, JSON.stringify(state))
  return result
}
export function closePaidCase(
  id: PaidCase,
  scope: RecoveryScope,
  history: unknown,
  store: Storage = sessionStorage,
  env = environment(),
) {
  guard(scope, env)
  const state = readPaidState(store, env),
    e = state[id]
  if (state.active !== id || !e || e.phase !== 'recovered' || slots.some((s) => store.getItem(s) !== null))
    throw new Error('Resolve pending recovery before cancelling and closing its case.')
  const context = wholesaleOrderContextSchema.parse(history)
  validatePaidFulfillmentInvoice(commandFor(id, e), e.response, context)
  const order = context.orders.find((o) => o.id === e.orderId)
  if (
    order?.status !== 'cancelled' ||
    order.lines.length !== 2 ||
    !order.lines.some(
      (l) => l.id === e.lineId && l.fulfilledQuantityMilli === 1000 && l.cancelledQuantityMilli === 1000,
    ) ||
    !order.lines.some(
      (l) => l.id === e.otherLineId && l.fulfilledQuantityMilli === 0 && l.cancelledQuantityMilli === 4000,
    )
  )
    throw new Error('Cancel only the exact five-unit undelivered remainder first.')
  assertStock(context, id === 'cod' ? 2000 : 1000)
  e.phase = 'closed'
  state.active = null
  store.setItem(paidStorage, JSON.stringify(state))
}
export function finishPaidCases(scope: RecoveryScope, store: Storage = sessionStorage, env = environment()) {
  guard(scope, env)
  const state = readPaidState(store, env)
  if (
    state.active ||
    paidCases.some((id) => state[id]?.phase !== 'closed') ||
    slots.some((s) => store.getItem(s) !== null)
  )
    throw new Error('Unresolved paid batch; cleanup refused.')
  store.setItem(paidDone, env.until ?? '')
  store.removeItem(paidStorage)
}
