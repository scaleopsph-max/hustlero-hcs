import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { WholesaleFundsContext } from '@hcs/contracts'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
vi.mock('@/lib/staging-recovery-entry', () => ({
  StagingRecoveryControls: () => null,
  assertRecoveryPending: () => {},
  recoveryRequest: (_scope: unknown, execute: () => unknown) => execute(),
}))
const user = '10000000-0000-4000-8000-000000000001'
const tenant = '20000000-0000-4000-8000-000000000001'
const paymentId = '30000000-0000-4000-8000-000000000001'
const storage = `hcs-wholesale-funds:${user}:${tenant}`
const allocation = { paymentId, capitalMinor: 50000, operatingMinor: 30000, recordedAt: '2026-10-26T04:00:00Z' }
const reversal = { ...allocation, reversalId: user, recordedAt: '2026-10-26T05:00:00Z' }
let Workspace: typeof import('./WholesaleFundsWorkspace').WholesaleFundsWorkspace
let current: WholesaleFundsContext
let posts: { key: string; body: string; path: string }[]
let effects: { allocation: number; reversal: number }
let replies: Map<string, unknown>
let failRead: boolean
let loseReversalResponse: boolean
let holdReversal: Promise<void> | null
let holdHistory: Promise<void> | null

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://funds-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://funds-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-only')
  Workspace = (await import('./WholesaleFundsWorkspace')).WholesaleFundsWorkspace
})
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  posts = []
  effects = { allocation: 0, reversal: 0 }
  replies = new Map()
  failRead = false
  loseReversalResponse = false
  holdReversal = null
  holdHistory = null
  current = {
    canManage: true,
    canReverse: true,
    funds: [
      { fundType: 'capital_cogs', name: 'Capital', balanceMinor: 0 },
      { fundType: 'operating', name: 'Operating', balanceMinor: 0 },
    ],
    payments: [{ paymentId, reference: 'Synthetic receipt', amountMinor: 80000, allocation: null, reversal: null }],
  }
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic-only', user: { id: user } } },
    error: null,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.origin !== 'https://funds-api.example.invalid') throw new Error('External network forbidden in test')
      if (url.pathname === '/v1/me')
        return Response.json({
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
        })
      if (url.pathname === '/v1/wholesale/funds' && init?.method !== 'POST') {
        if (holdHistory) await holdHistory
        if (failRead) {
          failRead = false
          throw new Error('Synthetic history disconnected')
        }
        return Response.json(current)
      }
      const reversing = url.pathname === '/v1/wholesale/funds/reverse'
      if (!reversing && url.pathname !== '/v1/wholesale/funds') throw new Error('Unexpected endpoint')
      const key = new Headers(init?.headers).get('Idempotency-Key')!
      const body = String(init?.body)
      const prior = posts.find((post) => post.key === key)
      if (prior) expect({ body, path: url.pathname }).toEqual({ body: prior.body, path: prior.path })
      const saved = JSON.parse(sessionStorage.getItem(reversing ? `${storage}:reversal` : storage)!)
      expect(saved.key).toBe(key)
      expect(saved.payload).toEqual(JSON.parse(body))
      posts.push({ key, body, path: url.pathname })
      if (!replies.has(key)) {
        if (reversing) {
          effects.reversal++
          current.payments[0]!.reversal = reversal
          current.funds.forEach((fund) => {
            fund.balanceMinor = 0
          })
        } else {
          effects.allocation++
          current.payments[0]!.allocation = allocation
          current.funds[0]!.balanceMinor = 50000
          current.funds[1]!.balanceMinor = 30000
        }
        replies.set(key, reversing ? reversal : allocation)
      }
      if (reversing && loseReversalResponse) {
        loseReversalResponse = false
        throw new Error('Synthetic response lost')
      }
      if (reversing && holdReversal) await holdReversal
      return Response.json(replies.get(key))
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
  await screen.findByRole('heading', { name: 'Allocation history' })
  return view
}
async function allocate() {
  fireEvent.change(screen.getByLabelText('Receipt', { exact: true }), { target: { value: paymentId } })
  fireEvent.change(screen.getByLabelText('Capital / COGS amount'), { target: { value: '500' } })
  fireEvent.change(screen.getByLabelText('Operating amount'), { target: { value: '300' } })
  fireEvent.change(screen.getByLabelText('Settlement reference'), { target: { value: 'Synthetic settled' } })
  fireEvent.change(screen.getByLabelText('Reason', { exact: true }), { target: { value: 'Synthetic allocation' } })
  fireEvent.click(screen.getByLabelText('I confirm this receipt is fully settled and available for fund allocation.'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm allocation' }))
}
async function reverse() {
  fireEvent.change(screen.getByLabelText('Original allocated receipt'), { target: { value: paymentId } })
  fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Synthetic separate reversal' } })
  fireEvent.click(screen.getByLabelText('Reverse the full original Capital / Operating allocation.'))
  fireEvent.click(screen.getByRole('button', { name: 'Reverse allocation' }))
}
it('completes allocation then separate reversal while preserving original split/history', async () => {
  await mount()
  await allocate()
  await screen.findByText('Fund allocation recorded. No bank transfer was made.')
  await reverse()
  await screen.findByText('Original fund allocation reversed. No customer payout recorded.')
  expect(effects).toEqual({ allocation: 1, reversal: 1 })
  expect(current.payments[0]!.allocation).toEqual(allocation)
  expect(current.payments[0]!.reversal).toEqual(reversal)
  expect(current.funds.map((fund) => fund.balanceMinor)).toEqual([0, 0])
  expect(sessionStorage.getItem(storage)).toBeNull()
  expect(sessionStorage.getItem(`${storage}:reversal`)).toBeNull()
  expect(screen.getByLabelText('Receipt', { exact: true }).querySelector(`option[value="${paymentId}"]`)).toBeNull()
})
it('retains reversal identity across manual parent refresh/remount after a lost response', async () => {
  await mount()
  await allocate()
  await screen.findByText('Fund allocation recorded. No bank transfer was made.')
  loseReversalResponse = true
  await reverse()
  await screen.findByRole('alert')
  const saved = sessionStorage.getItem(`${storage}:reversal`)
  expect(saved).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh funds' }))
  await screen.findByRole('button', { name: 'Retry original reversal' })
  expect(sessionStorage.getItem(`${storage}:reversal`)).toBe(saved)
  fireEvent.click(screen.getByRole('button', { name: 'Retry original reversal' }))
  await screen.findByText('Original fund allocation reversed. No customer payout recorded.')
  const requests = posts.filter((post) => post.path.endsWith('/reverse'))
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  expect(effects).toEqual({ allocation: 1, reversal: 1 })
})
it('retains allocation command on failed history refresh with AW4 reversal controls present', async () => {
  const first = await mount()
  failRead = true
  await allocate()
  await screen.findByRole('alert')
  expect(screen.queryByText('Fund allocation recorded. No bank transfer was made.')).toBeNull()
  const saved = sessionStorage.getItem(storage)
  expect(saved).not.toBeNull()
  first.unmount()
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Retry allocation' }))
  await screen.findByText('Fund allocation recorded. No bank transfer was made.')
  expect(effects).toEqual({ allocation: 1, reversal: 0 })
  expect(posts).toHaveLength(2)
  expect(posts[0]).toEqual(posts[1])
})
it('keeps allocation and reversal permissions independent for an allocation-only reader', async () => {
  current.canReverse = false
  await mount()
  expect((screen.getByRole('button', { name: 'Confirm allocation' }) as HTMLButtonElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: 'Reverse allocation' }) as HTMLButtonElement).disabled).toBe(true)
  expect(posts).toHaveLength(0)
})
it('keeps allocation and reversal permissions independent for reversal-only access', async () => {
  current.canManage = false
  current.payments[0]!.allocation = allocation
  await mount()
  expect((screen.getByRole('button', { name: 'Confirm allocation' }) as HTMLButtonElement).disabled).toBe(true)
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Reverse allocation' }) as HTMLButtonElement).disabled).toBe(false),
  )
  expect(posts).toHaveLength(0)
})
it.each(['auth', 'post', 'history'] as const)(
  'blocks parent refresh and allocation during reversal %s wait',
  async (phase) => {
    current.payments[0]!.allocation = allocation
    let release!: () => void
    const pause = new Promise<void>((resolve) => {
      release = resolve
    })
    await mount()
    if (phase === 'auth')
      mocks.getSession.mockImplementationOnce(async () => {
        await pause
        return { data: { session: { access_token: 'synthetic-only', user: { id: user } } }, error: null }
      })
    if (phase === 'post') holdReversal = pause
    if (phase === 'history') holdHistory = pause
    await reverse()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Refresh funds' }) as HTMLButtonElement).disabled).toBe(true),
    )
    if (phase !== 'auth') await waitFor(() => expect(posts).toHaveLength(1))
    const reads = vi.mocked(fetch).mock.calls.length
    expect((screen.getByRole('button', { name: 'Refresh funds' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Confirm allocation' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh funds' }))
    expect(vi.mocked(fetch).mock.calls).toHaveLength(reads)
    expect(sessionStorage.getItem(`${storage}:reversal`)).not.toBeNull()
    release()
    await screen.findByText('Original fund allocation reversed. No customer payout recorded.')
    expect(effects.reversal).toBe(1)
  },
)
