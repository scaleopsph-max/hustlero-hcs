import {
  onboardingUpdateResponseSchema,
  tenantBootstrapResponseSchema,
  type OnboardingResponse,
  type OnboardingUpdateRequest,
  type OnboardingUpdateResponse,
  type TenantBootstrapRequest,
  type TenantBootstrapResponse,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type TenantBootstrapper = (
  userId: string,
  request: TenantBootstrapRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<TenantBootstrapResponse>

export type OnboardingSnapshot = {
  hasMainLocation: boolean
  hasProducts: boolean
  hasOpeningInventory: boolean
  hasPaymentMethods: boolean
  hasBasicFunds: boolean
  hasEmployees: boolean
  hasRegister: boolean
  hasPosActivation: boolean
  hasTestSale: boolean
  businessQuestionsComplete: boolean
  featureSelectionComplete: boolean
  readyToSell: boolean
  businessProfile: OnboardingResponse['businessProfile']
  featureOptions: OnboardingResponse['featureOptions']
}

export type OnboardingLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<OnboardingSnapshot>
export type OnboardingUpdater = (
  userId: string,
  tenantId: string,
  request: OnboardingUpdateRequest,
  idempotencyKey: string | null,
  requestHash: string | null,
  requestId: string,
  bindings: Bindings,
) => Promise<OnboardingUpdateResponse>

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) {
    throw new Error('HYPERDRIVE binding is not configured.')
  }

  return bindings.HYPERDRIVE.connectionString
}

export const bootstrapTenantInPostgres: TenantBootstrapper = async (
  userId,
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
      `select app.bootstrap_tenant(
        $1::uuid, $2::text, $3::text, $4::text, $5::text,
        $6::text, $7::text, $8::text, $9::text, $10::text
      ) as response`,
      [
        userId,
        request.slug,
        request.name,
        request.baseCurrency,
        request.timezone,
        request.mainLocation.code,
        request.mainLocation.name,
        idempotencyKey,
        requestHash,
        requestId,
      ],
    )

    return tenantBootstrapResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const loadOnboardingFromPostgres: OnboardingLoader = async (userId, tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })

  try {
    await client.connect()
    const result = await client.query('select app.load_onboarding_snapshot($1::uuid,$2::uuid) snapshot', [
      userId,
      tenantId,
    ])
    const row = result.rows[0]?.snapshot as OnboardingSnapshot | undefined
    if (!row) throw new Error('Onboarding state was not returned.')
    return row
  } finally {
    await client.end()
  }
}

export const updateOnboardingInPostgres: OnboardingUpdater = async (
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
    const result =
      request.step === 'business_questions'
        ? await client.query(
            `select app.save_business_setup_questions(
              $1::uuid, $2::uuid, $3::text, $4::text[], $5::boolean, $6::text, $7::text
            ) as response`,
            [
              userId,
              tenantId,
              request.businessType,
              request.salesChannels,
              request.tracksInventory,
              request.productSetupMethod,
              requestId,
            ],
          )
        : request.step === 'feature_selection'
          ? await client.query(
              `select app.save_feature_selection(
              $1::uuid, $2::uuid, $3::text[], $4::text
            ) as response`,
              [userId, tenantId, request.enabledFeatures, requestId],
            )
          : await client.query(
              'select app.create_basic_fund_setup($1::uuid,$2::uuid,$3::text,$4::text,$5::text) response',
              [userId, tenantId, idempotencyKey, requestHash, requestId],
            )

    return onboardingUpdateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
