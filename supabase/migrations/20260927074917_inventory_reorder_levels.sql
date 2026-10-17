begin;

create table app.inventory_reorder_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  location_id uuid not null,
  variant_id uuid not null,
  reorder_level numeric(18, 3) not null,
  is_active boolean not null default true,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, location_id, variant_id),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  foreign key (tenant_id, updated_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint inventory_reorder_policies_level_valid
    check (reorder_level >= 0 and reorder_level <= 999999999.999 and reorder_level = round(reorder_level, 3))
);
create index inventory_reorder_policies_active_location_idx
  on app.inventory_reorder_policies (tenant_id, location_id, variant_id) where is_active;
create index inventory_reorder_policies_updated_by_idx
  on app.inventory_reorder_policies (tenant_id, updated_by);
create trigger inventory_reorder_policies_set_updated_at before update on app.inventory_reorder_policies
for each row execute function app.set_updated_at();
alter table app.inventory_reorder_policies enable row level security;
revoke all on table app.inventory_reorder_policies from public, anon, authenticated, hcs_hyperdrive;

create function app.sync_inventory_reorder_alert(
  p_tenant_id uuid,
  p_location_id uuid,
  p_variant_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_available numeric(18,3);
  v_reorder_level numeric(18,3);
  v_product_name text;
  v_variant_name text;
  v_sku text;
  v_location_name text;
begin
  select balance.on_hand - balance.reserved,
         policy.reorder_level, product.name, variant.name, variant.sku::text, location.name
    into v_available, v_reorder_level, v_product_name, v_variant_name, v_sku, v_location_name
  from app.inventory_balances balance
  join app.inventory_reorder_policies policy
    on policy.tenant_id = balance.tenant_id and policy.location_id = balance.location_id
   and policy.variant_id = balance.variant_id and policy.is_active
  join app.product_variants variant
    on variant.tenant_id = balance.tenant_id and variant.id = balance.variant_id
  join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
  join app.locations location on location.tenant_id = balance.tenant_id and location.id = balance.location_id
  where balance.tenant_id = p_tenant_id and balance.location_id = p_location_id
    and balance.variant_id = p_variant_id and variant.track_inventory and variant.is_active
    and product.status = 'active' and location.is_active;

  if found and v_available > 0 and v_available <= v_reorder_level then
    insert into app.risk_alerts (
      tenant_id, location_id, category, severity, status, title, message,
      entity_type, entity_id, dedup_key, metadata
    ) values (
      p_tenant_id, p_location_id, 'inventory', 'attention', 'open',
      v_sku || ' is low on stock',
      v_product_name || ' / ' || v_variant_name || ' is at or below its reorder level at ' || v_location_name || '.',
      'product_variant', p_variant_id,
      'inventory.low_stock:' || p_location_id::text || ':' || p_variant_id::text,
      pg_catalog.jsonb_build_object(
        'productName', v_product_name, 'variantName', v_variant_name, 'sku', v_sku,
        'availableMilli', pg_catalog.round(v_available * 1000)::bigint,
        'reorderLevelMilli', pg_catalog.round(v_reorder_level * 1000)::bigint
      )
    )
    on conflict (tenant_id, dedup_key) do update set
      severity = excluded.severity, title = excluded.title, message = excluded.message,
      last_detected_at = now(), metadata = excluded.metadata,
      status = case when app.risk_alerts.status = 'resolved' then 'open' else app.risk_alerts.status end,
      resolved_at = case when app.risk_alerts.status = 'resolved' then null else app.risk_alerts.resolved_at end,
      resolved_by = case when app.risk_alerts.status = 'resolved' then null else app.risk_alerts.resolved_by end;
  else
    update app.risk_alerts set
      status = 'resolved', resolved_at = now(), resolved_by = null,
      note = coalesce(note, 'Condition cleared automatically.')
    where tenant_id = p_tenant_id and location_id = p_location_id and entity_id = p_variant_id
      and dedup_key = 'inventory.low_stock:' || p_location_id::text || ':' || p_variant_id::text
      and status in ('open', 'acknowledged');
  end if;
end;
$$;
revoke all on function app.sync_inventory_reorder_alert(uuid,uuid,uuid)
  from public, anon, authenticated, hcs_hyperdrive;

create function app.sync_inventory_reorder_alert_from_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.sync_inventory_reorder_alert(new.tenant_id, new.location_id, new.variant_id);
  return new;
end;
$$;
revoke all on function app.sync_inventory_reorder_alert_from_balance()
  from public, anon, authenticated, hcs_hyperdrive;
create trigger inventory_balances_sync_reorder_alert
after insert or update of on_hand, reserved, damaged on app.inventory_balances
for each row execute function app.sync_inventory_reorder_alert_from_balance();

create function app.set_inventory_reorder_level(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_variant_id uuid,
  p_reorder_level numeric,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_previous numeric(18,3);
  v_response jsonb;
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active' and (
        membership.is_owner or exists (
          select 1 from app.membership_roles membership_role
          join app.role_permissions role_permission
            on role_permission.tenant_id = membership_role.tenant_id
           and role_permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id
            and role_permission.permission_code = 'inventory.manage'
        )
      )
  ) then raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed'; end if;

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'inventory'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable'; end if;

  if p_reorder_level is not null and (
    p_reorder_level < 0 or p_reorder_level > 999999999.999 or p_reorder_level <> round(p_reorder_level, 3)
  ) then raise exception using errcode = 'HCSR0', message = 'Reorder level is invalid'; end if;

  if not exists (
    select 1 from app.locations location
    left join app.employees employee
      on employee.tenant_id = p_tenant_id and employee.user_id = p_actor_user_id and employee.status = 'active'
    where location.tenant_id = p_tenant_id and location.id = p_location_id and location.is_active
      and (exists (
        select 1 from app.tenant_memberships membership
        where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
          and membership.status = 'active' and membership.is_owner
      ) or exists (
        select 1 from app.employee_locations employee_location
        where employee_location.tenant_id = p_tenant_id and employee_location.employee_id = employee.id
          and employee_location.location_id = location.id
      ))
  ) then raise exception using errcode = 'HCS19', message = 'Inventory location was not found'; end if;

  if not exists (
    select 1 from app.product_variants variant
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    where variant.tenant_id = p_tenant_id and variant.id = p_variant_id
      and variant.is_active and variant.track_inventory and product.status = 'active'
  ) then raise exception using errcode = 'HCS21', message = 'Inventory variant was not found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_tenant_id::text || ':inventory.reorder:' || p_location_id::text || ':' || p_variant_id::text, 0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_tenant_id::text || ':inventory.reorder.request:' || p_idempotency_key, 0
  ));

  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'inventory.reorder-level.set'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key conflict';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (
      tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at
    ) values (
      p_tenant_id, 'inventory.reorder-level.set', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  select reorder_level into v_previous from app.inventory_reorder_policies
  where tenant_id = p_tenant_id and location_id = p_location_id and variant_id = p_variant_id;

  if p_reorder_level is null then
    update app.inventory_reorder_policies set is_active = false, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and location_id = p_location_id and variant_id = p_variant_id;
  else
    insert into app.inventory_reorder_policies (
      tenant_id, location_id, variant_id, reorder_level, is_active, updated_by
    ) values (p_tenant_id, p_location_id, p_variant_id, p_reorder_level, true, p_actor_user_id)
    on conflict (tenant_id, location_id, variant_id) do update set
      reorder_level = excluded.reorder_level, is_active = true, updated_by = excluded.updated_by;
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'locationId', p_location_id, 'variantId', p_variant_id,
    'reorderLevelMilli', case when p_reorder_level is null then null
      else pg_catalog.round(p_reorder_level * 1000)::bigint end,
    'status', 'updated'
  );
  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'inventory.reorder_level.updated',
    'product_variant', p_variant_id, p_location_id,
    pg_catalog.jsonb_build_object('previousLevel', v_previous, 'newLevel', p_reorder_level)
  );
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'inventory.reorder_level.updated', 'product_variant', p_variant_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response,
    completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'inventory.reorder-level.set'
    and idempotency_key = p_idempotency_key;

  perform app.sync_inventory_reorder_alert(p_tenant_id, p_location_id, p_variant_id);
  return v_response;
end;
$$;
revoke all on function app.set_inventory_reorder_level(uuid,uuid,uuid,uuid,numeric,text,text,text)
  from public, anon, authenticated;
grant execute on function app.set_inventory_reorder_level(uuid,uuid,uuid,uuid,numeric,text,text,text)
  to hcs_hyperdrive;

create function app.list_inventory_stock_with_reorder(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
declare
  v_context jsonb;
  v_selected_location uuid;
begin
  v_context := app.list_inventory_stock(p_actor_user_id, p_tenant_id, p_location_id);
  v_selected_location := (v_context ->> 'selectedLocationId')::uuid;
  return pg_catalog.jsonb_set(v_context, '{items}', coalesce((
    select pg_catalog.jsonb_agg(item || pg_catalog.jsonb_build_object(
      'reorderLevel', policy.reorder_level::text,
      'stockStatus', case
        when not (item ->> 'hasBalance')::boolean then 'not_started'
        when (item ->> 'available')::numeric <= 0 then 'out_of_stock'
        when policy.is_active and (item ->> 'available')::numeric <= policy.reorder_level then 'low_stock'
        else 'in_stock'
      end
    ))
    from pg_catalog.jsonb_array_elements(v_context -> 'items') item
    left join app.inventory_reorder_policies policy
      on policy.tenant_id = p_tenant_id and policy.location_id = v_selected_location
     and policy.variant_id = (item ->> 'variantId')::uuid and policy.is_active
  ), '[]'::jsonb));
end;
$$;
revoke all on function app.list_inventory_stock_with_reorder(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.list_inventory_stock_with_reorder(uuid,uuid,uuid) to hcs_hyperdrive;

create function app.load_reporting_with_inventory_policy(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_channel text default 'all'
) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
declare
  v_context jsonb;
  v_low_stock_count integer;
begin
  v_context := app.load_reporting(p_actor_user_id, p_tenant_id, p_from, p_to, p_location_id, p_channel);
  select count(*)::integer into v_low_stock_count
  from app.inventory_balances balance
  join app.inventory_reorder_policies policy
    on policy.tenant_id = balance.tenant_id and policy.location_id = balance.location_id
   and policy.variant_id = balance.variant_id and policy.is_active
  join app.product_variants variant on variant.tenant_id = balance.tenant_id and variant.id = balance.variant_id
  join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
  where balance.tenant_id = p_tenant_id and (p_location_id is null or balance.location_id = p_location_id)
    and variant.is_active and variant.track_inventory and product.status = 'active'
    and balance.on_hand - balance.reserved > 0
    and balance.on_hand - balance.reserved <= policy.reorder_level;

  v_context := pg_catalog.jsonb_set(v_context, '{inventory,lowStockCount}', pg_catalog.to_jsonb(v_low_stock_count), true);
  v_context := pg_catalog.jsonb_set(v_context, '{inventoryItems}', coalesce((
    select pg_catalog.jsonb_agg(item || pg_catalog.jsonb_build_object(
      'reorderLevelMilli', case when policy.id is null then null
        else pg_catalog.round(policy.reorder_level * 1000)::bigint end,
      'stockStatus', case
        when (item ->> 'availableMilli')::bigint <= 0 then 'out_of_stock'
        when policy.is_active and (item ->> 'availableMilli')::bigint <= pg_catalog.round(policy.reorder_level * 1000)::bigint then 'low_stock'
        else 'in_stock'
      end
    ) order by item ->> 'locationName', item ->> 'productName', item ->> 'variantName')
    from pg_catalog.jsonb_array_elements(v_context -> 'inventoryItems') item
    left join app.product_variants variant
      on variant.tenant_id = p_tenant_id and variant.sku::text = item ->> 'sku'
    left join app.inventory_reorder_policies policy
      on policy.tenant_id = p_tenant_id and policy.location_id = (item ->> 'locationId')::uuid
     and policy.variant_id = variant.id and policy.is_active
  ), '[]'::jsonb));
  return v_context;
end;
$$;
revoke all on function app.load_reporting_with_inventory_policy(uuid,uuid,date,date,uuid,text)
  from public, anon, authenticated;
grant execute on function app.load_reporting_with_inventory_policy(uuid,uuid,date,date,uuid,text)
  to hcs_hyperdrive;

commit;
