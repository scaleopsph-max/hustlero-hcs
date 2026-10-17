import {
  customerCreateResponseSchema,
  customerDetailSchema,
  customerNoteResponseSchema,
  customerUpdateResponseSchema,
  customersContextSchema,
  posCustomerCreateResponseSchema,
  posCustomerSearchResponseSchema,
  type CustomerCreateRequest,
  type CustomerDetail,
  type CustomerNoteRequest,
  type CustomersContext,
  type CustomerUpdateRequest,
  type PosCustomerCreateRequest,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type CustomersLoader = (
  userId: string,
  tenantId: string,
  search: string,
  bindings: Bindings,
) => Promise<CustomersContext>
export type CustomerLoader = (
  userId: string,
  tenantId: string,
  customerId: string,
  bindings: Bindings,
) => Promise<CustomerDetail>
export type CustomerCreator = (
  userId: string,
  tenantId: string,
  request: CustomerCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type CustomerUpdater = (
  userId: string,
  tenantId: string,
  customerId: string,
  request: CustomerUpdateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type CustomerNoteCreator = (
  userId: string,
  tenantId: string,
  customerId: string,
  request: CustomerNoteRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type PosCustomersSearcher = (sessionHash: string, search: string, bindings: Bindings) => Promise<unknown>
export type PosCustomerCreator = (
  sessionHash: string,
  request: PosCustomerCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>

async function query(bindings: Bindings, text: string, values: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

export const loadCustomersFromPostgres: CustomersLoader = async (userId, tenantId, search, bindings) =>
  customersContextSchema.parse(
    (
      await query(bindings, 'select app.list_customers($1::uuid,$2::uuid,$3::text,$4::integer) context', [
        userId,
        tenantId,
        search,
        100,
      ])
    ).rows[0]?.context,
  )

export const loadCustomerFromPostgres: CustomerLoader = async (userId, tenantId, customerId, bindings) =>
  customerDetailSchema.parse(
    (
      await query(bindings, 'select app.load_customer($1::uuid,$2::uuid,$3::uuid) customer', [
        userId,
        tenantId,
        customerId,
      ])
    ).rows[0]?.customer,
  )

export const createCustomerInPostgres: CustomerCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  customerCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_customer($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid,$7::text,$8::boolean,$9::boolean,$10::text,$11::text,$12::text) response',
        [
          userId,
          tenantId,
          request.fullName,
          request.email,
          request.phone,
          request.customerGroupId,
          request.customerType,
          request.emailMarketingConsent,
          request.smsMarketingConsent,
          key,
          hash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )

export const updateCustomerInPostgres: CustomerUpdater = async (
  userId,
  tenantId,
  customerId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  customerUpdateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.update_customer($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::uuid,$8::text,$9::boolean,$10::boolean,$11::text,$12::text,$13::text,$14::text) response',
        [
          userId,
          tenantId,
          customerId,
          request.fullName,
          request.email,
          request.phone,
          request.customerGroupId,
          request.customerType,
          request.emailMarketingConsent,
          request.smsMarketingConsent,
          request.status,
          key,
          hash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )

export const addCustomerNoteInPostgres: CustomerNoteCreator = async (
  userId,
  tenantId,
  customerId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  customerNoteResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.add_customer_note($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text) response',
        [userId, tenantId, customerId, request.note, key, hash, requestId],
      )
    ).rows[0]?.response,
  )

export const searchPosCustomersFromPostgres: PosCustomersSearcher = async (sessionHash, search, bindings) =>
  posCustomerSearchResponseSchema.parse(
    (
      await query(bindings, 'select app.search_pos_customers($1::text,$2::text,$3::integer) context', [
        sessionHash,
        search,
        20,
      ])
    ).rows[0]?.context,
  )

export const createPosCustomerInPostgres: PosCustomerCreator = async (
  sessionHash,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  posCustomerCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_pos_customer($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::boolean,$7::text,$8::text,$9::text) response',
        [
          sessionHash,
          request.fullName,
          request.email,
          request.phone,
          request.emailMarketingConsent,
          request.smsMarketingConsent,
          key,
          hash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )
