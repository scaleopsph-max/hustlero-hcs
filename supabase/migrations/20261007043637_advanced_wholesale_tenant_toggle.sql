begin;

create or replace function app.save_feature_selection(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_enabled_feature_codes text[],
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled_feature_codes text[];
  v_existing_feature_codes text[];
  v_was_complete boolean;
begin
  if not exists (
    select 1
    from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
      and membership.is_owner
  ) then
    raise exception using errcode = 'HCS04', message = 'Active tenant owner membership is required';
  end if;

  if not exists (
    select 1
    from app.tenant_onboarding_profiles
    where tenant_id = p_tenant_id
      and business_questions_completed_at is not null
  ) then
    raise exception using errcode = 'HCS06', message = 'Business setup questions must be completed first';
  end if;

  select coalesce(pg_catalog.array_agg(distinct feature_code order by feature_code), '{}'::text[])
    into v_enabled_feature_codes
    from pg_catalog.unnest(coalesce(p_enabled_feature_codes, '{}'::text[])) feature_code;

  if exists (
    select 1
    from pg_catalog.unnest(v_enabled_feature_codes) feature_code
    where feature_code not in (
      'inventory', 'purchasing', 'customers', 'employees', 'finance', 'advanced_wholesale'
    )
  ) then
    raise exception using errcode = 'HCS07', message = 'Feature selection contains an unavailable feature';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(v_enabled_feature_codes) requested(feature_code)
    left join app.tenant_entitlements entitlement
      on entitlement.tenant_id = p_tenant_id
     and entitlement.feature_code = requested.feature_code
    left join app.features feature on feature.code = requested.feature_code
    where entitlement.tenant_id is null
       or not entitlement.entitled
       or not feature.platform_available
       or (entitlement.starts_at is not null and entitlement.starts_at > now())
       or (entitlement.ends_at is not null and entitlement.ends_at <= now())
  ) then
    raise exception using errcode = 'HCS07', message = 'Feature selection contains an unavailable feature';
  end if;

  select coalesce(pg_catalog.array_agg(feature_code order by feature_code), '{}'::text[])
    into v_existing_feature_codes
    from app.tenant_entitlements
    where tenant_id = p_tenant_id
      and enabled
      and feature_code in (
        'inventory', 'purchasing', 'customers', 'employees', 'finance', 'advanced_wholesale'
      );

  select feature_selection_completed_at is not null
    into v_was_complete
    from app.tenant_onboarding_profiles
    where tenant_id = p_tenant_id;

  if v_was_complete and v_existing_feature_codes = v_enabled_feature_codes then
    return pg_catalog.jsonb_build_object(
      'step', 'feature_selection',
      'status', 'complete',
      'enabledFeatures', v_enabled_feature_codes
    );
  end if;

  update app.tenant_entitlements entitlement
  set enabled = entitlement.feature_code = any(v_enabled_feature_codes)
  from app.features feature
  where entitlement.tenant_id = p_tenant_id
    and entitlement.feature_code = feature.code
    and entitlement.feature_code in (
      'inventory', 'purchasing', 'customers', 'employees', 'finance', 'advanced_wholesale'
    )
    and entitlement.entitled
    and feature.platform_available
    and (entitlement.starts_at is null or entitlement.starts_at <= now())
    and (entitlement.ends_at is null or entitlement.ends_at > now());

  update app.tenant_entitlements
  set enabled = false
  where tenant_id = p_tenant_id
    and feature_code in (
      'inventory', 'purchasing', 'customers', 'employees', 'finance', 'advanced_wholesale'
    )
    and (
      not entitled
      or (starts_at is not null and starts_at > now())
      or (ends_at is not null and ends_at <= now())
    );

  update app.tenant_onboarding_profiles
  set feature_selection_completed_at = coalesce(feature_selection_completed_at, now()),
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id;

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'onboarding.feature_selection.saved', 'tenant_onboarding', p_tenant_id
  );

  insert into integration.event_outbox (
    tenant_id, topic, aggregate_type, aggregate_id, payload
  ) values (
    p_tenant_id, 'onboarding.feature_selection.saved', 'tenant', p_tenant_id,
    pg_catalog.jsonb_build_object(
      'tenantId', p_tenant_id,
      'enabledFeatures', v_enabled_feature_codes
    )
  );

  return pg_catalog.jsonb_build_object(
    'step', 'feature_selection',
    'status', 'complete',
    'enabledFeatures', v_enabled_feature_codes
  );
end;
$$;

create or replace function app.load_onboarding_snapshot(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile app.tenant_onboarding_profiles%rowtype;
  v_result jsonb;
begin
  if not exists (
    select 1
    from app.tenant_memberships
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
      and is_owner
  ) then
    raise exception using errcode = 'HCS03', message = 'Business setup is available to its active owner';
  end if;

  select * into v_profile
  from app.tenant_onboarding_profiles
  where tenant_id = p_tenant_id;

  v_result := pg_catalog.jsonb_build_object(
    'hasMainLocation', exists(select 1 from app.locations where tenant_id = p_tenant_id and is_active),
    'hasProducts', app.tenant_has_products(p_tenant_id),
    'hasOpeningInventory', coalesce(v_profile.tracks_inventory = false, false) or app.tenant_has_opening_inventory(p_tenant_id),
    'hasPaymentMethods', exists(select 1 from app.payment_methods where tenant_id = p_tenant_id and is_active and method_type = 'cash'),
    'hasBasicFunds', (select count(distinct fund_type) = 2 from app.fund_accounts where tenant_id = p_tenant_id and status = 'active' and fund_type in ('capital_cogs', 'operating')),
    'hasEmployees', exists(select 1 from app.employees e join app.employee_locations el on el.tenant_id = e.tenant_id and el.employee_id = e.id join app.locations l on l.tenant_id = el.tenant_id and l.id = el.location_id where e.tenant_id = p_tenant_id and e.status = 'active' and l.is_active),
    'hasRegister', exists(select 1 from app.registers where tenant_id = p_tenant_id and status = 'active'),
    'hasPosActivation', exists(select 1 from app.pos_devices where tenant_id = p_tenant_id and status = 'active'),
    'hasTestSale', exists(select 1 from app.sales where tenant_id = p_tenant_id and status in ('completed', 'partially_refunded', 'refunded', 'voided')),
    'businessQuestionsComplete', v_profile.business_questions_completed_at is not null,
    'featureSelectionComplete', v_profile.feature_selection_completed_at is not null,
    'businessProfile', case when v_profile.business_questions_completed_at is not null then pg_catalog.jsonb_build_object(
      'businessType', v_profile.business_type,
      'salesChannels', v_profile.sales_channels,
      'tracksInventory', v_profile.tracks_inventory,
      'productSetupMethod', v_profile.product_setup_method
    ) else null end,
    'featureOptions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', feature.code,
        'name', feature.name,
        'enabled', entitlement.enabled,
        'required', feature.code in ('catalog', 'sales', 'reports')
      ) order by case feature.code
        when 'catalog' then 1
        when 'sales' then 2
        when 'reports' then 3
        when 'inventory' then 4
        when 'purchasing' then 5
        when 'customers' then 6
        when 'employees' then 7
        when 'finance' then 8
        when 'advanced_wholesale' then 9
      end)
      from app.tenant_entitlements entitlement
      join app.features feature on feature.code = entitlement.feature_code
      where entitlement.tenant_id = p_tenant_id
        and entitlement.entitled
        and feature.platform_available
        and feature.code in (
          'catalog', 'sales', 'reports', 'inventory', 'purchasing', 'customers', 'employees', 'finance',
          'advanced_wholesale'
        )
        and (entitlement.starts_at is null or entitlement.starts_at <= now())
        and (entitlement.ends_at is null or entitlement.ends_at > now())
    ), '[]'::jsonb)
  );

  return v_result || pg_catalog.jsonb_build_object(
    'readyToSell',
    (v_result->>'hasMainLocation')::boolean
      and (v_result->>'hasProducts')::boolean
      and (v_result->>'hasOpeningInventory')::boolean
      and (v_result->>'hasPaymentMethods')::boolean
      and (v_result->>'hasBasicFunds')::boolean
      and (v_result->>'hasEmployees')::boolean
      and (v_result->>'hasRegister')::boolean
      and (v_result->>'hasPosActivation')::boolean
      and (v_result->>'hasTestSale')::boolean
      and (v_result->>'businessQuestionsComplete')::boolean
      and (v_result->>'featureSelectionComplete')::boolean
  );
end;
$$;

revoke all on function app.save_feature_selection(uuid, uuid, text[], text) from public, anon, authenticated;
revoke all on function app.load_onboarding_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function app.save_feature_selection(uuid, uuid, text[], text) to hcs_hyperdrive;
grant execute on function app.load_onboarding_snapshot(uuid, uuid) to hcs_hyperdrive;

commit;
