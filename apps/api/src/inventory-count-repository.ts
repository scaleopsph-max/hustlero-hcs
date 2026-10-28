import { Client } from 'pg'
import {
  inventoryCountDraftSchema,
  type InventoryCountCreate,
  type InventoryCountEntryCommand,
  type InventoryCountDraft,
} from '@hcs/contracts'
import type { Bindings } from './env'

export type InventoryCountCreator = (
  actor: string,
  tenant: string,
  command: InventoryCountCreate,
  key: string,
  requestId: string,
  bindings: Bindings,
) => Promise<InventoryCountDraft>
export type InventoryCountEnterer = (
  actor: string,
  tenant: string,
  id: string,
  command: InventoryCountEntryCommand,
  key: string,
  requestId: string,
  bindings: Bindings,
) => Promise<InventoryCountDraft>
export type InventoryCountLoader = (
  actor: string,
  tenant: string,
  id: string,
  bindings: Bindings,
) => Promise<InventoryCountDraft>

async function query(bindings: Bindings, sql: string, values: unknown[]): Promise<InventoryCountDraft> {
  const connectionString = bindings.HYPERDRIVE?.connectionString
  if (!connectionString) throw new Error('Database connection is unavailable.')
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const result = await client.query(sql, values)
    return inventoryCountDraftSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
export const createInventoryCountInPostgres: InventoryCountCreator = (
  actor,
  tenant,
  command,
  key,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.create_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::text,$6::text) response',
    [actor, tenant, command.locationId, JSON.stringify(command.variantIds), key, requestId],
  )
export const enterInventoryCountInPostgres: InventoryCountEnterer = (
  actor,
  tenant,
  id,
  command,
  key,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.enter_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::jsonb,$6::text,$7::text) response',
    [actor, tenant, id, command.expectedRevision, JSON.stringify(command.entries), key, requestId],
  )
export const loadInventoryCountFromPostgres: InventoryCountLoader = (actor, tenant, id, bindings) =>
  query(bindings, 'select app.load_inventory_count($1::uuid,$2::uuid,$3::uuid) response', [actor, tenant, id])
