import {
  openingInventoryContextSchema,
  openingInventoryCreateResponseSchema,
  type OpeningInventoryContext,
  type OpeningInventoryCreateRequest,
  type OpeningInventoryCreateResponse,
} from '@hcs/contracts'
import { Client } from 'pg'
import { z } from 'zod'

import type { Bindings } from './env'

export type OpeningInventoryLoader = (
  userId: string,
  tenantId: string,
  locationId: string | null,
  bindings: Bindings,
) => Promise<OpeningInventoryContext>

export type OpeningInventoryRecorder = (
  userId: string,
  tenantId: string,
  request: OpeningInventoryCreateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<OpeningInventoryCreateResponse>

const databaseContextSchema = z.object({
  locations: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  selectedLocationId: z.uuid(),
  items: z.array(
    z.object({
      productId: z.uuid(),
      productName: z.string(),
      variantId: z.uuid(),
      variantName: z.string(),
      sku: z.string(),
      defaultUnitCost: z.string().nullable(),
      openingUnitCost: z.string().nullable(),
      openingQuantity: z.string(),
      onHand: z.string(),
      opened: z.boolean(),
    }),
  ),
})

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

function decimalToScaled(value: string, scale: number): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new Error('Database returned an invalid decimal value.')
  const fraction = (match[3] ?? '').padEnd(scale, '0').slice(0, scale)
  const scaled = Number(match[2]) * 10 ** scale + Number(fraction)
  return match[1] === '-' ? -scaled : scaled
}

function scaledToDecimal(value: number, scale: number): string {
  const divisor = 10 ** scale
  return `${Math.floor(value / divisor)}.${String(value % divisor).padStart(scale, '0')}`
}

export const loadOpeningInventoryFromPostgres: OpeningInventoryLoader = async (
  userId,
  tenantId,
  locationId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select app.list_opening_inventory($1::uuid, $2::uuid, $3::uuid) as context', [
      userId,
      tenantId,
      locationId,
    ])
    const context = databaseContextSchema.parse(result.rows[0]?.context)
    return openingInventoryContextSchema.parse({
      ...context,
      items: context.items.map(({ defaultUnitCost, openingUnitCost, openingQuantity, onHand, ...item }) => ({
        ...item,
        defaultUnitCostMinor: defaultUnitCost === null ? null : decimalToScaled(defaultUnitCost, 2),
        openingUnitCostMinor: openingUnitCost === null ? null : decimalToScaled(openingUnitCost, 2),
        openingQuantityMilli: decimalToScaled(openingQuantity, 3),
        onHandMilli: decimalToScaled(onHand, 3),
      })),
    })
  } finally {
    await client.end()
  }
}

export const recordOpeningInventoryInPostgres: OpeningInventoryRecorder = async (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) => {
  const entries = request.entries.map((entry) => ({
    variantId: entry.variantId,
    quantity: scaledToDecimal(entry.quantityMilli, 3),
    unitCost: scaledToDecimal(entry.unitCostMinor, 2),
  }))
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      `select app.record_opening_inventory(
        $1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text
      ) as response`,
      [userId, tenantId, request.locationId, JSON.stringify(entries), idempotencyKey, requestHash, requestId],
    )
    return openingInventoryCreateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
