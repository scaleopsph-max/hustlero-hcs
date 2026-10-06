-- Advanced Wholesale AW1: sales orders and shared-inventory reservations.
begin;

update app.features
set platform_available = true, updated_at = now()
where code = 'advanced_wholesale';

insert into app.tenant_entitlements (tenant_id, feature_code, entitled, enabled)
select tenant.id, 'advanced_wholesale', false, false
from app.tenants tenant
on conflict (tenant_id, feature_code) do nothing;

insert into app.permissions (code, description) values
  ('wholesale_orders.read', 'View advanced wholesale sales orders'),
  ('wholesale_orders.manage', 'Create, confirm, and cancel advanced wholesale sales orders')
on conflict (code) do update set description = excluded.description;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, permission.code
from app.roles role
cross join app.permissions permission
where lower(role.code::text) = 'owner'
  and permission.code in ('wholesale_orders.read', 'wholesale_orders.manage')
on conflict do nothing;

create function app.initialize_owner_wholesale_order_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.code::text) = 'owner' then
    insert into app.role_permissions (tenant_id, role_id, permission_code) values
      (new.tenant_id, new.id, 'wholesale_orders.read'),
      (new.tenant_id, new.id, 'wholesale_orders.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app.initialize_owner_wholesale_order_permissions() from public, anon, authenticated;

create trigger roles_initialize_wholesale_order_permissions
after insert on app.roles
for each row execute function app.initialize_owner_wholesale_order_permissions();

create table app.sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  order_number extensions.citext not null,
  customer_id uuid not null,
  location_id uuid not null,
  price_list_id uuid not null,
  pricing_type text not null check (pricing_type in ('wholesale', 'dealer')),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  customer_number_snapshot text,
  customer_name_snapshot text,
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(18,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(18,2) not null default 0 check (tax_total >= 0),
  total numeric(18,2) not null default 0 check (total >= 0),
  notes text,
  created_by uuid not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_number),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, price_list_id) references app.price_lists (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint sales_orders_number_not_blank check (btrim(order_number::text) <> ''),
  constraint sales_orders_notes_length check (notes is null or length(notes) <= 1000),
  constraint sales_orders_confirmation_state check (
    (status = 'draft' and confirmed_at is null and cancelled_at is null)
    or (status in ('confirmed', 'partially_fulfilled', 'fulfilled') and confirmed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  ),
  constraint sales_orders_confirmed_snapshot check (
    status = 'draft' or (customer_number_snapshot is not null and customer_name_snapshot is not null)
  )
);

create table app.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sales_order_id uuid not null,
  variant_id uuid not null,
  pricing_group_id uuid not null,
  product_name_snapshot text not null,
  variant_name_snapshot text not null,
  sku_snapshot text not null,
  ordered_quantity numeric(18,3) not null check (ordered_quantity > 0),
  fulfilled_quantity numeric(18,3) not null default 0 check (fulfilled_quantity >= 0),
  cancelled_quantity numeric(18,3) not null default 0 check (cancelled_quantity >= 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sales_order_id, variant_id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  foreign key (tenant_id, pricing_group_id) references app.pricing_groups (tenant_id, id) on delete restrict,
  constraint sales_order_lines_quantity_bounds check (
    fulfilled_quantity + cancelled_quantity <= ordered_quantity
  )
);

create table app.sales_order_reservation_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sales_order_id uuid not null,
  sales_order_line_id uuid not null,
  location_id uuid not null,
  variant_id uuid not null,
  quantity_delta numeric(18,3) not null check (quantity_delta <> 0),
  reason text not null check (reason in ('order_confirmed', 'order_cancelled', 'order_fulfilled')),
  actor_user_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sales_order_line_id) references app.sales_order_lines (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);

create index sales_orders_status_idx on app.sales_orders (tenant_id, status, created_at desc);
create index sales_orders_customer_idx on app.sales_orders (tenant_id, customer_id, created_at desc);
create index sales_order_lines_order_idx on app.sales_order_lines (tenant_id, sales_order_id, id);
create index sales_order_reservation_order_idx
  on app.sales_order_reservation_ledger (tenant_id, sales_order_id, occurred_at, id);
create index sales_order_reservation_variant_idx
  on app.sales_order_reservation_ledger (tenant_id, location_id, variant_id, occurred_at desc);

alter table app.sales_orders enable row level security;
alter table app.sales_order_lines enable row level security;
alter table app.sales_order_reservation_ledger enable row level security;

revoke all on app.sales_orders, app.sales_order_lines, app.sales_order_reservation_ledger
  from public, anon, authenticated, hcs_hyperdrive;

create trigger sales_orders_set_updated_at
before update on app.sales_orders
for each row execute function app.set_updated_at();

create trigger sales_order_lines_set_updated_at
before update on app.sales_order_lines
for each row execute function app.set_updated_at();

create function app.reject_sales_order_reservation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sales order reservations are append-only';
end;
$$;

revoke all on function app.reject_sales_order_reservation_mutation() from public, anon, authenticated;

create trigger sales_order_reservations_no_update
before update or delete on app.sales_order_reservation_ledger
for each row execute function app.reject_sales_order_reservation_mutation();

create function app.load_wholesale_order_context(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_can_read boolean;
  v_can_manage boolean;
begin
  if not exists (
    select 1
    from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id
      and entitlement.feature_code = 'advanced_wholesale'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCSQ0', message = 'Advanced wholesale is not enabled';
  end if;

  select membership.is_owner or exists (
    select 1 from app.membership_roles membership_role
    join app.role_permissions permission
      on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
    where membership_role.tenant_id = membership.tenant_id
      and membership_role.user_id = membership.user_id
      and permission.permission_code in ('wholesale_orders.read', 'wholesale_orders.manage')
  ), membership.is_owner or exists (
    select 1 from app.membership_roles membership_role
    join app.role_permissions permission
      on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
    where membership_role.tenant_id = membership.tenant_id
      and membership_role.user_id = membership.user_id
      and permission.permission_code = 'wholesale_orders.manage'
  )
  into v_can_read, v_can_manage
  from app.tenant_memberships membership
  where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active';

  if not found or not coalesce(v_can_read, false) then
    raise exception using errcode = 'HCSQ1', message = 'Wholesale order access is not allowed';
  end if;

  return jsonb_build_object(
    'canManage', coalesce(v_can_manage, false),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', customer.id, 'customerNumber', customer.customer_number::text, 'fullName', customer.full_name
      ) order by customer.full_name, customer.id)
      from app.customers customer
      where customer.tenant_id = p_tenant_id and customer.status = 'active' and customer.customer_type = 'reseller'
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('id', location.id, 'code', location.code, 'name', location.name)
        order by location.name, location.id)
      from app.locations location where location.tenant_id = p_tenant_id and location.is_active
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', variant.id, 'productName', product.name, 'variantName', variant.name, 'sku', variant.sku::text
      ) order by product.name, variant.name, variant.id)
      from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where variant.tenant_id = p_tenant_id and variant.is_active and product.status = 'active'
    ), '[]'::jsonb),
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'locationId', balance.location_id, 'variantId', balance.variant_id,
        'onHandMilli', round(balance.on_hand * 1000)::bigint,
        'reservedMilli', round(balance.reserved * 1000)::bigint,
        'availableMilli', greatest(round((balance.on_hand - balance.reserved - balance.damaged) * 1000)::bigint, 0)
      ) order by balance.location_id, balance.variant_id)
      from app.inventory_balances balance where balance.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'priceLists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', price_list.id, 'code', price_list.code::text, 'name', price_list.name,
        'pricingType', price_list.pricing_type, 'isDefault', price_list.is_default,
        'customerIds', coalesce((select jsonb_agg(assignment.customer_id order by assignment.customer_id)
          from app.customer_price_list_assignments assignment
          where assignment.tenant_id = price_list.tenant_id and assignment.price_list_id = price_list.id), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'variantId', entry.variant_id, 'unitPriceMinor', round(entry.unit_price * 100)::bigint,
          'pricingGroupId', entry.pricing_group_id, 'thresholdMilli', round(pricing_group.threshold_quantity * 1000)::bigint,
          'pricingGroupName', pricing_group.name
        ) order by entry.variant_id)
        from app.price_list_entries entry
        join app.pricing_groups pricing_group
          on pricing_group.tenant_id = entry.tenant_id and pricing_group.id = entry.pricing_group_id
        where entry.tenant_id = price_list.tenant_id and entry.price_list_id = price_list.id), '[]'::jsonb)
      ) order by price_list.name, price_list.id)
      from app.price_lists price_list
      where price_list.tenant_id = p_tenant_id and price_list.is_active
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sales_order.id, 'orderNumber', sales_order.order_number::text,
        'customerId', sales_order.customer_id, 'customerName', coalesce(sales_order.customer_name_snapshot, customer.full_name),
        'locationId', sales_order.location_id, 'locationName', location.name,
        'priceListId', sales_order.price_list_id, 'pricingType', sales_order.pricing_type,
        'status', sales_order.status, 'notes', sales_order.notes,
        'subtotalMinor', round(sales_order.subtotal * 100)::bigint,
        'totalMinor', round(sales_order.total * 100)::bigint,
        'confirmedAt', sales_order.confirmed_at, 'createdAt', sales_order.created_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'id', line.id, 'variantId', line.variant_id,
          'productName', line.product_name_snapshot, 'variantName', line.variant_name_snapshot,
          'sku', line.sku_snapshot, 'orderedQuantityMilli', round(line.ordered_quantity * 1000)::bigint,
          'fulfilledQuantityMilli', round(line.fulfilled_quantity * 1000)::bigint,
          'cancelledQuantityMilli', round(line.cancelled_quantity * 1000)::bigint,
          'unitPriceMinor', round(line.unit_price * 100)::bigint,
          'lineTotalMinor', round(line.line_total * 100)::bigint
        ) order by line.created_at, line.id)
        from app.sales_order_lines line
        where line.tenant_id = sales_order.tenant_id and line.sales_order_id = sales_order.id), '[]'::jsonb)
      ) order by sales_order.created_at desc, sales_order.id desc)
      from app.sales_orders sales_order
      join app.customers customer on customer.tenant_id = sales_order.tenant_id and customer.id = sales_order.customer_id
      join app.locations location on location.tenant_id = sales_order.tenant_id and location.id = sales_order.location_id
      where sales_order.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

create function app.save_wholesale_order_draft(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_payload jsonb,
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
  v_order app.sales_orders%rowtype;
  v_price_list app.price_lists%rowtype;
  v_entry record;
  v_line jsonb;
  v_line_count integer := 0;
  v_total numeric(18,2) := 0;
  v_result text := 'created';
  v_response jsonb;
begin
  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'advanced_wholesale'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then raise exception using errcode = 'HCSQ0', message = 'Advanced wholesale is not enabled'; end if;
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role join app.role_permissions permission
          on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = membership.tenant_id and membership_role.user_id = membership.user_id
          and permission.permission_code = 'wholesale_orders.manage'
      ))
  ) then raise exception using errcode = 'HCSQ1', message = 'Wholesale order management is not allowed'; end if;
  if p_payload is null
    or jsonb_typeof(p_payload->'lines') is distinct from 'array'
    or nullif(btrim(p_payload->>'orderNumber'), '') is null then
    raise exception using errcode = 'HCSQ2', message = 'Wholesale order details are invalid';
  end if;
  if jsonb_array_length(p_payload->'lines') < 1 then
    raise exception using errcode = 'HCSQ2', message = 'At least one wholesale order line is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':wholesale-order:save:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'wholesale_order.save' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'wholesale_order.save', p_idempotency_key, p_request_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;

  if not exists (select 1 from app.customers customer where customer.tenant_id = p_tenant_id
    and customer.id = (p_payload->>'customerId')::uuid and customer.status = 'active' and customer.customer_type = 'reseller') then
    raise exception using errcode = 'HCSQ3', message = 'An active reseller customer is required';
  end if;
  if not exists (select 1 from app.locations location where location.tenant_id = p_tenant_id
    and location.id = (p_payload->>'locationId')::uuid and location.is_active) then
    raise exception using errcode = 'HCSQ4', message = 'The order location is unavailable';
  end if;
  select * into v_price_list from app.price_lists price_list
  where price_list.tenant_id = p_tenant_id and price_list.id = (p_payload->>'priceListId')::uuid
    and price_list.pricing_type = p_payload->>'pricingType' and price_list.is_active;
  if not found then raise exception using errcode = 'HCSQ5', message = 'The price list is unavailable'; end if;
  if not (v_price_list.is_default or exists (
    select 1 from app.customer_price_list_assignments assignment
    where assignment.tenant_id = p_tenant_id and assignment.customer_id = (p_payload->>'customerId')::uuid
      and assignment.price_list_id = v_price_list.id
  )) then raise exception using errcode = 'HCSQ5', message = 'The price list is not assigned to this reseller'; end if;

  if nullif(p_payload->>'id', '') is null then
    insert into app.sales_orders (
      tenant_id, order_number, customer_id, location_id, price_list_id, pricing_type, notes, created_by
    ) values (
      p_tenant_id, btrim(p_payload->>'orderNumber'), (p_payload->>'customerId')::uuid,
      (p_payload->>'locationId')::uuid, v_price_list.id, v_price_list.pricing_type,
      nullif(btrim(p_payload->>'notes'), ''), p_actor_user_id
    ) returning * into v_order;
  else
    select * into v_order from app.sales_orders
    where tenant_id = p_tenant_id and id = (p_payload->>'id')::uuid for update;
    if not found then raise exception using errcode = 'HCSQ7', message = 'The wholesale order was not found'; end if;
    if v_order.status <> 'draft' then raise exception using errcode = 'HCSQ6', message = 'Only draft orders can be edited'; end if;
    update app.sales_orders set
      order_number = btrim(p_payload->>'orderNumber'), customer_id = (p_payload->>'customerId')::uuid,
      location_id = (p_payload->>'locationId')::uuid, price_list_id = v_price_list.id,
      pricing_type = v_price_list.pricing_type, notes = nullif(btrim(p_payload->>'notes'), ''), updated_at = now()
    where tenant_id = p_tenant_id and id = v_order.id returning * into v_order;
    delete from app.sales_order_lines where tenant_id = p_tenant_id and sales_order_id = v_order.id;
    v_result := 'updated';
  end if;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    if (v_line->>'quantityMilli')::bigint <= 0 then raise exception using errcode = 'HCSQ2', message = 'Order quantity must be positive'; end if;
    select variant.id variant_id, product.name product_name, variant.name variant_name, variant.sku::text sku,
      entry.pricing_group_id, entry.unit_price
    into v_entry
    from app.product_variants variant
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    join app.price_list_entries entry on entry.tenant_id = variant.tenant_id and entry.variant_id = variant.id
      and entry.price_list_id = v_price_list.id
    where variant.tenant_id = p_tenant_id and variant.id = (v_line->>'variantId')::uuid
      and variant.is_active and product.status = 'active';
    if not found then raise exception using errcode = 'HCSQ5', message = 'An order item is unavailable in the price list'; end if;
    insert into app.sales_order_lines (
      tenant_id, sales_order_id, variant_id, pricing_group_id, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, ordered_quantity, unit_price, line_total
    ) values (
      p_tenant_id, v_order.id, v_entry.variant_id, v_entry.pricing_group_id, v_entry.product_name,
      v_entry.variant_name, v_entry.sku, (v_line->>'quantityMilli')::numeric / 1000, v_entry.unit_price,
      round(((v_line->>'quantityMilli')::numeric / 1000) * v_entry.unit_price, 2)
    );
    v_total := v_total + round(((v_line->>'quantityMilli')::numeric / 1000) * v_entry.unit_price, 2);
    v_line_count := v_line_count + 1;
  end loop;
  update app.sales_orders set subtotal = v_total, total = v_total where tenant_id = p_tenant_id and id = v_order.id;

  v_response := jsonb_build_object(
    'salesOrderId', v_order.id, 'status', 'draft', 'result', v_result,
    'lineCount', v_line_count, 'totalMinor', round(v_total * 100)::bigint
  );
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    case when v_result = 'created' then 'sales_order.created' else 'sales_order.updated' end,
    'sales_order', v_order.id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, case when v_result = 'created' then 'sales_order.created' else 'sales_order.updated' end,
    'sales_order', v_order.id, v_response);
  update app.idempotency_records set response_status = case when v_result = 'created' then 201 else 200 end,
    response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'wholesale_order.save' and idempotency_key = p_idempotency_key;
  return v_response;
exception
  when unique_violation then raise exception using errcode = 'HCSQ8', message = 'Order number or variant is already in use';
end;
$$;

create function app.confirm_wholesale_order(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_sales_order_id uuid,
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
  v_order app.sales_orders%rowtype;
  v_customer app.customers%rowtype;
  v_line app.sales_order_lines%rowtype;
  v_balance app.inventory_balances%rowtype;
  v_entry record;
  v_total numeric(18,2) := 0;
  v_response jsonb;
begin
  if not exists (select 1 from app.tenant_entitlements entitlement join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'advanced_wholesale'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())) then
    raise exception using errcode = 'HCSQ0', message = 'Advanced wholesale is not enabled';
  end if;
  if not exists (select 1 from app.tenant_memberships membership where membership.tenant_id = p_tenant_id
    and membership.user_id = p_actor_user_id and membership.status = 'active' and (membership.is_owner or exists (
      select 1 from app.membership_roles membership_role join app.role_permissions permission
        on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
      where membership_role.tenant_id = membership.tenant_id and membership_role.user_id = membership.user_id
        and permission.permission_code = 'wholesale_orders.manage'))) then
    raise exception using errcode = 'HCSQ1', message = 'Wholesale order management is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':wholesale-order:confirm:' || p_sales_order_id::text, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id
    and operation = 'wholesale_order.confirm' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'wholesale_order.confirm', p_idempotency_key, p_request_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;

  select * into v_order from app.sales_orders where tenant_id = p_tenant_id and id = p_sales_order_id for update;
  if not found then raise exception using errcode = 'HCSQ7', message = 'The wholesale order was not found'; end if;
  if v_order.status <> 'draft' then raise exception using errcode = 'HCSQ6', message = 'Only draft orders can be confirmed'; end if;
  select * into v_customer from app.customers where tenant_id = p_tenant_id and id = v_order.customer_id
    and status = 'active' and customer_type = 'reseller';
  if not found then raise exception using errcode = 'HCSQ3', message = 'An active reseller customer is required'; end if;
  if not exists (select 1 from app.price_lists price_list where price_list.tenant_id = p_tenant_id
    and price_list.id = v_order.price_list_id and price_list.pricing_type = v_order.pricing_type and price_list.is_active
    and (price_list.is_default or exists (select 1 from app.customer_price_list_assignments assignment
      where assignment.tenant_id = p_tenant_id and assignment.customer_id = v_order.customer_id
        and assignment.price_list_id = price_list.id))) then
    raise exception using errcode = 'HCSQ5', message = 'The price list is unavailable for this reseller';
  end if;
  -- Refresh the draft's mutable catalog snapshots before validating current thresholds.
  for v_line in select * from app.sales_order_lines where tenant_id = p_tenant_id and sales_order_id = p_sales_order_id
    order by id for update loop
    select variant.id variant_id, product.name product_name, variant.name variant_name, variant.sku::text sku,
      entry.pricing_group_id, entry.unit_price
    into v_entry from app.product_variants variant
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    join app.price_list_entries entry on entry.tenant_id = variant.tenant_id and entry.variant_id = variant.id
      and entry.price_list_id = v_order.price_list_id
    where variant.tenant_id = p_tenant_id and variant.id = v_line.variant_id
      and variant.is_active and product.status = 'active';
    if not found then raise exception using errcode = 'HCSQ5', message = 'An order item is unavailable in the price list'; end if;
    update app.sales_order_lines set pricing_group_id = v_entry.pricing_group_id,
      product_name_snapshot = v_entry.product_name, variant_name_snapshot = v_entry.variant_name,
      sku_snapshot = v_entry.sku, unit_price = v_entry.unit_price,
      line_total = round(v_line.ordered_quantity * v_entry.unit_price, 2)
    where tenant_id = p_tenant_id and id = v_line.id;
  end loop;

  if exists (
    select 1
    from app.sales_order_lines line
    join app.pricing_groups pricing_group on pricing_group.tenant_id = line.tenant_id and pricing_group.id = line.pricing_group_id
    where line.tenant_id = p_tenant_id and line.sales_order_id = p_sales_order_id
    group by pricing_group.id, pricing_group.threshold_quantity
    having sum(line.ordered_quantity) < pricing_group.threshold_quantity
  ) then raise exception using errcode = 'HCSQ9', message = 'A pricing-group quantity threshold has not been met'; end if;

  -- Lock shared inventory rows in stable order, then reserve atomically.
  for v_line in select * from app.sales_order_lines where tenant_id = p_tenant_id and sales_order_id = p_sales_order_id
    order by variant_id for update loop
    select * into v_balance from app.inventory_balances where tenant_id = p_tenant_id
      and location_id = v_order.location_id and variant_id = v_line.variant_id for update;
    if not found or v_balance.on_hand - v_balance.reserved - v_balance.damaged < v_line.ordered_quantity then
      raise exception using errcode = 'HCQ10', message = 'Available stock is insufficient for this order';
    end if;
    update app.inventory_balances set reserved = reserved + v_line.ordered_quantity,
      version = version + 1, updated_at = now()
    where tenant_id = p_tenant_id and location_id = v_order.location_id and variant_id = v_line.variant_id;
    insert into app.sales_order_reservation_ledger (
      tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason, actor_user_id
    ) values (
      p_tenant_id, p_sales_order_id, v_line.id, v_order.location_id, v_line.variant_id,
      v_line.ordered_quantity, 'order_confirmed', p_actor_user_id
    );
    v_total := v_total + v_line.line_total;
  end loop;

  update app.sales_orders set status = 'confirmed', customer_number_snapshot = v_customer.customer_number::text,
    customer_name_snapshot = v_customer.full_name, subtotal = v_total, total = v_total, confirmed_at = now()
  where tenant_id = p_tenant_id and id = p_sales_order_id;
  v_response := jsonb_build_object('salesOrderId', p_sales_order_id, 'status', 'confirmed',
    'reservedLineCount', (select count(*)::integer from app.sales_order_lines line
      where line.tenant_id = p_tenant_id and line.sales_order_id = p_sales_order_id),
    'totalMinor', round(v_total * 100)::bigint);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'sales_order.confirmed', 'sales_order', p_sales_order_id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'sales_order.confirmed', 'sales_order', p_sales_order_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'wholesale_order.confirm' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.cancel_wholesale_order_remaining(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_sales_order_id uuid,
  p_reason text,
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
  v_order app.sales_orders%rowtype;
  v_line app.sales_order_lines%rowtype;
  v_remaining numeric(18,3);
  v_released numeric(18,3) := 0;
  v_response jsonb;
begin
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = 'HCSQ2', message = 'A cancellation reason is required'; end if;
  if not exists (select 1 from app.tenant_entitlements entitlement join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'advanced_wholesale'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())) then
    raise exception using errcode = 'HCSQ0', message = 'Advanced wholesale is not enabled';
  end if;
  if not exists (select 1 from app.tenant_memberships membership where membership.tenant_id = p_tenant_id
    and membership.user_id = p_actor_user_id and membership.status = 'active' and (membership.is_owner or exists (
      select 1 from app.membership_roles membership_role join app.role_permissions permission
        on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
      where membership_role.tenant_id = membership.tenant_id and membership_role.user_id = membership.user_id
        and permission.permission_code = 'wholesale_orders.manage'))) then
    raise exception using errcode = 'HCSQ1', message = 'Wholesale order management is not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':wholesale-order:cancel:' || p_sales_order_id::text, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id
    and operation = 'wholesale_order.cancel' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'wholesale_order.cancel', p_idempotency_key, p_request_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;
  select * into v_order from app.sales_orders where tenant_id = p_tenant_id and id = p_sales_order_id for update;
  if not found then raise exception using errcode = 'HCSQ7', message = 'The wholesale order was not found'; end if;
  if v_order.status not in ('confirmed', 'partially_fulfilled') then
    raise exception using errcode = 'HCSQ6', message = 'Only confirmed orders with remaining quantity can be cancelled';
  end if;
  for v_line in select * from app.sales_order_lines where tenant_id = p_tenant_id and sales_order_id = p_sales_order_id
    order by id for update loop
    v_remaining := v_line.ordered_quantity - v_line.fulfilled_quantity - v_line.cancelled_quantity;
    if v_remaining > 0 then
      update app.inventory_balances set reserved = reserved - v_remaining, version = version + 1, updated_at = now()
      where tenant_id = p_tenant_id and location_id = v_order.location_id and variant_id = v_line.variant_id
        and reserved >= v_remaining;
      if not found then raise exception using errcode = 'HCQ11', message = 'The reservation balance is inconsistent'; end if;
      update app.sales_order_lines set cancelled_quantity = cancelled_quantity + v_remaining
      where tenant_id = p_tenant_id and id = v_line.id;
      insert into app.sales_order_reservation_ledger (
        tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason, actor_user_id
      ) values (
        p_tenant_id, p_sales_order_id, v_line.id, v_order.location_id, v_line.variant_id,
        -v_remaining, 'order_cancelled', p_actor_user_id
      );
      v_released := v_released + v_remaining;
    end if;
  end loop;
  if v_released <= 0 then raise exception using errcode = 'HCSQ6', message = 'The order has no remaining quantity to cancel'; end if;
  update app.sales_orders set status = 'cancelled', cancelled_at = now()
  where tenant_id = p_tenant_id and id = p_sales_order_id;
  v_response := jsonb_build_object('salesOrderId', p_sales_order_id, 'status', 'cancelled',
    'releasedQuantityMilli', round(v_released * 1000)::bigint);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'sales_order.cancelled',
    'sales_order', p_sales_order_id, btrim(p_reason), v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'sales_order.cancelled', 'sales_order', p_sales_order_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'wholesale_order.cancel' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function app.load_wholesale_order_context(uuid, uuid) from public, anon, authenticated;
revoke all on function app.save_wholesale_order_draft(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.confirm_wholesale_order(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function app.cancel_wholesale_order_remaining(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function app.load_wholesale_order_context(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.save_wholesale_order_draft(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.confirm_wholesale_order(uuid, uuid, uuid, text, text, text) to hcs_hyperdrive;
grant execute on function app.cancel_wholesale_order_remaining(uuid, uuid, uuid, text, text, text, text) to hcs_hyperdrive;

commit;
