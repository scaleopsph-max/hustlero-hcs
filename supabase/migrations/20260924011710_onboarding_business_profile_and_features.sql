begin;

insert into app.features (code, name, platform_available) values
  ('catalog', 'Products and catalog', true),
  ('sales', 'Sales and checkout', true),
  ('reports', 'Basic reports', true),
  ('inventory', 'Inventory tracking', true),
  ('purchasing', 'Purchasing', true),
  ('customers', 'Customer profiles', true),
  ('employees', 'Employee management', true),
  ('finance', 'Basic fund tracking', true),
  ('online_store', 'Online store', false),
  ('advanced_wholesale', 'Advanced wholesale', false)
on conflict (code) do update
set name = excluded.name,
    platform_available = excluded.platform_available,
    updated_at = now();

create table app.tenant_onboarding_profiles (
  tenant_id uuid primary key references app.tenants (id) on delete restrict,
  business_type text,
  sales_channels text[] not null default '{}',
  tracks_inventory boolean,
  product_setup_method text,
  business_questions_completed_at timestamptz,
  feature_selection_completed_at timestamptz,
  updated_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_onboarding_business_type check (
    business_type is null or business_type in ('retail', 'food_and_beverage', 'services', 'mixed')
  ),
  constraint tenant_onboarding_sales_channels check (
    sales_channels <@ array['in_store', 'online', 'wholesale']::text[]
  ),
  constraint tenant_onboarding_product_setup_method check (
    product_setup_method is null or product_setup_method in ('manual', 'csv', 'later')
  ),
  constraint tenant_onboarding_questions_complete check (
    business_questions_completed_at is null or (
      business_type is not null
      and cardinality(sales_channels) > 0
      and tracks_inventory is not null
      and product_setup_method is not null
    )
  ),
  constraint tenant_onboarding_features_after_questions check (
    feature_selection_completed_at is null or business_questions_completed_at is not null
  )
);

alter table app.tenant_onboarding_profiles enable row level security;

create trigger tenant_onboarding_profiles_set_updated_at
before update on app.tenant_onboarding_profiles
for each row execute function app.set_updated_at();

grant select (
  tenant_id,
  business_type,
  sales_channels,
  tracks_inventory,
  product_setup_method,
  business_questions_completed_at,
  feature_selection_completed_at
) on app.tenant_onboarding_profiles to hcs_api_context_reader;

create policy tenant_onboarding_profiles_api_context_select
on app.tenant_onboarding_profiles for select to hcs_api_context_reader
using (true);

grant select (code, name, platform_available)
on app.features to hcs_api_context_reader;

create policy features_api_context_select
on app.features for select to hcs_api_context_reader
using (true);

create function app.initialize_tenant_core_features()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into app.tenant_entitlements (tenant_id, feature_code, entitled, enabled, starts_at)
  select
    new.id,
    feature.code,
    true,
    feature.code in ('catalog', 'sales', 'reports'),
    now()
  from app.features feature
  where feature.code in (
    'catalog', 'sales', 'reports', 'inventory', 'purchasing', 'customers', 'employees', 'finance'
  )
  on conflict (tenant_id, feature_code) do nothing;

  return new;
end;
$$;

revoke all on function app.initialize_tenant_core_features() from public, anon, authenticated;

create trigger tenants_initialize_core_features
after insert on app.tenants
for each row execute function app.initialize_tenant_core_features();

insert into app.tenant_entitlements (tenant_id, feature_code, entitled, enabled, starts_at)
select
  tenant.id,
  feature.code,
  true,
  feature.code in ('catalog', 'sales', 'reports'),
  now()
from app.tenants tenant
cross join app.features feature
where feature.code in (
  'catalog', 'sales', 'reports', 'inventory', 'purchasing', 'customers', 'employees', 'finance'
)
on conflict (tenant_id, feature_code) do nothing;

create function app.save_business_setup_questions(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_business_type text,
  p_sales_channels text[],
  p_tracks_inventory boolean,
  p_product_setup_method text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sales_channels text[];
  v_existing app.tenant_onboarding_profiles%rowtype;
  v_response jsonb;
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

  select coalesce(pg_catalog.array_agg(distinct channel order by channel), '{}'::text[])
    into v_sales_channels
    from pg_catalog.unnest(coalesce(p_sales_channels, '{}'::text[])) channel;

  if p_business_type not in ('retail', 'food_and_beverage', 'services', 'mixed')
    or cardinality(v_sales_channels) = 0
    or exists (
      select 1 from pg_catalog.unnest(v_sales_channels) channel
      where channel not in ('in_store', 'online', 'wholesale')
    )
    or p_tracks_inventory is null
    or p_product_setup_method not in ('manual', 'csv', 'later') then
    raise exception using errcode = 'HCS05', message = 'Invalid business setup answers';
  end if;

  select * into v_existing
  from app.tenant_onboarding_profiles
  where tenant_id = p_tenant_id;

  if found
    and v_existing.business_type = p_business_type
    and v_existing.sales_channels = v_sales_channels
    and v_existing.tracks_inventory = p_tracks_inventory
    and v_existing.product_setup_method = p_product_setup_method
    and v_existing.business_questions_completed_at is not null then
    return pg_catalog.jsonb_build_object(
      'step', 'business_questions',
      'status', 'complete'
    );
  end if;

  insert into app.tenant_onboarding_profiles (
    tenant_id,
    business_type,
    sales_channels,
    tracks_inventory,
    product_setup_method,
    business_questions_completed_at,
    updated_by
  ) values (
    p_tenant_id,
    p_business_type,
    v_sales_channels,
    p_tracks_inventory,
    p_product_setup_method,
    now(),
    p_actor_user_id
  )
  on conflict (tenant_id) do update
  set business_type = excluded.business_type,
      sales_channels = excluded.sales_channels,
      tracks_inventory = excluded.tracks_inventory,
      product_setup_method = excluded.product_setup_method,
      business_questions_completed_at = coalesce(
        app.tenant_onboarding_profiles.business_questions_completed_at,
        excluded.business_questions_completed_at
      ),
      updated_by = excluded.updated_by;

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'onboarding.business_questions.saved', 'tenant_onboarding', p_tenant_id
  );

  insert into integration.event_outbox (
    tenant_id, topic, aggregate_type, aggregate_id, payload
  ) values (
    p_tenant_id, 'onboarding.business_questions.saved', 'tenant', p_tenant_id,
    pg_catalog.jsonb_build_object('tenantId', p_tenant_id)
  );

  v_response := pg_catalog.jsonb_build_object(
    'step', 'business_questions',
    'status', 'complete'
  );
  return v_response;
end;
$$;

create function app.save_feature_selection(
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
    select 1 from app.tenant_onboarding_profiles
    where tenant_id = p_tenant_id
      and business_questions_completed_at is not null
  ) then
    raise exception using errcode = 'HCS06', message = 'Business setup questions must be completed first';
  end if;

  select coalesce(pg_catalog.array_agg(distinct feature_code order by feature_code), '{}'::text[])
    into v_enabled_feature_codes
    from pg_catalog.unnest(coalesce(p_enabled_feature_codes, '{}'::text[])) feature_code;

  if exists (
    select 1 from pg_catalog.unnest(v_enabled_feature_codes) feature_code
    where feature_code not in ('inventory', 'purchasing', 'customers', 'employees', 'finance')
  ) then
    raise exception using errcode = 'HCS07', message = 'Feature selection contains an unavailable feature';
  end if;

  select coalesce(pg_catalog.array_agg(feature_code order by feature_code), '{}'::text[])
    into v_existing_feature_codes
    from app.tenant_entitlements
    where tenant_id = p_tenant_id
      and enabled
      and feature_code in ('inventory', 'purchasing', 'customers', 'employees', 'finance');

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

  update app.tenant_entitlements
  set enabled = feature_code = any(v_enabled_feature_codes)
  where tenant_id = p_tenant_id
    and feature_code in ('inventory', 'purchasing', 'customers', 'employees', 'finance');

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

revoke all on function app.save_business_setup_questions(
  uuid, uuid, text, text[], boolean, text, text
) from public, anon, authenticated;
grant execute on function app.save_business_setup_questions(
  uuid, uuid, text, text[], boolean, text, text
) to hcs_hyperdrive;

revoke all on function app.save_feature_selection(
  uuid, uuid, text[], text
) from public, anon, authenticated;
grant execute on function app.save_feature_selection(
  uuid, uuid, text[], text
) to hcs_hyperdrive;

commit;
