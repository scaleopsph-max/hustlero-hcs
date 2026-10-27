'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Download, FileSpreadsheet, Save, RotateCcw, History } from 'lucide-react'
import {
  catalogImportPreviewRequestSchema,
  catalogImportPreviewResponseSchema,
  sessionContextResponseSchema,
  type CatalogImportPreviewResponse,
  catalogImportJobSavedSchema,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import { catalogImportTemplate, parseCatalogImportCsv } from '@/lib/catalog-import-file'
import {
  restoreImportSave,
  sameImportSave,
  reconcileImportSave,
  type PendingImportSave,
} from '@/lib/catalog-import-jobs'
import { Topbar } from './Topbar'
const api = process.env.NEXT_PUBLIC_API_URL,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
export function CatalogImportPreview() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; canPreview: boolean } | null>(null)
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<CatalogImportPreviewResponse | null>(null)
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImportSave | null>(null),
    [savedJob, setSavedJob] = useState<string | null>(null)
  const lock = useRef(false),
    sequence = useRef(0)
  async function call(token: string, tenant: string, path: string, body?: unknown, requestKey?: string) {
    if (!api) throw new Error('Back Office API is not configured.')
    const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenant,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(requestKey ? { 'Idempotency-Key': requestKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const value: unknown = await response.json()
    if (!response.ok)
      throw new Error((value as { error?: { message?: string } }).error?.message ?? 'Could not preview catalog import.')
    return value
  }
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data, error: authError } = await auth.auth.getSession()
        if (authError) throw authError
        if (!data.session) throw new Error('Sign in to preview a catalog import.')
        const context = sessionContextResponseSchema.parse(await call(data.session.access_token, '', '/v1/me'))
        const tenant = selectActiveTenant(context.tenants)
        if (!tenant) throw new Error('Select a business first.')
        if (active) {
          const restored = restoreImportSave(
            sessionStorage.getItem(`hcs-import-save:${data.session.user.id}:${tenant.tenantId}`),
          )
          setPending(restored)
          setScope({
            user: data.session.user.id,
            tenant: tenant.tenantId,
            canPreview: tenant.isOwner || tenant.permissions.includes('catalog.manage'),
          })
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not prepare import preview.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
      sequence.current++
    }
  }, [auth])
  function template() {
    const blob = new Blob([catalogImportTemplate()], { type: 'text/csv;charset=utf-8' }),
      href = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = href
    link.download = 'hustlero-product-catalog-template.csv'
    link.click()
    URL.revokeObjectURL(href)
  }
  async function run() {
    if (!auth || !scope?.canPreview || !file || pending || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setPreview(null)
    setSavedJob(null)
    const request = ++sequence.current
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('CSV must be 5 MB or smaller.')
      const rows = parseCatalogImportCsv(await file.text())
      const body = catalogImportPreviewRequestSchema.parse({ filename: file.name, rows })
      const { data, error: authError } = await auth.auth.getSession()
      if (authError) throw authError
      if (!data.session || data.session.user.id !== scope.user) throw new Error('Sign in to the original account.')
      const result = catalogImportPreviewResponseSchema.parse(
        await call(data.session.access_token, scope.tenant, '/v1/catalog/imports/preview', body),
      )
      if (result.filename !== file.name) throw new Error('Import preview does not match the selected file.')
      if (request === sequence.current) setPreview(result)
    } catch (cause) {
      if (request === sequence.current)
        setError(cause instanceof Error ? cause.message : 'Could not preview catalog import.')
    } finally {
      lock.current = false
      if (request === sequence.current) setBusy(false)
    }
  }
  async function save() {
    if (!auth || !scope?.canPreview || lock.current || (!pending && (!file || !preview))) return
    lock.current = true
    setBusy(true)
    setError(null)
    const request = ++sequence.current
    const storageKey = `hcs-import-save:${scope.user}:${scope.tenant}`
    try {
      const { data, error: authError } = await auth.auth.getSession()
      if (authError) throw authError
      if (!data.session || data.session.user.id !== scope.user) throw new Error('Sign in to the original account.')
      let command = pending
      if (!command) {
        const payload = catalogImportPreviewRequestSchema.parse({
          filename: file!.name,
          rows: parseCatalogImportCsv(await file!.text()),
        })
        command = { key: crypto.randomUUID(), payload }
        // Persist before the first request; storage failure must never send a write.
        sessionStorage.setItem(storageKey, JSON.stringify(command))
        setPending(command)
      }
      const result = catalogImportJobSavedSchema.parse(
        await call(data.session.access_token, scope.tenant, '/v1/catalog/imports/jobs', command.payload, command.key),
      )
      const detail = await call(data.session.access_token, scope.tenant, `/v1/catalog/imports/jobs/${result.jobId}`)
      const job = reconcileImportSave(command, result, detail)
      if (request !== sequence.current) return
      const stored = restoreImportSave(sessionStorage.getItem(storageKey))
      if (!sameImportSave(command, stored)) throw new Error('Saved request changed. Keep the original import pending.')
      sessionStorage.removeItem(storageKey)
      setPending(null)
      setSavedJob(job.id)
      setPreview({ filename: job.filename, rows: job.rows })
    } catch (cause) {
      if (request === sequence.current)
        setError(cause instanceof Error ? cause.message : 'Could not save import preview.')
    } finally {
      lock.current = false
      if (request === sequence.current) setBusy(false)
    }
  }
  const totals = preview
    ? {
        products: preview.rows.filter((row) => row.action === 'create_product').length,
        variants: preview.rows.filter((row) => row.action === 'create_variant').length,
        updates: preview.rows.filter((row) => row.action === 'update_variant').length,
        errors: preview.rows.filter((row) => row.issues.length > 0).length,
      }
    : null
  return (
    <>
      <Topbar
        title="Import preview"
        actions={
          <button
            type="button"
            onClick={template}
            className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3"
          >
            <Download size={17} />
            Template
          </button>
        }
      />
      <Link href="/products" className="inline-flex items-center gap-2 py-3 text-sm font-semibold">
        <ArrowLeft size={16} />
        Products
      </Link>
      <Link href="/products/import/history" className="ml-4 inline-flex items-center gap-2 py-3 text-sm font-semibold">
        <History size={16} />
        Import history
      </Link>
      {savedJob && (
        <p role="status" className="border-l-2 border-green-600 bg-green-50 p-3">
          Preview saved.{' '}
          <Link className="underline" href="/products/import/history">
            View history
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {!busy && scope && !scope.canPreview && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          Catalog management permission is required.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3 border-y border-ink-900/15 py-4">
        <label className="block min-w-0 flex-1 text-sm">
          Catalog CSV
          <input
            aria-label="Catalog CSV"
            type="file"
            accept=".csv,text/csv"
            disabled={busy || !!pending || !scope?.canPreview}
            onChange={(event) => {
              sequence.current++
              setFile(event.target.files?.[0] ?? null)
              setPreview(null)
              setError(null)
              setSavedJob(null)
            }}
            className="mt-2 block min-h-11 w-full rounded border border-ink-900/20 bg-white px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !!pending || !scope?.canPreview || !file}
          className="inline-flex min-h-11 items-center gap-2 rounded bg-ink-900 px-4 text-white disabled:opacity-50"
        >
          <Check size={18} />
          Preview
        </button>
        {(preview || pending) && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !scope?.canPreview || !!savedJob}
            className="inline-flex min-h-11 items-center gap-2 rounded border border-ink-900/20 px-4 disabled:opacity-50"
          >
            {pending ? <RotateCcw size={18} /> : <Save size={18} />} {pending ? 'Retry save' : 'Save preview'}
          </button>
        )}
      </div>
      {preview && totals && (
        <>
          <div className="grid grid-cols-2 gap-4 border-b border-ink-900/15 py-4 sm:grid-cols-4">
            {[
              ['New products', totals.products],
              ['New variants', totals.variants],
              ['Updates', totals.updates],
              ['Rejected rows', totals.errors],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-sm text-ink-500">{label}</div>
                <strong className="text-xl">{value}</strong>
              </div>
            ))}
          </div>
          <p className="flex min-w-0 items-center gap-2 py-4 text-sm">
            <FileSpreadsheet size={18} className="shrink-0" />
            <span className="break-all">{preview.filename}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-900/15">
                  {['Row', 'SKU / product SKU', 'Product / variant', 'Retail', 'Action', 'Validation'].map((label) => (
                    <th key={label} className="p-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-b border-ink-900/10">
                    <td className="p-3">{row.rowNumber}</td>
                    <td className="p-3">
                      <strong>{row.sku}</strong>
                      <div className="text-xs text-ink-500">{row.productSku}</div>
                    </td>
                    <td className="max-w-72 break-words p-3">
                      <strong>{row.name}</strong>
                      <div className="text-xs text-ink-500">{row.variantName}</div>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-semibold">Details</summary>
                        <dl className="mt-2 space-y-2">
                          <div>
                            <dt>Category</dt>
                            <dd>{row.categoryName ?? 'Uncategorized'}</dd>
                          </div>
                          <div>
                            <dt>Unit cost</dt>
                            <dd>{row.unitCostMinor === null ? 'Not set' : formatPeso(row.unitCostMinor)}</dd>
                          </div>
                          <div>
                            <dt>Track inventory</dt>
                            <dd>{row.trackInventory ? 'Yes' : 'No'}</dd>
                          </div>
                          <div>
                            <dt>Barcodes</dt>
                            <dd className="break-all">{row.barcodes.join(', ') || 'None'}</dd>
                          </div>
                          <div>
                            <dt>Description</dt>
                            <dd className="break-words">{row.description || 'None'}</dd>
                          </div>
                        </dl>
                      </details>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {row.retailPriceMinor === null ? '-' : formatPeso(row.retailPriceMinor)}
                    </td>
                    <td className="p-3">{row.action?.replaceAll('_', ' ') ?? 'Rejected'}</td>
                    <td className="min-w-40 p-3">
                      {row.issues.map((issue, index) => (
                        <div key={`${issue.code}:${index}`} className="text-red-700">
                          {issue.field}: {issue.code.replaceAll('_', ' ').toLowerCase()}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
