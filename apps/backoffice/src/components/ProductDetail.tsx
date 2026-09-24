'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Check, Plus } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  catalogProductUpdateResponseSchema,
  catalogResponseSchema,
  catalogVariantCreateResponseSchema,
  sessionContextResponseSchema,
  type CatalogProductUpdateRequest,
  type CatalogResponse,
  type CatalogVariantCreateRequest,
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

export function ProductDetail({ productId }: { productId: string }) {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [product, setProduct] = useState<CatalogResponse['products'][number] | null>(null)
  const [name, setName] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [description, setDescription] = useState('')
  const [variantName, setVariantName] = useState('Black / XL')
  const [variantSku, setVariantSku] = useState('')
  const [variantBarcode, setVariantBarcode] = useState('')
  const [retailPrice, setRetailPrice] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [trackInventory, setTrackInventory] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadProduct = useCallback(
    async (accessToken: string, selectedTenantId: string) => {
      const catalog = catalogResponseSchema.parse(
        await apiRequest('/v1/catalog', accessToken, selectedTenantId, undefined, auth ?? undefined, setToken),
      )
      const nextProduct = catalog.products.find((entry) => entry.id === productId) ?? null
      if (!nextProduct) throw new Error('Product not found.')
      setProduct(nextProduct)
      setName(nextProduct.name)
      setCategoryName(nextProduct.category?.name ?? '')
      setDescription(nextProduct.description ?? '')
    },
    [auth, productId],
  )

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in before opening a product.')
        setToken(data.session.access_token)
        const context = sessionContextResponseSchema.parse(
          await apiRequest('/v1/me', data.session.access_token, '', undefined, auth, setToken),
        )
        const tenant = context.tenants.find((item) => item.isOwner) ?? context.tenants[0]
        if (!tenant) throw new Error('Create a business before opening a product.')
        setTenantId(tenant.tenantId)
        await loadProduct(data.session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the product.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, loadProduct])

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const request: CatalogProductUpdateRequest = {
      name: name.trim(),
      categoryName: categoryName.trim() || null,
      description: description.trim() || null,
    }
    let requestToken = token
    try {
      const key = crypto.randomUUID()
      catalogProductUpdateResponseSchema.parse(
        await apiRequest(
          `/v1/catalog/products/${productId}`,
          requestToken,
          tenantId,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify(request),
          },
          auth ?? undefined,
          (refreshedToken) => {
            requestToken = refreshedToken
            setToken(refreshedToken)
          },
        ),
      )
      await loadProduct(requestToken, tenantId)
      setNotice('Product details updated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the product.')
    } finally {
      setBusy(false)
    }
  }

  async function addVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const request: CatalogVariantCreateRequest = {
      variantName: variantName.trim(),
      sku: variantSku.trim().toUpperCase(),
      retailPriceMinor: parsePeso(retailPrice),
      unitCostMinor: unitCost.trim() ? parsePeso(unitCost) : null,
      trackInventory,
      barcodes: variantBarcode.trim() ? [variantBarcode.trim().toUpperCase()] : [],
    }
    let requestToken = token
    try {
      catalogVariantCreateResponseSchema.parse(
        await apiRequest(
          `/v1/catalog/products/${productId}/variants`,
          requestToken,
          tenantId,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(request),
          },
          auth ?? undefined,
          (refreshedToken) => {
            requestToken = refreshedToken
            setToken(refreshedToken)
          },
        ),
      )
      await loadProduct(requestToken, tenantId)
      setVariantName('Black / XL')
      setVariantSku('')
      setVariantBarcode('')
      setRetailPrice('')
      setUnitCost('')
      setNotice('Variant added to the product.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the variant.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar title={product?.name ?? 'Product'} subtitle="Edit the product master and manage its variants." />
      <Link href="/products" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink-600">
        <ArrowLeft size={16} /> Products
      </Link>
      {loading ? <p className="py-12 text-center text-sm text-ink-500">Loading product...</p> : null}
      {error ? (
        <p role="alert" className="mb-5 border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-5 border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}
      {product ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Glass variant="data" className="rounded-panel p-5">
            <div className="flex items-start justify-between gap-4 border-b border-ink-900/10 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-500">Product master</p>
                <h1 className="mt-1 font-display text-2xl font-bold">{product.name}</h1>
              </div>
              <span className="text-sm text-ink-500">{product.variants.length} variants</span>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[650px] border-collapse text-left text-sm">
                <thead className="text-xs uppercase text-ink-500">
                  <tr>
                    <th className="py-3 font-semibold">Variant</th>
                    <th className="py-3 font-semibold">SKU</th>
                    <th className="py-3 font-semibold">Barcode</th>
                    <th className="py-3 text-right font-semibold">Retail price</th>
                    <th className="py-3 text-right font-semibold">Inventory</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant) => (
                    <tr key={variant.id} className="border-t border-ink-900/10">
                      <td className="py-4 font-semibold">{variant.name}</td>
                      <td className="py-4">{variant.sku}</td>
                      <td className="py-4 text-ink-600">{variant.barcodes[0] ?? 'None'}</td>
                      <td className="py-4 text-right font-semibold">{formatPeso(variant.retailPriceMinor)}</td>
                      <td className="py-4 text-right text-ink-600">
                        {variant.trackInventory ? (
                          <Check size={16} className="ml-auto text-emerald-700" />
                        ) : (
                          'Not tracked'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form className="mt-7 border-t border-ink-900/10 pt-5" onSubmit={(event) => void addVariant(event)}>
              <p className="text-xs font-semibold uppercase text-ink-500">Add variant</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <label className="text-sm font-medium">
                  Color / size
                  <input
                    className={`${inputClass} mt-1.5`}
                    required
                    value={variantName}
                    onChange={(event) => setVariantName(event.target.value)}
                    placeholder="Black / XL"
                  />
                </label>
                <label className="text-sm font-medium">
                  SKU
                  <input
                    className={`${inputClass} mt-1.5 uppercase`}
                    required
                    pattern="[A-Za-z0-9._-]+"
                    value={variantSku}
                    onChange={(event) => setVariantSku(event.target.value)}
                  />
                </label>
                <label className="text-sm font-medium">
                  Barcode
                  <input
                    className={`${inputClass} mt-1.5`}
                    pattern="[A-Za-z0-9._-]+"
                    value={variantBarcode}
                    onChange={(event) => setVariantBarcode(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                  Track inventory
                  <input
                    type="checkbox"
                    checked={trackInventory}
                    onChange={(event) => setTrackInventory(event.target.checked)}
                  />
                </label>
                <Button type="submit" variant="confirm" size="sm" disabled={busy || !token || !tenantId}>
                  <Plus size={18} className="mr-2" /> Save variant
                </Button>
              </div>
            </form>
          </Glass>
          <Glass variant="light" as="aside" className="rounded-panel p-5">
            <p className="text-xs font-semibold uppercase text-ink-500">Editable details</p>
            <h2 className="mt-1 font-display text-xl font-bold">Product master</h2>
            <form className="mt-5 flex flex-col gap-4" onSubmit={(event) => void saveProduct(event)}>
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
                  maxLength={80}
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="text-sm font-medium">
                Description
                <textarea
                  className={`${inputClass} mt-1.5 py-2`}
                  rows={4}
                  maxLength={1000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <Button type="submit" variant="confirm" size="sm" disabled={busy || !token || !tenantId}>
                <Check size={18} className="mr-2" /> Save changes
              </Button>
            </form>
          </Glass>
        </div>
      ) : null}
    </>
  )
}
