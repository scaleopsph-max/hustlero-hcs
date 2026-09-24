import {
  catalogProductCreateResponseSchema,
  catalogResponseSchema,
  type CatalogProductCreateRequest,
  type CatalogProductCreateResponse,
  type CatalogResponse,
} from '@hcs/contracts'
import { Client } from 'pg'
import { z } from 'zod'

import type { Bindings } from './env'

export type CatalogLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<CatalogResponse>
export type CatalogProductCreator = (
  userId: string,
  tenantId: string,
  request: CatalogProductCreateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<CatalogProductCreateResponse>

const databaseCatalogSchema = z.object({
  categories: z.array(z.object({ id: z.uuid(), name: z.string() })),
  products: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      description: z.string().nullable(),
      status: z.enum(['active', 'inactive', 'archived']),
      category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      variants: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          sku: z.string(),
          retailPrice: z.string(),
          unitCost: z.string().nullable(),
          trackInventory: z.boolean(),
          isActive: z.boolean(),
          barcodes: z.array(z.string()),
        }),
      ),
    }),
  ),
})

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

function minorToDecimal(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

function decimalToMinor(decimal: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal)
  if (!match) throw new Error('Database returned an invalid money value.')
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

export const loadCatalogFromPostgres: CatalogLoader = async (userId, tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select app.list_catalog_products($1::uuid, $2::uuid) as catalog', [
      userId,
      tenantId,
    ])
    const databaseCatalog = databaseCatalogSchema.parse(result.rows[0]?.catalog)
    return catalogResponseSchema.parse({
      categories: databaseCatalog.categories,
      products: databaseCatalog.products.map((product) => ({
        ...product,
        variants: product.variants.map(({ retailPrice, unitCost, ...variant }) => ({
          ...variant,
          retailPriceMinor: decimalToMinor(retailPrice),
          unitCostMinor: unitCost === null ? null : decimalToMinor(unitCost),
        })),
      })),
    })
  } finally {
    await client.end()
  }
}

export const createCatalogProductInPostgres: CatalogProductCreator = async (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      `select app.create_catalog_product(
        $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text,
        $8::numeric, $9::numeric, $10::boolean, $11::text[], $12::text, $13::text, $14::text
      ) as response`,
      [
        userId,
        tenantId,
        request.name,
        request.description ?? null,
        request.categoryName ?? null,
        request.variantName,
        request.sku,
        minorToDecimal(request.retailPriceMinor),
        request.unitCostMinor === null ? null : minorToDecimal(request.unitCostMinor),
        request.trackInventory,
        request.barcodes,
        idempotencyKey,
        requestHash,
        requestId,
      ],
    )
    return catalogProductCreateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
