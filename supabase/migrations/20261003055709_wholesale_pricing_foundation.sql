-- Basic wholesale/dealer pricing. Inventory remains shared with retail by variant and location.
begin;

create table app.pricing_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  threshold_quantity numeric(18,3) not null check (threshold_quantity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  constraint pricing_groups_name_not_blank check (btrim(name) <> '')
);

create table app.price_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  pricing_type text not null check (pricing_type in ('wholesale','dealer')),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, created_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint price_lists_name_not_blank check (btrim(name) <> '')
);
create unique index price_lists_one_default_type_idx
  on app.price_lists (tenant_id, pricing_type) where is_default and is_active;

create table app.price_list_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  price_list_id uuid not null,
  pricing_group_id uuid not null,
  variant_id uuid not null,
  unit_price numeric(18,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, price_list_id, variant_id),
  foreign key (tenant_id, price_list_id) references app.price_lists (tenant_id, id) on delete restrict,
  foreign key (tenant_id, pricing_group_id) references app.pricing_groups (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict
);
create index price_list_entries_group_idx on app.price_list_entries (tenant_id, price_list_id, pricing_group_id);
create index price_list_entries_variant_idx on app.price_list_entries (tenant_id, variant_id);

create table app.customer_price_list_assignments (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  customer_id uuid not null,
  price_list_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, customer_id, price_list_id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, price_list_id) references app.price_lists (tenant_id, id) on delete restrict
);
create index customer_price_list_assignments_list_idx on app.customer_price_list_assignments (tenant_id, price_list_id);

alter table app.sales add column pricing_type text not null default 'retail'
  check (pricing_type in ('retail','wholesale','dealer'));
alter table app.sales add column price_list_id uuid;
alter table app.sales add constraint sales_price_list_fkey foreign key (tenant_id, price_list_id)
  references app.price_lists (tenant_id, id) on delete restrict;
create index sales_pricing_type_idx on app.sales (tenant_id, pricing_type, completed_at desc);

create trigger pricing_groups_set_updated_at before update on app.pricing_groups
  for each row execute function app.set_updated_at();
create trigger price_lists_set_updated_at before update on app.price_lists
  for each row execute function app.set_updated_at();
create trigger price_list_entries_set_updated_at before update on app.price_list_entries
  for each row execute function app.set_updated_at();

alter table app.pricing_groups enable row level security;
alter table app.price_lists enable row level security;
alter table app.price_list_entries enable row level security;
alter table app.customer_price_list_assignments enable row level security;

revoke all on app.pricing_groups, app.price_lists, app.price_list_entries, app.customer_price_list_assignments
  from public, anon, authenticated, hcs_hyperdrive;

create function app.load_pricing_context(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_can_manage boolean;
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = p_tenant_id and membership_role.user_id = p_actor_user_id
          and permission.permission_code in ('catalog.read','catalog.manage')
      ))
  ) then raise exception using errcode = 'HCS09', message = 'Catalog access is not allowed'; end if;

  select membership.is_owner or exists (
    select 1 from app.membership_roles membership_role
    join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
    where membership_role.tenant_id = p_tenant_id and membership_role.user_id = p_actor_user_id
      and permission.permission_code = 'catalog.manage'
  ) into v_can_manage
  from app.tenant_memberships membership
  where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active';

  return jsonb_build_object(
    'canManage', coalesce(v_can_manage, false),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', variant.id, 'productName', product.name, 'variantName', variant.name,
        'sku', variant.sku::text, 'retailPriceMinor', round(variant.retail_price * 100)::bigint
      ) order by product.name, variant.name, variant.id)
      from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where variant.tenant_id = p_tenant_id and variant.is_active and product.status = 'active'
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', customer.id, 'customerNumber', customer.customer_number::text,
        'fullName', customer.full_name, 'customerType', 'reseller'
      ) order by customer.full_name, customer.id)
      from app.customers customer
      where customer.tenant_id = p_tenant_id and customer.status = 'active' and customer.customer_type = 'reseller'
    ), '[]'::jsonb),
    'priceLists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', price_list.id, 'code', price_list.code::text, 'name', price_list.name,
        'pricingType', price_list.pricing_type, 'isDefault', price_list.is_default, 'isActive', price_list.is_active,
        'pricingGroup', jsonb_build_object(
          'id', pricing_group.id, 'code', pricing_group.code::text, 'name', pricing_group.name,
          'thresholdMilli', round(pricing_group.threshold_quantity * 1000)::bigint
        ),
        'customerIds', coalesce((select jsonb_agg(assignment.customer_id order by assignment.customer_id)
          from app.customer_price_list_assignments assignment
          where assignment.tenant_id = price_list.tenant_id and assignment.price_list_id = price_list.id), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'variantId', entry.variant_id, 'unitPriceMinor', round(entry.unit_price * 100)::bigint
        ) order by entry.variant_id) from app.price_list_entries entry
          where entry.tenant_id = price_list.tenant_id and entry.price_list_id = price_list.id), '[]'::jsonb)
      ) order by price_list.pricing_type, price_list.name, price_list.id)
      from app.price_lists price_list
      join lateral (
        select distinct pricing_group.* from app.price_list_entries entry
        join app.pricing_groups pricing_group on pricing_group.tenant_id = entry.tenant_id and pricing_group.id = entry.pricing_group_id
        where entry.tenant_id = price_list.tenant_id and entry.price_list_id = price_list.id
        order by pricing_group.id limit 1
      ) pricing_group on true
      where price_list.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

create function app.upsert_price_list(
  p_actor_user_id uuid, p_tenant_id uuid, p_payload jsonb,
  p_idempotency_key text, p_request_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_price_list_id uuid := nullif(p_payload->>'id','')::uuid;
  v_group_id uuid;
  v_created boolean := false;
  v_entry jsonb;
  v_customer jsonb;
  v_pricing_type text := p_payload->>'pricingType';
  v_response jsonb;
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = p_tenant_id and membership_role.user_id = p_actor_user_id
          and permission.permission_code = 'catalog.manage'
      ))
  ) then raise exception using errcode = 'HCS09', message = 'Catalog management is not allowed'; end if;
  if v_pricing_type not in ('wholesale','dealer') or jsonb_typeof(p_payload->'entries') <> 'array'
    or jsonb_array_length(p_payload->'entries') = 0 then
    raise exception using errcode = 'HCSP1', message = 'Price list details are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':price-list.upsert:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'price-list.upsert' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at)
    values (p_tenant_id, 'price-list.upsert', p_idempotency_key, p_request_hash, now() + interval '24 hours');
  end if;

  insert into app.pricing_groups (tenant_id, code, name, threshold_quantity)
  values (p_tenant_id, upper(p_payload->'pricingGroup'->>'code'), p_payload->'pricingGroup'->>'name',
    (p_payload->'pricingGroup'->>'thresholdMilli')::bigint::numeric / 1000)
  on conflict (tenant_id, code) do update set
    name = excluded.name, threshold_quantity = excluded.threshold_quantity, is_active = true
  returning id into v_group_id;

  if coalesce((p_payload->>'isDefault')::boolean, false) then
    update app.price_lists set is_default = false
    where tenant_id = p_tenant_id and pricing_type = v_pricing_type
      and (v_price_list_id is null or id <> v_price_list_id) and is_default;
  end if;

  if v_price_list_id is null then
    v_price_list_id := gen_random_uuid();
    v_created := true;
    insert into app.price_lists (id, tenant_id, code, name, pricing_type, is_default, is_active, created_by)
    values (v_price_list_id, p_tenant_id, upper(p_payload->>'code'), p_payload->>'name', v_pricing_type,
      coalesce((p_payload->>'isDefault')::boolean, false), coalesce((p_payload->>'isActive')::boolean, true), p_actor_user_id);
  else
    if not exists (select 1 from app.price_lists where tenant_id = p_tenant_id and id = v_price_list_id) then
      raise exception using errcode = 'HCSP2', message = 'Price list was not found';
    end if;
    update app.price_lists set code = upper(p_payload->>'code'), name = p_payload->>'name', pricing_type = v_pricing_type,
      is_default = coalesce((p_payload->>'isDefault')::boolean, false),
      is_active = coalesce((p_payload->>'isActive')::boolean, true)
    where tenant_id = p_tenant_id and id = v_price_list_id;
  end if;

  delete from app.price_list_entries where tenant_id = p_tenant_id and price_list_id = v_price_list_id;
  for v_entry in select value from jsonb_array_elements(p_payload->'entries') loop
    if not exists (select 1 from app.product_variants where tenant_id = p_tenant_id and id = (v_entry->>'variantId')::uuid) then
      raise exception using errcode = 'HCSP3', message = 'A price list variant is unavailable';
    end if;
    insert into app.price_list_entries (tenant_id, price_list_id, pricing_group_id, variant_id, unit_price)
    values (p_tenant_id, v_price_list_id, v_group_id, (v_entry->>'variantId')::uuid,
      (v_entry->>'unitPriceMinor')::bigint::numeric / 100);
  end loop;

  delete from app.customer_price_list_assignments where tenant_id = p_tenant_id and price_list_id = v_price_list_id;
  for v_customer in select value from jsonb_array_elements(coalesce(p_payload->'customerIds','[]'::jsonb)) loop
    if not exists (select 1 from app.customers where tenant_id = p_tenant_id and id = (v_customer#>>'{}')::uuid
      and status = 'active' and customer_type = 'reseller') then
      raise exception using errcode = 'HCSP4', message = 'Only active reseller customers can receive wholesale pricing';
    end if;
    delete from app.customer_price_list_assignments assignment using app.price_lists assigned_list
    where assignment.tenant_id = p_tenant_id and assignment.customer_id = (v_customer#>>'{}')::uuid
      and assigned_list.tenant_id = assignment.tenant_id and assigned_list.id = assignment.price_list_id
      and assigned_list.pricing_type = v_pricing_type and assignment.price_list_id <> v_price_list_id;
    insert into app.customer_price_list_assignments (tenant_id, customer_id, price_list_id)
    values (p_tenant_id, (v_customer#>>'{}')::uuid, v_price_list_id);
  end loop;

  v_response := jsonb_build_object('priceListId', v_price_list_id, 'pricingGroupId', v_group_id,
    'status', case when v_created then 'created' else 'updated' end);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    case when v_created then 'price_list.created' else 'price_list.updated' end, 'price_list', v_price_list_id, p_payload);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, case when v_created then 'price_list.created' else 'price_list.updated' end,
    'price_list', v_price_list_id, v_response);
  update app.idempotency_records set response_status = case when v_created then 201 else 200 end,
    response_body = v_response, completed_at = now()
  where tenant_id = p_tenant_id and operation = 'price-list.upsert' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.load_pos_pricing_options(p_session_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant_id uuid;
begin
  select session.tenant_id into v_tenant_id from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id = session.tenant_id and device.id = session.device_id and device.status = 'active'
  where session.token_hash = p_session_token_hash and session.revoked_at is null and session.expires_at > now();
  if v_tenant_id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'variantId', entry.variant_id, 'priceListId', price_list.id, 'priceListName', price_list.name,
    'pricingType', price_list.pricing_type, 'pricingGroupId', pricing_group.id,
    'pricingGroupName', pricing_group.name, 'thresholdMilli', round(pricing_group.threshold_quantity * 1000)::bigint,
    'unitPriceCentavos', round(entry.unit_price * 100)::bigint, 'isDefault', price_list.is_default,
    'customerIds', coalesce((select jsonb_agg(assignment.customer_id) from app.customer_price_list_assignments assignment
      where assignment.tenant_id = price_list.tenant_id and assignment.price_list_id = price_list.id), '[]'::jsonb)
  ) order by entry.variant_id, price_list.pricing_type, price_list.name)
  from app.price_list_entries entry
  join app.price_lists price_list on price_list.tenant_id = entry.tenant_id and price_list.id = entry.price_list_id
  join app.pricing_groups pricing_group on pricing_group.tenant_id = entry.tenant_id and pricing_group.id = entry.pricing_group_id
  where entry.tenant_id = v_tenant_id and price_list.is_active and pricing_group.is_active), '[]'::jsonb);
end;
$$;

create function app.complete_pos_priced_sale(
  p_session_token_hash text,
  p_lines jsonb,
  p_payments jsonb,
  p_customer_id uuid,
  p_pricing_type text,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_register_session app.register_sessions%rowtype;
  v_existing app.idempotency_records%rowtype;
  v_customer app.customers%rowtype;
  v_price_list app.price_lists%rowtype;
  v_line jsonb;
  v_payment jsonb;
  v_variant record;
  v_balance app.inventory_balances%rowtype;
  v_method app.payment_methods%rowtype;
  v_entry record;
  v_sale_id uuid := gen_random_uuid();
  v_business_date date;
  v_receipt_seq bigint;
  v_receipt text;
  v_subtotal numeric(18,2) := 0;
  v_quantity numeric(18,3);
  v_group_quantity numeric(18,3);
  v_unit_price numeric(18,2);
  v_line_total numeric(18,2);
  v_payment_total numeric(18,2);
  v_amount numeric(18,2);
  v_tendered numeric(18,2);
  v_change numeric(18,2);
  v_cash_received_centavos bigint := 0;
  v_change_centavos bigint := 0;
  v_payment_response jsonb := '[]'::jsonb;
  v_response jsonb;
  v_policy app.loyalty_policies%rowtype;
  v_points bigint := 0;
  v_loyalty_balance bigint := 0;
  v_loyalty_transaction_id uuid;
begin
  if p_pricing_type not in ('retail','wholesale','dealer') then
    raise exception using errcode = 'HCSW0', message = 'Pricing type is invalid';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200
    or exists (select 1 from jsonb_array_elements(p_lines) line where (line->>'variantId') is null
      or (line->>'quantityMilli') is null or (line->>'quantityMilli') !~ '^[1-9][0-9]*$')
    or exists (select 1 from jsonb_array_elements(p_lines) line group by line->>'variantId' having count(*) > 1) then
    raise exception using errcode = 'HCS94', message = 'Sale lines are invalid';
  end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 or jsonb_array_length(p_payments) > 10
    or exists (select 1 from jsonb_array_elements(p_payments) payment where (payment->>'paymentMethodId') is null
      or (payment->>'paymentMethodId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (payment->>'amountCentavos') is null or (payment->>'amountCentavos') !~ '^[1-9][0-9]*$'
      or (payment->>'tenderedCentavos') is null or (payment->>'tenderedCentavos') !~ '^[1-9][0-9]*$')
    or exists (select 1 from jsonb_array_elements(p_payments) payment group by payment->>'paymentMethodId' having count(*) > 1) then
    raise exception using errcode = 'HCS94', message = 'Sale payments are invalid';
  end if;

  select session.* into v_pos from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id = session.tenant_id and device.id = session.device_id and device.status = 'active'
  where session.token_hash = p_session_token_hash and session.revoked_at is null and session.expires_at > now();
  if v_pos.id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
  if not app.is_location_inventory_cutover_ready(v_pos.tenant_id, v_pos.location_id) then
    raise exception using errcode = 'HCSC0', message = 'Opening inventory must be posted and reconciled before sales can begin';
  end if;
  if not exists (select 1 from app.employee_roles employee_role
    join app.role_permissions permission on permission.tenant_id = employee_role.tenant_id and permission.role_id = employee_role.role_id
    where employee_role.tenant_id = v_pos.tenant_id and employee_role.employee_id = v_pos.employee_id
      and permission.permission_code = 'sales.create') then
    raise exception using errcode = 'HCS93', message = 'Employee cannot complete sales';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text || ':pos-sale.complete:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = v_pos.tenant_id
    and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at)
    values (v_pos.tenant_id, 'pos-sale.complete', p_idempotency_key, p_request_hash, now() + interval '24 hours');
  end if;

  if p_customer_id is not null then
    select * into v_customer from app.customers where tenant_id = v_pos.tenant_id and id = p_customer_id and status = 'active';
    if not found then raise exception using errcode = 'HCSB1', message = 'Customer was not found'; end if;
  end if;
  if p_pricing_type <> 'retail' then
    if v_customer.id is null or v_customer.customer_type <> 'reseller' then
      raise exception using errcode = 'HCSW1', message = 'An active reseller customer is required for wholesale or dealer pricing';
    end if;
    select price_list.* into v_price_list from app.customer_price_list_assignments assignment
    join app.price_lists price_list on price_list.tenant_id = assignment.tenant_id and price_list.id = assignment.price_list_id
    where assignment.tenant_id = v_pos.tenant_id and assignment.customer_id = p_customer_id
      and price_list.pricing_type = p_pricing_type and price_list.is_active
    order by price_list.updated_at desc, price_list.id limit 1;
    if v_price_list.id is null then
      select * into v_price_list from app.price_lists where tenant_id = v_pos.tenant_id
        and pricing_type = p_pricing_type and is_default and is_active order by updated_at desc, id limit 1;
    end if;
    if v_price_list.id is null then raise exception using errcode = 'HCSW2', message = 'No active price list is available'; end if;
  end if;

  select * into v_register_session from app.register_sessions where tenant_id = v_pos.tenant_id
    and register_id = v_pos.register_id and employee_id = v_pos.employee_id and status = 'open' for update;
  if v_register_session.id is null then raise exception using errcode = 'HCS95', message = 'Open register session is required'; end if;

  select (now() at time zone coalesce(location.timezone, tenant.timezone, 'Asia/Manila'))::date into v_business_date
  from app.locations location join app.tenants tenant on tenant.id = location.tenant_id
  where location.tenant_id = v_pos.tenant_id and location.id = v_pos.location_id;
  insert into app.receipt_counters (tenant_id, location_id, business_date, last_number)
  values (v_pos.tenant_id, v_pos.location_id, v_business_date, 1)
  on conflict (tenant_id, location_id, business_date) do update
    set last_number = app.receipt_counters.last_number + 1, updated_at = now()
  returning last_number into v_receipt_seq;
  select upper(location.code::text) || '-' || to_char(v_business_date, 'YYYYMMDD') || '-' || lpad(v_receipt_seq::text, 6, '0')
  into v_receipt from app.locations location where location.tenant_id = v_pos.tenant_id and location.id = v_pos.location_id;
  insert into app.sales (id, tenant_id, location_id, register_id, register_session_id, employee_id, customer_id,
    receipt_number, subtotal, total, pricing_type, price_list_id)
  values (v_sale_id, v_pos.tenant_id, v_pos.location_id, v_pos.register_id, v_register_session.id, v_pos.employee_id,
    p_customer_id, v_receipt, 0, 0, p_pricing_type, v_price_list.id);

  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'variantId' loop
    v_quantity := ((v_line->>'quantityMilli')::bigint)::numeric / 1000;
    select variant.id, variant.product_id, variant.name variant_name, variant.sku::text sku, variant.retail_price,
      variant.unit_cost, variant.track_inventory, product.name product_name into v_variant
    from app.product_variants variant join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    where variant.tenant_id = v_pos.tenant_id and variant.id = (v_line->>'variantId')::uuid
      and variant.is_active and product.status = 'active' for update of variant;
    if v_variant.id is null then raise exception using errcode = 'HCS97', message = 'Product variant is unavailable'; end if;
    v_unit_price := v_variant.retail_price;
    if p_pricing_type <> 'retail' then
      select entry.unit_price, entry.pricing_group_id, pricing_group.threshold_quantity into v_entry
      from app.price_list_entries entry join app.pricing_groups pricing_group
        on pricing_group.tenant_id = entry.tenant_id and pricing_group.id = entry.pricing_group_id and pricing_group.is_active
      where entry.tenant_id = v_pos.tenant_id and entry.price_list_id = v_price_list.id and entry.variant_id = v_variant.id;
      if v_entry.pricing_group_id is null then
        raise exception using errcode = 'HCSW2', message = 'A cart item is not included in the selected price list';
      end if;
      select coalesce(sum(((line->>'quantityMilli')::bigint)::numeric / 1000),0) into v_group_quantity
      from jsonb_array_elements(p_lines) line join app.price_list_entries grouped_entry
        on grouped_entry.tenant_id = v_pos.tenant_id and grouped_entry.price_list_id = v_price_list.id
        and grouped_entry.variant_id = (line->>'variantId')::uuid
      where grouped_entry.pricing_group_id = v_entry.pricing_group_id;
      if v_group_quantity < v_entry.threshold_quantity then
        raise exception using errcode = 'HCSW3', message = 'The pricing-group quantity threshold has not been met';
      end if;
      v_unit_price := v_entry.unit_price;
    end if;
    if v_variant.track_inventory then
      select * into v_balance from app.inventory_balances where tenant_id = v_pos.tenant_id
        and location_id = v_pos.location_id and variant_id = v_variant.id for update;
      if v_balance.variant_id is null or (v_balance.on_hand - v_balance.reserved - v_balance.damaged) < v_quantity then
        raise exception using errcode = 'HCS98', message = 'Insufficient available stock';
      end if;
    end if;
    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into app.sale_lines (id, tenant_id, sale_id, variant_id, product_name, variant_name, sku, quantity, unit_price, unit_cost, line_total)
    values (gen_random_uuid(), v_pos.tenant_id, v_sale_id, v_variant.id, v_variant.product_name, v_variant.variant_name,
      v_variant.sku, v_quantity, v_unit_price, v_variant.unit_cost, v_line_total);
    if v_variant.track_inventory then
      update app.inventory_balances set on_hand = on_hand - v_quantity, version = version + 1, updated_at = now()
      where tenant_id = v_pos.tenant_id and location_id = v_pos.location_id and variant_id = v_variant.id;
      insert into app.inventory_movements (tenant_id, location_id, variant_id, movement_type, quantity, unit_cost, source_type, source_reference, occurred_at)
      values (v_pos.tenant_id, v_pos.location_id, v_variant.id, 'SALE', -v_quantity,
        coalesce(v_balance.average_unit_cost, v_variant.unit_cost), 'sale', v_sale_id::text, now());
    end if;
  end loop;

  select sum((payment->>'amountCentavos')::bigint)::numeric / 100 into v_payment_total from jsonb_array_elements(p_payments) payment;
  if v_payment_total <> v_subtotal then raise exception using errcode = 'HCS99', message = 'Payment allocation must equal the sale total'; end if;
  for v_payment in select value from jsonb_array_elements(p_payments) order by value->>'paymentMethodId' loop
    select * into v_method from app.payment_methods where tenant_id = v_pos.tenant_id
      and id = (v_payment->>'paymentMethodId')::uuid and is_active for share;
    if not found then raise exception using errcode = 'HCS96', message = 'An active payment method is required'; end if;
    v_amount := (v_payment->>'amountCentavos')::bigint::numeric / 100;
    v_tendered := (v_payment->>'tenderedCentavos')::bigint::numeric / 100;
    if (v_method.method_type = 'cash' and v_tendered < v_amount)
      or (v_method.method_type <> 'cash' and v_tendered <> v_amount) then
      raise exception using errcode = 'HCS99', message = 'Tender amount is invalid';
    end if;
    v_change := v_tendered - v_amount;
    insert into app.sale_payments (tenant_id, sale_id, payment_method_id, amount, tendered_amount, change_amount)
    values (v_pos.tenant_id, v_sale_id, v_method.id, v_amount, v_tendered, v_change);
    if v_method.method_type = 'cash' then
      insert into app.cash_movements (tenant_id, register_session_id, location_id, movement_type, amount, source_type, source_id, actor_employee_id)
      values (v_pos.tenant_id, v_register_session.id, v_pos.location_id, 'cash_sale', v_amount, 'sale', v_sale_id, v_pos.employee_id);
      v_cash_received_centavos := v_cash_received_centavos + round(v_tendered * 100)::bigint;
      v_change_centavos := v_change_centavos + round(v_change * 100)::bigint;
    end if;
    v_payment_response := v_payment_response || jsonb_build_array(jsonb_build_object(
      'paymentMethodId', v_method.id, 'methodName', v_method.name, 'methodType', v_method.method_type,
      'amountCentavos', round(v_amount * 100)::bigint, 'tenderedCentavos', round(v_tendered * 100)::bigint,
      'changeCentavos', round(v_change * 100)::bigint));
  end loop;

  update app.sales set subtotal = v_subtotal, total = v_subtotal where tenant_id = v_pos.tenant_id and id = v_sale_id;
  if p_customer_id is not null then
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
    values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'sale.customer_linked', 'sale', v_sale_id,
      v_pos.location_id, jsonb_build_object('customerId', p_customer_id));
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (v_pos.tenant_id, 'sale.customer_linked', 'sale', v_sale_id,
      jsonb_build_object('saleId', v_sale_id, 'customerId', p_customer_id));
    select * into v_policy from app.loyalty_policies where tenant_id = v_pos.tenant_id;
    if v_policy.enabled then
      v_points := floor(round(v_subtotal * 100)::bigint / round(v_policy.spend_per_point * 100)::bigint)::bigint;
      if v_points > 0 then
        v_loyalty_transaction_id := gen_random_uuid();
        insert into app.loyalty_transactions (id, tenant_id, customer_id, transaction_type, points_delta,
          balance_after_points, spend_per_point_centavos, sale_id, actor_employee_id, occurred_at)
        values (v_loyalty_transaction_id, v_pos.tenant_id, p_customer_id, 'sale_earn', v_points, 0,
          round(v_policy.spend_per_point * 100)::bigint, v_sale_id, v_pos.employee_id, now());
        insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
        values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'loyalty.points_earned',
          'loyalty_transaction', v_loyalty_transaction_id, v_pos.location_id,
          jsonb_build_object('saleId', v_sale_id, 'customerId', p_customer_id, 'points', v_points));
        insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
        values (v_pos.tenant_id, 'loyalty.points_earned', 'customer', p_customer_id,
          jsonb_build_object('transactionId', v_loyalty_transaction_id, 'saleId', v_sale_id,
            'customerId', p_customer_id, 'points', v_points));
      end if;
    end if;
    select coalesce(balance_points,0) into v_loyalty_balance from app.loyalty_accounts
      where tenant_id = v_pos.tenant_id and customer_id = p_customer_id;
  end if;
  v_response := jsonb_build_object(
    'saleId', v_sale_id, 'receiptNumber', v_receipt, 'status', 'completed',
    'subtotalCentavos', round(v_subtotal * 100)::bigint, 'totalCentavos', round(v_subtotal * 100)::bigint,
    'cashReceivedCentavos', v_cash_received_centavos, 'changeCentavos', v_change_centavos,
    'payments', v_payment_response, 'completedAt', now(), 'customerId', p_customer_id,
    'customerName', v_customer.full_name, 'loyaltyEarnedPoints', v_points,
    'loyaltyBalancePoints', case when p_customer_id is null then null else v_loyalty_balance end,
    'pricingType', p_pricing_type, 'priceListId', v_price_list.id, 'priceListName', v_price_list.name);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'sale.completed', 'sale', v_sale_id, v_pos.location_id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (v_pos.tenant_id, 'sale.completed', 'sale', v_sale_id, v_response);
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now()
  where tenant_id = v_pos.tenant_id and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function app.load_pricing_context(uuid,uuid), app.upsert_price_list(uuid,uuid,jsonb,text,text,text),
  app.load_pos_pricing_options(text), app.complete_pos_priced_sale(text,jsonb,jsonb,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function app.load_pricing_context(uuid,uuid), app.upsert_price_list(uuid,uuid,jsonb,text,text,text),
  app.load_pos_pricing_options(text), app.complete_pos_priced_sale(text,jsonb,jsonb,uuid,text,text,text,text)
  to hcs_hyperdrive;

commit;
