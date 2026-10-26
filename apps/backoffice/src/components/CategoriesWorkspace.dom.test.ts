import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { CatalogCategoriesContext, CatalogCategoryCommand } from '@hcs/contracts'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
vi.mock('./Topbar', () => ({
  Topbar: ({ title, actions }: { title: string; actions: ReactNode }) =>
    createElement('header', null, createElement('h1', null, title), actions),
}))
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  id = '30000000-0000-4000-8000-000000000001'
const storage = `hcs-categories:${user}:${tenant}`
let Workspace: typeof import('./CategoriesWorkspace').CategoriesWorkspace
let current: CatalogCategoriesContext, posts: { key: string; body: string }[], effects: number
let lost: boolean, failHistory: boolean, hold: Promise<void> | null
let replies: Map<string, unknown>
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://category-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://category-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-only')
  Workspace = (await import('./CategoriesWorkspace')).CategoriesWorkspace
})
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  posts = []
  effects = 0
  lost = false
  failHistory = false
  hold = null
  replies = new Map()
  current = { canManage: true, categories: [] }
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic-only', user: { id: user } } },
    error: null,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
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
      if (init?.method === 'POST') {
        const saved = restoreSaved(),
          key = (init.headers as Record<string, string>)['Idempotency-Key']!
        expect(saved?.key).toBe(key)
        expect(JSON.stringify(saved?.payload)).toBe(init.body)
        posts.push({ key, body: String(init.body) })
        await hold
        let result = replies.get(key)
        if (!result) {
          const body = JSON.parse(String(init.body)) as CatalogCategoryCommand
          if (body.action === 'create')
            current.categories.push({ id, name: body.name, status: 'active', productCount: 0, pricingGroupCount: 0 })
          else {
            const row = current.categories.find((c) => c.id === body.categoryId)!
            if (body.action === 'rename') row.name = body.name
            else row.status = 'archived'
          }
          const row = current.categories.find((c) => c.id === (body.action === 'create' ? id : body.categoryId))!
          result = { categoryId: row.id, name: row.name, status: row.status }
          replies.set(key, result)
          effects++
        }
        if (lost) {
          lost = false
          throw new TypeError('Synthetic lost response')
        }
        return Response.json(result)
      }
      if (failHistory && posts.length) {
        failHistory = false
        throw new TypeError('Synthetic history failure')
      }
      return Response.json(current)
    }),
  )
})
function restoreSaved() {
  return JSON.parse(sessionStorage.getItem(storage) ?? 'null') as {
    key: string
    payload: CatalogCategoryCommand
  } | null
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(() => vi.unstubAllEnvs())
async function mount() {
  const view = render(createElement(Workspace))
  await screen.findByLabelText('New category')
  return view
}
function create() {
  fireEvent.change(screen.getByLabelText('New category'), { target: { value: 'Shoes' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
}
it('creates and displays one category through the authorized context', async () => {
  await mount()
  create()
  await screen.findByText('Category saved.')
  expect(current.categories[0]?.name).toBe('Shoes')
  expect(effects).toBe(1)
  expect(sessionStorage.getItem(storage)).toBeNull()
})
it('recovers a lost response after reload with the identical key/body and one effect', async () => {
  const first = await mount()
  lost = true
  create()
  await screen.findByRole('alert')
  const saved = sessionStorage.getItem(storage)
  expect(saved).not.toBeNull()
  first.unmount()
  await mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original command' }))
  await screen.findByText('Category saved.')
  expect(posts).toHaveLength(2)
  expect(posts[0]).toEqual(posts[1])
  expect(effects).toBe(1)
})
it('retains recovery when the successful POST cannot refresh history', async () => {
  await mount()
  failHistory = true
  create()
  await screen.findByRole('alert')
  expect(screen.queryByText('Category saved.')).toBeNull()
  expect(sessionStorage.getItem(storage)).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry original command' }))
  await screen.findByText('Category saved.')
  expect(effects).toBe(1)
  expect(posts[0]).toEqual(posts[1])
})
it.each(['', '{', 'null', '{}'])('fails closed without replacing corrupt recovery %s', async (value) => {
  sessionStorage.setItem(storage, value)
  render(createElement(Workspace))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull()
  expect(posts).toHaveLength(0)
  expect(sessionStorage.getItem(storage)).toBe(value)
})
it('keeps reader controls disabled', async () => {
  current.canManage = false
  await mount()
  expect((screen.getByRole('button', { name: 'Add category' }) as HTMLButtonElement).disabled).toBe(true)
  expect(posts).toHaveLength(0)
})
it('blocks refresh and duplicate submits while a POST waits', async () => {
  await mount()
  let release!: () => void
  hold = new Promise((resolve) => {
    release = resolve
  })
  create()
  await waitFor(() => expect(posts).toHaveLength(1))
  expect((screen.getByRole('button', { name: 'Refresh categories' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
  expect(posts).toHaveLength(1)
  release()
  await screen.findByText('Category saved.')
})
it('renames without changing identity and disables archival while references exist', async () => {
  current.categories = [{ id, name: 'Shoes', status: 'active', productCount: 2, pricingGroupCount: 1 }]
  await mount()
  expect((screen.getByRole('button', { name: 'Archive Shoes' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Rename Shoes' }))
  fireEvent.change(screen.getByLabelText('Rename category'), { target: { value: 'Footwear' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Category saved.')
  expect(current.categories[0]?.id).toBe(id)
  expect(current.categories[0]?.name).toBe('Footwear')
})
