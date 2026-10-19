import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  wholesaleCreditApplyResponseSchema,
  wholesaleCreditRefundResponseSchema,
  type WholesaleReturnsContext,
} from '@hcs/contracts'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001'
const invoice = '30000000-0000-4000-8000-000000000001',
  line = '40000000-0000-4000-8000-000000000001'
const note = '50000000-0000-4000-8000-000000000001',
  customer = '60000000-0000-4000-8000-000000000001'
const target = '70000000-0000-4000-8000-000000000001',
  method = '80000000-0000-4000-8000-000000000001'
const session = '90000000-0000-4000-8000-000000000001',
  location = 'a0000000-0000-4000-8000-000000000001'
const postedNote = 'b0000000-0000-4000-8000-000000000001'
const storage = `hcs-aw4:${user}:${tenant}`
const access = {
  userId: user,
  tenants: [
    {
      tenantId: tenant,
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
}
const fixture = (): WholesaleReturnsContext => ({
  canPost: true,
  canApply: true,
  canRefund: true,
  invoices: [
    {
      invoiceId: invoice,
      invoiceNumber: 'SYNTHETIC-001',
      customerId: customer,
      customerName: 'Synthetic Customer',
      locationId: location,
      locationName: 'Synthetic Branch',
      totalMinor: 90000,
      creditedMinor: 45000,
      settledMinor: 90000,
      openDebtMinor: 0,
      valuationSupported: true,
      lines: [
        {
          invoiceLineId: line,
          name: 'Synthetic Shoes',
          quantityMilli: 2000,
          returnedQuantityMilli: 1000,
          unitPriceMinor: 45000,
          originalTotalMinor: 90000,
          priorCreditMinor: 45000,
        },
      ],
    },
    {
      invoiceId: target,
      invoiceNumber: 'SYNTHETIC-002',
      customerId: customer,
      customerName: 'Synthetic Customer',
      locationId: location,
      locationName: 'Synthetic Branch',
      totalMinor: 90000,
      creditedMinor: 0,
      settledMinor: 0,
      openDebtMinor: 90000,
      valuationSupported: true,
      lines: [],
    },
  ],
  notes: [
    {
      creditNoteId: note,
      invoiceId: invoice,
      customerId: customer,
      locationId: location,
      amountMinor: 45000,
      issuedCreditMinor: 45000,
      availableCreditMinor: 45000,
      commandKey: null,
      payoutBlocked: false,
      recordedAt: '2026-10-19T00:00:00Z',
    },
  ],
  applications: [],
  payouts: [],
  methods: [{ id: method, name: 'Synthetic GCash', type: 'e_wallet' }],
  sessions: [{ id: session, locationId: location, name: 'Synthetic Register' }],
})
const result = {
  creditNoteId: postedNote,
  invoiceId: invoice,
  refundId: postedNote,
  amountMinor: 45000,
  debtReductionMinor: 0,
  newCustomerCreditMinor: 45000,
  openDebtMinor: 0,
  cashPayoutMinor: 0,
}
let Workspace: typeof import('./WholesaleReturnsWorkspace').WholesaleReturnsWorkspace
let current: WholesaleReturnsContext
let posts: { key: string; body: string; path: string }[]
let commit: (path: string, body: string, key: string) => Response | Promise<Response>
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://aw4-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://aw4-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-dom-test-only')
  Workspace = (await import('./WholesaleReturnsWorkspace')).WholesaleReturnsWorkspace
})
beforeEach(() => {
  current = fixture()
  posts = []
  sessionStorage.clear()
  localStorage.clear()
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic-dom-only', user: { id: user } } },
    error: null,
  })
  commit = async () => {
    throw new Error('Unexpected mutation in synthetic DOM test')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const endpoint = new URL(input)
      if (endpoint.origin !== 'https://aw4-api.example.invalid') throw new Error('No external network allowed')
      if (endpoint.pathname === '/v1/me') return Response.json(access)
      if (endpoint.pathname === '/v1/wholesale/returns' && (!init?.method || init.method === 'GET'))
        return Response.json(current)
      if (endpoint.pathname === '/v1/wholesale/returns/preview')
        return Response.json({
          totalCreditMinor: 45000,
          debtReductionMinor: 0,
          newCustomerCreditMinor: 45000,
          openDebtMinor: 0,
          cashPayoutMinor: 0,
        })
      const key = new Headers(init?.headers).get('Idempotency-Key') ?? ''
      const body = String(init?.body)
      const persisted = JSON.parse(sessionStorage.getItem(storage) ?? 'null')
      expect(persisted?.key).toBe(key)
      expect(persisted?.payload).toEqual(JSON.parse(body))
      posts.push({ key, body, path: endpoint.pathname })
      return commit(endpoint.pathname, body, key)
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
  const view = render(createElement(Workspace))
  await screen.findByRole('tab', { name: 'Returns' })
  return view
}
async function prepareReturn() {
  fireEvent.change(screen.getByLabelText('Invoice'), { target: { value: invoice } })
  fireEvent.change(screen.getByLabelText('Return quantity Synthetic Shoes'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic return reason' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Post credit note' }) as HTMLButtonElement).disabled).toBe(false),
  )
}
function committedReturn(key: string) {
  current.notes.push({ ...current.notes[0]!, creditNoteId: postedNote, commandKey: key })
  current.invoices[0]!.creditedMinor = 90000
  current.invoices[0]!.lines[0]!.returnedQuantityMilli = 2000
  current.invoices[0]!.lines[0]!.priorCreditMinor = 90000
}
describe('actual AW4 component with isolated synthetic Auth/API', () => {
  it.each(['apply', 'refund'] as const)(
    'recovers a lost %s response after reload using the exact original command',
    async (operation) => {
      let effects = 0
      const response =
        operation === 'apply'
          ? { applicationId: postedNote, creditNoteId: note, invoiceId: target, amountMinor: 30000 }
          : {
              payoutId: postedNote,
              creditNoteId: note,
              paymentMethodId: method,
              registerSessionId: null,
              referenceLastFour: '0047',
              amountMinor: 20000,
            }
      commit = async (path, _body, key) => {
        expect(path).toBe(`/v1/wholesale/credits/${operation}`)
        if (effects === 0) {
          if ('applicationId' in response) {
            current.applications.push({ ...wholesaleCreditApplyResponseSchema.parse(response), commandKey: key })
            current.invoices[1]!.openDebtMinor = 60000
            current.invoices[1]!.settledMinor = 30000
            current.notes[0]!.availableCreditMinor = 15000
          } else {
            current.payouts.push({ ...wholesaleCreditRefundResponseSchema.parse(response), commandKey: key })
            current.notes[0]!.availableCreditMinor = 25000
          }
          effects++
          throw new TypeError('Synthetic committed response lost')
        }
        return Response.json(response)
      }
      const view = await mount()
      fireEvent.click(screen.getByRole('tab', { name: operation === 'apply' ? 'Apply credit' : 'Refunds' }))
      fireEvent.change(screen.getByLabelText('Customer credit'), { target: { value: note } })
      fireEvent.change(screen.getByLabelText('Amount PHP'), {
        target: { value: operation === 'apply' ? '300.00' : '200.00' },
      })
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic lost-response recovery' } })
      if (operation === 'apply') fireEvent.change(screen.getByLabelText('Invoice'), { target: { value: target } })
      else {
        fireEvent.change(screen.getByLabelText('Original payment method'), { target: { value: method } })
        fireEvent.change(screen.getByLabelText('Transaction reference last four digits'), { target: { value: '0047' } })
        fireEvent.click(screen.getByLabelText('Payout completed and verified'))
      }
      fireEvent.click(
        screen.getByRole('button', { name: operation === 'apply' ? 'Apply credit' : 'Record confirmed payout' }),
      )
      await screen.findByRole('alert')
      expect(sessionStorage.getItem(storage)).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'Dismiss rejected request' })).toBeNull()
      view.unmount()
      await mount()
      fireEvent.click(screen.getByRole('button', { name: 'Retry original request' }))
      await screen.findByText(operation === 'apply' ? 'Customer credit applied.' : 'Confirmed payout recorded.')
      expect(posts).toHaveLength(2)
      expect(posts[1]).toEqual(posts[0])
      expect(effects).toBe(1)
      expect(sessionStorage.getItem(storage)).toBeNull()
    },
  )
  it('preserves corrupted pending storage and fails closed without a mutation', async () => {
    sessionStorage.setItem(storage, 'corrupted synthetic command')
    render(createElement(Workspace))
    await screen.findByRole('alert')
    expect(sessionStorage.getItem(storage)).toBe('corrupted synthetic command')
    expect(posts).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Post credit note' })).toBeNull()
  })
  it('lets a proven rejected payout be dismissed without discarding an unknown outcome', async () => {
    const pending = {
      operation: 'refund',
      key: postedNote,
      payload: {
        creditNoteId: note,
        paymentMethodId: method,
        registerSessionId: session,
        referenceLastFour: null,
        payoutConfirmed: true,
        amountMinor: 20000,
        reason: 'Synthetic closed-register payout',
      },
    }
    sessionStorage.setItem(storage, JSON.stringify(pending))
    commit = async () =>
      Response.json(
        { error: { code: 'WHOLESALE_RETURN_HCWR6', message: 'Authorized open cash session unavailable.' } },
        { status: 409 },
      )
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry original request' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss rejected request' }))
    expect(sessionStorage.getItem(storage)).toBeNull()
    expect(posts).toHaveLength(1)
  })
  it('does not allow a scope denial before replay lookup to clear an uncertain payout', async () => {
    const pending = {
      operation: 'refund',
      key: postedNote,
      payload: {
        creditNoteId: note,
        paymentMethodId: method,
        registerSessionId: session,
        referenceLastFour: null,
        payoutConfirmed: true,
        amountMinor: 20000,
        reason: 'Synthetic uncertain payout',
      },
    }
    sessionStorage.setItem(storage, JSON.stringify(pending))
    commit = async () =>
      Response.json(
        { error: { code: 'WHOLESALE_RETURN_HCWR2', message: 'Authorized scope unavailable.' } },
        { status: 404 },
      )
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry original request' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Dismiss rejected request' })).toBeNull()
    expect(JSON.parse(sessionStorage.getItem(storage)!)).toEqual(pending)
  })
  it('requires the current preview and invalidates it after editing the return', async () => {
    await mount()
    expect((screen.getByRole('button', { name: 'Post credit note' }) as HTMLButtonElement).disabled).toBe(true)
    await prepareReturn()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Changed return reason' } })
    expect((screen.getByRole('button', { name: 'Post credit note' }) as HTMLButtonElement).disabled).toBe(true)
    expect(posts).toHaveLength(0)
  })
  it('survives response loss and reload, retrying the exact persisted key/body before clearing', async () => {
    let effects = 0
    commit = async (_path, _body, key) => {
      if (effects === 0) {
        committedReturn(key)
        effects++
        throw new TypeError('Synthetic response lost')
      }
      return Response.json(result)
    }
    const view = await mount()
    await prepareReturn()
    fireEvent.click(screen.getByRole('button', { name: 'Post credit note' }))
    await screen.findByRole('alert')
    const saved = sessionStorage.getItem(storage)
    expect(saved).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss rejected request' })).toBeNull()
    view.unmount()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry original request' }))
    await screen.findByText('Credit note posted.')
    expect(posts).toHaveLength(2)
    expect(posts[1]).toEqual(posts[0])
    expect(effects).toBe(1)
    expect(sessionStorage.getItem(storage)).toBeNull()
  })
  it('retains the original command when a successful response lacks matching authorized history', async () => {
    commit = async () => Response.json(result)
    await mount()
    await prepareReturn()
    fireEvent.click(screen.getByRole('button', { name: 'Post credit note' }))
    await screen.findByRole('alert')
    expect(sessionStorage.getItem(storage)).not.toBeNull()
    expect(screen.queryByText('Credit note posted.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss rejected request' })).toBeNull()
  })
  it('records the exact external payout and preserves leading-zero reference digits', async () => {
    commit = async (path, body, key) => {
      expect(path).toBe('/v1/wholesale/credits/refund')
      const payload = JSON.parse(body)
      expect(payload.referenceLastFour).toBe('0047')
      expect(payload.amountMinor).toBe(20000)
      const response = {
        payoutId: postedNote,
        creditNoteId: note,
        paymentMethodId: method,
        registerSessionId: null,
        referenceLastFour: '0047',
        amountMinor: 20000,
      }
      current.payouts.push({ ...response, commandKey: key })
      current.notes[0]!.availableCreditMinor = 25000
      return Response.json(response)
    }
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Refunds' }))
    fireEvent.change(screen.getByLabelText('Customer credit'), { target: { value: note } })
    fireEvent.change(screen.getByLabelText('Original payment method'), { target: { value: method } })
    fireEvent.change(screen.getByLabelText('Amount PHP'), { target: { value: '200.00' } })
    fireEvent.change(screen.getByLabelText('Transaction reference last four digits'), { target: { value: '0047' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Verified synthetic external payout' } })
    fireEvent.click(screen.getByLabelText('Payout completed and verified'))
    fireEvent.click(screen.getByRole('button', { name: 'Record confirmed payout' }))
    await screen.findByText('Confirmed payout recorded.')
    expect(posts).toHaveLength(1)
    expect(sessionStorage.getItem(storage)).toBeNull()
  })
  it('keeps pending storage and sends no mutation after the signed-in actor changes', async () => {
    const pending = {
      operation: 'return',
      key: postedNote,
      payload: {
        invoiceId: invoice,
        reason: 'Synthetic pending return',
        lines: [{ invoiceLineId: line, quantityMilli: 1000, returnToStock: true }],
      },
    }
    sessionStorage.setItem(storage, JSON.stringify(pending))
    await mount()
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'another-synthetic-session', user: { id: customer } } },
      error: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry original request' }))
    await screen.findByRole('alert')
    expect(posts).toHaveLength(0)
    expect(JSON.parse(sessionStorage.getItem(storage)!)).toEqual(pending)
  })
  it('does not offer funded credit for payout but keeps it available for credit application', async () => {
    current.notes[0]!.payoutBlocked = true
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Refunds' }))
    expect((screen.getByLabelText('Customer credit') as HTMLSelectElement).options).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Apply credit' }))
    expect((screen.getByLabelText('Customer credit') as HTMLSelectElement).options).toHaveLength(2)
    expect(posts).toHaveLength(0)
  })
})
