'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Archive, ArrowLeft, Check, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import {
  catalogCategoriesContextSchema,
  catalogCategoryCommandSchema,
  sessionContextResponseSchema,
  type CatalogCategoriesContext,
  type CatalogCategoryCommand,
} from '@hcs/contracts'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import {
  categoryCommandMatches,
  categoryDefinitivelyRejected,
  reconcileCategory,
  restoreCategoryCommand,
  type PendingCategory,
} from '@/lib/category-commands'
import { Topbar } from './Topbar'

const api = process.env.NEXT_PUBLIC_API_URL
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
export function CategoriesWorkspace() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; storage: string } | null>(null)
  const [data, setData] = useState<CatalogCategoriesContext | null>(null)
  const [pending, setPending] = useState<PendingCategory | null>(null)
  const [name, setName] = useState(''),
    [editing, setEditing] = useState<string | null>(null)
  const [search, setSearch] = useState(''),
    [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null)
  const [dismissible, setDismissible] = useState(false)
  const lock = useRef(false)
  async function call(token: string, tenant: string, command?: PendingCategory, path = '/v1/catalog/categories') {
    if (!api) throw new Error('Back Office API is not configured.')
    const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
      method: command ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenant,
        ...(command ? { 'Content-Type': 'application/json', 'Idempotency-Key': command.key } : {}),
      },
      ...(command ? { body: JSON.stringify(command.payload) } : {}),
    })
    const value: unknown = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error((value as { error?: { message?: string } }).error?.message ?? 'Category request failed.'),
        { code: (value as { error?: { code?: string } }).error?.code },
      )
    return value
  }
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data: session, error: authError } = await auth.auth.getSession()
        if (authError) throw authError
        if (!session.session) throw new Error('Sign in to view categories.')
        const access = sessionContextResponseSchema.parse(
          await call(session.session.access_token, '', undefined, '/v1/me'),
        )
        const tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const storage = `hcs-categories:${session.session.user.id}:${tenant.tenantId}`
        const restored = restoreCategoryCommand(sessionStorage.getItem(storage))
        const context = catalogCategoriesContextSchema.parse(await call(session.session.access_token, tenant.tenantId))
        if (active) {
          setScope({ user: session.session.user.id, tenant: tenant.tenantId, storage })
          setPending(restored)
          setData(context)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load categories.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [auth])
  async function run(payload?: CatalogCategoryCommand) {
    if (!scope || !auth || lock.current || (payload && !pending && !data?.canManage)) return
    lock.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    setDismissible(false)
    try {
      const { data: session, error: authError } = await auth.auth.getSession()
      if (authError) throw authError
      if (!session.session || session.session.user.id !== scope.user)
        throw new Error('Sign in to the original account.')
      let command = pending
      const stored = restoreCategoryCommand(sessionStorage.getItem(scope.storage))
      if (command ? !categoryCommandMatches(command, stored) : stored !== null)
        throw new Error('Saved command changed. Reload to reconcile it.')
      if (payload || command) {
        command ??= { key: crypto.randomUUID(), payload: catalogCategoryCommandSchema.parse(payload) }
        sessionStorage.setItem(scope.storage, JSON.stringify(command))
        setPending(command)
        const result = await call(session.session.access_token, scope.tenant, command)
        setData(null)
        const history = catalogCategoriesContextSchema.parse(await call(session.session.access_token, scope.tenant))
        reconcileCategory(command, result, history)
        if (!categoryCommandMatches(command, restoreCategoryCommand(sessionStorage.getItem(scope.storage))))
          throw new Error('Saved command changed. Reload to reconcile it.')
        sessionStorage.removeItem(scope.storage)
        setPending(null)
        setData(history)
        setName('')
        setEditing(null)
        setMessage('Category saved.')
      } else {
        setData(null)
        setData(catalogCategoriesContextSchema.parse(await call(session.session.access_token, scope.tenant)))
      }
    } catch (cause) {
      setDismissible(categoryDefinitivelyRejected((cause as { code?: string }).code))
      setError(cause instanceof Error ? cause.message : 'Could not save category.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function dismiss() {
    if (!scope || !pending || lock.current) return
    try {
      if (!categoryCommandMatches(pending, restoreCategoryCommand(sessionStorage.getItem(scope.storage))))
        throw new Error('Saved command changed. Reload to reconcile it.')
      sessionStorage.removeItem(scope.storage)
      setPending(null)
      setDismissible(false)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reconcile command.')
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void run(editing ? { action: 'rename', categoryId: editing, name } : { action: 'create', name })
  }
  const rows = data?.categories.filter((row) => row.name.toLowerCase().includes(search.toLowerCase())) ?? []
  return (
    <>
      <Topbar
        title="Categories"
        actions={
          <button
            type="button"
            title="Refresh categories"
            aria-label="Refresh categories"
            disabled={busy || !scope || !!pending}
            onClick={() => void run()}
            className="grid size-10 place-items-center rounded border border-ink-900/20 disabled:opacity-50"
          >
            <RefreshCw size={18} />
          </button>
        }
      />
      <Link href="/products" className="inline-flex items-center gap-2 py-3 text-sm font-semibold">
        <ArrowLeft size={16} />
        Products
      </Link>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="border-l-2 border-emerald-600 bg-emerald-50 p-3">
          {message}
        </p>
      )}
      {pending && (
        <div className="flex flex-wrap items-center gap-3 border-y border-ink-900/15 py-3">
          <span>Pending {pending.payload.action}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(pending.payload)}
            className="underline disabled:opacity-50"
          >
            Retry original command
          </button>
          {dismissible && (
            <button type="button" disabled={busy} onClick={dismiss} className="underline">
              Dismiss rejected command
            </button>
          )}
        </div>
      )}
      {data && (
        <>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-b border-ink-900/15 py-4">
            <label className="min-w-0 flex-1 text-sm">
              {editing ? 'Rename category' : 'New category'}
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy || !!pending || !data.canManage}
                className="mt-1 block min-h-11 w-full rounded border border-ink-900/20 bg-white px-3"
              />
            </label>
            <button
              disabled={busy || !!pending || !data.canManage}
              className="inline-flex min-h-11 items-center gap-2 rounded bg-ink-900 px-4 text-white disabled:opacity-50"
            >
              {editing ? <Check size={18} /> : <Plus size={18} />} {editing ? 'Save' : 'Add category'}
            </button>
            {editing && (
              <button
                type="button"
                title="Cancel rename"
                aria-label="Cancel rename"
                disabled={busy || !!pending}
                onClick={() => {
                  setEditing(null)
                  setName('')
                }}
                className="grid size-11 place-items-center"
              >
                <X size={18} />
              </button>
            )}
          </form>
          <label className="my-4 block max-w-md text-sm">
            Search categories
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded border border-ink-900/20 bg-white px-3"
            />
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-900/15">
                  <th className="p-3">Category</th>
                  <th className="p-3">Products</th>
                  <th className="p-3">Pricing groups</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-ink-900/10">
                    <td className="max-w-64 break-words p-3 font-semibold">{row.name}</td>
                    <td className="p-3">{row.productCount}</td>
                    <td className="p-3">{row.pricingGroupCount}</td>
                    <td className="p-3">{row.status}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title={`Rename ${row.name}`}
                          aria-label={`Rename ${row.name}`}
                          disabled={busy || !!pending || !data.canManage || row.status !== 'active'}
                          onClick={() => {
                            setEditing(row.id)
                            setName(row.name)
                          }}
                          className="grid size-10 shrink-0 place-items-center disabled:opacity-40"
                        >
                          <Pencil size={17} />
                        </button>
                        <button
                          type="button"
                          title={
                            row.productCount || row.pricingGroupCount
                              ? 'Category has active references'
                              : `Archive ${row.name}`
                          }
                          aria-label={`Archive ${row.name}`}
                          disabled={
                            busy ||
                            !!pending ||
                            !data.canManage ||
                            row.status !== 'active' ||
                            row.productCount > 0 ||
                            row.pricingGroupCount > 0
                          }
                          onClick={() => void run({ action: 'archive', categoryId: row.id })}
                          className="grid size-10 shrink-0 place-items-center disabled:opacity-40"
                        >
                          <Archive size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="py-8 text-center text-ink-500">No categories found.</p>}
          </div>
        </>
      )}
    </>
  )
}
