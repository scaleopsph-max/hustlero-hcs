import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { PosSalesContext, PosSaleCompleteRequest } from '@hcs/contracts'
import { POS_CART_KEY, POS_SESSION_KEY } from '@/lib/pos-api'
import { posSaleScope, posSaleStorage } from '@/lib/pos-sale-recovery'
const mocks = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }))
vi.mock('@/components/SubHeader', () => ({
  SubHeader: ({ title, right }: { title: string; right: ReactNode }) =>
    createElement('header', null, createElement('h1', null, title), right),
}))
const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-000000000001`
const device = {
  id: id('2'),
  name: 'POS',
  tenantId: id('1'),
  tenantName: 'Synthetic',
  locationId: id('5'),
  locationName: 'Main',
  registerId: id('4'),
  registerName: 'Register',
}
const employee = { id: id('3'), employeeCode: 'CASH-1', displayName: 'Cashier' }
const definition = {
  id: id('8'),
  name: 'Retail fixed',
  value: { kind: 'fixed' as const, amountMinor: 100 },
  status: 'active' as const,
  revision: 1,
  scope: 'retail_ticket' as const,
  updatedAt: '2026-10-27T00:00:00Z',
}
const storage = posSaleStorage(posSaleScope({ device, employee }))
let Checkout: typeof import('./page').default
let context: PosSalesContext, posts: { key: string; body: string }[], replies: Map<string, unknown>, effects: number
let lost: boolean, hold: Promise<void> | null, code: string | null, tamper: boolean
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://pos-test.example.invalid')
  Checkout = (await import('./page')).default
})
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  mocks.router.push.mockClear()
  mocks.router.replace.mockClear()
  posts = []
  replies = new Map()
  effects = 0
  lost = false
  hold = null
  code = null
  tamper = false
  sessionStorage.setItem(
    POS_SESSION_KEY,
    JSON.stringify({ sessionToken: 'f'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', device, employee }),
  )
  sessionStorage.setItem(POS_CART_KEY, JSON.stringify([{ variantId: id('6'), quantityMilli: 1000 }]))
  context = {
    device,
    employee,
    registerSession: { id: id('b'), openedAt: '2026-10-27T00:00:00Z', openingCashCentavos: 100000 },
    categories: [],
    items: [
      {
        variantId: id('6'),
        productName: 'Socks',
        variantName: 'Each',
        sku: 'SOCKS',
        barcode: null,
        category: null,
        retailPriceCentavos: 1000,
        pricingOptions: [],
        availableMilli: null,
        trackInventory: false,
      },
    ],
    paymentMethods: [
      { id: id('7'), code: 'cash', name: 'Cash', type: 'cash' },
      { id: id('c'), code: 'bank', name: 'Bank', type: 'bank_transfer' },
    ],
    canApplyDiscount: true,
    discounts: [definition],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/v1/pos/context') return Response.json(context)
      if (path !== '/v1/pos/sales/complete') throw new Error('Unexpected mocked POS route')
      const key = (init!.headers as Record<string, string>)['Idempotency-Key']!,
        body = String(init!.body),
        saved = JSON.parse(sessionStorage.getItem(storage)!)
      expect(saved.key).toBe(key)
      expect(JSON.stringify(saved.payload)).toBe(body)
      posts.push({ key, body })
      await hold
      if (code) return Response.json({ error: { code, message: 'Synthetic rejection' } }, { status: 409 })
      let reply = replies.get(key)
      if (!reply) {
        const payload = JSON.parse(body) as PosSaleCompleteRequest,
          discount = payload.discount ? 100 : 0
        const payments = payload.payments.map((row) => ({
          paymentMethodId: row.paymentMethodId,
          methodName: row.paymentMethodId === id('7') ? 'Cash' : 'Bank',
          methodType: row.paymentMethodId === id('7') ? 'cash' : 'bank_transfer',
          amountCentavos: row.amountCentavos,
          tenderedCentavos: row.tenderedCentavos,
          changeCentavos: row.tenderedCentavos - row.amountCentavos,
          ...(row.referenceLastFour ? { referenceLastFour: row.referenceLastFour } : {}),
        }))
        reply = {
          saleId: id('9'),
          receiptNumber: 'MAIN-001',
          status: 'completed',
          subtotalCentavos: 1000,
          totalCentavos: 1000 - discount,
          discountCentavos: discount,
          discountSnapshot: payload.discount ? definition : null,
          discountLines: payload.discount
            ? [
                {
                  saleLineId: id('a'),
                  variantId: id('6'),
                  quantityMilli: 1000,
                  grossMinor: 1000,
                  discountMinor: 100,
                  netMinor: 900,
                },
              ]
            : [],
          payments,
          cashReceivedCentavos: payments
            .filter((row) => row.methodType === 'cash')
            .reduce((sum, row) => sum + row.tenderedCentavos, 0),
          changeCentavos: payments
            .filter((row) => row.methodType === 'cash')
            .reduce((sum, row) => sum + row.changeCentavos, 0),
          completedAt: '2026-10-27T00:00:00Z',
          customerId: payload.customerId ?? null,
          pricingType: 'retail',
        }
        replies.set(key, reply)
        effects++
        if (lost) {
          lost = false
          throw new TypeError('Synthetic lost response')
        }
      }
      return Response.json(tamper ? { ...(reply as object), totalCentavos: 1 } : reply)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(() => vi.unstubAllEnvs())
async function mount() {
  const view = render(createElement(Checkout))
  await screen.findByRole('heading', { name: 'Order summary' })
  return view
}
async function cash() {
  fireEvent.change(screen.getByLabelText('Ticket discount'), { target: { value: id('8') } })
  await waitFor(() => expect((screen.getByLabelText('Amount to apply') as HTMLInputElement).value).toBe('9.00'))
  fireEvent.change(screen.getByLabelText('Cash received'), { target: { value: '10.00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Add Cash/ }))
  await screen.findByRole('button', { name: /^Complete sale/ })
}
async function finish() {
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await screen.findByText('Sale completed')
}
it('posts a predefined pointer and exact net payable once', async () => {
  await mount()
  await cash()
  await finish()
  expect(effects).toBe(1)
  expect(JSON.parse(posts[0]!.body)).toMatchObject({
    discount: { discountId: id('8'), expectedRevision: 1 },
    payments: [{ amountCentavos: 900, tenderedCentavos: 1000 }],
  })
  expect(sessionStorage.getItem(storage)).toBeNull()
  expect(sessionStorage.getItem(POS_CART_KEY)).toBeNull()
})
it('restores original body/key after response loss, missing cart and later definition edits', async () => {
  const first = await mount()
  await cash()
  lost = true
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await screen.findByRole('alert')
  first.unmount()
  sessionStorage.removeItem(POS_CART_KEY)
  context.discounts = [{ ...definition, revision: 2, status: 'archived' }]
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Retry original sale' }))
  await screen.findByText('Sale completed')
  expect(effects).toBe(1)
  expect(posts).toHaveLength(2)
  expect(posts[0]).toEqual(posts[1])
  expect(mocks.router.replace).not.toHaveBeenCalledWith('/sell')
})
it('freezes selection once payments are allocated until they are removed', async () => {
  await mount()
  await cash()
  expect((screen.getByLabelText('Ticket discount') as HTMLSelectElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Cash' }))
  expect((screen.getByLabelText('Ticket discount') as HTMLSelectElement).disabled).toBe(false)
})
it('resets allocation to the exact new payable when rapidly switching a predefined discount', async () => {
  await mount()
  const select = screen.getByLabelText('Ticket discount')
  fireEvent.change(select, { target: { value: id('8') } })
  fireEvent.change(select, { target: { value: '' } })
  fireEvent.change(select, { target: { value: id('8') } })
  expect((screen.getByLabelText('Amount to apply') as HTMLInputElement).value).toBe('9.00')
  expect((screen.getByLabelText('Cash received') as HTMLInputElement).value).toBe('9.00')
})
it('retains recovery for altered receipt proof', async () => {
  await mount()
  await cash()
  tamper = true
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  expect(screen.queryByText('Sale completed')).toBeNull()
  expect(effects).toBe(1)
})
it('preserves an unrelated changed cart after reconciling the original sale', async () => {
  await mount()
  await cash()
  let release!: () => void
  hold = new Promise((resolve) => {
    release = resolve
  })
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await waitFor(() => expect(posts).toHaveLength(1))
  const changed = JSON.stringify([{ variantId: id('6'), quantityMilli: 2000 }])
  sessionStorage.setItem(POS_CART_KEY, changed)
  release()
  await screen.findByText('Sale completed')
  expect(sessionStorage.getItem(POS_CART_KEY)).toBe(changed)
})
it('retains the original command if the page unmounts before the successful response arrives', async () => {
  const first = await mount()
  await cash()
  let release!: () => void
  hold = new Promise((resolve) => {
    release = resolve
  })
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await waitFor(() => expect(posts).toHaveLength(1))
  first.unmount()
  release()
  await waitFor(() => expect(effects).toBe(1))
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Retry original sale' }))
  await screen.findByText('Sale completed')
  expect(effects).toBe(1)
  expect(posts[0]).toEqual(posts[1])
})
it('keeps recovery when cart cleanup storage fails after a completed command', async () => {
  await mount()
  await cash()
  const original = Storage.prototype.removeItem
  const cleanupFailure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (key === POS_CART_KEY) throw new Error('Synthetic cleanup failure')
    original.call(this, key)
  })
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  cleanupFailure.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: 'Retry original sale' }))
  await screen.findByText('Sale completed')
  expect(effects).toBe(1)
})
it('guards duplicate clicks while a response waits', async () => {
  await mount()
  await cash()
  let release!: () => void
  hold = new Promise((resolve) => {
    release = resolve
  })
  const button = screen.getByRole('button', { name: /^Complete sale/ })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(posts).toHaveLength(1))
  release()
  await screen.findByText('Sale completed')
  expect(effects).toBe(1)
})
it('requires a zero-preserving online suffix on discounted bank payment', async () => {
  await mount()
  fireEvent.change(screen.getByLabelText('Ticket discount'), { target: { value: id('8') } })
  fireEvent.click(screen.getByRole('button', { name: 'Bank' }))
  expect((screen.getByRole('button', { name: /^Add Bank/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Transaction reference (last 4 digits)'), { target: { value: '0047' } })
  fireEvent.click(screen.getByRole('button', { name: /^Add Bank/ }))
  await screen.findByRole('button', { name: /^Complete sale/ })
  await finish()
  expect(JSON.parse(posts[0]!.body).payments[0].referenceLastFour).toBe('0047')
})
it('offers explicit no-effect discard but retains auth/key conflicts', async () => {
  await mount()
  await cash()
  code = 'POS_DISCOUNT_CHANGED'
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Discard rejected attempt and return to sale' })).toBeTruthy()
  code = 'IDEMPOTENCY_KEY_CONFLICT'
  fireEvent.click(screen.getByRole('button', { name: 'Retry original sale' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Discard rejected attempt and return to sale' })).toBeNull(),
  )
  expect(sessionStorage.getItem(storage)).not.toBeNull()
})
it('does not submit or replace corrupt saved recovery', async () => {
  sessionStorage.setItem(storage, '{broken')
  render(createElement(Checkout))
  await screen.findByRole('alert')
  expect(posts).toHaveLength(0)
  expect(sessionStorage.getItem(storage)).toBe('{broken')
})
it('blocks a different cashier over an unresolved original device attempt', async () => {
  const first = await mount()
  await cash()
  lost = true
  fireEvent.click(screen.getByRole('button', { name: /^Complete sale/ }))
  await screen.findByRole('alert')
  first.unmount()
  const session = JSON.parse(sessionStorage.getItem(POS_SESSION_KEY)!)
  session.employee.id = id('d')
  sessionStorage.setItem(POS_SESSION_KEY, JSON.stringify(session))
  render(createElement(Checkout))
  await screen.findByRole('alert')
  expect(posts).toHaveLength(1)
  expect(sessionStorage.getItem(storage)).not.toBeNull()
})
it('keeps the original no-discount cash flow usable', async () => {
  await mount()
  await waitFor(() => expect((screen.getByLabelText('Amount to apply') as HTMLInputElement).value).toBe('10.00'))
  fireEvent.click(screen.getByRole('button', { name: /^Add Cash/ }))
  await screen.findByRole('button', { name: /^Complete sale/ })
  await finish()
  expect(effects).toBe(1)
  expect(JSON.parse(posts[0]!.body)).not.toHaveProperty('discount')
})
