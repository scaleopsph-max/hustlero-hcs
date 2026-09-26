import {
  dashboardContextSchema,
  inventoryReportContextSchema,
  salesReportContextSchema,
  type DashboardContext,
  type InventoryReportContext,
  type ReportingFilter,
  type SalesReportContext,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

type ReportingPayload = Record<string, unknown>
export type DashboardLoader = (
  userId: string,
  tenantId: string,
  filter: ReportingFilter,
  bindings: Bindings,
) => Promise<DashboardContext>
export type SalesReportLoader = (
  userId: string,
  tenantId: string,
  filter: ReportingFilter,
  bindings: Bindings,
) => Promise<SalesReportContext>
export type InventoryReportLoader = (
  userId: string,
  tenantId: string,
  filter: ReportingFilter,
  bindings: Bindings,
) => Promise<InventoryReportContext>

async function load(
  userId: string,
  tenantId: string,
  filter: ReportingFilter,
  bindings: Bindings,
): Promise<ReportingPayload> {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    const result = await client.query(
      'select app.load_reporting($1::uuid,$2::uuid,$3::date,$4::date,$5::uuid,$6::text) context',
      [userId, tenantId, filter.from, filter.to, filter.locationId, filter.channel],
    )
    return result.rows[0]?.context as ReportingPayload
  } finally {
    await client.end()
  }
}

export const loadDashboardFromPostgres: DashboardLoader = async (userId, tenantId, filter, bindings) =>
  dashboardContextSchema.parse(await load(userId, tenantId, filter, bindings))

export const loadSalesReportFromPostgres: SalesReportLoader = async (userId, tenantId, filter, bindings) => {
  const context = await load(userId, tenantId, filter, bindings)
  return salesReportContextSchema.parse(context)
}

export const loadInventoryReportFromPostgres: InventoryReportLoader = async (userId, tenantId, filter, bindings) => {
  const context = await load(userId, tenantId, filter, bindings)
  return inventoryReportContextSchema.parse({
    scope: context.scope,
    locations: context.locations,
    summary: context.inventory,
    items: context.inventoryItems,
  })
}
