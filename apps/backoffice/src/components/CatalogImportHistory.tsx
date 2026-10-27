'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Eye, Ban } from 'lucide-react'
import {
  catalogImportJobListSchema,
  catalogImportJobSchema,
  sessionContextResponseSchema,
  type CatalogImportJob,
  type CatalogImportJobList,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import { Topbar } from './Topbar'
import { CatalogImportExecutionPanel } from './CatalogImportExecution'
const api = process.env.NEXT_PUBLIC_API_URL,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
export function CatalogImportHistory() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [jobs, setJobs] = useState<CatalogImportJobList['jobs']>([]),
    [detail, setDetail] = useState<CatalogImportJob | null>(null)
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [confirm, setConfirm] = useState(false)
  const [executionChecked, setExecutionChecked] = useState(false),
    [hasExecution, setHasExecution] = useState(false)
  const identity = useRef<{ user: string; tenant: string } | null>(null),
    lock = useRef(false),
    sequence = useRef(0)
  async function call(path: string, body?: unknown, requestKey?: string) {
    if (!auth || !api) throw new Error('Authentication or API is not configured.')
    const { data, error: authError } = await auth.auth.getSession()
    if (authError) throw authError
    if (!data.session) throw new Error('Sign in to view import history.')
    if (!identity.current) {
      const response = await fetch(`${api.replace(/\/$/, '')}/v1/me`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      if (!response.ok) throw new Error('Could not load business access.')
      const context = sessionContextResponseSchema.parse(await response.json()),
        tenant = selectActiveTenant(context.tenants)
      if (!tenant || !(tenant.isOwner || tenant.permissions.includes('catalog.manage')))
        throw new Error('Catalog management permission is required.')
      identity.current = { user: data.session.user.id, tenant: tenant.tenantId }
    }
    if (data.session.user.id !== identity.current.user) throw new Error('Sign in to the original account.')
    const response = await fetch(`${api.replace(/\/$/, '')}/v1/catalog/imports/jobs${path}`, {
      cache: 'no-store',
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'X-Tenant-Id': identity.current.tenant,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(requestKey ? { 'Idempotency-Key': requestKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const value: unknown = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error((value as { error?: { message?: string } }).error?.message ?? 'Could not load import history.'),
        { code: (value as { error?: { code?: string } }).error?.code },
      )
    return value
  }
  async function run(action: 'list' | 'view' | 'cancel', id?: string) {
    if (lock.current) return
    lock.current = true
    const request = ++sequence.current
    setBusy(true)
    setError(null)
    setConfirm(false)
    setExecutionChecked(false)
    setHasExecution(false)
    if (action === 'list') {
      setJobs([])
      setDetail(null)
    } else setDetail(null)
    try {
      if (action === 'list') {
        const result = catalogImportJobListSchema.parse(await call(''))
        if (request === sequence.current) setJobs(result.jobs)
      } else {
        if (!id) throw new Error('Select an import job.')
        const result = catalogImportJobSchema.parse(
          await call(`/${id}`, action === 'cancel' ? { action: 'cancel' } : undefined),
        )
        if (result.id !== id || (action === 'cancel' && result.state !== 'cancelled'))
          throw new Error('Import job response does not match the request.')
        if (request === sequence.current) {
          setDetail(result)
          setJobs((current) => current.map((row) => (row.id === result.id ? result : row)))
        }
      }
    } catch (cause) {
      if (request === sequence.current) {
        setJobs([])
        setDetail(null)
        setError(cause instanceof Error ? cause.message : 'Could not load import history.')
      }
    } finally {
      if (request === sequence.current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    void run('list')
    return () => {
      sequence.current++
      lock.current = false
    }
  }, [])
  return (
    <>
      <Topbar
        title="Import history"
        actions={
          <button
            type="button"
            title="Refresh import history"
            aria-label="Refresh import history"
            disabled={busy}
            onClick={() => void run('list')}
            className="inline-flex h-11 w-11 items-center justify-center rounded border border-ink-900/20"
          >
            <RefreshCw size={18} />
          </button>
        }
      />
      <Link href="/products/import" className="inline-flex items-center gap-2 py-4 text-sm font-semibold">
        <ArrowLeft size={16} />
        Catalog preview
      </Link>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {!busy && !error && jobs.length === 0 && <p className="py-6">No saved previews.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {['File / created', 'State', 'Rows', 'Proposed creates', 'Proposed updates', 'Rejected', ''].map(
                (label) => (
                  <th key={label} className="border-b border-ink-900/15 p-3">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-ink-900/10">
                <td className="min-w-52 max-w-64 break-all p-3">
                  <strong>{job.filename}</strong>
                  <div className="whitespace-nowrap text-xs">
                    {new Date(job.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                  </div>
                </td>
                <td className="p-3">{job.state}</td>
                {[job.rowCount, job.proposedCreates, job.proposedUpdates, job.rejectedCount].map((value, index) => (
                  <td key={index} className="p-3">
                    {value}
                  </td>
                ))}
                <td className="p-3">
                  <button
                    type="button"
                    title={`View ${job.filename}`}
                    aria-label={`View ${job.filename}`}
                    disabled={busy}
                    onClick={() => void run('view', job.id)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded border border-ink-900/20"
                  >
                    <Eye size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <section className="mt-6 border-t border-ink-900/20 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 break-all text-lg font-semibold">{detail.filename}</h2>
            {detail.state === 'preview' && executionChecked && !hasExecution && (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                disabled={busy}
                className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3"
              >
                <Ban size={16} />
                Cancel preview
              </button>
            )}
          </div>
          {confirm && (
            <div
              role="dialog"
              aria-label="Cancel saved preview"
              className="my-4 border-l-2 border-red-500 bg-red-50 p-4"
            >
              <p>Cancel this saved preview?</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => void run('cancel', detail.id)}
                  className="min-h-10 rounded bg-ink-900 px-3 text-white"
                >
                  Confirm cancellation
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="min-h-10 px-3">
                  Keep preview
                </button>
              </div>
            </div>
          )}
          <p className="py-3 text-sm">
            {detail.state} · {detail.rowCount} rows · {detail.rejectedCount} rejected
          </p>
          {identity.current && (
            <CatalogImportExecutionPanel
              key={detail.id}
              job={detail}
              user={identity.current.user}
              tenant={identity.current.tenant}
              call={call}
              onChecked={(exists) => {
                setExecutionChecked(true)
                setHasExecution(exists)
              }}
            />
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {['Row', 'SKU', 'Product / variant', 'Retail', 'Proposed action', 'Validation'].map((label) => (
                    <th key={label} className="p-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-ink-900/10">
                    <td className="p-3">{row.rowNumber}</td>
                    <td className="whitespace-nowrap p-3">{row.sku}</td>
                    <td className="max-w-64 break-words p-3">
                      {row.name}
                      <div>{row.variantName}</div>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {row.retailPriceMinor === null ? '-' : formatPeso(row.retailPriceMinor)}
                    </td>
                    <td className="p-3">{row.action ?? 'rejected'}</td>
                    <td className="p-3">
                      {row.issues.map((issue) => `${issue.field}: ${issue.code}`).join('; ') || 'Valid'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
