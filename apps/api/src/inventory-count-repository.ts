import { Client } from 'pg'
import {
  inventoryCountDraftSchema,
  inventoryCountListSchema,
  type InventoryCountCreate,
  type InventoryCountEntryCommand,
  type InventoryCountDraft,
  type InventoryCountList,
  type InventoryCountSubmit,
  type InventoryCountDecision,
  type InventoryCountPost,
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
export type InventoryCountListLoader = (
  actor: string,
  tenant: string,
  bindings: Bindings,
) => Promise<InventoryCountList>
export type InventoryCountAction = 'submit' | 'approval' | 'post' | 'cancel'
export type InventoryCountActionCommander = (
  actor: string,
  tenant: string,
  id: string,
  action: InventoryCountAction,
  command: InventoryCountSubmit | InventoryCountDecision | InventoryCountPost,
  key: string,
  requestId: string,
  bindings: Bindings,
) => Promise<InventoryCountDraft>

async function query(bindings: Bindings, sql: string, values: unknown[]): Promise<unknown> {
  const connectionString = bindings.HYPERDRIVE?.connectionString
  if (!connectionString) throw new Error('Database connection is unavailable.')
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const result = await client.query(sql, values)
    return result.rows[0]?.response
  } finally {
    await client.end()
  }
}
export const createInventoryCountInPostgres: InventoryCountCreator = async (
  actor,
  tenant,
  command,
  key,
  requestId,
  bindings,
) =>
  inventoryCountDraftSchema.parse(
    await query(
      bindings,
      'select app.create_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::text,$6::text) response',
      [actor, tenant, command.locationId, JSON.stringify(command.variantIds), key, requestId],
    ),
  )
export const enterInventoryCountInPostgres: InventoryCountEnterer = async (
  actor,
  tenant,
  id,
  command,
  key,
  requestId,
  bindings,
) =>
  inventoryCountDraftSchema.parse(
    await query(
      bindings,
      'select app.enter_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::jsonb,$6::text,$7::text) response',
      [actor, tenant, id, command.expectedRevision, JSON.stringify(command.entries), key, requestId],
    ),
  )
export const loadInventoryCountFromPostgres: InventoryCountLoader = async (actor, tenant, id, bindings) =>
  inventoryCountDraftSchema.parse(
    await query(bindings, 'select app.load_inventory_count($1::uuid,$2::uuid,$3::uuid) response', [actor, tenant, id]),
  )
export const listInventoryCountsFromPostgres: InventoryCountListLoader = async (actor, tenant, bindings) =>
  inventoryCountListSchema.parse(
    await query(bindings, 'select app.list_inventory_counts($1::uuid,$2::uuid) response', [actor, tenant]),
  )
export const commandInventoryCountInPostgres: InventoryCountActionCommander = async (
  actor,
  tenant,
  id,
  action,
  command,
  key,
  requestId,
  bindings,
) => {
  let sql: string, values: unknown[]
  if (action === 'submit') {
    sql = 'select app.submit_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text) response'
    values = [actor, tenant, id, command.expectedRevision, key, requestId]
  } else if (action === 'approval' && 'decision' in command) {
    sql =
      'select app.decide_inventory_count_approval($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text,$7::text,$8::text) response'
    values = [actor, tenant, id, command.expectedRevision, command.decision, command.note ?? null, key, requestId]
  } else if ((action === 'post' || action === 'cancel') && 'reason' in command) {
    sql =
      action === 'post'
        ? 'select app.post_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text,$7::text) response'
        : 'select app.cancel_inventory_count($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text,$7::text) response'
    values = [actor, tenant, id, command.expectedRevision, command.reason, key, requestId]
  } else throw new Error('Invalid inventory count action.')
  return inventoryCountDraftSchema.parse(await query(bindings, sql, values))
}
