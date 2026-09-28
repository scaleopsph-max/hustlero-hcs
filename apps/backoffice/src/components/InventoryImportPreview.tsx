'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import Papa from 'papaparse'
import { useEffect, useMemo, useState } from 'react'
import {
  inventoryImportPreviewResponseSchema,
  inventoryImportPostResponseSchema,
  inventoryImportReconcileResponseSchema,
  sessionContextResponseSchema,
  type InventoryImportPreviewRequest,
  type InventoryImportPreviewResponse,
  type InventoryImportPostResponse,
  type InventoryImportReconcileResponse,
} from '@hcs/contracts'
import { Button, Glass } from '@hcs/ui'
import { selectActiveTenant } from '@/lib/active-tenant'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL
const maxFileBytes = 5 * 1024 * 1024

const headers = [
  'branch_code',
  'sku',
  'barcode',
  'quantity_on_hand',
  'unit_cost',
  'reorder_level',
  'reserved_quantity',
  'damaged_quantity',
  'in_transit_quantity',
  'source_reference',
] as const

type CsvRow = Record<(typeof headers)[number], string>

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

function localCutoverValue(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(value / 1000)
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value / 100)
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}

function downloadTemplate() {
  const example = ['MAIN', 'SKU-001', '', '10', '125.50', '5', '0', '0', '0', 'SOURCE-001']
  const csv = `${headers.join(',')}\r\n${example.join(',')}\r\n`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'hustlero-opening-inventory-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export function InventoryImportPreview() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [cutoverAt, setCutoverAt] = useState(localCutoverValue)
  const [preview, setPreview] = useState<InventoryImportPreviewResponse | null>(null)
  const [posted, setPosted] = useState<InventoryImportPostResponse | null>(null)
  const [reconciled, setReconciled] = useState<InventoryImportReconcileResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) return
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in before importing inventory.')
        if (!apiUrl) throw new Error('Back Office API URL is not configured.')
        setToken(data.session.access_token)
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/me`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        })
        const body: unknown = await response.json()
        if (!response.ok) throw new Error('Could not load the active business.')
        const session = sessionContextResponseSchema.parse(body)
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Create a business before importing inventory.')
        setTenantId(tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not prepare inventory import.')
      }
    })
  }, [auth])

  const rejectedRows = useMemo(() => preview?.rows.filter((row) => row.status === 'rejected') ?? [], [preview])

  async function parseFile(selectedFile: File): Promise<InventoryImportPreviewRequest['rows']> {
    if (selectedFile.size > maxFileBytes) throw new Error('CSV file must be 5 MB or smaller.')
    const result = Papa.parse<CsvRow>(await selectedFile.text(), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeHeader,
    })
    if (result.errors.length > 0) throw new Error(`CSV row ${result.errors[0]?.row ?? 1}: ${result.errors[0]?.message}`)
    const actualHeaders = new Set(result.meta.fields ?? [])
    const required = ['branch_code', 'quantity_on_hand']
    const missing = required.filter((header) => !actualHeaders.has(header))
    if (missing.length > 0) throw new Error(`Missing required column: ${missing.join(', ')}.`)
    if (!actualHeaders.has('sku') && !actualHeaders.has('barcode')) {
      throw new Error('The CSV needs an sku or barcode column.')
    }
    if (result.data.length === 0 || result.data.length > 5000) throw new Error('CSV must contain 1 to 5,000 data rows.')
    return result.data.map((row, index) => ({
      rowNumber: index + 2,
      branchCode: row.branch_code ?? '',
      sku: row.sku ?? '',
      barcode: row.barcode ?? '',
      quantityOnHand: row.quantity_on_hand ?? '',
      unitCost: row.unit_cost ?? '',
      reorderLevel: row.reorder_level ?? '',
      reservedQuantity: row.reserved_quantity ?? '',
      damagedQuantity: row.damaged_quantity ?? '',
      inTransitQuantity: row.in_transit_quantity ?? '',
      sourceReference: row.source_reference ?? '',
    }))
  }

  async function previewFile() {
    if (!file || !token || !tenantId || !auth || !apiUrl) return
    setBusy(true)
    setError(null)
    setPreview(null)
    setPosted(null)
    setReconciled(null)
    try {
      const rows = await parseFile(file)
      const request: InventoryImportPreviewRequest = {
        filename: file.name,
        cutoverAt: new Date(cutoverAt).toISOString(),
        rows,
      }
      const storageKey = `hcs:inventory-import-preview:${tenantId}:${file.name}:${file.size}:${file.lastModified}:${request.cutoverAt}`
      const idempotencyKey = window.localStorage.getItem(storageKey) ?? crypto.randomUUID()
      window.localStorage.setItem(storageKey, idempotencyKey)

      const send = (accessToken: string) =>
        fetch(`${apiUrl.replace(/\/$/, '')}/v1/inventory/imports/preview`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-Tenant-Id': tenantId,
          },
          body: JSON.stringify(request),
        })
      let response = await send(token)
      if (response.status === 401) {
        const refreshed = await auth.auth.refreshSession()
        if (refreshed.data.session?.access_token) {
          setToken(refreshed.data.session.access_token)
          response = await send(refreshed.data.session.access_token)
        }
      }
      const body: unknown = await response.json()
      if (!response.ok) {
        const apiError = body as { error?: { message?: string } }
        throw new Error(apiError.error?.message ?? 'Inventory preview failed.')
      }
      setPreview(inventoryImportPreviewResponseSchema.parse(body))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventory preview failed.')
    } finally {
      setBusy(false)
    }
  }

  async function runBatchCommand(action: 'post' | 'reconcile') {
    if (!preview || !token || !tenantId || !auth || !apiUrl) return
    if (
      action === 'post' &&
      !window.confirm('Post these opening balances permanently? This cannot be edited or deleted.')
    )
      return
    setBusy(true)
    setError(null)
    try {
      const storageKey = `hcs:inventory-import-${action}:${tenantId}:${preview.batchId}`
      const idempotencyKey = window.localStorage.getItem(storageKey) ?? crypto.randomUUID()
      window.localStorage.setItem(storageKey, idempotencyKey)
      const send = (accessToken: string) =>
        fetch(`${apiUrl.replace(/\/$/, '')}/v1/inventory/imports/${preview.batchId}/${action}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Idempotency-Key': idempotencyKey,
            'X-Tenant-Id': tenantId,
          },
        })
      let response = await send(token)
      if (response.status === 401) {
        const refreshed = await auth.auth.refreshSession()
        if (refreshed.data.session?.access_token) {
          setToken(refreshed.data.session.access_token)
          response = await send(refreshed.data.session.access_token)
        }
      }
      const body: unknown = await response.json()
      if (!response.ok) {
        const apiError = body as { error?: { message?: string } }
        throw new Error(apiError.error?.message ?? `Inventory ${action} failed.`)
      }
      if (action === 'post') setPosted(inventoryImportPostResponseSchema.parse(body))
      else setReconciled(inventoryImportReconcileResponseSchema.parse(body))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Inventory ${action} failed.`)
    } finally {
      setBusy(false)
    }
  }

  function downloadRejectedRows() {
    if (!preview || rejectedRows.length === 0) return
    const rows = rejectedRows.map((row) => ({
      row_number: row.rowNumber,
      branch_code: row.branchCode,
      sku: row.sku ?? '',
      barcode: row.barcode ?? '',
      errors: row.errors.map((issue) => `${issue.code}: ${issue.message}`).join(' | '),
    }))
    const csv = Papa.unparse(rows)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${preview.filename.replace(/\.csv$/i, '')}-errors.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Glass variant="data" className="rounded-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-900/10 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase text-ink-500">Migration preview</p>
          <h2 className="mt-1 font-display text-xl font-bold">Upload opening inventory CSV</h2>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={downloadTemplate}>
          <Download size={17} className="mr-2" /> Template
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px_auto] lg:items-end">
        <label className="text-sm font-medium">
          CSV file
          <span className="mt-1.5 flex h-11 items-center gap-3 rounded-control border border-ink-900/15 bg-white px-3">
            <FileSpreadsheet size={18} className="text-ink-500" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{file?.name ?? 'Choose file'}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setPreview(null)
                setPosted(null)
                setReconciled(null)
                setError(null)
              }}
            />
          </span>
        </label>
        <label className="text-sm font-medium">
          Cutover timestamp
          <input
            type="datetime-local"
            className="mt-1.5 h-11 w-full rounded-control border border-ink-900/15 bg-white px-3 text-sm"
            value={cutoverAt}
            onChange={(event) => {
              setCutoverAt(event.target.value)
              setPreview(null)
              setPosted(null)
              setReconciled(null)
            }}
          />
        </label>
        <Button
          type="button"
          variant="confirm"
          size="sm"
          disabled={!file || !token || !tenantId || busy}
          onClick={() => void previewFile()}
        >
          {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : <Upload size={17} className="mr-2" />}
          Preview
        </Button>
      </div>

      {preview ? (
        <div className="mt-6 border-t border-ink-900/10 pt-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Rows', preview.summary.rowCount],
              ['Accepted', preview.summary.acceptedCount],
              ['Rejected', preview.summary.rejectedCount],
              ['Quantity', formatQuantity(preview.summary.totalQuantityMilli)],
              ['Valuation', formatMoney(preview.summary.totalValuationMinor)],
            ].map(([label, value]) => (
              <div key={label} className="border-l-2 border-ink-900/15 pl-3">
                <p className="text-xs font-semibold uppercase text-ink-500">{label}</p>
                <p className="mt-1 font-display text-xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="text-xs uppercase text-ink-500">
                <tr>
                  <th className="py-3 font-semibold">Row</th>
                  <th className="py-3 font-semibold">Branch</th>
                  <th className="py-3 font-semibold">Product and variant</th>
                  <th className="py-3 font-semibold">SKU / barcode</th>
                  <th className="py-3 text-right font-semibold">Quantity</th>
                  <th className="py-3 text-right font-semibold">Cost</th>
                  <th className="py-3 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-ink-900/10 align-top">
                    <td className="py-3">{row.rowNumber}</td>
                    <td className="py-3">{row.branchCode || '—'}</td>
                    <td className="py-3">
                      <span className="block font-semibold">{row.productName ?? 'Unresolved'}</span>
                      <span className="text-xs text-ink-500">{row.variantName ?? ''}</span>
                    </td>
                    <td className="py-3">{row.sku ?? row.barcode ?? '—'}</td>
                    <td className="py-3 text-right">
                      {row.quantityOnHandMilli === null ? '—' : formatQuantity(row.quantityOnHandMilli)}
                    </td>
                    <td className="py-3 text-right">
                      {row.unitCostMinor === null ? '—' : formatMoney(row.unitCostMinor)}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 font-semibold ${row.status === 'accepted' ? 'text-emerald-700' : 'text-red-700'}`}
                      >
                        {row.status === 'accepted' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                        {row.status}
                      </span>
                      {[...row.errors, ...row.warnings].map((issue) => (
                        <p key={`${issue.code}-${issue.field}`} className="mt-1 max-w-xs text-xs text-ink-600">
                          {issue.message}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink-900/10 pt-4">
            <p className="text-sm text-ink-600">
              {reconciled
                ? 'Reconciled. Opening balances match the approved file and POS cutover is ready.'
                : posted
                  ? 'Posted permanently. Run reconciliation to unlock this cutover for POS.'
                  : 'Preview only. No inventory movement or balance has been posted.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {rejectedRows.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={downloadRejectedRows}>
                  <Download size={17} className="mr-2" /> Error rows
                </Button>
              ) : null}
              {rejectedRows.length === 0 && !posted ? (
                <Button
                  type="button"
                  variant="confirm"
                  size="sm"
                  disabled={busy}
                  onClick={() => void runBatchCommand('post')}
                >
                  {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : <Database size={17} className="mr-2" />}
                  Post opening balances
                </Button>
              ) : null}
              {posted && !reconciled ? (
                <Button
                  type="button"
                  variant="confirm"
                  size="sm"
                  disabled={busy}
                  onClick={() => void runBatchCommand('reconcile')}
                >
                  {busy ? (
                    <Loader2 size={17} className="mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck size={17} className="mr-2" />
                  )}
                  Reconcile and unlock POS
                </Button>
              ) : null}
            </div>
          </div>
          {reconciled ? (
            <div className="mt-4 grid gap-3 border-l-2 border-emerald-600 bg-emerald-50 p-4 text-sm sm:grid-cols-3">
              <div>
                <span className="block text-xs font-semibold uppercase text-emerald-800">Rows matched</span>
                {reconciled.rowCount}
              </div>
              <div>
                <span className="block text-xs font-semibold uppercase text-emerald-800">Quantity matched</span>
                {formatQuantity(reconciled.actualQuantityMilli)}
              </div>
              <div>
                <span className="block text-xs font-semibold uppercase text-emerald-800">Valuation matched</span>
                {formatMoney(reconciled.actualValuationMinor)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Glass>
  )
}
