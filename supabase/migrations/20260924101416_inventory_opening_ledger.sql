begin;

insert into app.permissions (code, description) values
  ('inventory.read', 'View inventory balances and movement history'),
  ('inventory.manage', 'Record opening inventory and stock movements')
on conflict (code) do update set description = excluded.description;

create table app.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  location_id uuid not null,
  variant_id uuid not null,
  movement_type text not null check (movement_type in (
    'OPENING_BALANCE', 'SALE', 'REFUND', 'PURCHASE_RECEIPT', 'TRANSFER_OUT',
    'TRANSFER_IN', 'DAMAGE', 'ADJUSTMENT', 'RETURN_TO_SUPPLIER'
  )),
  quantity numeric(18, 3) not null,
  unit_cost numeric(18, 2),
  source_type text not null,
  source_reference text not null,
  actor_user_id uuid references auth.users (id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  constraint inventory_movements_quantity_nonzero check (quantity <> 0),
  constraint inventory_movements_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0),
  constraint inventory_movements_source_type_not_blank check (btrim(source_type) <> ''),
  constraint inventory_movements_source_reference_not_blank check (btrim(source_reference) <> ''),
  constraint inventory_movements_opening_positive check (movement_type <> 'OPENING_BALANCE' or quantity > 0)
);
create index inventory_movements_tenant_location_occurred_idx
  on app.inventory_movements (tenant_id, location_id, occurred_at desc, id);
create index inventory_movements_tenant_variant_occurred_idx
  on app.inventory_movements (tenant_id, variant_id, occurred_at desc, id);
create index inventory_movements_actor_idx
  on app.inventory_movements (actor_user_id) where actor_user_id is not null;
create unique index inventory_movements_one_opening_idx
  on app.inventory_movements (tenant_id, location_id, variant_id)
  where movement_type = 'OPENING_BALANCE';

create table app.inventory_balances (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  location_id uuid not null,
  variant_id uuid not null,
  on_hand numeric(18, 3) not null default 0,
  reserved numeric(18, 3) not null default 0,
  in_transit numeric(18, 3) not null default 0,
  damaged numeric(18, 3) not null default 0,
  average_unit_cost numeric(18, 2),
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, variant_id),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  constraint inventory_balances_reserved_nonnegative check (reserved >= 0),
  constraint inventory_balances_in_transit_nonnegative check (in_transit >= 0),
  constraint inventory_balances_damaged_nonnegative check (damaged >= 0),
  constraint inventory_balances_cost_nonnegative check (average_unit_cost is null or average_unit_cost >= 0)
);
create index inventory_balances_tenant_variant_idx
  on app.inventory_balances (tenant_id, variant_id, location_id);

alter table app.inventory_movements enable row level security;
alter table app.inventory_balances enable row level security;

create function app.reject_inventory_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'inventory movements are append-only';
end;
$$;
revoke all on function app.reject_inventory_movement_mutation() from public, anon, authenticated;
create trigger inventory_movements_reject_update_delete
before update or delete on app.inventory_movements
for each row execute function app.reject_inventory_movement_mutation();

create function app.initialize_owner_inventory_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.code::text) = 'owner' then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values
      (new.tenant_id, new.id, 'inventory.read'),
      (new.tenant_id, new.id, 'inventory.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_owner_inventory_permissions() from public, anon, authenticated;
create trigger roles_initialize_inventory_permissions
after insert on app.roles for each row execute function app.initialize_owner_inventory_permissions();

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, permission.code
from app.roles role
cross join app.permissions permission
where lower(role.code::text) = 'owner'
  and permission.code in ('inventory.read', 'inventory.manage')
on conflict do nothing;

create function app.list_opening_inventory(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean;
  v_employee_id uuid;
  v_selected_location_id uuid;
begin
  select membership.is_owner, employee.id
    into v_is_owner, v_employee_id
  from app.tenant_memberships membership
  left join app.employees employee
    on employee.tenant_id = membership.tenant_id
   and employee.user_id = membership.user_id
   and employee.status = 'active'
  where membership.tenant_id = p_tenant_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and (
      membership.is_owner
      or exists (
        select 1
        from app.membership_roles membership_role
        join app.role_permissions role_permission
          on role_permission.tenant_id = membership_role.tenant_id
         and role_permission.role_id = membership_role.role_id
        where membership_role.tenant_id = membership.tenant_id
          and membership_role.user_id = membership.user_id
          and role_permission.permission_code in ('inventory.read', 'inventory.manage')
      )
    );
  if not found then
    raise exception using errcode = 'HCS17', message = 'Inventory access is not allowed';
  end if;

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id
      and entitlement.feature_code = 'inventory'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable';
  end if;

  select location.id into v_selected_location_id
  from app.locations location
  where location.tenant_id = p_tenant_id
    and location.is_active
    and (v_is_owner or exists (
      select 1 from app.employee_locations employee_location
      where employee_location.tenant_id = p_tenant_id
        and employee_location.employee_id = v_employee_id
        and employee_location.location_id = location.id
    ))
    and (p_location_id is null or location.id = p_location_id)
  order by location.created_at, location.id
  limit 1;
  if v_selected_location_id is null then
    raise exception using errcode = 'HCS19', message = 'Inventory location was not found';
  end if;

  return pg_catalog.jsonb_build_object(
    'locations', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', location.id, 'code', location.code::text, 'name', location.name)
        order by location.created_at, location.id
      )
      from app.locations location
      where location.tenant_id = p_tenant_id and location.is_active
        and (v_is_owner or exists (
          select 1 from app.employee_locations employee_location
          where employee_location.tenant_id = p_tenant_id
            and employee_location.employee_id = v_employee_id
            and employee_location.location_id = location.id
        ))
    ), '[]'::jsonb),
    'selectedLocationId', v_selected_location_id,
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'productId', product.id,
          'productName', product.name,
          'variantId', variant.id,
          'variantName', variant.name,
          'sku', variant.sku::text,
          'defaultUnitCost', variant.unit_cost::text,
          'openingUnitCost', opening.unit_cost::text,
          'openingQuantity', coalesce(opening.quantity, 0)::text,
          'onHand', coalesce(balance.on_hand, 0)::text,
          'opened', opening.id is not null
        ) order by lower(product.name), lower(variant.name), variant.id
      )
      from app.product_variants variant
      join app.products product
        on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      left join app.inventory_balances balance
        on balance.tenant_id = variant.tenant_id
       and balance.location_id = v_selected_location_id
       and balance.variant_id = variant.id
      left join app.inventory_movements opening
        on opening.tenant_id = variant.tenant_id
       and opening.location_id = v_selected_location_id
       and opening.variant_id = variant.id
       and opening.movement_type = 'OPENING_BALANCE'
      where variant.tenant_id = p_tenant_id
        and variant.is_active and variant.track_inventory
        and product.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create function app.record_opening_inventory(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_entries jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_is_owner boolean;
  v_employee_id uuid;
  v_entry record;
  v_count integer := 0;
  v_response jsonb;
begin
  select membership.is_owner, employee.id
    into v_is_owner, v_employee_id
  from app.tenant_memberships membership
  left join app.employees employee
    on employee.tenant_id = membership.tenant_id
   and employee.user_id = membership.user_id
   and employee.status = 'active'
  where membership.tenant_id = p_tenant_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and (
      membership.is_owner
      or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions role_permission
          on role_permission.tenant_id = membership_role.tenant_id
         and role_permission.role_id = membership_role.role_id
        where membership_role.tenant_id = membership.tenant_id
          and membership_role.user_id = membership.user_id
          and role_permission.permission_code = 'inventory.manage'
      )
    );
  if not found then
    raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed';
  end if;

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id
      and entitlement.feature_code = 'inventory'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable';
  end if;

  if not exists (
    select 1 from app.locations location
    where location.tenant_id = p_tenant_id and location.id = p_location_id and location.is_active
      and (v_is_owner or exists (
        select 1 from app.employee_locations employee_location
        where employee_location.tenant_id = p_tenant_id
          and employee_location.employee_id = v_employee_id
          and employee_location.location_id = location.id
      ))
  ) then
    raise exception using errcode = 'HCS19', message = 'Inventory location was not found';
  end if;

  if p_entries is null or pg_catalog.jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = 'HCS20', message = 'Opening inventory entries are invalid';
  end if;
  if pg_catalog.jsonb_array_length(p_entries) = 0
     or pg_catalog.jsonb_array_length(p_entries) > 500
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_entries) entry
       group by entry->>'variantId' having count(*) > 1
     )
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_entries) entry
       where entry->>'variantId' is null
          or entry->>'quantity' is null
          or entry->>'unitCost' is null
          or entry->>'quantity' !~ '^\d+(?:\.\d{1,3})?$'
          or entry->>'unitCost' !~ '^\d+(?:\.\d{1,2})?$'
     ) then
    raise exception using errcode = 'HCS20', message = 'Opening inventory entries are invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.opening:' || p_location_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.opening.request:' || p_idempotency_key, 0)
  );

  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id
    and operation = 'inventory.opening.record'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key was reused with different opening inventory';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (
      tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at
    ) values (
      p_tenant_id, 'inventory.opening.record', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  for v_entry in
    select
      (entry->>'variantId')::uuid as variant_id,
      (entry->>'quantity')::numeric(18, 3) as quantity,
      (entry->>'unitCost')::numeric(18, 2) as unit_cost
    from pg_catalog.jsonb_array_elements(p_entries) entry
    order by entry->>'variantId'
  loop
    if v_entry.quantity <= 0 or v_entry.unit_cost < 0 then
      raise exception using errcode = 'HCS20', message = 'Opening inventory entries are invalid';
    end if;
    if not exists (
      select 1 from app.product_variants variant
      join app.products product
        on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where variant.tenant_id = p_tenant_id and variant.id = v_entry.variant_id
        and variant.is_active and variant.track_inventory and product.status = 'active'
    ) then
      raise exception using errcode = 'HCS21', message = 'Inventory variant was not found';
    end if;
    if exists (
      select 1 from app.inventory_movements movement
      where movement.tenant_id = p_tenant_id
        and movement.location_id = p_location_id
        and movement.variant_id = v_entry.variant_id
    ) then
      raise exception using errcode = 'HCS16', message = 'Opening inventory already exists or stock has moved';
    end if;

    insert into app.inventory_movements (
      tenant_id, location_id, variant_id, movement_type, quantity, unit_cost,
      source_type, source_reference, actor_user_id
    ) values (
      p_tenant_id, p_location_id, v_entry.variant_id, 'OPENING_BALANCE',
      v_entry.quantity, v_entry.unit_cost, 'onboarding_opening_inventory', p_idempotency_key, p_actor_user_id
    );

    insert into app.inventory_balances (
      tenant_id, location_id, variant_id, on_hand, average_unit_cost, version
    ) values (
      p_tenant_id, p_location_id, v_entry.variant_id, v_entry.quantity, v_entry.unit_cost, 1
    );
    v_count := v_count + 1;
  end loop;

  v_response := pg_catalog.jsonb_build_object(
    'locationId', p_location_id, 'movementCount', v_count, 'status', 'recorded'
  );

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'inventory.opening.recorded', 'location', p_location_id, p_location_id,
    pg_catalog.jsonb_build_object('movementCount', v_count)
  );

  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'inventory.opening.recorded', 'location', p_location_id, v_response);

  update app.idempotency_records
  set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id
    and operation = 'inventory.opening.record'
    and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

create function app.tenant_has_opening_inventory(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from app.inventory_movements movement
    where movement.tenant_id = p_tenant_id and movement.movement_type = 'OPENING_BALANCE'
  );
$$;

revoke all on function app.list_opening_inventory(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function app.list_opening_inventory(uuid,uuid,uuid) to hcs_hyperdrive;
revoke all on function app.record_opening_inventory(uuid,uuid,uuid,jsonb,text,text,text)
from public, anon, authenticated;
grant execute on function app.record_opening_inventory(uuid,uuid,uuid,jsonb,text,text,text)
to hcs_hyperdrive;
revoke all on function app.tenant_has_opening_inventory(uuid) from public, anon, authenticated;
grant execute on function app.tenant_has_opening_inventory(uuid) to hcs_hyperdrive;

commit;
