'use client'

import { Search, UserPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { posCustomerCreateResponseSchema, posCustomerSearchResponseSchema, type PosCustomer } from '@hcs/contracts'
import { Button } from '@hcs/ui'
import { newIdempotencyKey, posRequest, writePosCustomer } from '@/lib/pos-api'

const input =
  'h-11 w-full border border-white/20 bg-white/[0.08] px-3 text-sm text-white placeholder:text-ink-300 outline-none focus:border-gold-400'

export function PosCustomerPicker({
  selected,
  onSelect,
}: {
  selected: PosCustomer | null
  onSelect: (customer: PosCustomer | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PosCustomer[]>([])
  const [creating, setCreating] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function choose(customer: PosCustomer | null) {
    writePosCustomer(customer)
    onSelect(customer)
    setOpen(false)
    setCreating(false)
    setError(null)
  }
  async function search(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setResults(
        posCustomerSearchResponseSchema.parse(await posRequest(`/v1/pos/customers?q=${encodeURIComponent(query)}`))
          .customers,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search customers.')
    } finally {
      setBusy(false)
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = posCustomerCreateResponseSchema.parse(
        await posRequest('/v1/pos/customers', {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('customer') },
          body: JSON.stringify({
            fullName,
            email: email.trim() || null,
            phone: phone.trim() || null,
            emailMarketingConsent: false,
            smsMarketingConsent: false,
          }),
        }),
      )
      choose({
        id: created.customerId,
        customerNumber: created.customerNumber,
        fullName: created.fullName,
        email: created.email,
        phone: created.phone,
        customerType: created.customerType,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create customer.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-y border-white/10 py-3">
      {selected ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-ink-300">Customer</div>
            <div className="truncate font-semibold text-white">{selected.fullName}</div>
          </div>
          <button
            type="button"
            aria-label="Remove customer"
            onClick={() => choose(null)}
            className="grid size-10 place-items-center border border-white/20 text-white"
          >
            <X size={17} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-center gap-2 border border-white/20 text-sm font-semibold text-white"
        >
          <UserPlus size={18} />
          Add customer
        </button>
      )}
      {open && !selected ? (
        <div className="mt-3 grid gap-3">
          {error ? (
            <div className="border-l-2 border-red-400 bg-red-950/60 p-2 text-xs text-red-100">{error}</div>
          ) : null}
          {!creating ? (
            <>
              <form className="flex gap-2" onSubmit={search}>
                <div className="relative flex-1">
                  <Search size={17} className="absolute left-3 top-3 text-ink-300" />
                  <input
                    className={`${input} pl-9`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Name, email, or phone"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={busy}>
                  Find
                </Button>
              </form>
              <div className="max-h-40 overflow-y-auto">
                {results.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => choose(customer)}
                    className="flex w-full items-center justify-between border-t border-white/10 px-1 py-3 text-left text-sm text-white"
                  >
                    <span>
                      <strong>{customer.fullName}</strong>
                      <span className="block text-xs text-ink-300">{customer.email ?? customer.phone}</span>
                    </span>
                    <span className="text-xs text-ink-300">{customer.customerNumber}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="text-left text-sm font-semibold text-gold-300"
              >
                Create new customer
              </button>
            </>
          ) : (
            <form className="grid gap-2" onSubmit={create}>
              <input
                className={input}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Full name"
                required
              />
              <input
                className={input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
              />
              <input
                className={input}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Phone"
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !fullName.trim() || (!email.trim() && !phone.trim())}
                >
                  Create and select
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  )
}
