'use client'

import { createClient } from '@supabase/supabase-js'
import { Receipt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { salesContextSchema, sessionContextResponseSchema, type SalesContext } from '@hcs/contracts'
import { Chip, Glass, formatPeso } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

async function call(path: string, token: string, tenantId = '') {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}) },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}

export function SalesWorkspace() {
  const [data, setData] = useState<SalesContext>({ sales: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    const auth = createClient(supabaseUrl, supabaseKey)
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to view sales.')
        const token = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', token))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setData(salesContextSchema.parse(await call('/v1/sales', token, tenant.tenantId)))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load sales.')
      } finally {
        setLoading(false)
      }
    })
  }, [])

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading sales...
      </Glass>
    )
  if (error) return <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div>

  const gross = data.sales.reduce((sum, sale) => sum + sale.totalCentavos, 0)
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-ink-900/10 bg-white p-5">
          <div className="text-sm text-ink-500">Completed receipts</div>
          <div className="mt-1 font-display text-3xl font-bold">
            {data.sales.filter((sale) => sale.status === 'completed').length}
          </div>
        </div>
        <div className="border border-ink-900/10 bg-white p-5">
          <div className="text-sm text-ink-500">Recorded sales</div>
          <div className="mt-1 font-display text-3xl font-bold">{formatPeso(gross)}</div>
        </div>
      </div>
      <Glass variant="light" className="overflow-hidden">
        <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr] gap-3 border-b border-ink-900/10 px-5 py-3 text-xs font-semibold uppercase text-ink-500">
          <span>Receipt</span>
          <span>Branch / register</span>
          <span>Cashier</span>
          <span>Completed</span>
          <span className="text-right">Total</span>
        </div>
        {data.sales.length ? (
          data.sales.map((sale) => (
            <div
              key={sale.id}
              className="grid grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr] items-center gap-3 border-b border-ink-900/10 px-5 py-4 text-sm last:border-0"
            >
              <div>
                <div className="font-semibold">{sale.receiptNumber}</div>
                <div className="mt-1">
                  <Chip tone="success">{sale.status}</Chip>
                </div>
              </div>
              <span>
                {sale.locationName}
                <br />
                <span className="text-ink-500">{sale.registerName}</span>
              </span>
              <span>{sale.employeeName}</span>
              <span>
                {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(
                  new Date(sale.completedAt),
                )}
              </span>
              <strong className="text-right">{formatPeso(sale.totalCentavos)}</strong>
            </div>
          ))
        ) : (
          <div className="grid place-items-center gap-3 px-5 py-16 text-center">
            <Receipt size={34} className="text-ink-400" />
            <div>
              <div className="font-semibold">No completed sales yet</div>
              <div className="text-sm text-ink-500">The first POS receipt will appear here.</div>
            </div>
          </div>
        )}
      </Glass>
    </div>
  )
}
