import { createElement, StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
import { CatalogImportExecutionPanel } from './CatalogImportExecution'
import type { CatalogImportExecution } from '@hcs/contracts'
const user = '1c000000-0000-4000-8000-000000000001',
  tenant = '2c000000-0000-4000-8000-000000000001',
  jobId = '3c000000-0000-4000-8000-000000000001',
  executionId = '4c000000-0000-4000-8000-000000000001',
  product = '5c000000-0000-4000-8000-000000000001',
  variant = '6c000000-0000-4000-8000-000000000001'
const hash = 'a'.repeat(64),
  source = { filename: 'test.csv', rows: [{ product_name: 'Shoes', sku: 'SHOE-8', retail_price: '499.99' }] }
const job = {
  id: jobId,
  filename: source.filename,
  uploaderId: user,
  state: 'preview' as const,
  rowCount: 1,
  rejectedCount: 0,
  proposedCreates: 1,
  proposedUpdates: 0,
  createdAt: '2026-10-27T00:00:00Z',
  cancelledAt: null,
  source,
  rows: planCatalogImport(source.rows, { categories: [], products: [] }),
}
let execution: CatalogImportExecution | null,
  lostStart: boolean,
  lostStep: boolean,
  deny: boolean,
  stale: boolean,
  storageError: boolean,
  posts: unknown[],
  effects: number
const checked = vi.fn()
function setup() {
  const call = vi.fn(async (path: string, body?: unknown, key?: string) => {
    if (deny) throw new Error('Access revoked')
    if (path.endsWith('/review')) return { hash, jobId, groupCount: 1 }
    if (body) {
      const command = body as { action: string; reviewHash: string; groupIndex: number }
      posts.push(structuredClone({ body, key }))
      if (command.action === 'start') {
        if (stale) throw Object.assign(new Error('Catalog changed'), { code: 'CATALOG_CHANGED' })
        if (!execution)
          execution = {
            id: executionId,
            jobId,
            state: 'running',
            groupCount: 1,
            nextGroup: 0,
            confirmedBy: user,
            requestKey: key!,
            reviewHash: command.reviewHash,
            confirmedAt: '2026-10-27T00:00:00Z',
            completedAt: null,
            results: [],
          }
        if (lostStart) {
          lostStart = false
          throw new Error('Lost confirmation response')
        }
      } else {
        if (!execution) throw new Error('Confirm first')
        if (execution.nextGroup === 0) {
          effects++
          execution = {
            ...execution,
            state: 'completed',
            nextGroup: 1,
            completedAt: '2026-10-27T00:00:01Z',
            results: [
              {
                groupIndex: command.groupIndex,
                rowNumber: 2,
                outcome: 'created',
                productId: product,
                variantId: variant,
                errorCode: null,
                recordedAt: '2026-10-27T00:00:01Z',
              },
            ],
          }
        }
        if (lostStep) {
          lostStep = false
          throw new Error('Lost group response')
        }
      }
    }
    return { execution: structuredClone(execution) }
  })
  const props = { job, user, tenant, call, onChecked: checked }
  return {
    call,
    props,
    mount: async (strict = false) => {
      render(
        strict
          ? createElement(StrictMode, null, createElement(CatalogImportExecutionPanel, props))
          : createElement(CatalogImportExecutionPanel, props),
      )
      await waitFor(() =>
        expect((screen.getByRole('button', { name: 'Refresh import execution' }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      )
    },
  }
}
beforeEach(() => {
  sessionStorage.clear()
  execution = null
  lostStart = false
  lostStep = false
  deny = false
  stale = false
  storageError = false
  posts = []
  effects = 0
  checked.mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
async function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
  fireEvent.click(await screen.findByRole('button', { name: /Confirm import/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Confirm import/ })).toBeNull())
}
it('reviews, explicitly confirms and posts the bounded group with reconciled results', async () => {
  const { mount } = setup()
  await mount()
  await confirm()
  expect(posts).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Continue import' }))
  await screen.findByText('completed')
  expect(effects).toBe(1)
  expect(sessionStorage.length).toBe(0)
  expect(screen.getByText(variant)).toBeTruthy()
})
it('recovers a lost confirmation after remount with the original key/hash', async () => {
  const { mount } = setup()
  await mount()
  lostStart = true
  await confirm()
  await screen.findByRole('alert')
  const original = posts[0]
  cleanup()
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Retry confirmation' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry confirmation' })).toBeNull())
  expect(posts[1]).toEqual(original)
  expect(effects).toBe(0)
  expect(sessionStorage.length).toBe(0)
})
it('retries the original group after lost success even when durable execution is already completed', async () => {
  const { mount } = setup()
  await mount()
  await confirm()
  lostStep = true
  fireEvent.click(screen.getByRole('button', { name: 'Continue import' }))
  await screen.findByRole('alert')
  expect(effects).toBe(1)
  const original = posts[1]
  cleanup()
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Retry group' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry group' })).toBeNull())
  expect(posts[2]).toEqual(original)
  expect(effects).toBe(1)
  expect(sessionStorage.length).toBe(0)
})
it('does not send confirmation if pending storage cannot be written', async () => {
  const { mount } = setup()
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
  await screen.findByRole('button', { name: /Confirm import/ })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    storageError = true
    throw new Error('Storage unavailable')
  })
  fireEvent.click(screen.getByRole('button', { name: /Confirm import/ }))
  await screen.findByRole('alert')
  expect(storageError).toBe(true)
  expect(posts).toHaveLength(0)
})
it('retains uncertain pending state on permission denial', async () => {
  const { mount } = setup()
  await mount()
  await confirm()
  lostStep = true
  fireEvent.click(screen.getByRole('button', { name: 'Continue import' }))
  await screen.findByRole('alert')
  deny = true
  fireEvent.click(screen.getByRole('button', { name: 'Retry group' }))
  await screen.findByRole('alert')
  expect(sessionStorage.length).toBe(1)
  expect(effects).toBe(1)
})
it('permits explicit rejected-confirmation discard only after independent no-execution lookup', async () => {
  const { mount } = setup()
  await mount()
  stale = true
  await confirm()
  await screen.findByRole('alert')
  fireEvent.click(await screen.findByRole('button', { name: 'Discard rejected confirmation' }))
  expect(sessionStorage.length).toBe(0)
  expect(screen.getByRole('button', { name: 'Review import' })).toBeTruthy()
  expect(effects).toBe(0)
})
it('does not strand loading under StrictMode and never posts on mount', async () => {
  const { mount } = setup()
  await mount(true)
  expect(posts).toHaveLength(0)
  expect(checked).toHaveBeenCalledWith(false)
})
it('does not offer confirmation for a cancelled preview', async () => {
  const { props } = setup()
  render(
    createElement(CatalogImportExecutionPanel, {
      ...props,
      job: { ...job, state: 'cancelled', cancelledAt: '2026-10-27T00:00:00Z' },
    }),
  )
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Refresh import execution' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  expect(screen.queryByRole('button', { name: 'Review import' })).toBeNull()
})
