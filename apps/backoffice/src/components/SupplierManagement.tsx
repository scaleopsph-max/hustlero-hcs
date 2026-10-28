'use client'
import { useEffect, useRef, useState } from 'react'
import {
  purchasingContextSchema,
  supplierUpdateRequestSchema,
  supplierUpdateResponseSchema,
  type PurchasingContext,
} from '@hcs/contracts'
import { Button } from '@hcs/ui'
import { z } from 'zod'
const pendingSchema = z.strictObject({
  actor: z.uuid(),
  tenant: z.uuid(),
  supplierId: z.uuid(),
  key: z.uuid(),
  body: supplierUpdateRequestSchema,
})
type Pending = z.infer<typeof pendingSchema>
const apiUrl = process.env.NEXT_PUBLIC_API_URL
export function SupplierManagement({
  actor,
  tenant,
  token,
  data,
  refresh,
}: {
  actor: string
  tenant: string
  token: string
  data: PurchasingContext
  refresh: () => Promise<void>
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [contact, setContact] = useState(''),
    [phone, setPhone] = useState(''),
    [email, setEmail] = useState('')
  const [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false),
    storage = `hcs-supplier-update:${tenant}:${actor}`,
    supplier = data.suppliers.find((row) => row.id === selected)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storage)
      if (raw) {
        const value = pendingSchema.parse(JSON.parse(raw))
        if (value.actor !== actor || value.tenant !== tenant) throw new Error()
        setPending(value)
      }
    } catch {
      setBlocked(true)
      setError('Saved supplier request needs reconciliation.')
    }
  }, [storage, actor, tenant])
  function choose(id: string) {
    const value = data.suppliers.find((row) => row.id === id)
    setSelected(id)
    if (value) {
      setName(value.name)
      setContact(value.contactName ?? '')
      setPhone(value.contactPhone ?? '')
      setEmail(value.contactEmail ?? '')
    }
  }
  async function run(value: Pending) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      if (!apiUrl) throw new Error('Back Office API is not configured.')
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved supplier request changed; reconciliation required.')
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/purchasing/suppliers/${value.supplierId}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': tenant,
          'Content-Type': 'application/json',
          'Idempotency-Key': value.key,
        },
        body: JSON.stringify(value.body),
      })
      const raw: unknown = await response.json()
      if (!response.ok)
        throw new Error((raw as { error?: { message?: string } }).error?.message ?? 'Supplier update failed.')
      const result = supplierUpdateResponseSchema.parse(raw)
      if (
        result.supplierId !== value.supplierId ||
        result.revision !== value.body.expectedRevision + 1 ||
        result.status !== (value.body.archive ? 'archived' : 'active')
      )
        throw new Error('Supplier response did not match request.')
      const proofResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/purchasing`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant },
      })
      if (!proofResponse.ok) throw new Error('Supplier state could not be verified; retry the original request.')
      const proof = purchasingContextSchema
        .parse(await proofResponse.json())
        .suppliers.find((row) => row.id === value.supplierId)
      if (
        !proof ||
        proof.revision === undefined ||
        proof.revision < result.revision ||
        (value.body.archive && proof.status !== 'archived')
      )
        throw new Error('Supplier state could not be verified; reconcile the request.')
      await refresh()
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved supplier request changed; reconciliation required.')
      sessionStorage.removeItem(storage)
      setPending(null)
      setSelected('')
      setNotice(value.body.archive ? 'Supplier archived; purchase history remains.' : 'Supplier updated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Supplier outcome is unknown.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function save(archive: boolean) {
    if (!supplier || supplier.revision === undefined || pending || blocked || busy || lock.current) return
    try {
      const value = pendingSchema.parse({
        actor,
        tenant,
        supplierId: supplier.id,
        key: crypto.randomUUID(),
        body: {
          expectedRevision: supplier.revision,
          name: archive ? supplier.name : name.trim(),
          contactName: archive ? supplier.contactName : contact.trim() || null,
          contactPhone: archive ? supplier.contactPhone : phone.trim() || null,
          contactEmail: archive ? supplier.contactEmail : email.trim() || null,
          archive,
        },
      })
      if (sessionStorage.getItem(storage)) throw new Error('A previous supplier request needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(value))
      setPending(value)
      await run(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check supplier details.')
    }
  }
  return (
    <section className="mt-5 border-t border-ink-900/10 pt-4">
      <h3 className="font-semibold">Manage suppliers</h3>
      <label className="mt-2 block text-sm">
        Search suppliers
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="ml-2 rounded border p-2" />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-green-700">
          {notice}
        </p>
      ) : null}
      {pending ? (
        <div className="mt-2 text-sm">
          <p>A previous supplier request needs reconciliation.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void run(pending)}>
            Retry supplier request
          </Button>
        </div>
      ) : null}
      <div className="mt-2 grid gap-2">
        {data.suppliers
          .filter((row) => `${row.name} ${row.contactName ?? ''}`.toLowerCase().includes(query.toLowerCase()))
          .map((row) => (
            <button
              key={row.id}
              type="button"
              disabled={busy || !!pending || blocked}
              className="rounded border p-2 text-left text-sm"
              onClick={() => choose(row.id)}
            >
              {row.name} · {row.status}
            </button>
          ))}
      </div>
      {supplier ? (
        <div className="mt-4 grid gap-2">
          <h4 className="font-semibold">
            {supplier.name} · {supplier.status}
          </h4>
          <label className="text-sm">
            Supplier name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="ml-2 rounded border p-2"
              disabled={supplier.status !== 'active' || busy || !!pending || blocked}
            />
          </label>
          <label className="text-sm">
            Contact person
            <input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              className="ml-2 rounded border p-2"
              disabled={supplier.status !== 'active' || busy || !!pending || blocked}
            />
          </label>
          <label className="text-sm">
            Phone
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="ml-2 rounded border p-2"
              disabled={supplier.status !== 'active' || busy || !!pending || blocked}
            />
          </label>
          <label className="text-sm">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              className="ml-2 rounded border p-2"
              disabled={supplier.status !== 'active' || busy || !!pending || blocked}
            />
          </label>
          {supplier.status === 'active' ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={supplier.revision === undefined || busy || !!pending || blocked}
                onClick={() => void save(false)}
              >
                Save supplier
              </Button>
              <Button
                variant="secondary"
                disabled={supplier.revision === undefined || busy || !!pending || blocked}
                onClick={() => void save(true)}
              >
                Archive supplier
              </Button>
            </div>
          ) : null}
          <h5 className="mt-2 font-semibold">Purchase history</h5>
          {data.orders
            .filter((row) => row.supplierId === supplier.id)
            .map((order) => (
              <p key={order.id} className="text-sm">
                {order.orderNumber} · {order.status} · {order.supplierName}
                {order.supplierSnapshotSource === 'migration_baseline' ? ' (name recorded at migration)' : ''}
              </p>
            ))}
          {!data.orders.some((row) => row.supplierId === supplier.id) ? (
            <p className="text-sm">No purchase orders in your accessible locations.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
