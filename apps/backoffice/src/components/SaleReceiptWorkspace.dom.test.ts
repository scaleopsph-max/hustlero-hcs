import { createElement } from 'react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { saleReversalFixture, reversalIds as ids } from '../lib/sale-reversal.fixtures'
import { pendingSaleReversalSchema } from '../lib/sale-reversal'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
let Workspace: (typeof import('./SaleReceiptWorkspace'))['SaleReceiptWorkspace']
let current = saleReversalFixture()
let posts: { key: string; body: string }[] = []
let commit: (body: string) => Promise<Response>
const storage = `hcs-sale-reversal-v1:${ids.tenant}:${ids.actor}:${ids.sale}`
const result = {
  reversalId: ids.reversal,
  saleId: ids.sale,
  receiptNumber: 'SYNTHETIC-001',
  type: 'refund',
  saleStatus: 'partially_refunded',
  amountCentavos: 53,
  completedAt: '2026-10-28T02:00:00Z',
}
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://sale-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sale-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-dom-only')
  Workspace = (await import('./SaleReceiptWorkspace')).SaleReceiptWorkspace
})
beforeEach(() => {
  current = saleReversalFixture()
  posts = []
  sessionStorage.clear()
  localStorage.clear()
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-dom-only' } }, error: null })
  commit = async () => {
    throw new Error('Unexpected mutation')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.origin !== 'https://sale-api.example.invalid') throw new Error('External network denied')
      if (url.pathname === '/v1/me')
        return Response.json({
          userId: ids.actor,
          tenants: [
            {
              tenantId: ids.tenant,
              tenantSlug: 'synthetic',
              tenantName: 'Synthetic',
              isOwner: true,
              employeeId: null,
              locationIds: [],
              locationCount: 1,
              permissions: [],
              entitlements: [],
            },
          ],
        })
      if (init?.method === 'POST') {
        const body = String(init.body),
          key = new Headers(init.headers).get('Idempotency-Key')!
        const saved = JSON.parse(sessionStorage.getItem(storage) ?? 'null')
        expect(saved.key).toBe(key)
        expect(saved.body).toBe(body)
        posts.push({ key, body })
        return commit(body)
      }
      return Response.json(current)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
async function openRefund() {
  render(createElement(Workspace, { saleId: ids.sale }))
  fireEvent.click(await screen.findByRole('button', { name: 'Refund items' }))
  fireEvent.change(screen.getAllByRole('spinbutton')[0]!, { target: { value: '1' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Original net return' } })
}
function postedHistory() {
  current.refundedCentavos = 53
  current.refundableCentavos = 346
  current.status = 'partially_refunded'
  current.reversals = [
    {
      id: ids.reversal,
      type: 'refund',
      amountCentavos: 53,
      reason: 'Original net return',
      completedAt: result.completedAt,
    },
  ]
  current.lines[0]!.refundedQuantityMilli = 1000
  current.lines[0]!.refundableQuantityMilli = 2000
  current.discountReturnSnapshot!.refundedMinor = 53
  current.discountReturnSnapshot!.lines[0]!.refundedQuantityMilli = 1000
  current.discountReturnSnapshot!.lines[0]!.refundedMinor = 53
}
it('shows historical discount identity/line breakdown and previews original net cents', async () => {
  await openRefund()
  expect(screen.getByText(/Original special/)).toBeTruthy()
  expect(screen.getByText(/Refund total/).textContent).toMatch(/0\.53/)
  expect(posts).toHaveLength(0)
})
it('preserves a lost successful response, reloads and retries the identical key/body once', async () => {
  commit = async () => {
    postedHistory()
    throw new Error('Response lost')
  }
  await openRefund()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
  await screen.findByText('Response lost')
  const saved = sessionStorage.getItem(storage)
  expect(saved).not.toBeNull()
  expect(posts).toHaveLength(1)
  cleanup()
  commit = async () => Response.json(result)
  render(createElement(Workspace, { saleId: ids.sale }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original reversal' }))
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull())
  expect(posts).toHaveLength(2)
  expect(posts[0]).toEqual(posts[1])
  expect(screen.getByText(/Refund recorded:/)).toBeTruthy()
})
it('retains original command when the result disagrees instead of clearing or paying again', async () => {
  commit = async () => Response.json({ ...result, amountCentavos: 67 })
  await openRefund()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
  await screen.findByText(/Reversal response does not match/)
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Discard rejected request' })).toBeNull()
})
it('does not clear the original key until the reversal appears in receipt history', async () => {
  commit = async () => Response.json(result)
  await openRefund()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
  await screen.findByText(/not verified in receipt history/)
  expect(sessionStorage.getItem(storage)).not.toBeNull()
})
it('permits explicit discard after a known no-effect validation conflict', async () => {
  commit = async () =>
    Response.json({ error: { code: 'SALE_REVERSAL_CONFLICT', message: 'Original register closed' } }, { status: 409 })
  await openRefund()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Discard rejected request' }))
  expect(sessionStorage.getItem(storage)).toBeNull()
  expect(posts).toHaveLength(1)
})
it('rejects corrupted pending scope before enabling any new mutation', async () => {
  const command = pendingSaleReversalSchema.parse({
    version: 1,
    actorId: ids.actor,
    tenantId: ids.tenant,
    saleId: ids.sale,
    key: ids.key,
    mode: 'void',
    expectedAmountMinor: 399,
    body: JSON.stringify({ reason: 'Original void reason' }),
  })
  sessionStorage.setItem(storage, JSON.stringify({ ...command, actorId: ids.otherLine }))
  render(createElement(Workspace, { saleId: ids.sale }))
  await screen.findByText(/Pending reversal storage needs reconciliation/)
  expect(posts).toHaveLength(0)
  expect(screen.queryByRole('button', { name: 'Confirm refund' })).toBeNull()
})
it('blocks zero-cent refund selections before posting', async () => {
  await openRefund()
  fireEvent.change(screen.getAllByRole('spinbutton')[0]!, { target: { value: '0.001' } })
  expect((screen.getByRole('button', { name: 'Confirm refund' }) as HTMLButtonElement).disabled).toBe(true)
  expect(posts).toHaveLength(0)
})
