import { z } from 'zod'
import { wholesalePaymentsContextSchema, wholesaleFundsContextSchema } from '@hcs/contracts'
import { restoreWholesalePayment, validateWholesalePaymentResponse } from './wholesale-payment'
import { restoreFundAllocation, validateFundAllocationResponse } from './wholesale-funds'
import {
  canonical,
  diagnosticOwner,
  diagnosticTenant,
  environment,
  assertRecoveryScope,
} from './staging-recovery-policy'
import type { RecoveryRequest, RecoveryScope, RecoveryFamily } from './staging-recovery-entry'

export const freshPaymentBody = {
  customerId: '5a3fdf97-3259-42e4-a340-86f045998b35',
  paymentMethodId: 'fc75965f-b614-4a78-a1c1-562a7aad21b5',
  amountMinor: 160000,
  reference: 'AW3-FIRSTCOMMIT-PAYMENT-20261014-R1',
  allocations: [{ invoiceId: '6363f7d5-9205-4c4e-9c03-15c0a91de2a0', amountMinor: 160000 }],
}
export const freshFundBody = (paymentId: string) => ({
  paymentId,
  capitalMinor: 100000,
  operatingMinor: 60000,
  settledConfirmed: true as const,
  settlementReference: 'AW3-FIRSTCOMMIT-FUNDS-20261014-R1',
  reason: 'Owner-approved synthetic Staging first-commit recovery UAT; no real settlement or Production money',
})
const prefix = `${diagnosticOwner}:${diagnosticTenant}`
export const paymentSlot = `hcs:wholesale-payment:${diagnosticTenant}:${diagnosticOwner}`
export const fundSlot = `hcs-wholesale-funds:${prefix}`
export const freshStorage = `hcs:recovery-uat:fresh-payment-funds-v1:${prefix}`
export const freshDone = `${freshStorage}:finished`
const slots = [paymentSlot, fundSlot, `hcs-wholesale-order-action:${prefix}`, `hcs-paid-fulfillment:${prefix}`]
const entrySchema = z.strictObject({
  key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  body: z.unknown(),
  attempts: z.number().int().min(1).max(2),
  phase: z.enum(['sending', 'withheld', 'retrying', 'recovered']),
  response: z.unknown().nullable(),
})
const stateSchema = z.strictObject({
  until: z.string(),
  armed: z.enum(['payment', 'funds']).nullable(),
  oldReceiptIds: z.array(z.uuid()).max(1000),
  payment: entrySchema.nullable(),
  funds: entrySchema.nullable(),
})
export type FreshState = z.infer<typeof stateSchema>
type Family = 'payment' | 'funds'
const guard = (scope: RecoveryScope, env: ReturnType<typeof environment>) =>
  assertRecoveryScope(scope, env, 'fresh-payment-funds-v1')

function resultFor(family: Family, key: string, body: unknown, result: unknown) {
  return family === 'payment'
    ? validateWholesalePaymentResponse(restoreWholesalePayment(JSON.stringify({ key, request: body }))!, result)
    : validateFundAllocationResponse(restoreFundAllocation(JSON.stringify({ key, payload: body }))!, result)
}
export function readFreshState(store: Storage, env: ReturnType<typeof environment>): FreshState {
  if (store.getItem(freshDone) !== null) throw new Error('Fresh diagnostic batch already finished.')
  const raw = store.getItem(freshStorage)
  if (raw === null) return { until: env.until ?? '', armed: null, oldReceiptIds: [], payment: null, funds: null }
  const state = stateSchema.parse(JSON.parse(raw))
  if (state.until !== env.until) throw new Error('Fresh diagnostic window differs.')
  for (const family of ['payment', 'funds'] as const) {
    const entry = state[family]
    if (!entry) continue
    const payment = state.payment?.response
      ? resultFor('payment', state.payment.key, state.payment.body, state.payment.response)
      : null
    const expected =
      family === 'payment'
        ? freshPaymentBody
        : payment && 'paymentId' in payment
          ? freshFundBody(payment.paymentId)
          : null
    if (
      !expected ||
      canonical(entry.body) !== canonical(expected) ||
      (entry.phase === 'sending' && (entry.attempts !== 1 || entry.response !== null)) ||
      (entry.phase === 'withheld' && (entry.attempts !== 1 || entry.response === null)) ||
      ((entry.phase === 'recovered' || entry.phase === 'retrying') &&
        (entry.attempts !== 2 || entry.response === null)) ||
      (family === 'funds' && state.payment?.phase !== 'recovered')
    )
      throw new Error('Fresh diagnostic latch needs reconciliation.')
    if (entry.response !== null) {
      const result = resultFor(family, entry.key, entry.body, entry.response)
      if (family === 'payment' && state.oldReceiptIds.includes(result.paymentId))
        throw new Error('Expected a newly committed receipt, not a historical result.')
    }
  }
  return state
}
export function armFreshCase(
  family: RecoveryFamily,
  scope: RecoveryScope,
  context: unknown,
  store: Storage = sessionStorage,
  env = environment(),
) {
  guard(scope, env)
  if (family !== 'payment' && family !== 'funds') throw new Error('Only fresh payment/fund cases are permitted.')
  const state = readFreshState(store, env)
  if (state.armed || state[family] || slots.some((s) => store.getItem(s) !== null))
    throw new Error('Existing recovery must not be overwritten or rearmed.')
  if (family === 'payment') {
    const data = wholesalePaymentsContextSchema.parse(context)
    const invoice = data.invoices.find((i) => i.invoiceId === freshPaymentBody.allocations[0]!.invoiceId)
    if (
      !data.canRecord ||
      !invoice?.canAllocate ||
      invoice.customerId !== freshPaymentBody.customerId ||
      invoice.openBalanceMinor !== 160000 ||
      !data.paymentMethods.some((m) => m.id === freshPaymentBody.paymentMethodId) ||
      data.payments.some((p) => p.reference === freshPaymentBody.reference)
    )
      throw new Error('Fresh invoice/method/history baseline differs.')
    state.oldReceiptIds = data.payments.map((p) => p.paymentId)
  } else {
    if (state.payment?.phase !== 'recovered') throw new Error('Recover and reconcile the fresh payment first.')
    const payment = resultFor('payment', state.payment.key, state.payment.body, state.payment.response)
    const data = wholesaleFundsContextSchema.parse(context)
    const receipt = data.payments.find((p) => p.paymentId === payment.paymentId)
    if (
      !data.canManage ||
      !receipt ||
      receipt.reference !== freshPaymentBody.reference ||
      receipt.amountMinor !== 160000 ||
      receipt.allocation !== null ||
      data.funds.find((f) => f.fundType === 'capital_cogs')?.balanceMinor !== 50000 ||
      data.funds.find((f) => f.fundType === 'operating')?.balanceMinor !== 30000
    )
      throw new Error('Fresh receipt/fund baseline differs.')
  }
  state.armed = family
  store.setItem(freshStorage, JSON.stringify(state))
}
export async function freshRequestWithFault(
  request: RecoveryRequest,
  send: () => Promise<unknown>,
  store: Storage = sessionStorage,
  env = environment(),
) {
  guard(request.scope, env)
  const family =
    request.path === '/v1/wholesale/payments' ? 'payment' : request.path === '/v1/wholesale/funds' ? 'funds' : null
  if (!family) throw new Error('Fresh diagnostic route not approved.')
  const state = readFreshState(store, env)
  if (state.armed !== family || store.getItem(freshStorage) === null)
    throw new Error('Arm the exact fresh case before the normal form submission.')
  if (family === 'funds' && (state.payment?.phase !== 'recovered' || store.getItem(paymentSlot) !== null))
    throw new Error('Fresh payment must be recovered and its normal pending slot cleared first.')
  const stored =
    family === 'payment'
      ? restoreWholesalePayment(store.getItem(paymentSlot))
      : restoreFundAllocation(store.getItem(fundSlot))
  if (
    !stored ||
    stored.key !== request.key ||
    canonical('request' in stored ? stored.request : stored.payload) !== canonical(request.body)
  )
    throw new Error('Normal application must persist its own pending command before the HTTP request.')
  let entry = state[family]
  const payment = state.payment?.response
    ? resultFor('payment', state.payment.key, state.payment.body, state.payment.response)
    : null
  const expected = family === 'payment' ? freshPaymentBody : payment ? freshFundBody(payment.paymentId) : null
  if (!expected || canonical(request.body) !== canonical(expected))
    throw new Error('Fresh diagnostic body not approved.')
  if (!entry) {
    entry = { key: request.key, body: request.body, attempts: 1, phase: 'sending', response: null }
    state[family] = entry
  } else {
    if (
      entry.key !== request.key ||
      canonical(entry.body) !== canonical(request.body) ||
      entry.phase !== 'withheld' ||
      entry.attempts !== 1
    )
      throw new Error('Retry only the original withheld command; uncertain outcomes need reconciliation.')
    entry.attempts = 2
    entry.phase = 'retrying'
  }
  store.setItem(freshStorage, JSON.stringify(state))
  const response = resultFor(family, entry.key, entry.body, await send())
  guard(request.scope, { ...env, now: Date.now() })
  if (entry.attempts === 1) {
    if (family === 'payment' && state.oldReceiptIds.includes(response.paymentId))
      throw new Error('Historical receipt cannot prove a fresh commit.')
    entry.response = response
    entry.phase = 'withheld'
    store.setItem(freshStorage, JSON.stringify(state))
    throw new Error('Staging UAT: first fresh success withheld. Reload and retry the original pending command.')
  }
  if (canonical(entry.response) !== canonical(response))
    throw new Error('Fresh replay response identity differs; stop for reconciliation.')
  entry.phase = 'recovered'
  state.armed = null
  store.setItem(freshStorage, JSON.stringify(state))
  return response
}
export function finishFreshCases(scope: RecoveryScope, store: Storage = sessionStorage, env = environment()) {
  guard(scope, env)
  const state = readFreshState(store, env)
  if (
    state.armed ||
    state.payment?.phase !== 'recovered' ||
    state.funds?.phase !== 'recovered' ||
    slots.some((s) => store.getItem(s) !== null)
  )
    throw new Error('Unresolved fresh recovery; cleanup refused.')
  store.setItem(freshDone, env.until ?? '')
  store.removeItem(freshStorage)
}
