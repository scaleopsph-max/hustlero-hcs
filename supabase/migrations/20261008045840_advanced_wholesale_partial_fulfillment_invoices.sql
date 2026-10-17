-- Advanced Wholesale AW2: partial fulfillment, immutable invoices, and Sales archive linkage.
begin;

alter table app.sales
  add column channel text not null default 'pos'
    check (channel in ('pos', 'wholesale')),
  add column completed_by_user_id uuid;

alter table app.sales
  alter column register_id drop not null,
  alter column register_session_id drop not null,
  alter column employee_id drop not null;

alter table app.sales
  add constraint sales_completed_by_user_fkey
    foreign key (tenant_id, completed_by_user_id)
    references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  add constraint sales_channel_actor_context check (
    (channel = 'pos' and register_id is not null and register_session_id is not null
      and employee_id is not null and completed_by_user_id is null)
    or
    (channel = 'wholesale' and register_id is null and register_session_id is null
      and employee_id is null and completed_by_user_id is not null)
  );

create index sales_channel_completed_idx
  on app.sales (tenant_id, channel, completed_at desc, id);
create index sales_completed_by_user_idx
  on app.sales (tenant_id, completed_by_user_id, completed_at desc)
  where completed_by_user_id is not null;

create table app.invoice_counters (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  business_date date not null,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, business_date)
);

create table app.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  invoice_number extensions.citext not null,
  invoice_type text not null default 'wholesale' check (invoice_type = 'wholesale'),
  sales_order_id uuid not null,
  sale_id uuid not null,
  customer_id uuid not null,
  location_id uuid not null,
  order_number_snapshot text not null,
  customer_number_snapshot text not null,
  customer_name_snapshot text not null,
  location_name_snapshot text not null,
  subtotal numeric(18,2) not null check (subtotal >= 0),
  discount_total numeric(18,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(18,2) not null default 0 check (tax_total >= 0),
  total numeric(18,2) not null check (total >= 0),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, invoice_number),
  unique (tenant_id, sale_id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, issued_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint invoices_number_not_blank check (btrim(invoice_number::text) <> ''),
  constraint invoices_snapshot_not_blank check (
    btrim(order_number_snapshot) <> '' and btrim(customer_number_snapshot) <> ''
    and btrim(customer_name_snapshot) <> '' and btrim(location_name_snapshot) <> ''
  ),
  constraint invoices_total_equation check (total = subtotal - discount_total + tax_total)
);

create table app.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  invoice_id uuid not null,
  sales_order_line_id uuid not null,
  sale_line_id uuid not null,
  variant_id uuid not null,
  product_name text not null,
  variant_name text not null,
  sku text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, invoice_id, sales_order_line_id),
  foreign key (tenant_id, invoice_id) references app.invoices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sales_order_line_id) references app.sales_order_lines (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_line_id) references app.sale_lines (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  constraint invoice_lines_snapshot_not_blank check (
    btrim(product_name) <> '' and btrim(variant_name) <> '' and btrim(sku) <> ''
  ),
  constraint invoice_lines_total_equation check (line_total = round(quantity * unit_price, 2))
);

create index invoices_order_issued_idx on app.invoices (tenant_id, sales_order_id, issued_at, id);
create index invoices_customer_issued_idx on app.invoices (tenant_id, customer_id, issued_at desc, id);
create index invoices_location_issued_idx on app.invoices (tenant_id, location_id, issued_at desc, id);
create index invoices_issued_by_idx on app.invoices (tenant_id, issued_by, issued_at desc);
create index invoice_lines_invoice_idx on app.invoice_lines (tenant_id, invoice_id, id);
create index invoice_lines_order_line_idx on app.invoice_lines (tenant_id, sales_order_line_id, id);
create index invoice_lines_sale_line_idx on app.invoice_lines (tenant_id, sale_line_id);
create index invoice_lines_variant_idx on app.invoice_lines (tenant_id, variant_id, created_at desc);

alter table app.invoice_counters enable row level security;
alter table app.invoices enable row level security;
alter table app.invoice_lines enable row level security;
revoke all on table app.invoice_counters, app.invoices, app.invoice_lines
  from public, anon, authenticated, hcs_hyperdrive;

create function app.reject_invoice_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'issued invoices are immutable';
end;
$$;
revoke all on function app.reject_invoice_mutation() from public, anon, authenticated, hcs_hyperdrive;
create trigger invoices_reject_update_delete before update or delete on app.invoices
for each row execute function app.reject_invoice_mutation();
create trigger invoice_lines_reject_update_delete before update or delete on app.invoice_lines
for each row execute function app.reject_invoice_mutation();

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, permission.code
from app.roles role cross join app.permissions permission
where lower(role.code::text) in ('owner', 'admin', 'manager')
  and permission.code in ('wholesale_orders.read', 'wholesale_orders.manage')
on conflict do nothing;

create or replace function app.initialize_owner_wholesale_order_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) in ('owner', 'admin', 'manager') then
    insert into app.role_permissions (tenant_id, role_id, permission_code) values
      (new.tenant_id, new.id, 'wholesale_orders.read'),
      (new.tenant_id, new.id, 'wholesale_orders.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function app.fulfill_wholesale_order(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_sales_order_id uuid,
  p_lines jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_order app.sales_orders%rowtype;
  v_order_line app.sales_order_lines%rowtype;
  v_balance app.inventory_balances%rowtype;
  v_item jsonb;
  v_quantity numeric(18,3);
  v_remaining numeric(18,3);
  v_subtotal numeric(18,2) := 0;
  v_total_quantity numeric(18,3) := 0;
  v_business_date date;
  v_counter bigint;
  v_invoice_number text;
  v_invoice_id uuid := gen_random_uuid();
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_issued_at timestamptz := now();
  v_order_status text;
  v_response jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 500
    or exists (
      select 1 from jsonb_array_elements(p_lines) item
      where item ->> 'salesOrderLineId' is null
        or item ->> 'quantityMilli' !~ '^[1-9][0-9]*$'
    )
    or exists (
      select 1 from jsonb_array_elements(p_lines) item
      group by item ->> 'salesOrderLineId' having count(*) > 1
    )
  then raise exception using errcode = 'HCSR1', message = 'Fulfillment lines are invalid'; end if;

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
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active' and (
        membership.is_owner or exists (
          select 1 from app.membership_roles membership_role
          join app.role_permissions permission
            on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id
            and permission.permission_code = 'wholesale_orders.manage'
        )
      )
  ) then raise exception using errcode = 'HCSQ1', message = 'Wholesale order management is not allowed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':wholesale-order:fulfill:' || p_sales_order_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':wholesale-order:fulfill-request:' || p_idempotency_key, 0
  ));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'wholesale_order.fulfill'
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
      p_tenant_id, 'wholesale_order.fulfill', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  select * into v_order from app.sales_orders
  where tenant_id = p_tenant_id and id = p_sales_order_id for update;
  if not found then raise exception using errcode = 'HCSQ7', message = 'The wholesale order was not found'; end if;
  if v_order.status not in ('confirmed', 'partially_fulfilled') then
    raise exception using errcode = 'HCSQ6', message = 'Only confirmed orders with remaining quantity can be fulfilled';
  end if;

  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_quantity := ((v_item ->> 'quantityMilli')::bigint)::numeric / 1000;
    select * into v_order_line from app.sales_order_lines
    where tenant_id = p_tenant_id and sales_order_id = p_sales_order_id
      and id = (v_item ->> 'salesOrderLineId')::uuid for update;
    if not found then raise exception using errcode = 'HCSR2', message = 'The wholesale order line was not found'; end if;
    v_remaining := v_order_line.ordered_quantity - v_order_line.fulfilled_quantity - v_order_line.cancelled_quantity;
    if v_quantity <= 0 or v_quantity > v_remaining then
      raise exception using errcode = 'HCSR3', message = 'Fulfillment exceeds the remaining order quantity';
    end if;
    select * into v_balance from app.inventory_balances
    where tenant_id = p_tenant_id and location_id = v_order.location_id
      and variant_id = v_order_line.variant_id for update;
    if not found or v_balance.reserved < v_quantity or v_balance.on_hand < v_quantity then
      raise exception using errcode = 'HCQ11', message = 'The reservation balance is inconsistent';
    end if;
    v_subtotal := v_subtotal + round(v_quantity * v_order_line.unit_price, 2);
    v_total_quantity := v_total_quantity + v_quantity;
  end loop;

  select (v_issued_at at time zone tenant.timezone)::date into v_business_date
  from app.tenants tenant where tenant.id = p_tenant_id;
  insert into app.invoice_counters (tenant_id, business_date, last_number)
  values (p_tenant_id, v_business_date, 1)
  on conflict (tenant_id, business_date) do update set
    last_number = app.invoice_counters.last_number + 1, updated_at = now()
  returning last_number into v_counter;
  v_invoice_number := 'INV-' || to_char(v_business_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, 6, '0');

  insert into app.sales (
    id, tenant_id, location_id, register_id, register_session_id, employee_id,
    completed_by_user_id, channel, customer_id, receipt_number, pricing_type, price_list_id,
    subtotal, discount_total, tax_total, total, completed_at
  ) values (
    v_sale_id, p_tenant_id, v_order.location_id, null, null, null,
    p_actor_user_id, 'wholesale', v_order.customer_id, v_invoice_number,
    v_order.pricing_type, v_order.price_list_id,
    v_subtotal, 0, 0, v_subtotal, v_issued_at
  );

  insert into app.invoices (
    id, tenant_id, invoice_number, sales_order_id, sale_id, customer_id, location_id,
    order_number_snapshot, customer_number_snapshot, customer_name_snapshot, location_name_snapshot,
    subtotal, discount_total, tax_total, total, issued_by, issued_at
  ) values (
    v_invoice_id, p_tenant_id, v_invoice_number, p_sales_order_id, v_sale_id,
    v_order.customer_id, v_order.location_id, v_order.order_number::text,
    v_order.customer_number_snapshot, v_order.customer_name_snapshot,
    (select name from app.locations where tenant_id = p_tenant_id and id = v_order.location_id),
    v_subtotal, 0, 0, v_subtotal, p_actor_user_id, v_issued_at
  );

  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_quantity := ((v_item ->> 'quantityMilli')::bigint)::numeric / 1000;
    select * into v_order_line from app.sales_order_lines
    where tenant_id = p_tenant_id and sales_order_id = p_sales_order_id
      and id = (v_item ->> 'salesOrderLineId')::uuid for update;
    select * into v_balance from app.inventory_balances
    where tenant_id = p_tenant_id and location_id = v_order.location_id
      and variant_id = v_order_line.variant_id for update;
    v_sale_line_id := gen_random_uuid();
    insert into app.sale_lines (
      id, tenant_id, sale_id, variant_id, product_name, variant_name, sku,
      quantity, unit_price, unit_cost, line_total
    ) values (
      v_sale_line_id, p_tenant_id, v_sale_id, v_order_line.variant_id,
      v_order_line.product_name_snapshot, v_order_line.variant_name_snapshot, v_order_line.sku_snapshot,
      v_quantity, v_order_line.unit_price, v_balance.average_unit_cost,
      round(v_quantity * v_order_line.unit_price, 2)
    );
    insert into app.invoice_lines (
      tenant_id, invoice_id, sales_order_line_id, sale_line_id, variant_id,
      product_name, variant_name, sku, quantity, unit_price, line_total
    ) values (
      p_tenant_id, v_invoice_id, v_order_line.id, v_sale_line_id, v_order_line.variant_id,
      v_order_line.product_name_snapshot, v_order_line.variant_name_snapshot, v_order_line.sku_snapshot,
      v_quantity, v_order_line.unit_price, round(v_quantity * v_order_line.unit_price, 2)
    );
    update app.sales_order_lines set fulfilled_quantity = fulfilled_quantity + v_quantity
    where tenant_id = p_tenant_id and id = v_order_line.id;
    update app.inventory_balances set
      on_hand = on_hand - v_quantity,
      reserved = reserved - v_quantity,
      version = version + 1,
      updated_at = now()
    where tenant_id = p_tenant_id and location_id = v_order.location_id
      and variant_id = v_order_line.variant_id;
    insert into app.inventory_movements (
      tenant_id, location_id, variant_id, movement_type, quantity, unit_cost,
      source_type, source_reference, actor_user_id
    ) values (
      p_tenant_id, v_order.location_id, v_order_line.variant_id, 'SALE', -v_quantity,
      v_balance.average_unit_cost, 'wholesale_invoice', v_invoice_id::text, p_actor_user_id
    );
    insert into app.sales_order_reservation_ledger (
      tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id,
      quantity_delta, reason, actor_user_id
    ) values (
      p_tenant_id, p_sales_order_id, v_order_line.id, v_order.location_id,
      v_order_line.variant_id, -v_quantity, 'order_fulfilled', p_actor_user_id
    );
  end loop;

  select case when exists (
    select 1 from app.sales_order_lines line
    where line.tenant_id = p_tenant_id and line.sales_order_id = p_sales_order_id
      and line.ordered_quantity > line.fulfilled_quantity + line.cancelled_quantity
  ) then 'partially_fulfilled' else 'fulfilled' end into v_order_status;
  update app.sales_orders set status = v_order_status
  where tenant_id = p_tenant_id and id = p_sales_order_id;

  v_response := jsonb_build_object(
    'salesOrderId', p_sales_order_id,
    'orderStatus', v_order_status,
    'invoiceId', v_invoice_id,
    'invoiceNumber', v_invoice_number,
    'saleId', v_sale_id,
    'fulfilledQuantityMilli', round(v_total_quantity * 1000)::bigint,
    'totalMinor', round(v_subtotal * 100)::bigint,
    'issuedAt', v_issued_at
  );
  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'wholesale_invoice.issued', 'invoice', v_invoice_id, v_order.location_id, v_response
  );
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'wholesale_invoice.issued', 'invoice', v_invoice_id, v_response);
  update app.idempotency_records set response_status = 201, response_body = v_response,
    completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'wholesale_order.fulfill'
    and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.list_wholesale_invoices(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
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
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active' and (
        membership.is_owner or exists (
          select 1 from app.membership_roles membership_role
          join app.role_permissions permission
            on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id
            and permission.permission_code = 'wholesale_orders.read'
        )
      )
  ) then raise exception using errcode = 'HCSQ1', message = 'Wholesale order access is not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', invoice.id,
      'invoiceNumber', invoice.invoice_number::text,
      'salesOrderId', invoice.sales_order_id,
      'orderNumber', invoice.order_number_snapshot,
      'saleId', invoice.sale_id,
      'customerId', invoice.customer_id,
      'customerName', invoice.customer_name_snapshot,
      'locationId', invoice.location_id,
      'locationName', invoice.location_name_snapshot,
      'totalMinor', round(invoice.total * 100)::bigint,
      'issuedAt', invoice.issued_at,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', line.id,
          'salesOrderLineId', line.sales_order_line_id,
          'saleLineId', line.sale_line_id,
          'variantId', line.variant_id,
          'productName', line.product_name,
          'variantName', line.variant_name,
          'sku', line.sku,
          'quantityMilli', round(line.quantity * 1000)::bigint,
          'unitPriceMinor', round(line.unit_price * 100)::bigint,
          'lineTotalMinor', round(line.line_total * 100)::bigint
        ) order by line.created_at, line.id)
        from app.invoice_lines line
        where line.tenant_id = invoice.tenant_id and line.invoice_id = invoice.id
      ), '[]'::jsonb)
    ) order by invoice.issued_at desc, invoice.id)
    from app.invoices invoice where invoice.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end;
$$;

create function app.list_sales_archive(p_actor_user_id uuid, p_tenant_id uuid, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active' and (
        membership.is_owner or exists (
          select 1 from app.membership_roles membership_role
          join app.role_permissions permission
            on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id and permission.permission_code = 'sales.read'
        )
      )
  ) then raise exception using errcode = 'HCSA0', message = 'Sales access is not allowed'; end if;
  return jsonb_build_object('sales', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sale.id,
      'receiptNumber', sale.receipt_number,
      'channel', sale.channel,
      'invoiceId', invoice.id,
      'salesOrderId', invoice.sales_order_id,
      'status', sale.status,
      'locationName', location.name,
      'registerName', coalesce(register.name, 'Back Office'),
      'employeeName', coalesce(employee.display_name, actor.email::text, 'Business user'),
      'itemCount', (select coalesce(sum(line.quantity), 0) from app.sale_lines line
        where line.tenant_id = sale.tenant_id and line.sale_id = sale.id),
      'totalCentavos', round(sale.total * 100)::bigint,
      'refundedCentavos', round(coalesce((select sum(refund.amount) from app.refunds refund
        where refund.tenant_id = sale.tenant_id and refund.sale_id = sale.id), 0) * 100)::bigint,
      'netCentavos', round((sale.total - coalesce((select sum(refund.amount) from app.refunds refund
        where refund.tenant_id = sale.tenant_id and refund.sale_id = sale.id), 0)) * 100)::bigint,
      'completedAt', sale.completed_at
    ) order by sale.completed_at desc, sale.id)
    from (select * from app.sales where tenant_id = p_tenant_id
      order by completed_at desc, id limit least(greatest(p_limit, 1), 200)) sale
    join app.locations location on location.tenant_id = sale.tenant_id and location.id = sale.location_id
    left join app.registers register on register.tenant_id = sale.tenant_id and register.id = sale.register_id
    left join app.employees employee on employee.tenant_id = sale.tenant_id and employee.id = sale.employee_id
    left join auth.users actor on actor.id = sale.completed_by_user_id
    left join app.invoices invoice on invoice.tenant_id = sale.tenant_id and invoice.sale_id = sale.id
  ), '[]'::jsonb));
end;
$$;

create function app.load_sale_archive_record(p_actor_user_id uuid, p_tenant_id uuid, p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sale app.sales%rowtype;
  v_invoice app.invoices%rowtype;
  v_result jsonb;
begin
  select * into v_sale from app.sales where tenant_id = p_tenant_id and id = p_sale_id;
  if not found then raise exception using errcode = 'HCSA1', message = 'Sale was not found'; end if;
  if v_sale.channel = 'pos' then
    return app.load_sale_receipt_with_customer(p_actor_user_id, p_tenant_id, p_sale_id)
      || jsonb_build_object(
        'channel', 'pos', 'invoiceId', null, 'invoiceNumber', null,
        'salesOrderId', null, 'orderNumber', null
      );
  end if;
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active' and (
        membership.is_owner or exists (
          select 1 from app.membership_roles membership_role
          join app.role_permissions permission
            on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id and permission.permission_code = 'sales.read'
        )
      )
  ) then raise exception using errcode = 'HCSA0', message = 'Sales access is not allowed'; end if;
  select * into v_invoice from app.invoices where tenant_id = p_tenant_id and sale_id = p_sale_id;
  if not found then raise exception using errcode = 'HCSA1', message = 'Wholesale invoice was not found'; end if;
  select jsonb_build_object(
    'id', v_sale.id,
    'receiptNumber', v_sale.receipt_number,
    'channel', 'wholesale',
    'invoiceId', v_invoice.id,
    'invoiceNumber', v_invoice.invoice_number::text,
    'salesOrderId', v_invoice.sales_order_id,
    'orderNumber', v_invoice.order_number_snapshot,
    'status', v_sale.status,
    'locationName', v_invoice.location_name_snapshot,
    'registerName', 'Back Office',
    'employeeName', coalesce((select actor.email::text from auth.users actor
      where actor.id = v_sale.completed_by_user_id), 'Business user'),
    'customerId', v_invoice.customer_id,
    'customerName', v_invoice.customer_name_snapshot,
    'customerNumber', v_invoice.customer_number_snapshot,
    'loyaltyEarnedPoints', 0,
    'loyaltyReversedPoints', 0,
    'completedAt', v_sale.completed_at,
    'subtotalCentavos', round(v_sale.subtotal * 100)::bigint,
    'discountCentavos', round(v_sale.discount_total * 100)::bigint,
    'taxCentavos', round(v_sale.tax_total * 100)::bigint,
    'totalCentavos', round(v_sale.total * 100)::bigint,
    'refundedCentavos', 0,
    'refundableCentavos', 0,
    'canReverse', false,
    'reversalBlockedReason', 'Wholesale returns and credits are introduced in AW4.',
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'id', line.id,
      'productName', line.product_name,
      'variantName', line.variant_name,
      'sku', line.sku,
      'quantityMilli', round(line.quantity * 1000)::bigint,
      'refundedQuantityMilli', 0,
      'refundableQuantityMilli', 0,
      'unitPriceCentavos', round(line.unit_price * 100)::bigint,
      'lineTotalCentavos', round(line.line_total * 100)::bigint
    ) order by line.created_at, line.id) from app.sale_lines line
      where line.tenant_id = p_tenant_id and line.sale_id = p_sale_id), '[]'::jsonb),
    'payments', '[]'::jsonb,
    'reversals', '[]'::jsonb
  ) into v_result;
  return v_result;
end;
$$;

create function app.load_reporting_by_channel(
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
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_sales_context jsonb;
begin
  if p_channel not in ('all', 'pos', 'wholesale') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  v_context := app.load_reporting_with_inventory_policy(
    p_actor_user_id, p_tenant_id, p_from, p_to, p_location_id, 'all'
  );
  select timezone into v_timezone from app.tenants where id = p_tenant_id;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with
  scoped_sales as (
    select sale.* from app.sales sale
    where sale.tenant_id = p_tenant_id and (p_channel = 'all' or sale.channel = p_channel)
      and sale.completed_at >= v_start and sale.completed_at < v_end
      and (p_location_id is null or sale.location_id = p_location_id)
  ),
  scoped_refunds as (
    select refund.*, sale.location_id, sale.employee_id, sale.completed_by_user_id
    from app.refunds refund
    join app.sales sale on sale.tenant_id = refund.tenant_id and sale.id = refund.sale_id
    where refund.tenant_id = p_tenant_id and (p_channel = 'all' or sale.channel = p_channel)
      and refund.completed_at >= v_start and refund.completed_at < v_end
      and (p_location_id is null or sale.location_id = p_location_id)
  ),
  summary as (
    select
      coalesce((select sum(total) from scoped_sales), 0) gross_sales,
      coalesce((select sum(amount) from scoped_refunds), 0) refunds,
      coalesce((select sum(discount_total) from scoped_sales), 0) discounts,
      coalesce((select sum(tax_total) from scoped_sales), 0) taxes,
      coalesce((select sum(line.quantity * coalesce(line.unit_cost, 0))
        from app.sale_lines line join scoped_sales sale
          on sale.id = line.sale_id and sale.tenant_id = line.tenant_id), 0)
      - coalesce((select sum(item.quantity * coalesce(line.unit_cost, 0))
        from app.refund_items item join scoped_refunds refund
          on refund.id = item.refund_id and refund.tenant_id = item.tenant_id
        join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id), 0) cogs,
      (select count(*) from scoped_sales) transactions
  ),
  trend_days as (select generate_series(p_from, p_to, interval '1 day')::date business_date),
  trend_sales as (
    select (sale.completed_at at time zone v_timezone)::date business_date,
      sum(sale.total) gross, count(*) transactions
    from scoped_sales sale group by 1
  ),
  trend_refunds as (
    select (refund.completed_at at time zone v_timezone)::date business_date, sum(refund.amount) refunds
    from scoped_refunds refund group by 1
  ),
  branch_sales as (
    select location_id, sum(total) gross, count(*) transactions from scoped_sales group by location_id
  ),
  branch_refunds as (
    select location_id, sum(amount) refunds from scoped_refunds group by location_id
  ),
  branch_cogs as (
    select sale.location_id, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by sale.location_id
  ),
  branch_refund_cogs as (
    select refund.location_id, sum(item.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    group by refund.location_id
  ),
  item_sales as (
    select line.variant_id, max(line.product_name) product_name, max(line.variant_name) variant_name,
      max(line.sku) sku, sum(line.quantity) quantity, count(distinct sale.id) transactions,
      sum(line.line_total) gross, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by line.variant_id
  ),
  item_refunds as (
    select line.variant_id, sum(item.quantity) quantity, count(distinct refund.id) transactions,
      sum(item.amount) refunds, sum(item.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    group by line.variant_id
  ),
  category_sales as (
    select coalesce(category.name, 'Uncategorized') label, count(distinct sale.id) transactions,
      sum(line.line_total) gross, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id
    join app.product_variants variant on variant.tenant_id = line.tenant_id and variant.id = line.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    left join app.product_categories category
      on category.tenant_id = product.tenant_id and category.id = product.category_id group by 1
  ),
  category_refunds as (
    select coalesce(category.name, 'Uncategorized') label, sum(item.amount) refunds,
      sum(item.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    join app.product_variants variant on variant.tenant_id = line.tenant_id and variant.id = line.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    left join app.product_categories category
      on category.tenant_id = product.tenant_id and category.id = product.category_id group by 1
  ),
  actor_sales as (
    select coalesce(sale.employee_id, sale.completed_by_user_id) actor_id,
      count(*) transactions, sum(sale.total) gross
    from scoped_sales sale group by 1
  ),
  actor_refunds as (
    select coalesce(refund.employee_id, refund.completed_by_user_id) actor_id, sum(refund.amount) refunds
    from scoped_refunds refund group by 1
  ),
  actor_cogs as (
    select coalesce(sale.employee_id, sale.completed_by_user_id) actor_id,
      sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by 1
  ),
  actor_refund_cogs as (
    select coalesce(refund.employee_id, refund.completed_by_user_id) actor_id,
      sum(item.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id group by 1
  ),
  actor_labels as (
    select actor_id, coalesce(employee.display_name, user_account.email::text, 'Business user') label
    from (select actor_id from actor_sales union select actor_id from actor_refunds) actor
    left join app.employees employee on employee.tenant_id = p_tenant_id and employee.id = actor.actor_id
    left join auth.users user_account on user_account.id = actor.actor_id
  ),
  payment_sales as (
    select method.method_type, method.name, sum(payment.amount) gross
    from scoped_sales sale join app.sale_payments payment
      on payment.tenant_id = sale.tenant_id and payment.sale_id = sale.id
    join app.payment_methods method
      on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
    group by method.method_type, method.name
  ),
  payment_refunds as (
    select method.method_type, method.name, sum(reversal.amount) refunds
    from scoped_refunds refund join app.payment_reversals reversal
      on reversal.tenant_id = refund.tenant_id and reversal.refund_id = refund.id
    join app.sale_payments payment
      on payment.tenant_id = reversal.tenant_id and payment.id = reversal.sale_payment_id
    join app.payment_methods method
      on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
    group by method.method_type, method.name
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'grossSalesCentavos', round(gross_sales * 100)::bigint,
      'refundsCentavos', round(refunds * 100)::bigint,
      'netSalesCentavos', round((gross_sales - refunds) * 100)::bigint,
      'cogsCentavos', round(cogs * 100)::bigint,
      'grossProfitCentavos', round((gross_sales - refunds - cogs) * 100)::bigint,
      'transactionCount', transactions::integer,
      'discountCentavos', round(discounts * 100)::bigint,
      'taxCentavos', round(taxes * 100)::bigint
    ) from summary),
    'salesTrend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day.business_date,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer
    ) order by day.business_date) from trend_days day
      left join trend_sales sale on sale.business_date = day.business_date
      left join trend_refunds refund on refund.business_date = day.business_date), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object(
      'locationId', location.id,
      'locationName', location.name,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(cost.cogs, 0) + coalesce(refund_cost.cogs, 0)) * 100)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer
    ) order by location.name) from app.locations location
      left join branch_sales sale on sale.location_id = location.id
      left join branch_refunds refund on refund.location_id = location.id
      left join branch_cogs cost on cost.location_id = location.id
      left join branch_refund_cogs refund_cost on refund_cost.location_id = location.id
      where location.tenant_id = p_tenant_id and location.is_active
        and (p_location_id is null or location.id = p_location_id)), '[]'::jsonb),
    'byItem', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.variant_id, refund.variant_id)::text,
      'label', coalesce(sale.product_name, product.name),
      'variantName', coalesce(sale.variant_name, variant.name),
      'sku', coalesce(sale.sku, variant.sku::text),
      'quantityMilli', round((coalesce(sale.quantity, 0) - coalesce(refund.quantity, 0)) * 1000)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(sale.cogs, 0) - coalesce(refund.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(sale.cogs, 0) + coalesce(refund.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from item_sales sale full join item_refunds refund on refund.variant_id = sale.variant_id
      join app.product_variants variant
        on variant.tenant_id = p_tenant_id and variant.id = coalesce(sale.variant_id, refund.variant_id)
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id), '[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.label, refund.label), 'label', coalesce(sale.label, refund.label),
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(sale.cogs, 0) - coalesce(refund.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(sale.cogs, 0) + coalesce(refund.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from category_sales sale full join category_refunds refund on refund.label = sale.label), '[]'::jsonb),
    'byEmployee', coalesce((select jsonb_agg(jsonb_build_object(
      'key', label.actor_id::text, 'label', label.label,
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(cost.cogs, 0) - coalesce(refund_cost.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(cost.cogs, 0) + coalesce(refund_cost.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from actor_labels label
      left join actor_sales sale on sale.actor_id = label.actor_id
      left join actor_refunds refund on refund.actor_id = label.actor_id
      left join actor_cogs cost on cost.actor_id = label.actor_id
      left join actor_refund_cogs refund_cost on refund_cost.actor_id = label.actor_id), '[]'::jsonb),
    'byPaymentType', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.method_type, refund.method_type),
      'label', coalesce(sale.name, refund.name),
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from payment_sales sale full join payment_refunds refund
        on refund.method_type = sale.method_type and refund.name = sale.name), '[]'::jsonb)
  ) into v_sales_context;

  return v_context
    || v_sales_context
    || jsonb_build_object('scope', (v_context -> 'scope') || jsonb_build_object('channel', p_channel));
end;
$$;

revoke all on function app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
revoke all on function app.list_wholesale_invoices(uuid,uuid)
  from public, anon, authenticated;
revoke all on function app.list_sales_archive(uuid,uuid,integer)
  from public, anon, authenticated;
revoke all on function app.load_sale_archive_record(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function app.load_reporting_by_channel(uuid,uuid,date,date,uuid,text)
  from public, anon, authenticated;
grant execute on function app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;
grant execute on function app.list_wholesale_invoices(uuid,uuid) to hcs_hyperdrive;
grant execute on function app.list_sales_archive(uuid,uuid,integer) to hcs_hyperdrive;
grant execute on function app.load_sale_archive_record(uuid,uuid,uuid) to hcs_hyperdrive;
grant execute on function app.load_reporting_by_channel(uuid,uuid,date,date,uuid,text) to hcs_hyperdrive;

commit;
