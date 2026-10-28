import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { RetailDiscount, RetailDiscountCommand } from '@hcs/contracts'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
vi.mock('./Topbar', () => ({
  Topbar: ({ title, actions }: { title: string; actions: ReactNode }) =>
    createElement('header', null, createElement('h1', null, title), actions),
}))
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  id = '30000000-0000-4000-8000-000000000001'
const storage = `hcs-discounts:${user}:${tenant}`
let Workspace: typeof import('./DiscountsWorkspace').DiscountsWorkspace
let rows: RetailDiscount[],
  versions: RetailDiscount[],
  replies: Map<string, RetailDiscount>,
  posts: { key: string; body: string }[],
  effects: number
let lost: boolean, proofFailed: boolean, tamperProof: boolean, denied: string | null, hold: Promise<void> | null
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://discount-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://discount-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic')
  Workspace = (await import('./DiscountsWorkspace')).DiscountsWorkspace
})
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  rows = []
  versions = []
  replies = new Map()
  posts = []
  effects = 0
  lost = false
  proofFailed = false
  tamperProof = false
  denied = null
  hold = null
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic', user: { id: user } } },
    error: null,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      expect(init?.cache).toBe('no-store')
      if (path === '/v1/me')
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
      if (denied) return Response.json({ error: { code: denied, message: 'Synthetic denial' } }, { status: 403 })
      if (init?.method === 'POST') {
        const key = (init.headers as Record<string, string>)['Idempotency-Key']!,
          body = String(init.body)
        expect(JSON.parse(sessionStorage.getItem(storage)!).key).toBe(key)
        expect(JSON.stringify(JSON.parse(sessionStorage.getItem(storage)!).payload)).toBe(body)
        posts.push({ key, body })
        await hold
        let result = replies.get(key)
        if (!result) {
          const command = JSON.parse(body) as RetailDiscountCommand
          const previous = rows.find((row) => row.id === id)
          result =
            command.action === 'archive'
              ? { ...previous!, status: 'archived', revision: previous!.revision + 1 }
              : {
                  id,
                  name: command.name,
                  value: command.value,
                  status: command.status,
                  revision: command.action === 'create' ? 1 : command.expectedRevision + 1,
                  scope: 'retail_ticket',
                  updatedAt: '2026-10-27T00:00:00Z',
                }
          rows = [result]
          versions.push(structuredClone(result))
          replies.set(key, result)
          effects++
          if (lost) {
            lost = false
            throw new TypeError('Synthetic lost response')
          }
        }
        return Response.json(result)
      }
      if (path.endsWith('/versions')) return Response.json({ discountId: id, versions: [...versions].reverse() })
      if (path.includes('/versions/')) {
        if (proofFailed) {
          proofFailed = false
          throw new TypeError('Synthetic exact-version failure')
        }
        const snapshot = versions.find((row) => row.revision === Number(path.split('/').at(-1)))!
        return Response.json(tamperProof ? { ...snapshot, name: 'Tampered' } : snapshot)
      }
      return Response.json({ discounts: rows })
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
  await screen.findByLabelText('Discount name')
  return view
}
function create() {
  fireEvent.change(screen.getByLabelText('Discount name'), { target: { value: 'Promotion' } })
  fireEvent.change(screen.getByLabelText('Amount (PHP)'), { target: { value: '12.34' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add discount' }))
}
it('creates an inactive exact-cent predefined discount and proves its immutable revision', async () => {
  await mount()
  create()
  await screen.findByText('Discount saved.')
  expect(rows[0]).toMatchObject({ value: { kind: 'fixed', amountMinor: 1234 }, status: 'inactive' })
  expect(effects).toBe(1)
  expect(sessionStorage.getItem(storage)).toBeNull()
})
it('replays the original key and body after response loss and reload, even after later edits', async () => {
  const view = await mount()
  lost = true
  create()
  await screen.findByRole('alert')
  view.unmount()
  rows = [{ ...rows[0]!, name: 'Later version', revision: 2 }]
  versions.push(rows[0]!)
  render(createElement(Workspace))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original command' }))
  await screen.findByText('Discount saved.')
  expect(posts).toHaveLength(2)
  expect(posts[0]).toEqual(posts[1])
  expect(effects).toBe(1)
  expect(screen.getByText('Later version')).toBeTruthy()
  expect(sessionStorage.getItem(storage)).toBeNull()
})
it('retains original recovery if exact history proof cannot be read', async () => {
  await mount()
  proofFailed = true
  create()
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  expect(screen.queryByText('Discount saved.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry original command' }))
  await screen.findByText('Discount saved.')
  expect(effects).toBe(1)
  expect(posts[0]).toEqual(posts[1])
})
it('never clears recovery on altered proof', async () => {
  await mount()
  tamperProof = true
  create()
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  expect(screen.queryByText('Discount saved.')).toBeNull()
})
it('edits expected revisions and archives while preserving history', async () => {
  await mount()
  create()
  await screen.findByText('Discount saved.')
  fireEvent.click(screen.getByRole('button', { name: 'Edit Promotion' }))
  fireEvent.change(screen.getByLabelText('Discount type'), { target: { value: 'percent' } })
  fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '12.5' } })
  fireEvent.click(screen.getByLabelText('Active'))
  fireEvent.click(screen.getByRole('button', { name: 'Save discount' }))
  await waitFor(() => expect(rows[0]?.revision).toBe(2))
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull())
  expect(JSON.parse(posts[1]!.body)).toMatchObject({
    expectedRevision: 1,
    value: { kind: 'percent', rateBps: 1250 },
    status: 'active',
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Archive Promotion' }))
  await waitFor(() => expect(rows[0]?.status).toBe('archived'))
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'History Promotion' }))
  await screen.findByText('Discount history')
  expect(versions).toHaveLength(3)
  expect((screen.getByRole('button', { name: 'Edit Promotion' }) as HTMLButtonElement).disabled).toBe(true)
})
it.each(['', '{', 'null', '{}'])('fails closed with corrupt saved recovery %s', async (raw) => {
  sessionStorage.setItem(storage, raw)
  render(createElement(Workspace))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Add discount' })).toBeNull()
  expect(posts).toHaveLength(0)
  expect(sessionStorage.getItem(storage)).toBe(raw)
})
it('rejects 100 percent and fractional-cent form input without requests', async () => {
  await mount()
  fireEvent.change(screen.getByLabelText('Discount name'), { target: { value: 'Promotion' } })
  fireEvent.change(screen.getByLabelText('Discount type'), { target: { value: 'percent' } })
  fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '100' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add discount' }))
  await screen.findByRole('alert')
  expect(posts).toHaveLength(0)
  fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '1.234' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add discount' }))
  expect(posts).toHaveLength(0)
})
it('blocks duplicate mutation while a response waits and retains replaced storage', async () => {
  await mount()
  let release!: () => void
  hold = new Promise((resolve) => {
    release = resolve
  })
  create()
  await waitFor(() => expect(posts).toHaveLength(1))
  const saved = sessionStorage.getItem(storage)!
  const replacement = { ...JSON.parse(saved), key: 'a0000000-0000-4000-8000-000000000009' }
  sessionStorage.setItem(storage, JSON.stringify(replacement))
  release()
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(storage)).toBe(JSON.stringify(replacement))
  expect(posts).toHaveLength(1)
})
it('denies management before displaying controls when server access is missing', async () => {
  denied = 'DISCOUNT_ACCESS_DENIED'
  render(createElement(Workspace))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Add discount' })).toBeNull()
  expect(posts).toHaveLength(0)
})
it('retains pending command and refuses replay under another signed-in account', async () => {
  await mount()
  lost = true
  create()
  await screen.findByRole('alert')
  const original = sessionStorage.getItem(storage)
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'other', user: { id: '10000000-0000-4000-8000-000000000009' } } },
    error: null,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Retry original command' }))
  await screen.findByText('Sign in to the original account.')
  expect(posts).toHaveLength(1)
  expect(sessionStorage.getItem(storage)).toBe(original)
})
