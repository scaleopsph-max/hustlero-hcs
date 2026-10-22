import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { wholesaleFundsContextSchema } from '@hcs/contracts'
import { WholesaleFundReversalForm } from './WholesaleFundReversalForm'

const id = '20000000-0000-4000-8000-000000000001'
const storage = 'synthetic-fund-reversal'
const result = {
  reversalId: id,
  paymentId: id,
  capitalMinor: 50000,
  operatingMinor: 30000,
  recordedAt: '2026-10-21T03:00:00Z',
}
const fixture = () =>
  wholesaleFundsContextSchema.parse({
    canManage: true,
    canReverse: true,
    funds: [],
    payments: [
      {
        paymentId: id,
        reference: 'Synthetic receipt',
        amountMinor: 80000,
        allocation: { paymentId: id, capitalMinor: 50000, operatingMinor: 30000, recordedAt: '2026-10-20T03:00:00Z' },
        reversal: null,
      },
    ],
  })
beforeEach(() => sessionStorage.clear())
afterEach(cleanup)

it('restores a lost-response command and retries exactly its original key and body', async () => {
  const command = {
    key: id,
    payload: { paymentId: id, reason: 'Original allocation reversal', reversalConfirmed: true },
  }
  sessionStorage.setItem(storage, JSON.stringify(command))
  const data = fixture(),
    history = fixture()
  history.payments[0]!.reversal = result
  const execute = vi.fn(async () => ({ result, history }))
  render(createElement(WholesaleFundReversalForm, { storage, data, execute }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry original reversal' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Retry original reversal' }))
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull())
  expect(execute).toHaveBeenCalledExactlyOnceWith(command)
  expect(screen.getByRole('status').textContent).toContain('No customer payout')
})
it('preserves uncertain commands through a reload instead of generating another key', async () => {
  const command = {
    key: id,
    payload: { paymentId: id, reason: 'Original allocation reversal', reversalConfirmed: true },
  }
  sessionStorage.setItem(storage, JSON.stringify(command))
  const execute = vi.fn(async () => {
    throw new Error('Response lost')
  })
  const props = { storage, data: fixture(), execute }
  const first = render(createElement(WholesaleFundReversalForm, props))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry original reversal' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Retry original reversal' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Dismiss rejected reversal' })).toBeNull()
  expect(JSON.parse(sessionStorage.getItem(storage)!)).toEqual(command)
  first.unmount()
  render(createElement(WholesaleFundReversalForm, props))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry original reversal' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Retry original reversal' }))
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  expect(execute.mock.calls[0]).toEqual(execute.mock.calls[1])
})
it('does not offer a write to a reader without reversal permission', () => {
  const data = fixture()
  data.canReverse = false
  const execute = vi.fn()
  render(createElement(WholesaleFundReversalForm, { storage, data, execute }))
  expect((screen.getByRole('button', { name: 'Reverse allocation' }) as HTMLButtonElement).disabled).toBe(true)
  expect(execute).not.toHaveBeenCalled()
})
it.each(['WHOLESALE_FUNDS_HCFD6', 'WHOLESALE_FUNDS_HCFD7'])(
  'allows explicit dismissal only after definitive rejection %s',
  async (code) => {
    const command = {
      key: id,
      payload: { paymentId: id, reason: 'Original allocation reversal', reversalConfirmed: true },
    }
    sessionStorage.setItem(storage, JSON.stringify(command))
    const execute = vi.fn(async () => {
      throw Object.assign(new Error('Definitive no-effect rejection'), { code })
    })
    render(createElement(WholesaleFundReversalForm, { storage, data: fixture(), execute }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry original reversal' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Retry original reversal' }))
    const dismiss = await screen.findByRole('button', { name: 'Dismiss rejected reversal' })
    expect(sessionStorage.getItem(storage)).not.toBeNull()
    fireEvent.click(dismiss)
    expect(sessionStorage.getItem(storage)).toBeNull()
    expect(screen.getByRole('button', { name: 'Reverse allocation' })).toBeTruthy()
    cleanup()
    render(createElement(WholesaleFundReversalForm, { storage, data: fixture(), execute }))
    expect(screen.queryByRole('button', { name: 'Retry original reversal' })).toBeNull()
  },
)
