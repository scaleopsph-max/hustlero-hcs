'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Glass } from '@hcs/ui'
import {
  inventoryCountDraftSchema,
  inventoryCountListSchema,
  inventoryStockContextSchema,
  sessionContextResponseSchema,
  type InventoryCountDraft,
  type InventoryCountList,
  type InventoryStockContext,
} from '@hcs/contracts'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import {
  CountCommandError,
  canDiscardCountCommand,
  countQuantity,
  countQuantityToMilli,
  countStorage,
  decodePendingCount,
  pendingCountSchema,
  type PendingCount,
} from '@/lib/inventory-count-recovery'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

async function request(path: string, token: string, tenant: string, init?: RequestInit) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenant,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } }).error
    throw new CountCommandError(error?.message ?? 'Request failed.', error?.code ?? 'UNKNOWN')
  }
  return data
}

export function InventoryCountsWorkspace() {
  const [actor, setActor] = useState(''),
    [tenant, setTenant] = useState(''),
    [token, setToken] = useState('')
  const [list, setList] = useState<InventoryCountList | null>(null),
    [stock, setStock] = useState<InventoryStockContext | null>(null)
  const [count, setCount] = useState<InventoryCountDraft | null>(null),
    [entries, setEntries] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState('')
  const [pending, setPending] = useState<PendingCount | null>(null),
    [blocked, setBlocked] = useState(false),
    [discardable, setDiscardable] = useState(false)
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  const commandLock = useRef(false),
    mounted = useRef(true)
  const storage = countStorage(tenant, actor)
  const capability = list?.locations.find((row) => row.id === (count?.locationId ?? stock?.selectedLocationId))
  const creationCapability = list?.locations.find((row) => row.id === stock?.selectedLocationId)
  const stale = Boolean(
    count?.lines.some(
      (line) =>
        line.currentOnHandMilli == null ||
        line.currentBalanceVersion == null ||
        line.currentOnHandMilli !== line.expectedMilli ||
        line.currentBalanceVersion !== line.balanceVersion,
    ),
  )
  const dirty = Boolean(
    count?.lines.some((line) => {
      const value = entries[line.variantId] ?? ''
      if (!value.trim()) return line.countedMilli !== null
      try {
        return countQuantityToMilli(value) !== line.countedMilli
      } catch {
        return true
      }
    }),
  )

  const loadList = useCallback(async (accessToken: string, business: string) => {
    const value = inventoryCountListSchema.parse(await request('/v1/inventory/counts', accessToken, business))
    if (mounted.current) setList(value)
    return value
  }, [])
  const loadCount = useCallback(async (accessToken: string, business: string, id: string) => {
    const value = inventoryCountDraftSchema.parse(await request(`/v1/inventory/counts/${id}`, accessToken, business))
    if (mounted.current) {
      setCount(value)
      setEntries(
        Object.fromEntries(
          value.lines.map((line) => [
            line.variantId,
            line.countedMilli === null ? '' : countQuantity(line.countedMilli),
          ]),
        ),
      )
    }
    return value
  }, [])
  const loadStock = useCallback(async (accessToken: string, business: string, location?: string) => {
    const value = inventoryStockContextSchema.parse(
      await request(
        `/v1/inventory/stock${location ? `?locationId=${encodeURIComponent(location)}` : ''}`,
        accessToken,
        business,
      ),
    )
    if (mounted.current) {
      setStock(value)
      setSelected([])
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    const auth = createClient(supabaseUrl, supabaseKey)
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to use inventory counts.')
        const accessToken = data.session.access_token,
          session = sessionContextResponseSchema.parse(await request('/v1/me', accessToken, '')),
          business = selectActiveTenant(session.tenants)
        if (!business) throw new Error('Select an authorized business.')
        if (!mounted.current) return
        setActor(session.userId)
        setTenant(business.tenantId)
        setToken(accessToken)
        try {
          const raw = sessionStorage.getItem(countStorage(business.tenantId, session.userId))
          if (raw) setPending(decodePendingCount(raw, business.tenantId, session.userId))
        } catch {
          setBlocked(true)
          throw new Error('Saved count command needs reconciliation before another action.')
        }
        await loadList(accessToken, business.tenantId)
        // Staff with explicit count access can use existing counts without inventory.read.
        try {
          await loadStock(accessToken, business.tenantId)
        } catch {
          if (mounted.current) setStock(null)
        }
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load inventory counts.')
      } finally {
        if (mounted.current) setLoading(false)
      }
    })
  }, [loadList, loadStock])

  async function execute(command: PendingCount) {
    if (commandLock.current) return
    commandLock.current = true
    setBusy(true)
    setError(null)
    setDiscardable(false)
    let rejectedAtPost = false
    try {
      const original = JSON.stringify(command),
        restored = decodePendingCount(sessionStorage.getItem(storage) ?? '', tenant, actor)
      if (JSON.stringify(restored) !== original)
        throw new Error('Saved count command changed; reconciliation is required.')
      const path =
        command.action === 'create'
          ? '/v1/inventory/counts'
          : `/v1/inventory/counts/${command.countId}/${command.action}`
      let data: unknown
      try {
        data = await request(path, token, tenant, {
          method: 'POST',
          headers: { 'Idempotency-Key': command.key },
          body: command.body,
        })
      } catch (cause) {
        rejectedAtPost = canDiscardCountCommand(cause)
        throw cause
      }
      const result = inventoryCountDraftSchema.parse(data)
      if (command.countId && result.id !== command.countId)
        throw new Error('Count response does not match the original request.')
      const body = JSON.parse(command.body) as { expectedRevision?: number }
      if (command.action === 'create' ? result.revision !== 1 : result.revision !== (body.expectedRevision ?? 0) + 1)
        throw new Error('Count response revision does not match the original request.')
      if (command.action === 'post' && (result.status !== 'posted' || !result.movementIds))
        throw new Error('Posting response needs reconciliation.')
      if (!mounted.current) return
      const current = await loadCount(token, tenant, result.id)
      if (!mounted.current) return
      if (
        current.id !== result.id ||
        current.revision < result.revision ||
        (command.action === 'post' && current.status !== 'posted')
      )
        throw new Error('Count history could not be verified; retry the original request.')
      await loadList(token, tenant)
      if (!mounted.current) return
      if (sessionStorage.getItem(storage) !== original)
        throw new Error('Saved count command changed; reconciliation is required.')
      sessionStorage.removeItem(storage)
      setPending(null)
      setReason('')
      setSelected([])
      setNotice(
        command.action === 'post'
          ? `Count posted with ${result.movementIds?.length ?? 0} recorded adjustments.`
          : `Count ${command.action === 'create' ? 'created' : command.action === 'entries' ? 'saved' : command.action === 'approval' ? 'decision recorded' : command.action === 'submit' ? 'submitted' : 'cancelled'}.`,
      )
      if (command.action === 'post' && stock)
        void loadStock(token, tenant, stock.selectedLocationId).catch(() => setStock(null))
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Count outcome is unknown.')
        setDiscardable(rejectedAtPost)
      }
    } finally {
      commandLock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function start(action: PendingCount['action'], body: unknown, countId: string | null) {
    if (pending || blocked || commandLock.current) return
    try {
      const command = pendingCountSchema.parse({
        version: 1,
        actorId: actor,
        tenantId: tenant,
        key: crypto.randomUUID(),
        action,
        countId,
        body: JSON.stringify(body),
      })
      if (sessionStorage.getItem(storage)) throw new Error('An earlier count action needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(command))
      setPending(command)
      setError(null)
      await execute(command)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare count action.')
    }
  }
  async function createCount() {
    if (!stock || !creationCapability?.canCreate || !selected.length) return
    await start('create', { locationId: stock.selectedLocationId, variantIds: selected }, null)
  }
  async function saveEntries() {
    if (!count || !capability?.canEnter) return
    try {
      const rows = count.lines
        .filter((line) => entries[line.variantId]?.trim())
        .map((line) => ({ variantId: line.variantId, countedMilli: countQuantityToMilli(entries[line.variantId]!) }))
      if (!rows.length) throw new Error('Enter at least one counted quantity.')
      await start('entries', { expectedRevision: count.revision, entries: rows }, count.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the quantities.')
    }
  }
  const disabled = busy || !!pending || blocked
  if (loading)
    return (
      <Glass variant="light" className="p-6">
        Loading inventory counts...
      </Glass>
    )
  if (!list)
    return (
      <div role="alert" className="border-l-2 border-red-600 bg-red-50 p-4">
        {error ?? 'Inventory counts are unavailable.'}
      </div>
    )
  return (
    <div className="grid gap-5">
      {error ? (
        <div role="alert" className="border-l-2 border-red-600 bg-red-50 p-4 text-red-900">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="border-l-2 border-green-600 bg-green-50 p-4 text-green-900">
          {notice}
        </div>
      ) : null}
      {pending ? (
        <section className="rounded border border-amber-600 bg-amber-50 p-4" role="status">
          <p>A count action has an unknown result. Retry the original request before starting another action.</p>
          <Button variant="primary" disabled={busy} onClick={() => void execute(pending)}>
            Retry original count action
          </Button>
          {discardable ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                try {
                  if (sessionStorage.getItem(storage) !== JSON.stringify(pending))
                    throw new Error('Saved count command changed.')
                  sessionStorage.removeItem(storage)
                  setPending(null)
                  setDiscardable(false)
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Could not discard request.')
                }
              }}
            >
              Discard rejected action
            </Button>
          ) : null}
        </section>
      ) : null}
      {stock ? (
        <Glass variant="light" className="p-5">
          <h2 className="font-display text-xl font-bold">Start a physical count</h2>
          <label className="mt-3 grid max-w-sm gap-1 text-sm">
            Location
            <select
              value={stock.selectedLocationId}
              disabled={disabled}
              onChange={(event) =>
                void loadStock(token, tenant, event.target.value).catch((cause) =>
                  setError(cause instanceof Error ? cause.message : 'Could not load location.'),
                )
              }
              className="rounded border border-ink-900/20 bg-white px-3 py-2"
            >
              {stock.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          {list.locations.find((row) => row.id === stock.selectedLocationId)?.canCreate ? (
            <>
              <p className="mt-3 text-sm text-ink-600">
                Select products with recorded stock. Starting a count does not change inventory.
              </p>
              <div className="mt-3 max-h-72 overflow-auto border border-ink-900/10">
                {stock.items
                  .filter((item) => item.hasBalance && item.onHandMilli >= 0)
                  .map((item) => (
                    <label key={item.variantId} className="flex gap-3 border-b border-ink-900/10 p-3 text-sm">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selected.includes(item.variantId)}
                        onChange={(event) =>
                          setSelected((old) =>
                            event.target.checked ? [...old, item.variantId] : old.filter((id) => id !== item.variantId),
                          )
                        }
                      />
                      <span>
                        {item.productName} · {item.variantName} <span className="text-ink-500">({item.sku})</span>
                      </span>
                    </label>
                  ))}
              </div>
              <Button
                variant="primary"
                disabled={disabled || !selected.length || selected.length > 500}
                onClick={() => void createCount()}
              >
                Create PCOUNT ({selected.length})
              </Button>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-600">
              Only an Owner or assigned Manager can create a count at this location.
            </p>
          )}
        </Glass>
      ) : (
        <p className="text-sm text-ink-600">Open an existing count below to enter quantities.</p>
      )}
      <Glass variant="light" className="p-5">
        <h2 className="font-display text-xl font-bold">Recent counts</h2>
        <p className="text-sm text-ink-500">Latest 100 counts in your assigned locations.</p>
        {list.counts.length ? (
          <div className="mt-3 grid gap-2">
            {list.counts.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={disabled}
                onClick={() =>
                  void loadCount(token, tenant, row.id).catch((cause) =>
                    setError(cause instanceof Error ? cause.message : 'Could not load count.'),
                  )
                }
                className="rounded border border-ink-900/15 bg-white p-3 text-left text-sm"
              >
                <strong>PCOUNT {row.id}</strong> ·{' '}
                {list.locations.find((location) => location.id === row.locationId)?.name ?? 'Assigned location'} ·{' '}
                {row.status.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">No counts yet.</p>
        )}
      </Glass>
      {count ? (
        <Glass variant="light" className="p-5">
          <h2 className="font-display text-xl font-bold">PCOUNT {count.id}</h2>
          <p className="mt-1 text-sm">
            {list.locations.find((location) => location.id === count.locationId)?.name ?? 'Assigned location'} ·{' '}
            {count.status.replaceAll('_', ' ')} · revision {count.revision}
          </p>
          {stale && !['posted', 'cancelled'].includes(count.status) ? (
            <div className="mt-3 border-l-2 border-amber-600 bg-amber-50 p-3 text-sm">
              Stock changed since this count started. An Owner or Manager must cancel it and start a fresh recount
              before posting.
            </div>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Item</th>
                  <th className="p-2">Expected</th>
                  <th className="p-2">Current</th>
                  <th className="p-2">Counted</th>
                  <th className="p-2">Variance</th>
                </tr>
              </thead>
              <tbody>
                {count.lines.map((line) => {
                  const value = entries[line.variantId] ?? '',
                    editable = ['draft', 'counting'].includes(count.status) && !!capability?.canEnter
                  let variance = '—'
                  try {
                    if (value.trim()) variance = countQuantity(countQuantityToMilli(value) - line.expectedMilli)
                  } catch {
                    variance = '—'
                  }
                  return (
                    <tr key={line.variantId} className="border-b">
                      <td className="p-2">
                        {line.productName ?? line.variantId} · {line.variantName ?? ''}
                        <div className="text-xs text-ink-500">{line.sku ?? ''}</div>
                      </td>
                      <td className="p-2">{countQuantity(line.expectedMilli)}</td>
                      <td className="p-2">
                        {line.currentOnHandMilli == null ? 'Unavailable' : countQuantity(line.currentOnHandMilli)}
                      </td>
                      <td className="p-2">
                        {editable ? (
                          <input
                            aria-label={`Counted ${line.productName ?? line.variantId} ${line.variantName ?? ''}`}
                            inputMode="decimal"
                            value={value}
                            disabled={disabled}
                            onChange={(event) =>
                              setEntries((old) => ({ ...old, [line.variantId]: event.target.value }))
                            }
                            className="w-28 rounded border border-ink-900/25 bg-white px-2 py-1"
                          />
                        ) : line.countedMilli === null ? (
                          'Not counted'
                        ) : (
                          countQuantity(line.countedMilli)
                        )}
                      </td>
                      <td className="p-2">{variance}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {dirty && ['draft', 'counting'].includes(count.status) ? (
            <p className="mt-3 text-sm text-amber-800">Save quantities before submitting this count.</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {['draft', 'counting'].includes(count.status) && capability?.canEnter ? (
              <Button variant="secondary" disabled={disabled} onClick={() => void saveEntries()}>
                Save quantities
              </Button>
            ) : null}
            {['counting', 'submitted'].includes(count.status) && capability?.canEnter ? (
              <Button
                variant="secondary"
                disabled={disabled || dirty || stale || count.lines.some((line) => line.countedMilli === null)}
                onClick={() => void start('submit', { expectedRevision: count.revision }, count.id)}
              >
                {count.status === 'submitted' ? 'Check approval policy' : 'Submit count'}
              </Button>
            ) : null}
            {count.status === 'awaiting_approval' && capability?.canApprove ? (
              <>
                <Button
                  variant="secondary"
                  disabled={disabled || stale}
                  onClick={() =>
                    void start(
                      'approval',
                      { expectedRevision: count.revision, decision: 'approved', note: null },
                      count.id,
                    )
                  }
                >
                  Approve whole count
                </Button>
                <Button
                  variant="secondary"
                  disabled={disabled || stale}
                  onClick={() =>
                    void start(
                      'approval',
                      { expectedRevision: count.revision, decision: 'rejected', note: null },
                      count.id,
                    )
                  }
                >
                  Reject count
                </Button>
              </>
            ) : null}
            {['submitted', 'approved'].includes(count.status) && capability?.canPost ? (
              <Button
                variant="primary"
                disabled={disabled || stale || reason.trim().length < 3}
                onClick={() =>
                  void start('post', { expectedRevision: count.revision, reason: reason.trim() }, count.id)
                }
              >
                Post stock adjustments
              </Button>
            ) : null}
            {!['posted', 'cancelled'].includes(count.status) && capability?.canCreate ? (
              <Button
                variant="secondary"
                disabled={disabled || reason.trim().length < 3}
                onClick={() =>
                  void start('cancel', { expectedRevision: count.revision, reason: reason.trim() }, count.id)
                }
              >
                Cancel count
              </Button>
            ) : null}
          </div>
          {(['submitted', 'approved'].includes(count.status) && capability?.canPost) ||
          (!['posted', 'cancelled'].includes(count.status) && capability?.canCreate) ? (
            <label className="mt-4 grid max-w-lg gap-1 text-sm">
              Reason for posting or cancelling
              <input
                value={reason}
                disabled={disabled}
                onChange={(event) => setReason(event.target.value)}
                maxLength={240}
                className="rounded border border-ink-900/25 bg-white px-3 py-2"
              />
            </label>
          ) : null}
          <p className="mt-4 text-sm text-ink-600">
            Approval does not change stock. Only an Owner or Manager can post the complete count.
          </p>
        </Glass>
      ) : null}
    </div>
  )
}
