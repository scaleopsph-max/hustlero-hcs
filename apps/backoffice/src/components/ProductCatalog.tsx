'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Loader2, Package, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  catalogProductCreateResponseSchema,
  catalogResponseSchema,
  sessionContextResponseSchema,
  type CatalogProductCreateRequest,
  type CatalogResponse,
} from '@hcs/contracts'
import { Button, Glass, formatPeso, parsePeso } from '@hcs/ui'
import { Topbar } from './Topbar'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(
  path: string,
  accessToken: string,
  tenantId: string,
  options?: RequestInit,
  auth?: SupabaseClient,
  onTokenRefreshed?: (accessToken: string) => void,
) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')

  const request = (token: string) =>
    fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId, ...options?.headers },
    })

  let response = await request(accessToken)
  if (response.status === 401 && auth) {
    const { data, error } = await auth.auth.refreshSession()
    if (!error && data.session?.access_token) {
      onTokenRefreshed?.(data.session.access_token)
      response = await request(data.session.access_token)
    }
  }
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = data as { error?: { message?: string } }
    throw new Error(error.error?.message ?? 'The request could not be completed.')
  }
  return data
}

const inputClass =
  'min-h-11 w-full rounded-control border border-ink-900/15 bg-white/80 px-3 text-sm outline-none focus:border-ink-900'

export function ProductCatalog() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogResponse>({ categories: [], products: [] })
  const [showForm, setShowForm] = useState(true)
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [variantName, setVariantName] = useState('Default')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [retailPrice, setRetailPrice] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [trackInventory, setTrackInventory] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(
    async (accessToken: string, selectedTenantId: string) => {
      setCatalog(
        catalogResponseSchema.parse(
          await apiRequest('/v1/catalog', accessToken, selectedTenantId, undefined, auth ?? undefined, setToken),
        ),
      )
    },
    [auth],
  )

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        const session = data.session
        if (!session) return
        setToken(session.access_token)
        const context = sessionContextResponseSchema.parse(
          await apiRequest('/v1/me', session.access_token, '', undefined, auth, setToken),
        )
        const tenant = context.tenants.find((item) => item.isOwner) ?? context.tenants[0]
        if (!tenant) throw new Error('Create a business before adding products.')
        setTenantId(tenant.tenantId)
        await loadCatalog(session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the catalog.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, loadCatalog])

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return catalog.products
    return catalog.products.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.category?.name.toLowerCase().includes(query) ||
        product.variants.some(
          (variant) =>
            variant.sku.toLowerCase().includes(query) ||
            variant.barcodes.some((value) => value.toLowerCase().includes(query)),
        ),
    )
  }, [catalog.products, search])

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const request: CatalogProductCreateRequest = {
      name: name.trim(),
      categoryName: categoryName.trim() || undefined,
      variantName: variantName.trim() || 'Default',
      sku: sku.trim().toUpperCase(),
      retailPriceMinor: parsePeso(retailPrice),
      unitCostMinor: unitCost.trim() ? parsePeso(unitCost) : null,
      trackInventory,
      barcodes: barcode.trim() ? [barcode.trim().toUpperCase()] : [],
    }
    const serialized = JSON.stringify(request)
    const storageKey = `hcs:catalog-product:${tenantId}:${request.sku}`
    let requestToken = token
    try {
      const previous = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { body?: string; key?: string } | null
      const idempotencyKey = previous?.body === serialized && previous.key ? previous.key : crypto.randomUUID()
      localStorage.setItem(storageKey, JSON.stringify({ body: serialized, key: idempotencyKey }))
      catalogProductCreateResponseSchema.parse(
        await apiRequest(
          '/v1/catalog/products',
          requestToken,
          tenantId,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
            body: serialized,
          },
          auth ?? undefined,
          (refreshedToken) => {
            requestToken = refreshedToken
            setToken(refreshedToken)
          },
        ),
      )
      localStorage.removeItem(storageKey)
      await loadCatalog(requestToken, tenantId)
      setName('')
      setSku('')
      setBarcode('')
      setRetailPrice('')
      setUnitCost('')
      setNotice('Product added. The Products setup step is now complete.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the product.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar
        title="Products"
        subtitle="Product master, variants, tenant-unique SKUs and barcodes."
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowForm((current) => !current)}>
            <Plus size={18} strokeWidth={2} className="mr-2" />
            Add product
          </Button>
        }
      />

      {error ? (
        <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}

      <div className={`grid min-h-0 gap-4 ${showForm ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <Glass variant="data" className="min-w-0 rounded-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900/10 pb-4">
            <label className="relative block min-w-[240px] flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-3 text-ink-500" size={18} />
              <span className="sr-only">Search products</span>
              <input
                className={`${inputClass} pl-10`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, SKU or barcode"
              />
            </label>
            <span className="text-sm text-ink-500">{catalog.products.length} products</span>
          </div>

          {loading ? <p className="py-12 text-center text-sm text-ink-500">Loading catalog...</p> : null}
          {!loading && filteredProducts.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              <Package size={32} className="text-ink-400" />
              <h2 className="mt-3 font-display text-lg font-bold">No products yet</h2>
              <p className="mt-1 max-w-sm text-sm text-ink-500">
                Add the first sellable item. Opening stock is recorded separately in the inventory ledger.
              </p>
            </div>
          ) : null}
          {filteredProducts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="text-xs uppercase text-ink-500">
                  <tr>
                    <th className="py-3 font-semibold">Product</th>
                    <th className="py-3 font-semibold">Category</th>
                    <th className="py-3 font-semibold">SKU</th>
                    <th className="py-3 font-semibold">Barcode</th>
                    <th className="py-3 text-right font-semibold">Retail price</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.flatMap((product) =>
                    product.variants.map((variant, index) => (
                      <tr key={variant.id} className="border-t border-ink-900/10">
                        <td className="py-4 font-semibold">
                          {index === 0 ? product.name : `${product.name} / ${variant.name}`}
                        </td>
                        <td className="py-4 text-ink-600">{product.category?.name ?? 'Uncategorized'}</td>
                        <td className="py-4 font-medium">{variant.sku}</td>
                        <td className="py-4 text-ink-600">{variant.barcodes[0] ?? 'None'}</td>
                        <td className="py-4 text-right font-semibold">{formatPeso(variant.retailPriceMinor)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </Glass>

        {showForm ? (
          <Glass variant="light" as="aside" className="rounded-panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-500">Manual entry</p>
                <h2 className="mt-1 font-display text-xl font-bold">New product</h2>
              </div>
              <Link href="/setup" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-600">
                <ArrowLeft size={15} /> Setup
              </Link>
            </div>
            <form className="mt-5 flex flex-col gap-4" onSubmit={(event) => void createProduct(event)}>
              <label className="text-sm font-medium">
                Product name
                <input
                  className={`${inputClass} mt-1.5`}
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Category
                <input
                  className={`${inputClass} mt-1.5`}
                  list="catalog-categories"
                  maxLength={80}
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <datalist id="catalog-categories">
                {catalog.categories.map((category) => (
                  <option key={category.id} value={category.name} />
                ))}
              </datalist>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium">
                  Variant
                  <input
                    className={`${inputClass} mt-1.5`}
                    required
                    maxLength={80}
                    value={variantName}
                    onChange={(event) => setVariantName(event.target.value)}
                  />
                </label>
                <label className="text-sm font-medium">
                  SKU
                  <input
                    className={`${inputClass} mt-1.5 uppercase`}
                    required
                    maxLength={64}
                    pattern="[A-Za-z0-9._-]+"
                    value={sku}
                    onChange={(event) => setSku(event.target.value)}
                  />
                </label>
              </div>
              <label className="text-sm font-medium">
                Barcode
                <input
                  className={`${inputClass} mt-1.5`}
                  maxLength={64}
                  pattern="[A-Za-z0-9._-]+"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium">
                  Retail price
                  <input
                    className={`${inputClass} mt-1.5`}
                    required
                    inputMode="decimal"
                    pattern="[0-9]+([.][0-9]{1,2})?"
                    value={retailPrice}
                    onChange={(event) => setRetailPrice(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="text-sm font-medium">
                  Unit cost
                  <input
                    className={`${inputClass} mt-1.5`}
                    inputMode="decimal"
                    pattern="[0-9]+([.][0-9]{1,2})?"
                    value={unitCost}
                    onChange={(event) => setUnitCost(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
              </div>
              <label className="flex min-h-11 items-center justify-between border-y border-ink-900/10 text-sm font-medium">
                Track inventory
                <input
                  type="checkbox"
                  checked={trackInventory}
                  onChange={(event) => setTrackInventory(event.target.checked)}
                />
              </label>
              <Button
                type="submit"
                variant="confirm"
                size="sm"
                disabled={busy || !token || !tenantId}
                className="w-full"
              >
                {busy ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Plus size={18} className="mr-2" />}
                Save product
              </Button>
            </form>
          </Glass>
        ) : null}
      </div>
    </>
  )
}
