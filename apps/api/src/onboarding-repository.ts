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
  businessQuestionsComplete: boolean
  featureSelectionComplete: boolean
  businessProfile: OnboardingResponse['businessProfile']
  featureOptions: OnboardingResponse['featureOptions']
}

export type OnboardingLoader = (tenantId: string, bindings: Bindings) => Promise<OnboardingSnapshot>
export type OnboardingUpdater = (
  userId: string,
  tenantId: string,
  request: OnboardingUpdateRequest,
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

export const loadOnboardingFromPostgres: OnboardingLoader = async (tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })

  try {
    await client.connect()
    const result = await client.query(
      `select
        exists (
          select 1 from app.locations
          where tenant_id = $1::uuid and is_active
        ) as "hasMainLocation",
        app.tenant_has_products($1::uuid) as "hasProducts",
        app.tenant_has_opening_inventory($1::uuid) as "hasOpeningInventory",
        profile.business_questions_completed_at is not null as "businessQuestionsComplete",
        profile.feature_selection_completed_at is not null as "featureSelectionComplete",
        case when profile.business_questions_completed_at is not null then
          jsonb_build_object(
            'businessType', profile.business_type,
            'salesChannels', profile.sales_channels,
            'tracksInventory', profile.tracks_inventory,
            'productSetupMethod', profile.product_setup_method
          )
        else null end as "businessProfile",
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'code', feature.code,
              'name', feature.name,
              'enabled', entitlement.enabled,
              'required', feature.code in ('catalog', 'sales', 'reports')
            ) order by
              case feature.code
                when 'catalog' then 1 when 'sales' then 2 when 'reports' then 3
                when 'inventory' then 4 when 'purchasing' then 5 when 'customers' then 6
                when 'employees' then 7 when 'finance' then 8
              end
          )
          from app.tenant_entitlements entitlement
          join app.features feature on feature.code = entitlement.feature_code
          where entitlement.tenant_id = $1::uuid
            and entitlement.entitled
            and feature.platform_available
            and feature.code in (
              'catalog', 'sales', 'reports', 'inventory', 'purchasing', 'customers', 'employees', 'finance'
            )
        ), '[]'::jsonb) as "featureOptions"
      from (select 1) seed
      left join app.tenant_onboarding_profiles profile on profile.tenant_id = $1::uuid`,
      [tenantId],
    )

    const row = result.rows[0] as OnboardingSnapshot | undefined
    if (!row) throw new Error('Onboarding state was not returned.')
    return row
  } finally {
    await client.end()
  }
}

export const updateOnboardingInPostgres: OnboardingUpdater = async (userId, tenantId, request, requestId, bindings) => {
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
        : await client.query(
            `select app.save_feature_selection(
              $1::uuid, $2::uuid, $3::text[], $4::text
            ) as response`,
            [userId, tenantId, request.enabledFeatures, requestId],
          )

    return onboardingUpdateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
