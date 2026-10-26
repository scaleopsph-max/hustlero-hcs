import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
it.each(['', '{', 'null', '{}'])(
  'disables reversal controls when original saved recovery is corrupt: %s',
  async (stored) => {
    sessionStorage.setItem(storage, stored)
    const execute = vi.fn()
    const rendered = render(createElement(WholesaleFundReversalForm, { storage, data: fixture(), execute }))
    await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: 'Reverse allocation' }) as HTMLButtonElement).disabled).toBe(true)
    const fieldset = rendered.container.querySelector('fieldset')!
    expect(fieldset.disabled).toBe(true)
    fireEvent.submit(rendered.container.querySelector('form')!)
    expect(execute).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(storage)).toBe(stored)
    expect(screen.queryByRole('button', { name: 'Dismiss rejected reversal' })).toBeNull()
  },
)
it('does not let an unmounted older completion clear a newer pending reversal', async () => {
  const original = { key: id, payload: { paymentId: id, reason: 'Original reversal', reversalConfirmed: true } }
  sessionStorage.setItem(storage, JSON.stringify(original))
  type Outcome = { result: typeof result; history: ReturnType<typeof fixture> }
  let finishOriginal!: (value: Outcome) => void
  let finishNewer!: (value: Outcome) => void
  const originalReply = new Promise<Outcome>((resolve) => {
    finishOriginal = resolve
  })
  const newerReply = new Promise<Outcome>((resolve) => {
    finishNewer = resolve
  })
  const history = fixture()
  history.payments[0]!.reversal = result
  const execute = vi
    .fn()
    .mockImplementationOnce(() => originalReply)
    .mockResolvedValueOnce({ result, history })
    .mockImplementationOnce(() => newerReply)
  const old = render(createElement(WholesaleFundReversalForm, { storage, data: fixture(), execute }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original reversal' }))
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
  old.unmount()
  const current = render(createElement(WholesaleFundReversalForm, { storage, data: history, execute }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original reversal' }))
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull())
  const other = '20000000-0000-4000-8000-000000000002'
  const next = structuredClone(history)
  next.payments.push({
    ...fixture().payments[0]!,
    paymentId: other,
    reference: 'Newer receipt',
    allocation: { ...fixture().payments[0]!.allocation!, paymentId: other },
  })
  current.rerender(createElement(WholesaleFundReversalForm, { storage, data: next, execute }))
  fireEvent.change(screen.getByLabelText('Original allocated receipt'), { target: { value: other } })
  fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Newer reversal' } })
  fireEvent.click(screen.getByLabelText('Reverse the full original Capital / Operating allocation.'))
  fireEvent.click(screen.getByRole('button', { name: 'Reverse allocation' }))
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
  const newerSaved = sessionStorage.getItem(storage)
  expect(newerSaved).not.toBeNull()
  await act(async () => {
    finishOriginal({ result, history })
  })
  expect(sessionStorage.getItem(storage)).toBe(newerSaved)
  const newerResult = { ...result, paymentId: other, reversalId: other }
  next.payments[1]!.reversal = newerResult
  await act(async () => {
    finishNewer({ result: newerResult, history: next })
  })
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull())
})
it('does not dismiss another saved command after an older definitive rejection', async () => {
  const original = { key: id, payload: { paymentId: id, reason: 'Original reversal', reversalConfirmed: true } }
  sessionStorage.setItem(storage, JSON.stringify(original))
  const execute = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('Definitive rejection'), { code: 'WHOLESALE_FUNDS_HCFD6' }))
  render(createElement(WholesaleFundReversalForm, { storage, data: fixture(), execute }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original reversal' }))
  const dismiss = await screen.findByRole('button', { name: 'Dismiss rejected reversal' })
  const newer = {
    ...original,
    key: '20000000-0000-4000-8000-000000000002',
    payload: { ...original.payload, reason: 'Newer reversal' },
  }
  const saved = JSON.stringify(newer)
  sessionStorage.setItem(storage, saved)
  fireEvent.click(dismiss)
  expect(sessionStorage.getItem(storage)).toBe(saved)
})
it.each([true, false])('does not overwrite newer saved recovery on submit; old pending=%s', async (restoreOriginal) => {
  const original = { key: id, payload: { paymentId: id, reason: 'Original reversal', reversalConfirmed: true } }
  if (restoreOriginal) sessionStorage.setItem(storage, JSON.stringify(original))
  const execute = vi.fn()
  render(createElement(WholesaleFundReversalForm, { storage, data: fixture(), execute }))
  if (!restoreOriginal) {
    fireEvent.change(screen.getByLabelText('Original allocated receipt'), { target: { value: id } })
    fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Fresh reversal' } })
    fireEvent.click(screen.getByLabelText('Reverse the full original Capital / Operating allocation.'))
  }
  const newer = { ...original, key: '20000000-0000-4000-8000-000000000002' }
  const saved = JSON.stringify(newer)
  sessionStorage.setItem(storage, saved)
  fireEvent.click(
    await screen.findByRole('button', { name: restoreOriginal ? 'Retry original reversal' : 'Reverse allocation' }),
  )
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(storage)).toBe(saved)
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
