-- Reseller portal operations (owner selection 2026-10-31, decisions confirmed 2026-10-31):
--   1. Shipping fee: a flat fee per delivery order, free above an amount the business sets. Pickup is free. The fee is
--      part of the order total and is billed on the order's first invoice (invoices.shipping_fee). It is not product
--      revenue: the wholesale sale keeps the item total, and returns never refund it.
--   2. Printable invoice for resellers (app.load_reseller_invoice).
--   3. Partial shipment: the team can send part of a delivery order as a parcel. Each parcel leaves stock and gets its
--      own invoice right away; the last shipment sends the rest. Verified payments are recorded across the invoices.
--   4. Return requests: resellers ask to return items from an invoice with photos; the team approves (then records the
--      return in Returns) or declines with a reason.
begin;

-- ---------------------------------------------------------------------------
-- 1. Shipping fee
-- ---------------------------------------------------------------------------
alter table app.reseller_portal_settings
  add column shipping_fee numeric(18,2) not null default 0 check (shipping_fee >= 0 and shipping_fee <= 100000),
  add column free_shipping_minimum numeric(18,2) check (free_shipping_minimum is null or free_shipping_minimum > 0);
alter table app.sales_orders add column shipping_fee numeric(18,2) not null default 0 check (shipping_fee >= 0);
alter table app.invoices add column shipping_fee numeric(18,2) not null default 0 check (shipping_fee >= 0);
alter table app.invoices drop constraint invoices_total_equation;
alter table app.invoices add constraint invoices_total_equation check (total = subtotal - discount_total + tax_total + shipping_fee);

create function app.save_reseller_shipping_settings(p_actor uuid, p_tenant uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_fee numeric; v_free numeric;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('feeMinor', 'freeAboveMinor'))
    or jsonb_typeof(p_payload->'feeMinor') is distinct from 'number'
    or jsonb_typeof(p_payload->'freeAboveMinor') not in ('number', 'null') then
    raise exception using errcode = 'HCRP3', message = 'Shipping settings are invalid';
  end if;
  v_fee := (p_payload->>'feeMinor')::numeric; v_free := (p_payload->>'freeAboveMinor')::numeric;
  if v_fee <> trunc(v_fee) or v_fee < 0 or v_fee > 10000000
    or (v_free is not null and (v_free <> trunc(v_free) or v_free < 1 or v_free > 900719925474099)) then
    raise exception using errcode = 'HCRP3', message = 'Shipping settings are invalid';
  end if;
  update app.reseller_portal_settings set shipping_fee = v_fee / 100, free_shipping_minimum = v_free / 100
  where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.shipping_settings_saved', 'tenant', p_tenant,
    jsonb_build_object('feeMinor', v_fee::bigint, 'freeAboveMinor', v_free::bigint));
  return jsonb_build_object('feeMinor', v_fee::bigint, 'freeAboveMinor', v_free::bigint);
end;
$$;
revoke all on function app.save_reseller_shipping_settings(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.save_reseller_shipping_settings(uuid, uuid, jsonb, text) to hcs_hyperdrive;

CREATE OR REPLACE FUNCTION app.submit_reseller_portal_order(p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype;
  v_customer app.customers%rowtype; v_credit app.wholesale_customer_credit_settings%rowtype;
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype;
  v_line jsonb; v_order_line app.sales_order_lines%rowtype; v_balance app.inventory_balances%rowtype; v_entry record;
  v_number bigint; v_order_number text; v_total numeric(18,2) := 0; v_line_count integer := 0;
  v_reason text; v_quantity numeric; v_response jsonb; v_method text; v_address text; v_due timestamptz;
  v_tracked boolean; v_ship numeric(18,2) := 0;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  -- Expired holds give their stock back before this order checks availability.
  perform app.expire_reseller_payment_holds(p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;

  v_method := p_payload->>'fulfillmentMethod';
  v_address := nullif(btrim(coalesce(p_payload->>'deliveryAddress', '')), '');
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('lines', 'fulfillmentMethod', 'deliveryAddress', 'paymentPreference', 'notes'))
    or jsonb_typeof(p_payload->'lines') is distinct from 'array'
    or jsonb_array_length(p_payload->'lines') not between 1 and 100
    or coalesce(v_method, '') not in ('delivery', 'pickup')
    or (v_method = 'delivery' and (v_address is null or char_length(v_address) not between 5 and 500))
    or coalesce(p_payload->>'paymentPreference', '') not in ('gcash', 'bank_transfer')
    or char_length(coalesce(p_payload->>'notes', '')) > 1000
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null or nullif(p_request_id, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Order details are invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-order:submit:' || p_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.order_submit:' || v_account.id::text and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant, 'reseller_portal.order_submit:' || v_account.id::text, p_key, p_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;

  -- The customer lock serializes this credit decision with Back Office confirmations and fulfilments.
  select * into v_customer from app.customers where tenant_id = p_tenant and id = v_account.customer_id
    and status = 'active' and customer_type = 'reseller' for update;
  if not found then raise exception using errcode = 'HCRP1', message = 'Reseller access is not allowed'; end if;
  if not app.reseller_price_list_valid(p_tenant, v_account.customer_id, v_account.price_list_id) then
    raise exception using errcode = 'HCRP4', message = 'The reseller price list is unavailable';
  end if;
  if not exists (select 1 from app.locations where tenant_id = p_tenant and id = v_settings.fulfillment_location_id and is_active) then
    raise exception using errcode = 'HCRP2', message = 'The fulfillment branch is unavailable';
  end if;

  insert into app.reseller_order_counters (tenant_id, last_number) values (p_tenant, 1)
  on conflict (tenant_id) do update set last_number = app.reseller_order_counters.last_number + 1
  returning last_number into v_number;
  v_order_number := 'RP-' || lpad(v_number::text, 6, '0');
  while exists (select 1 from app.sales_orders where tenant_id = p_tenant and order_number = v_order_number::extensions.citext) loop
    update app.reseller_order_counters set last_number = last_number + 1 where tenant_id = p_tenant returning last_number into v_number;
    v_order_number := 'RP-' || lpad(v_number::text, 6, '0');
  end loop;

  insert into app.sales_orders (
    tenant_id, order_number, customer_id, location_id, price_list_id, pricing_type, status, source,
    customer_number_snapshot, customer_name_snapshot, notes, created_by_reseller_account_id,
    review_reason, fulfillment_method, delivery_address, payment_preference
  )
  select p_tenant, v_order_number, v_account.customer_id, v_settings.fulfillment_location_id, price_list.id,
    price_list.pricing_type, 'submitted', 'reseller_portal', v_customer.customer_number::text, v_customer.full_name,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_account.id, 'manual_review', v_method,
    case when v_method = 'delivery' then v_address end, p_payload->>'paymentPreference'
  from app.price_lists price_list where price_list.tenant_id = p_tenant and price_list.id = v_account.price_list_id
  returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    begin
      if jsonb_typeof(v_line) is distinct from 'object' or jsonb_typeof(v_line->'quantityMilli') is distinct from 'number' then
        raise invalid_text_representation;
      end if;
      v_quantity := (v_line->>'quantityMilli')::numeric;
      if v_quantity <> trunc(v_quantity) or v_quantity < 1 or v_quantity > 999999999999 then raise invalid_text_representation; end if;
      select variant.id variant_id, product.name product_name, variant.name variant_name, variant.sku::text sku,
        entry.pricing_group_id, entry.unit_price
      into v_entry from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      join app.price_list_entries entry on entry.tenant_id = variant.tenant_id and entry.variant_id = variant.id
        and entry.price_list_id = v_account.price_list_id
      where variant.tenant_id = p_tenant and variant.id = (v_line->>'variantId')::uuid and variant.is_active and product.status = 'active';
      if not found then raise exception using errcode = 'HCRP4', message = 'An order item is no longer available'; end if;
      -- Owner decision 2026-10-30: out-of-stock items cannot be ordered from the portal.
      if app.reseller_stock_status(p_tenant, v_settings.fulfillment_location_id, v_entry.variant_id) = 'out_of_stock' then
        raise exception using errcode = 'HCRP7', message = 'An order item is out of stock';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'HCRP3', message = 'Order details are invalid';
    end;
    begin
      insert into app.sales_order_lines (
        tenant_id, sales_order_id, variant_id, pricing_group_id, product_name_snapshot, variant_name_snapshot,
        sku_snapshot, ordered_quantity, unit_price, line_total
      ) values (
        p_tenant, v_order.id, v_entry.variant_id, v_entry.pricing_group_id, v_entry.product_name, v_entry.variant_name,
        v_entry.sku, v_quantity / 1000, v_entry.unit_price, round((v_quantity / 1000) * v_entry.unit_price, 2)
      );
    exception when unique_violation then
      raise exception using errcode = 'HCRP3', message = 'Each item may appear only once in an order';
    end;
    v_total := v_total + round((v_quantity / 1000) * v_entry.unit_price, 2);
    v_line_count := v_line_count + 1;
  end loop;

  if exists (
    select 1 from app.sales_order_lines line
    join app.pricing_groups pricing_group on pricing_group.tenant_id = line.tenant_id and pricing_group.id = line.pricing_group_id
    where line.tenant_id = p_tenant and line.sales_order_id = v_order.id
    group by pricing_group.id, pricing_group.threshold_quantity
    having sum(line.ordered_quantity) < pricing_group.threshold_quantity
  ) then raise exception using errcode = 'HCRP5', message = 'A wholesale minimum quantity has not been met'; end if;

  -- Pay first (owner decision 2026-10-30): every portal order holds its stock for four hours and waits
  -- for the reseller's payment proof. The team then verifies the payment and confirms in one step.
  for v_order_line in select * from app.sales_order_lines where tenant_id = p_tenant and sales_order_id = v_order.id
    order by variant_id loop
    select variant.track_inventory into v_tracked from app.product_variants variant
    where variant.tenant_id = p_tenant and variant.id = v_order_line.variant_id;
    if not v_tracked then continue; end if;
    select * into v_balance from app.inventory_balances where tenant_id = p_tenant
      and location_id = v_order.location_id and variant_id = v_order_line.variant_id for update;
    if not found or v_balance.on_hand - v_balance.reserved - v_balance.damaged < v_order_line.ordered_quantity then
      raise exception using errcode = 'HCRP8', message = 'Not enough stock for an order item';
    end if;
    update app.inventory_balances set reserved = reserved + v_order_line.ordered_quantity, version = version + 1, updated_at = now()
    where tenant_id = p_tenant and location_id = v_order.location_id and variant_id = v_order_line.variant_id;
    insert into app.sales_order_reservation_ledger (
      tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason, actor_reseller_account_id
    ) values (
      p_tenant, v_order.id, v_order_line.id, v_order.location_id, v_order_line.variant_id,
      v_order_line.ordered_quantity, 'payment_hold', v_account.id
    );
  end loop;
  v_reason := 'awaiting_payment';
  if v_method = 'delivery' and v_settings.shipping_fee > 0
    and (v_settings.free_shipping_minimum is null or v_total < v_settings.free_shipping_minimum) then
    v_ship := v_settings.shipping_fee;
  end if;
  update app.sales_orders set review_reason = v_reason, payment_due_at = now() + interval '4 hours',
    subtotal = v_total, shipping_fee = v_ship, total = v_total + v_ship
  where tenant_id = p_tenant and id = v_order.id
  returning payment_due_at into v_due;

  v_response := jsonb_build_object('salesOrderId', v_order.id, 'orderNumber', v_order_number,
    'status', 'submitted', 'reviewReason', v_reason, 'paymentDueAt', v_due,
    'lineCount', v_line_count, 'totalMinor', round((v_total + v_ship) * 100)::bigint,
    'shippingFeeMinor', round(v_ship * 100)::bigint);
  -- Portal actors are recorded as `system` with the reseller identity in metadata.
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id,
    'sales_order.submitted', 'sales_order', v_order.id,
    v_order.location_id, v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id,
      'customerNumber', v_customer.customer_number::text, 'source', 'reseller_portal', 'paymentHold', true));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'sales_order.submitted',
    'sales_order', v_order.id, v_response || jsonb_build_object('source', 'reseller_portal'));
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant and operation = 'reseller_portal.order_submit:' || v_account.id::text and idempotency_key = p_key;
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.fulfill_wholesale_order_inventory_core(p_actor_user_id uuid, p_tenant_id uuid, p_sales_order_id uuid, p_lines jsonb, p_idempotency_key text, p_request_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing app.idempotency_records%rowtype;
  v_order app.sales_orders%rowtype;
  v_order_line app.sales_order_lines%rowtype;
  v_balance app.inventory_balances%rowtype;
  v_item jsonb;
  v_quantity numeric(18,3);
  v_remaining numeric(18,3);
  v_subtotal numeric(18,2) := 0; v_ship numeric(18,2) := 0;
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

  -- The order's shipping fee is billed once, on its first invoice.
  if v_order.shipping_fee > 0 and not exists (select 1 from app.invoices i where i.tenant_id = p_tenant_id
    and i.sales_order_id = p_sales_order_id and i.shipping_fee > 0) then
    v_ship := v_order.shipping_fee;
  end if;
  insert into app.invoices (
    id, tenant_id, invoice_number, sales_order_id, sale_id, customer_id, location_id,
    order_number_snapshot, customer_number_snapshot, customer_name_snapshot, location_name_snapshot,
    subtotal, discount_total, tax_total, shipping_fee, total, issued_by, issued_at
  ) values (
    v_invoice_id, p_tenant_id, v_invoice_number, p_sales_order_id, v_sale_id,
    v_order.customer_id, v_order.location_id, v_order.order_number::text,
    v_order.customer_number_snapshot, v_order.customer_name_snapshot,
    (select name from app.locations where tenant_id = p_tenant_id and id = v_order.location_id),
    v_subtotal, 0, 0, v_ship, v_subtotal + v_ship, p_actor_user_id, v_issued_at
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
    'totalMinor', round((v_subtotal + v_ship) * 100)::bigint,
    'shippingFeeMinor', round(v_ship * 100)::bigint,
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
$function$;

-- Confirming keeps the shipping fee that was set when the reseller ordered.
CREATE OR REPLACE FUNCTION app.confirm_wholesale_order_inventory_core(p_actor_user_id uuid, p_tenant_id uuid, p_sales_order_id uuid, p_idempotency_key text, p_request_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    customer_name_snapshot = v_customer.full_name, subtotal = v_total, total = v_total + shipping_fee, confirmed_at = now()
  where tenant_id = p_tenant_id and id = p_sales_order_id;
  v_response := jsonb_build_object('salesOrderId', p_sales_order_id, 'status', 'confirmed',
    'reservedLineCount', (select count(*)::integer from app.sales_order_lines line
      where line.tenant_id = p_tenant_id and line.sales_order_id = p_sales_order_id),
    'totalMinor', round((v_total + v_order.shipping_fee) * 100)::bigint);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'sales_order.confirmed', 'sales_order', p_sales_order_id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'sales_order.confirmed', 'sales_order', p_sales_order_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'wholesale_order.confirm' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.post_wholesale_return(p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_invoice app.invoices%rowtype; v_sale app.sales%rowtype; v_line app.invoice_lines%rowtype;
 v_balance app.inventory_balances%rowtype; v_existing app.idempotency_records%rowtype;
 v_customer uuid; v_invoice_id uuid; v_item jsonb; v_line_id uuid; v_quantity numeric; v_line_credit numeric;
 v_valuations jsonb; v_line_payable numeric;
 v_prior_quantity numeric; v_prior_credit numeric; v_total numeric:=0; v_prior_total numeric;
 v_paid numeric; v_charge numeric; v_debt_before numeric; v_debt_after numeric; v_new_credit numeric;
 v_refund uuid:=gen_random_uuid(); v_note uuid:=gen_random_uuid(); v_response jsonb;
 v_returned_total numeric; v_cost numeric; v_whole numeric; v_effective_at timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 if not(p_payload ?& array['invoiceId','reason','lines'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('invoiceId','reason','lines'))
 or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or jsonb_typeof(p_payload->'lines') is distinct from 'array'
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 begin v_invoice_id:=(p_payload->>'invoiceId')::uuid;
 exception when invalid_text_representation then raise exception using errcode='HCWR1',message='Invalid return'; end;
 for v_item in select value from jsonb_array_elements(p_payload->'lines') loop
   if jsonb_typeof(v_item) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid return'; end if;
   if not(v_item ?& array['invoiceLineId','quantityMilli','returnToStock'])
   or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('invoiceLineId','quantityMilli','returnToStock'))
   or jsonb_typeof(v_item->'invoiceLineId') is distinct from 'string'
   or jsonb_typeof(v_item->'quantityMilli') is distinct from 'number'
   or jsonb_typeof(v_item->'returnToStock') is distinct from 'boolean'
   then raise exception using errcode='HCWR1',message='Invalid return'; end if;
   begin v_line_id:=(v_item->>'invoiceLineId')::uuid; v_whole:=(v_item->>'quantityMilli')::numeric;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCWR1',message='Invalid return'; end;
   if v_whole<1 or v_whole>9007199254740991 or trunc(v_whole)<>v_whole then raise exception using errcode='HCWR1',message='Positive integer milli-units required'; end if;
 end loop;
 if (select count(distinct(value->>'invoiceLineId')::uuid) from jsonb_array_elements(p_payload->'lines'))<>jsonb_array_length(p_payload->'lines')
 then raise exception using errcode='HCWR1',message='Duplicate return lines'; end if;
 select customer_id into v_customer from app.invoices where tenant_id=p_tenant and id=v_invoice_id;
 if not found then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
 -- Match the existing payment-command lock order: customer before invoice and inventory.
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 select * into v_invoice from app.invoices where tenant_id=p_tenant and id=v_invoice_id for update;
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_invoice.location_id)
 then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
 perform app.lock_wholesale_return_location(p_actor,p_tenant,v_invoice.location_id);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':wholesale-return:'||p_key,0));
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='wholesale_return.post' and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null or not exists(
     select 1 from app.wholesale_credit_notes where tenant_id=p_tenant and id=(v_existing.response_body->>'creditNoteId')::uuid
     and invoice_id=v_invoice.id and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 select * into v_sale from app.sales where tenant_id=p_tenant and id=v_invoice.sale_id for update;
 if v_sale.channel<>'wholesale' or v_sale.customer_id is distinct from v_invoice.customer_id or v_sale.location_id<>v_invoice.location_id
 or v_sale.status not in ('completed','partially_refunded') or v_sale.total<>v_invoice.total-v_invoice.shipping_fee
 then raise exception using errcode='HCWR3',message='Invoice sale cannot be returned'; end if;
 select jsonb_object_agg(invoice_line_id::text,jsonb_build_object('policy','header_gross_proportional_v1',
 'grossMinor',(gross*100)::bigint,'discountMinor',(discount*100)::bigint,'taxMinor',(tax*100)::bigint,'payableMinor',(payable*100)::bigint))
 into v_valuations from app.wholesale_return_line_valuations(p_tenant,v_invoice.id);
 if v_valuations is null then raise exception using errcode='HCWR3',message='Original invoice valuation requires reconciliation'; end if;
 select coalesce(sum(amount),0) into v_prior_total from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=v_invoice.id;
 if (select coalesce(sum(amount),0) from app.refunds where tenant_id=p_tenant and sale_id=v_sale.id)<>v_prior_total
 then raise exception using errcode='HCWR3',message='Commercial reversal history requires reconciliation'; end if;
 select coalesce((select amount from app.wholesale_receivable_charges where tenant_id=p_tenant and invoice_id=v_invoice.id),
 (select amount from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=v_invoice.id)) into v_charge;
 if v_charge is null or v_charge<>v_invoice.total then raise exception using errcode='HCWR3',message='Invoice classification requires reconciliation'; end if;
 for v_item in select value from jsonb_array_elements(p_payload->'lines') order by (value->>'invoiceLineId')::uuid loop
   select * into v_line from app.invoice_lines where tenant_id=p_tenant and invoice_id=v_invoice.id and id=(v_item->>'invoiceLineId')::uuid;
   if not found then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
   v_quantity:=(v_item->>'quantityMilli')::numeric/1000;
   v_line_payable:=(v_valuations->v_line.id::text->>'payableMinor')::numeric/100;
   select coalesce(sum(quantity),0),coalesce(sum(amount),0) into v_prior_quantity,v_prior_credit
   from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=v_line.id;
   if v_line.quantity*1000>9007199254740991 or v_line.unit_price*100>9007199254740991
   or v_line.unit_price<=0 or v_line.line_total<>round(v_line.quantity*v_line.unit_price,2)
   or v_line_payable is null or v_line_payable<=0 or v_prior_credit<>round(v_line_payable*v_prior_quantity/v_line.quantity,2)
   then raise exception using errcode='HCWR3',message='Original line valuation is unsupported'; end if;
   if v_quantity>v_line.quantity-v_prior_quantity then raise exception using errcode='HCWR4',message='Return exceeds remaining fulfilled quantity'; end if;
   if not exists(select 1 from app.sale_lines sl where sl.tenant_id=p_tenant and sl.id=v_line.sale_line_id and sl.sale_id=v_sale.id
     and sl.variant_id=v_line.variant_id and sl.quantity=v_line.quantity and sl.unit_price=v_line.unit_price and sl.line_total=v_line.line_total)
   then raise exception using errcode='HCWR3',message='Invoice and sale line snapshots disagree'; end if;
   v_line_credit:=round(v_line_payable*(v_prior_quantity+v_quantity)/v_line.quantity,2)-v_prior_credit;
   if v_line_credit<=0 then raise exception using errcode='HCWR4',message='Selected quantity has no refundable centavo'; end if;
   v_total:=v_total+v_line_credit;
 end loop;
 select coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=v_invoice.id),0)
  +coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=v_invoice.id),0) into v_paid;
 if v_total<=0 or v_total*100>9007199254740991 or v_prior_total+v_total>v_charge or v_paid>v_charge
 then raise exception using errcode='HCWR4',message='Credit exceeds remaining original invoice'; end if;
 v_debt_before:=greatest(v_charge-v_prior_total-v_paid,0); v_debt_after:=greatest(v_charge-v_prior_total-v_total-v_paid,0);
 v_new_credit:=greatest(v_paid-(v_charge-v_prior_total-v_total),0)-greatest(v_paid-(v_charge-v_prior_total),0);
 -- Acquire all stock locks before choosing the single effective time for this business event.
 perform 1 from app.inventory_balances b join app.invoice_lines l
 on l.tenant_id=b.tenant_id and l.variant_id=b.variant_id and l.invoice_id=v_invoice.id
 join jsonb_array_elements(p_payload->'lines') item on l.id=(item.value->>'invoiceLineId')::uuid
 where b.tenant_id=p_tenant and b.location_id=v_invoice.location_id and (item.value->>'returnToStock')::boolean
 order by b.variant_id,l.id for update of b;
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 v_effective_at:=clock_timestamp();
 insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by,completed_at,created_at)
 values(v_refund,p_tenant,v_sale.id,'refund',v_total,btrim(p_payload->>'reason'),p_actor,v_effective_at,v_effective_at);
 insert into app.wholesale_credit_notes(id,tenant_id,invoice_id,customer_id,refund_id,amount,debt_reduction,customer_credit,reason,request_body,recorded_by,recorded_at)
 values(v_note,p_tenant,v_invoice.id,v_customer,v_refund,v_total,v_debt_before-v_debt_after,v_new_credit,btrim(p_payload->>'reason'),p_payload,p_actor,v_effective_at);
 -- Stable variant ordering also serializes different invoices returning the same branch stock.
 for v_item in select item.value from jsonb_array_elements(p_payload->'lines') item
 join app.invoice_lines line on line.tenant_id=p_tenant and line.invoice_id=v_invoice.id and line.id=(item.value->>'invoiceLineId')::uuid
 order by line.variant_id,line.id loop
   select * into v_line from app.invoice_lines where tenant_id=p_tenant and id=(v_item->>'invoiceLineId')::uuid;
   v_quantity:=(v_item->>'quantityMilli')::numeric/1000;
   select coalesce(sum(quantity),0),coalesce(sum(amount),0) into v_prior_quantity,v_prior_credit from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=v_line.id;
   v_line_payable:=(v_valuations->v_line.id::text->>'payableMinor')::numeric/100;
   v_line_credit:=round(v_line_payable*(v_prior_quantity+v_quantity)/v_line.quantity,2)-v_prior_credit;
   insert into app.wholesale_credit_note_lines(tenant_id,credit_note_id,invoice_line_id,quantity,amount,return_to_stock,valuation_snapshot)
   values(p_tenant,v_note,v_line.id,v_quantity,v_line_credit,(v_item->>'returnToStock')::boolean,
     (v_valuations->v_line.id::text)||jsonb_build_object('originalQuantityMilli',(v_line.quantity*1000)::bigint));
   insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock,created_at)
   values(p_tenant,v_refund,v_line.sale_line_id,v_quantity,v_line_credit,(v_item->>'returnToStock')::boolean,v_effective_at);
   if (v_item->>'returnToStock')::boolean then
     select unit_cost into v_cost from app.sale_lines where tenant_id=p_tenant and id=v_line.sale_line_id;
     select * into v_balance from app.inventory_balances where tenant_id=p_tenant and location_id=v_invoice.location_id and variant_id=v_line.variant_id for update;
     if not found or v_balance.on_hand<0 or v_cost is null or (v_balance.on_hand>0 and v_balance.average_unit_cost is null)
     then raise exception using errcode='HCWR3',message='Return inventory requires reconciliation'; end if;
     update app.inventory_balances set on_hand=on_hand+v_quantity,
       average_unit_cost=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,v_cost)+v_quantity*v_cost)/(v_balance.on_hand+v_quantity),2),
       version=version+1,updated_at=v_effective_at
     where tenant_id=p_tenant and location_id=v_invoice.location_id and variant_id=v_line.variant_id;
     insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id,occurred_at,created_at)
     values(p_tenant,v_invoice.location_id,v_line.variant_id,'REFUND',v_quantity,v_cost,'wholesale_credit_note',v_note::text,p_actor,v_effective_at,v_effective_at);
   end if;
 end loop;
 if v_new_credit>0 then insert into app.wholesale_customer_credit_issues(tenant_id,credit_note_id,customer_id,amount,recorded_at)
 values(p_tenant,v_note,v_customer,v_new_credit,v_effective_at); end if;
 v_returned_total:=v_prior_total+v_total;
 update app.sales set status=case when v_returned_total=total then 'refunded' else 'partially_refunded' end where tenant_id=p_tenant and id=v_sale.id;
 v_response:=jsonb_build_object('creditNoteId',v_note,'invoiceId',v_invoice.id,'refundId',v_refund,'amountMinor',(v_total*100)::bigint,
 'debtReductionMinor',((v_debt_before-v_debt_after)*100)::bigint,'newCustomerCreditMinor',(v_new_credit*100)::bigint,
 'openDebtMinor',(v_debt_after*100)::bigint,'cashPayoutMinor',0);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_return.posted','wholesale_credit_note',v_note,v_invoice.location_id,btrim(p_payload->>'reason'),v_response,v_effective_at);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at)
 values(p_tenant,'wholesale_return.posted','wholesale_credit_note',v_note,v_response,v_effective_at,v_effective_at);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'wholesale_return.post',p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.wholesale_return_line_valuations(p_tenant uuid, p_invoice uuid)
 RETURNS TABLE(invoice_line_id uuid, gross numeric, discount numeric, tax numeric, payable numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_invoice app.invoices%rowtype; v_sale app.sales%rowtype;
begin
 select * into v_invoice from app.invoices where tenant_id=p_tenant and id=p_invoice;
 if not found then return; end if;
 select * into v_sale from app.sales where tenant_id=p_tenant and id=v_invoice.sale_id;
 if not found or v_sale.channel<>'wholesale' or v_sale.customer_id is distinct from v_invoice.customer_id
 or v_sale.location_id<>v_invoice.location_id or v_sale.subtotal<>v_invoice.subtotal
 or v_sale.discount_total<>v_invoice.discount_total or v_sale.tax_total<>v_invoice.tax_total or v_sale.total<>v_invoice.total-v_invoice.shipping_fee
 or v_invoice.subtotal<0 or v_invoice.discount_total>v_invoice.subtotal
 or greatest(v_invoice.total,v_invoice.subtotal,v_invoice.tax_total)*100>9007199254740991
 or v_invoice.subtotal<>(select coalesce(sum(l.line_total),0) from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=p_invoice)
 or exists(select 1 from app.invoice_lines l left join app.sale_lines sl on sl.tenant_id=l.tenant_id and sl.id=l.sale_line_id and sl.sale_id=v_sale.id
 where l.tenant_id=p_tenant and l.invoice_id=p_invoice and (sl.id is null or sl.variant_id<>l.variant_id or sl.quantity<>l.quantity
 or sl.unit_price<>l.unit_price or sl.line_total<>l.line_total or l.quantity*1000>9007199254740991
 or l.unit_price*100>9007199254740991 or l.line_total<>round(l.quantity*l.unit_price,2)))
 or (select count(*) from app.sale_lines where tenant_id=p_tenant and sale_id=v_sale.id)<>
 (select count(*) from app.invoice_lines where tenant_id=p_tenant and invoice_id=p_invoice)
 then return; end if;
 if v_invoice.subtotal=0 then
   if v_invoice.tax_total<>0 then return; end if;
   return query select l.id,l.line_total,0::numeric,0::numeric,l.line_total
   from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=p_invoice order by l.id;
   return;
 end if;
 return query with gross_lines as (
 select l.id,l.line_total,sum(l.line_total) over(order by l.id rows unbounded preceding) running
 from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=p_invoice
 ), allocated as (
 select id,line_total,
 round(v_invoice.discount_total*running/v_invoice.subtotal,2)-round(v_invoice.discount_total*(running-line_total)/v_invoice.subtotal,2) allocated_discount,
 round(v_invoice.tax_total*running/v_invoice.subtotal,2)-round(v_invoice.tax_total*(running-line_total)/v_invoice.subtotal,2) allocated_tax
 from gross_lines)
 select id,line_total,allocated_discount,allocated_tax,line_total-allocated_discount+allocated_tax from allocated order by id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Verified payment proofs can now be recorded across several invoices of one order: recorded_amount is the running
-- total recorded so far and wholesale_payment_id the first payment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.record_portal_proof_payments(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order app.sales_orders%rowtype; v_proof app.payment_proofs%rowtype; v_invoice record;
  v_left numeric; v_alloc numeric; v_allocations jsonb; v_allocated numeric; v_payment uuid := null; v_method_id uuid;
  v_method app.payment_methods%rowtype; v_digits text; v_total numeric := 0; v_item jsonb; v_response jsonb;
begin
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order;
  if not found or v_order.source <> 'reseller_portal'
    or not exists (select 1 from app.invoices where tenant_id = p_tenant and sales_order_id = p_order) then
    return 0;
  end if;
  -- Same lock order as wholesale payments: customer before invoices.
  perform 1 from app.customers where tenant_id = p_tenant and id = v_order.customer_id for update;
  for v_proof in
    select * from app.payment_proofs
    where tenant_id = p_tenant and sales_order_id = p_order and status = 'accepted' and coalesce(recorded_amount, 0) < amount
    order by reviewed_at, created_at, id for update
  loop
    v_left := v_proof.amount - coalesce(v_proof.recorded_amount, 0); v_allocations := '[]'::jsonb; v_allocated := 0;
    for v_invoice in
      select i.id, app.wholesale_invoice_open_balance(p_tenant, i.id) balance
      from app.invoices i where i.tenant_id = p_tenant and i.sales_order_id = p_order
      order by i.issued_at, i.id for update
    loop
      exit when v_left <= 0;
      if v_invoice.balance is null then
        raise exception using errcode = 'HCAP4', message = 'Invoice classification is required';
      end if;
      continue when v_invoice.balance <= 0;
      v_alloc := least(v_left, v_invoice.balance);
      v_allocations := v_allocations || jsonb_build_object('invoiceId', v_invoice.id, 'amount', v_alloc);
      v_left := v_left - v_alloc; v_allocated := v_allocated + v_alloc;
    end loop;
    continue when v_allocated <= 0;
    v_method_id := app.portal_payment_method(p_tenant, v_proof.method);
    if v_method_id is null then
      raise exception using errcode = 'HCRP9', message = 'An active payment method is required to record this payment';
    end if;
    select * into v_method from app.payment_methods where tenant_id = p_tenant and id = v_method_id;
    v_payment := gen_random_uuid();
    insert into app.wholesale_payments (id, tenant_id, customer_id, payment_method_id, amount, reference, recorded_by)
    values (v_payment, p_tenant, v_order.customer_id, v_method_id, v_allocated, left(btrim(v_proof.reference), 100), p_actor);
    v_digits := regexp_replace(v_proof.reference, '[^0-9]', '', 'g');
    if char_length(v_digits) >= 4 then
      insert into app.wholesale_payment_references (tenant_id, payment_id, reference_last_four, method_name_snapshot, method_type_snapshot)
      values (p_tenant, v_payment, right(v_digits, 4), v_method.name, v_method.method_type);
    end if;
    for v_item in select value from jsonb_array_elements(v_allocations) loop
      insert into app.wholesale_payment_allocations (tenant_id, payment_id, invoice_id, amount)
      values (p_tenant, v_payment, (v_item->>'invoiceId')::uuid, (v_item->>'amount')::numeric);
    end loop;
    update app.payment_proofs set wholesale_payment_id = coalesce(wholesale_payment_id, v_payment),
      recorded_amount = coalesce(recorded_amount, 0) + v_allocated
    where tenant_id = p_tenant and id = v_proof.id;
    v_response := jsonb_build_object('paymentId', v_payment, 'customerId', v_order.customer_id,
      'amountMinor', round(v_allocated * 100)::bigint, 'allocationCount', jsonb_array_length(v_allocations),
      'recordedAt', clock_timestamp());
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor, 'wholesale_payment.recorded', 'wholesale_payment', v_payment,
      v_order.location_id, v_response || jsonb_build_object('reference', v_proof.reference, 'source', 'reseller_portal',
        'paymentProofId', v_proof.id, 'salesOrderId', p_order, 'proofAmountMinor', round(v_proof.amount * 100)::bigint));
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (p_tenant, 'wholesale_payment.recorded', 'wholesale_payment', v_payment,
      v_response || jsonb_build_object('source', 'reseller_portal', 'paymentProofId', v_proof.id));
    v_total := v_total + v_allocated;
  end loop;
  return round(v_total * 100)::bigint;
end;
$function$;

CREATE OR REPLACE FUNCTION app.wholesale_verified_prepayments(p_tenant uuid, p_customer uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(least(paid.amount, remaining.amount)), 0)
  from app.sales_orders orders
  join lateral (select coalesce(sum(proof.amount - coalesce(proof.recorded_amount, 0)), 0) amount from app.payment_proofs proof
    where proof.tenant_id = orders.tenant_id and proof.sales_order_id = orders.id and proof.status = 'accepted') paid on true
  join lateral (select coalesce(sum(round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * line.unit_price, 2)), 0) amount
    from app.sales_order_lines line where line.tenant_id = orders.tenant_id and line.sales_order_id = orders.id) remaining on true
  where orders.tenant_id = p_tenant and orders.customer_id = p_customer and orders.source = 'reseller_portal'
    and orders.status in ('confirmed', 'partially_fulfilled');
$function$;

CREATE OR REPLACE FUNCTION app.load_reseller_statement(p_auth_user uuid, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_account app.reseller_accounts%rowtype; v_today date; v_since timestamptz := now() - interval '90 days';
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select (now() at time zone timezone)::date into v_today from app.tenants where id = p_tenant;
  return (
    with invoices as (
      select i.id, i.invoice_number::text invoice_number, i.issued_at, i.total, i.sales_order_id,
        o.order_number::text order_number, o.source, c.due_date,
        app.wholesale_invoice_open_balance(p_tenant, i.id) balance,
        coalesce((select sum(a.amount) from app.wholesale_payment_allocations a where a.tenant_id = i.tenant_id and a.invoice_id = i.id), 0) paid,
        coalesce((select sum(n.amount) from app.wholesale_credit_notes n where n.tenant_id = i.tenant_id and n.invoice_id = i.id), 0) credited
      from app.invoices i
      left join app.sales_orders o on o.tenant_id = i.tenant_id and o.id = i.sales_order_id
      left join app.wholesale_invoice_charges c on c.tenant_id = i.tenant_id and c.invoice_id = i.id
      where i.tenant_id = p_tenant and i.customer_id = v_account.customer_id
    ), shown as (
      select * from invoices where balance > 0 or issued_at > v_since
    ), not_invoiced as (
      select o.id, o.order_number::text order_number, o.confirmed_at,
        greatest(coalesce((select sum(round((l.ordered_quantity - l.fulfilled_quantity - l.cancelled_quantity) * l.unit_price, 2))
          from app.sales_order_lines l where l.tenant_id = o.tenant_id and l.sales_order_id = o.id), 0)
          + case when exists (select 1 from app.invoices i where i.tenant_id = o.tenant_id and i.sales_order_id = o.id
            and i.shipping_fee > 0) then 0 else o.shipping_fee end
          - coalesce((select sum(p.amount - coalesce(p.recorded_amount, 0)) from app.payment_proofs p
            where p.tenant_id = o.tenant_id and p.sales_order_id = o.id and p.status = 'accepted'), 0), 0) amount
      from app.sales_orders o
      where o.tenant_id = p_tenant and o.customer_id = v_account.customer_id and o.status in ('confirmed', 'partially_fulfilled')
    ), activity as (
      select 'invoice:' || i.id id, i.issued_at at, 'invoice' kind, 'Invoice ' || i.invoice_number::text ||
          coalesce(' · ' || o.order_number::text, '') label, i.total debit, 0::numeric credit
      from app.invoices i left join app.sales_orders o on o.tenant_id = i.tenant_id and o.id = i.sales_order_id
      where i.tenant_id = p_tenant and i.customer_id = v_account.customer_id and i.issued_at > v_since
      union all
      select 'payment:' || p.id, p.recorded_at, 'payment', 'Payment · ' || m.name || ' · ref ' || p.reference, 0, p.amount
      from app.wholesale_payments p join app.payment_methods m on m.tenant_id = p.tenant_id and m.id = p.payment_method_id
      where p.tenant_id = p_tenant and p.customer_id = v_account.customer_id and p.recorded_at > v_since
      union all
      select 'return:' || n.id, n.recorded_at, 'return', 'Return · ' || i.invoice_number::text || ' · ' || n.reason, 0, n.amount
      from app.wholesale_credit_notes n join app.invoices i on i.tenant_id = n.tenant_id and i.id = n.invoice_id
      where n.tenant_id = p_tenant and n.customer_id = v_account.customer_id and n.recorded_at > v_since
    )
    select jsonb_build_object(
      'asOf', v_today,
      'summary', jsonb_build_object(
        'outstandingMinor', (select round(coalesce(sum(balance) filter (where balance > 0), 0) * 100)::bigint from invoices),
        'overdueMinor', (select round(coalesce(sum(balance) filter (where balance > 0 and due_date < v_today), 0) * 100)::bigint from invoices),
        'notInvoicedMinor', (select round(coalesce(sum(amount), 0) * 100)::bigint from not_invoiced),
        'pendingProofsMinor', (select round(coalesce(sum(p.amount), 0) * 100)::bigint from app.payment_proofs p
          join app.sales_orders o on o.tenant_id = p.tenant_id and o.id = p.sales_order_id
          where p.tenant_id = p_tenant and o.customer_id = v_account.customer_id and p.status = 'pending'),
        'creditAvailableMinor', (select round(coalesce(sum(app.wholesale_credit_available(p_tenant, n.id)), 0) * 100)::bigint
          from app.wholesale_credit_notes n where n.tenant_id = p_tenant and n.customer_id = v_account.customer_id)),
      'points', (select jsonb_build_object(
          'balance', coalesce((select balance_points from app.loyalty_accounts where tenant_id = p_tenant and customer_id = v_account.customer_id), 0),
          'redeemValueMinor', case when coalesce((select enabled from app.loyalty_policies where tenant_id = p_tenant), false)
            then round(s.points_redeem_value * 100)::bigint end,
          'minimumPoints', s.points_min_redeem)
        from app.reseller_portal_settings s where s.tenant_id = p_tenant),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoiceId', id, 'invoiceNumber', invoice_number,
          'salesOrderId', case when source = 'reseller_portal' then sales_order_id end, 'orderNumber', order_number,
          'issuedAt', issued_at, 'dueDate', due_date, 'totalMinor', round(total * 100)::bigint,
          'paidMinor', round(paid * 100)::bigint, 'creditedMinor', round(credited * 100)::bigint,
          'balanceMinor', round(greatest(coalesce(balance, 0), 0) * 100)::bigint,
          'status', case when coalesce(balance, 0) <= 0 then 'paid' when due_date < v_today then 'overdue' else 'open' end,
          'daysOverdue', case when coalesce(balance, 0) > 0 and due_date < v_today then v_today - due_date else 0 end)
          order by (coalesce(balance, 0) > 0) desc, due_date nulls last, issued_at desc, id) from shown), '[]'::jsonb),
      'notInvoiced', coalesce((select jsonb_agg(jsonb_build_object('salesOrderId', id, 'orderNumber', order_number,
          'confirmedAt', confirmed_at, 'amountMinor', round(amount * 100)::bigint) order by confirmed_at, id)
          from not_invoiced where amount > 0), '[]'::jsonb),
      'activity', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', at, 'kind', kind, 'label', label,
          'debitMinor', round(debit * 100)::bigint, 'creditMinor', round(credit * 100)::bigint) order by at desc, id)
          from (select * from activity order by at desc, id limit 100) a), '[]'::jsonb)));
end;
$function$;

CREATE OR REPLACE FUNCTION app.load_reseller_portal_catalog(p_auth_user uuid, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype;
  v_credit app.wholesale_customer_credit_settings%rowtype; v_price_list app.price_lists%rowtype;
  v_exposure numeric;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  if not app.reseller_price_list_valid(p_tenant, v_account.customer_id, v_account.price_list_id) then
    raise exception using errcode = 'HCRP4', message = 'The reseller price list is unavailable';
  end if;
  select * into v_price_list from app.price_lists where tenant_id = p_tenant and id = v_account.price_list_id;
  select * into v_credit from app.wholesale_customer_credit_settings
  where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
  v_exposure := app.wholesale_customer_credit_exposure(p_tenant, v_account.customer_id);
  return jsonb_build_object(
    'branding', app.reseller_branding_json(p_tenant),
    'account', jsonb_build_object(
      'accountId', v_account.id, 'customerId', v_account.customer_id,
      'customerName', (select full_name from app.customers where tenant_id = p_tenant and id = v_account.customer_id),
      'businessName', (select name from app.tenants where id = p_tenant),
      'priceListName', v_price_list.name, 'pricingType', v_price_list.pricing_type,
      'paymentTerm', v_credit.payment_term,
      'creditLimitMinor', case when v_credit.id is null then null else round(v_credit.credit_limit * 100)::bigint end,
      'availableCreditMinor', case when v_credit.id is null then null
        else greatest(round((v_credit.credit_limit - v_exposure) * 100)::bigint, 0) end,
      'pointsBalance', coalesce((select balance_points from app.loyalty_accounts
        where tenant_id = p_tenant and customer_id = v_account.customer_id), 0)
    ),
    'shipping', jsonb_build_object('feeMinor', round(v_settings.shipping_fee * 100)::bigint,
      'freeAboveMinor', round(v_settings.free_shipping_minimum * 100)::bigint),
    'fulfillmentLocationName', (select name from app.locations where tenant_id = p_tenant and id = v_settings.fulfillment_location_id),
    'payment', jsonb_build_object('instructions', v_settings.payment_instructions, 'holdHours', 4,
      'accounts', app.reseller_payment_accounts_json(p_tenant, true)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variantId', variant.id, 'productId', product.id, 'productName', product.name, 'variantName', variant.name,
        'sku', variant.sku::text, 'categoryName', category.name,
        'unitPriceMinor', round(entry.unit_price * 100)::bigint, 'srpMinor', round(variant.retail_price * 100)::bigint,
        'pricingGroupId', pricing_group.id, 'pricingGroupName', pricing_group.name,
        'thresholdMilli', round(pricing_group.threshold_quantity * 1000)::bigint,
        'stockStatus', app.reseller_stock_status(p_tenant, v_settings.fulfillment_location_id, variant.id),
        'isNew', product.created_at > now() - interval '14 days',
        'isFavorite', exists (select 1 from app.reseller_favorites f where f.tenant_id = p_tenant
          and f.reseller_account_id = v_account.id and f.product_id = product.id),
        'notifyRequested', exists (select 1 from app.reseller_stock_alerts a where a.tenant_id = p_tenant
          and a.reseller_account_id = v_account.id and a.variant_id = variant.id and a.notified_at is null)
      ) order by product.name, variant.name, variant.id)
      from app.price_list_entries entry
      join app.product_variants variant on variant.tenant_id = entry.tenant_id and variant.id = entry.variant_id
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      join app.pricing_groups pricing_group on pricing_group.tenant_id = entry.tenant_id and pricing_group.id = entry.pricing_group_id
      left join app.product_categories category on category.tenant_id = product.tenant_id and category.id = product.category_id
      where entry.tenant_id = p_tenant and entry.price_list_id = v_account.price_list_id
        and variant.is_active and product.status = 'active'
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app.load_reseller_portal_admin(p_actor uuid, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_settings app.reseller_portal_settings%rowtype;
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  return jsonb_build_object(
    'branding', app.reseller_branding_json(p_tenant),
    'canManage', app.can_manage_reseller_portal(p_actor, p_tenant),
    'tenantSlug', (select slug::text from app.tenants where id = p_tenant),
    'settings', case when v_settings.tenant_id is null then null else jsonb_build_object(
      'fulfillmentLocationId', v_settings.fulfillment_location_id, 'defaultPriceListId', v_settings.default_price_list_id,
      'applicationsOpen', v_settings.applications_open, 'autoConfirm', v_settings.auto_confirm,
      'paymentInstructions', v_settings.payment_instructions,
      'pointsRedeemValueMinor', round(v_settings.points_redeem_value * 100)::bigint,
      'pointsMinRedeem', v_settings.points_min_redeem,
      'shippingFeeMinor', round(v_settings.shipping_fee * 100)::bigint,
      'freeShippingAboveMinor', round(v_settings.free_shipping_minimum * 100)::bigint,
      'updatedAt', v_settings.updated_at) end,
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name) order by l.name, l.id)
      from app.locations l where l.tenant_id = p_tenant and l.is_active), '[]'::jsonb),
    'priceLists', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'pricingType', p.pricing_type,
        'isDefault', p.is_default) order by p.name, p.id)
      from app.price_lists p where p.tenant_id = p_tenant and p.is_active), '[]'::jsonb),
    'resellerCustomers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'customerNumber', c.customer_number::text,
        'fullName', c.full_name, 'email', c.email::text) order by c.full_name, c.id)
      from app.customers c where c.tenant_id = p_tenant and c.status = 'active' and c.customer_type = 'reseller'
        and not exists (select 1 from app.reseller_accounts a where a.tenant_id = c.tenant_id and a.customer_id = c.id)), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'fullName', a.full_name,
        'businessName', a.business_name, 'email', a.email::text, 'phone', a.phone, 'city', a.city, 'message', a.message,
        'status', a.status, 'decisionReason', a.decision_reason, 'reviewedAt', a.reviewed_at, 'createdAt', a.created_at)
        order by (a.status = 'pending') desc, a.created_at desc, a.id)
      from (select * from app.reseller_applications where tenant_id = p_tenant
        order by (status = 'pending') desc, created_at desc limit 200) a), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'customerId', c.id, 'customerName', c.full_name,
        'customerNumber', c.customer_number::text, 'email', a.email::text, 'status', a.status,
        'priceListId', a.price_list_id, 'priceListName', p.name, 'activatedAt', a.activated_at, 'createdAt', a.created_at)
        order by c.full_name, a.id)
      from app.reseller_accounts a
      join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      join app.price_lists p on p.tenant_id = a.tenant_id and p.id = a.price_list_id
      where a.tenant_id = p_tenant), '[]'::jsonb),
    'reviewQueue', coalesce((select jsonb_agg(app.reseller_order_json(p_tenant, o.id) order by o.created_at, o.id)
      from app.sales_orders o where o.tenant_id = p_tenant and o.status = 'submitted'
        and o.review_reason <> 'awaiting_payment'), '[]'::jsonb),
    'paymentAccounts', app.reseller_payment_accounts_json(p_tenant, false),
    'shipments', coalesce((select jsonb_agg(app.portal_shipment_json(s.tenant_id, s.sales_order_id)
        order by s.created_at, s.sales_order_id)
      from app.sales_order_shipments s
      where s.tenant_id = p_tenant and (s.status <> 'delivered' or s.delivered_at > now() - interval '7 days')), '[]'::jsonb),
    'awaitingPayment', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'orderNumber', o.order_number::text,
        'customerName', coalesce(o.customer_name_snapshot, c.full_name), 'totalMinor', round(o.total * 100)::bigint,
        'createdAt', o.created_at, 'paymentDueAt', o.payment_due_at) order by o.payment_due_at, o.id)
      from app.sales_orders o join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = p_tenant and o.status = 'submitted' and o.review_reason = 'awaiting_payment'), '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Partial shipment: parcels
-- ---------------------------------------------------------------------------
create table app.portal_parcels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sales_order_id uuid not null,
  parcel_number integer not null check (parcel_number between 1 and 50),
  courier text not null check (courier in ('jnt', 'lalamove', 'other')),
  tracking_number text check (tracking_number is null or char_length(btrim(tracking_number)) between 3 and 80),
  note text check (note is null or char_length(btrim(note)) between 2 and 500),
  invoice_id uuid not null,
  shipped_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_by uuid not null,
  unique (tenant_id, id),
  unique (tenant_id, sales_order_id, parcel_number),
  unique (tenant_id, invoice_id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, invoice_id) references app.invoices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);
create table app.portal_parcel_lines (
  tenant_id uuid not null,
  parcel_id uuid not null,
  sales_order_line_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0),
  primary key (tenant_id, parcel_id, sales_order_line_id),
  foreign key (tenant_id, parcel_id) references app.portal_parcels (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sales_order_line_id) references app.sales_order_lines (tenant_id, id) on delete restrict
);
alter table app.portal_parcels enable row level security;
alter table app.portal_parcel_lines enable row level security;
revoke all on app.portal_parcels, app.portal_parcel_lines from public, anon, authenticated, hcs_hyperdrive;

-- Charges a portal invoice to the reseller with the order's credit-snapshot term (once per invoice).
create function app.charge_portal_invoice(p_actor uuid, p_tenant uuid, p_order uuid, p_invoice uuid, p_request_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_term text; v_invoice app.invoices%rowtype; v_due date;
begin
  if exists (select 1 from app.wholesale_invoice_charges where tenant_id = p_tenant and invoice_id = p_invoice) then return; end if;
  select payment_term into v_term from app.wholesale_order_credit_snapshots where tenant_id = p_tenant and sales_order_id = p_order;
  if v_term is null then raise exception using errcode = 'HCCR2', message = 'Explicit customer credit settings are required'; end if;
  select * into v_invoice from app.invoices where tenant_id = p_tenant and id = p_invoice;
  select (v_invoice.issued_at at time zone coalesce(l.timezone, t.timezone))::date
    + case v_term when 'net_7' then 7 when 'net_15' then 15 when 'net_30' then 30 else 0 end
    into v_due
  from app.locations l join app.tenants t on t.id = l.tenant_id
  where l.tenant_id = p_tenant and l.id = v_invoice.location_id;
  insert into app.wholesale_invoice_charges (tenant_id, invoice_id, customer_id, sales_order_id, amount, payment_term, due_date)
  values (p_tenant, v_invoice.id, v_invoice.customer_id, p_order, v_invoice.total, v_term, v_due);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'wholesale_receivable.charged', 'invoice', v_invoice.id,
    jsonb_build_object('amountMinor', round(v_invoice.total * 100)::bigint, 'dueDate', v_due, 'paymentTerm', v_term,
      'source', 'reseller_portal'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'wholesale_receivable.charged', 'invoice', v_invoice.id,
    jsonb_build_object('amountMinor', round(v_invoice.total * 100)::bigint, 'dueDate', v_due));
end;
$$;
revoke all on function app.charge_portal_invoice(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, hcs_hyperdrive;

CREATE OR REPLACE FUNCTION app.fulfill_portal_order(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order app.sales_orders%rowtype; v_term text; v_lines jsonb; v_fulfilled jsonb; v_invoice app.invoices%rowtype;
  v_due date; v_recorded bigint; v_points bigint;
begin
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  if not found or v_order.source <> 'reseller_portal' then
    raise exception using errcode = 'HCRA4', message = 'The order was not found';
  end if;
  if v_order.status in ('confirmed', 'partially_fulfilled') then
    select jsonb_agg(jsonb_build_object('salesOrderLineId', line.id,
        'quantityMilli', round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * 1000)::bigint)
        order by line.variant_id, line.id::text)
      into v_lines
    from app.sales_order_lines line
    where line.tenant_id = p_tenant and line.sales_order_id = p_order
      and line.ordered_quantity > line.fulfilled_quantity + line.cancelled_quantity;
    v_fulfilled := app.fulfill_wholesale_order_inventory_core(p_actor, p_tenant, p_order, coalesce(v_lines, '[]'::jsonb),
      'portal_fulfill_' || replace(p_order::text, '-', ''), 'portal-fulfill:' || p_order::text, p_request_id);
    perform app.charge_portal_invoice(p_actor, p_tenant, p_order, (v_fulfilled->>'invoiceId')::uuid, p_request_id);
  elsif v_order.status <> 'fulfilled' then
    raise exception using errcode = 'HCSQ6', message = 'Only confirmed orders with remaining quantity can be fulfilled';
  end if;
  v_points := app.award_portal_loyalty(p_actor, p_tenant, p_order, p_request_id);
  v_recorded := app.record_portal_proof_payments(p_actor, p_tenant, p_order, p_request_id);
  return jsonb_build_object(
    'invoiceNumber', (select invoice_number::text from app.invoices where tenant_id = p_tenant and sales_order_id = p_order
      order by issued_at desc, id limit 1),
    'recordedPaymentMinor', v_recorded,
    'pointsEarned', v_points,
    'balanceMinor', coalesce((select round(sum(app.wholesale_invoice_open_balance(p_tenant, i.id)) * 100)::bigint
      from app.invoices i where i.tenant_id = p_tenant and i.sales_order_id = p_order), 0));
end;
$function$;

-- Sends part of a delivery order now: the chosen quantities leave stock, get their own invoice, and verified
-- payments are recorded against it. At least one unit must stay for the last shipment.
create function app.ship_portal_parcel(p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order app.sales_orders%rowtype; v_shipment app.sales_order_shipments%rowtype; v_parcel uuid := gen_random_uuid();
  v_lines jsonb; v_fulfilled jsonb; v_number integer; v_response jsonb; v_left numeric;
  v_courier text := nullif(p_payload->>'courier', ''); v_tracking text := nullif(btrim(coalesce(p_payload->>'trackingNumber', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('lines', 'courier', 'trackingNumber', 'note'))
    or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100
    or exists (select 1 from jsonb_array_elements(p_payload->'lines') item where jsonb_typeof(item) is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('salesOrderLineId', 'quantityMilli'))
      or coalesce(item->>'salesOrderLineId', '') !~ '^[0-9a-f-]{36}$' or coalesce(item->>'quantityMilli', '') !~ '^[1-9][0-9]{0,14}$')
    or (select count(distinct item->>'salesOrderLineId') from jsonb_array_elements(p_payload->'lines') item)
      <> jsonb_array_length(p_payload->'lines')
    or coalesce(v_courier, '') not in ('jnt', 'lalamove', 'other')
    or (v_tracking is not null and char_length(v_tracking) not between 3 and 80)
    or (v_note is not null and char_length(v_note) not between 2 and 500) then
    raise exception using errcode = 'HCRP3', message = 'Parcel details are invalid';
  end if;
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  if not found or v_order.source <> 'reseller_portal' then
    raise exception using errcode = 'HCRA4', message = 'The order was not found';
  end if;
  select * into v_shipment from app.sales_order_shipments where tenant_id = p_tenant and sales_order_id = p_order for update;
  if v_order.status not in ('confirmed', 'partially_fulfilled') or v_shipment.method is distinct from 'delivery'
    or v_shipment.status not in ('to_pack', 'packed') then
    raise exception using errcode = 'HCRS1', message = 'Only delivery orders that are not shipped yet can be sent in parts';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'lines') item where not exists (select 1 from app.sales_order_lines l
    where l.tenant_id = p_tenant and l.sales_order_id = p_order and l.id = (item->>'salesOrderLineId')::uuid)) then
    raise exception using errcode = 'HCRP3', message = 'Parcel details are invalid';
  end if;
  select coalesce(sum(l.ordered_quantity - l.fulfilled_quantity - l.cancelled_quantity), 0)
    - coalesce((select sum((item->>'quantityMilli')::numeric / 1000) from jsonb_array_elements(p_payload->'lines') item), 0)
    into v_left
  from app.sales_order_lines l where l.tenant_id = p_tenant and l.sales_order_id = p_order;
  if v_left <= 0 then
    raise exception using errcode = 'HCRS2', message = 'Leave something for the last shipment, or ship the whole order';
  end if;
  select jsonb_agg(jsonb_build_object('salesOrderLineId', item->>'salesOrderLineId', 'quantityMilli', (item->>'quantityMilli')::bigint)
    order by item->>'salesOrderLineId') into v_lines
  from jsonb_array_elements(p_payload->'lines') item;
  v_fulfilled := app.fulfill_wholesale_order_inventory_core(p_actor, p_tenant, p_order, v_lines,
    'portal_parcel_' || replace(v_parcel::text, '-', ''), 'portal-parcel:' || v_parcel::text, p_request_id);
  perform app.charge_portal_invoice(p_actor, p_tenant, p_order, (v_fulfilled->>'invoiceId')::uuid, p_request_id);
  select coalesce(max(parcel_number), 0) + 1 into v_number from app.portal_parcels where tenant_id = p_tenant and sales_order_id = p_order;
  insert into app.portal_parcels (id, tenant_id, sales_order_id, parcel_number, courier, tracking_number, note, invoice_id, created_by)
  values (v_parcel, p_tenant, p_order, v_number, v_courier, v_tracking, v_note, (v_fulfilled->>'invoiceId')::uuid, p_actor);
  insert into app.portal_parcel_lines (tenant_id, parcel_id, sales_order_line_id, quantity)
  select p_tenant, v_parcel, (item->>'salesOrderLineId')::uuid, (item->>'quantityMilli')::numeric / 1000
  from jsonb_array_elements(p_payload->'lines') item;
  perform app.record_portal_proof_payments(p_actor, p_tenant, p_order, p_request_id);
  v_response := jsonb_build_object('salesOrderId', p_order, 'parcelId', v_parcel, 'parcelNumber', v_number,
    'invoiceNumber', v_fulfilled->>'invoiceNumber', 'totalMinor', (v_fulfilled->>'totalMinor')::bigint);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'sales_order.parcel_shipped', 'sales_order', p_order,
    v_response || jsonb_build_object('courier', v_courier, 'trackingNumber', v_tracking));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'sales_order.parcel_shipped', 'sales_order', p_order, v_response);
  return v_response;
end;
$$;
revoke all on function app.ship_portal_parcel(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.ship_portal_parcel(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;

create function app.deliver_portal_parcel(p_actor uuid, p_tenant uuid, p_parcel uuid, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_parcel app.portal_parcels%rowtype;
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  update app.portal_parcels set delivered_at = coalesce(delivered_at, now())
  where tenant_id = p_tenant and id = p_parcel returning * into v_parcel;
  if not found then raise exception using errcode = 'HCRA4', message = 'The parcel was not found'; end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'sales_order.parcel_delivered', 'sales_order', v_parcel.sales_order_id,
    jsonb_build_object('parcelId', v_parcel.id, 'parcelNumber', v_parcel.parcel_number));
  return jsonb_build_object('parcelId', v_parcel.id, 'deliveredAt', v_parcel.delivered_at);
end;
$$;
revoke all on function app.deliver_portal_parcel(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.deliver_portal_parcel(uuid, uuid, uuid, text) to hcs_hyperdrive;

create function app.portal_parcels_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('parcelId', p.id, 'parcelNumber', p.parcel_number, 'courier', p.courier,
      'trackingNumber', p.tracking_number, 'note', p.note, 'shippedAt', p.shipped_at, 'deliveredAt', p.delivered_at,
      'invoiceNumber', i.invoice_number::text,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('productName', l.product_name_snapshot,
          'variantName', l.variant_name_snapshot, 'quantityMilli', round(pl.quantity * 1000)::bigint)
          order by l.product_name_snapshot, l.variant_name_snapshot, l.id), '[]'::jsonb)
        from app.portal_parcel_lines pl join app.sales_order_lines l on l.tenant_id = pl.tenant_id and l.id = pl.sales_order_line_id
        where pl.tenant_id = p.tenant_id and pl.parcel_id = p.id)) order by p.parcel_number), '[]'::jsonb)
  from app.portal_parcels p join app.invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
  where p.tenant_id = p_tenant and p.sales_order_id = p_order;
$$;
revoke all on function app.portal_parcels_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

CREATE OR REPLACE FUNCTION app.update_portal_shipment(p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_response jsonb; v_status text;
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  -- Order before shipment, matching the confirmation path that creates shipments.
  perform 1 from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  v_response := app.update_portal_shipment_core(p_actor, p_tenant, p_order, p_payload, p_request_id);
  select status into v_status from app.sales_orders where tenant_id = p_tenant and id = p_order;
  if v_response->>'status' in ('shipped', 'delivered') and v_status in ('confirmed', 'partially_fulfilled', 'fulfilled') then
    v_response := v_response || app.fulfill_portal_order(p_actor, p_tenant, p_order, p_request_id);
  end if;
  -- Delivering the last shipment also marks earlier parcels delivered.
  if v_response->>'status' = 'delivered' then
    update app.portal_parcels set delivered_at = now()
    where tenant_id = p_tenant and sales_order_id = p_order and delivered_at is null;
  end if;
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.portal_shipment_json(p_tenant uuid, p_order uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'salesOrderId', o.id, 'orderNumber', o.order_number::text,
    'customerName', coalesce(o.customer_name_snapshot, c.full_name), 'customerPhone', c.phone,
    'method', s.method, 'status', s.status, 'courier', s.courier, 'trackingNumber', s.tracking_number, 'note', s.note,
    'deliveryAddress', o.delivery_address, 'locationName', l.name, 'totalMinor', round(o.total * 100)::bigint,
    'confirmedAt', o.confirmed_at, 'packedAt', s.packed_at, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at,
    'invoiceId', (select i.id from app.invoices i where i.tenant_id = o.tenant_id
      and i.sales_order_id = o.id order by i.issued_at desc, i.id limit 1),
    'invoiceNumber', (select i.invoice_number::text from app.invoices i where i.tenant_id = o.tenant_id
      and i.sales_order_id = o.id order by i.issued_at desc, i.id limit 1),
    'balanceMinor', (select round(sum(app.wholesale_invoice_open_balance(o.tenant_id, i.id)) * 100)::bigint
      from app.invoices i where i.tenant_id = o.tenant_id and i.sales_order_id = o.id),
    'shippingFeeMinor', round(o.shipping_fee * 100)::bigint,
    'parcels', app.portal_parcels_json(o.tenant_id, o.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('salesOrderLineId', line.id, 'productName', line.product_name_snapshot,
        'variantName', line.variant_name_snapshot, 'sku', line.sku_snapshot,
        'quantityMilli', round((line.ordered_quantity - line.cancelled_quantity) * 1000)::bigint,
        'remainingMilli', round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * 1000)::bigint)
        order by line.product_name_snapshot, line.variant_name_snapshot, line.id)
      from app.sales_order_lines line where line.tenant_id = o.tenant_id and line.sales_order_id = o.id), '[]'::jsonb))
  from app.sales_order_shipments s
  join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
  join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
  join app.locations l on l.tenant_id = o.tenant_id and l.id = o.location_id
  where s.tenant_id = p_tenant and s.sales_order_id = p_order;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Printable invoice
-- ---------------------------------------------------------------------------
create function app.load_reseller_invoice(p_auth_user uuid, p_tenant uuid, p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_invoice app.invoices%rowtype; v_balance numeric; v_today date;
  v_charge app.wholesale_invoice_charges%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_invoice from app.invoices where tenant_id = p_tenant and id = p_invoice and customer_id = v_account.customer_id;
  if not found then raise exception using errcode = 'HCRI1', message = 'The invoice was not found'; end if;
  select * into v_charge from app.wholesale_invoice_charges where tenant_id = p_tenant and invoice_id = p_invoice;
  select (now() at time zone timezone)::date into v_today from app.tenants where id = p_tenant;
  v_balance := greatest(coalesce(app.wholesale_invoice_open_balance(p_tenant, p_invoice), 0), 0);
  return jsonb_build_object(
    'branding', app.reseller_branding_json(p_tenant),
    'businessName', (select name from app.tenants where id = p_tenant),
    'invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number::text, 'issuedAt', v_invoice.issued_at,
    'orderNumber', v_invoice.order_number_snapshot, 'customerName', v_invoice.customer_name_snapshot,
    'customerNumber', v_invoice.customer_number_snapshot, 'locationName', v_invoice.location_name_snapshot,
    'paymentTerm', v_charge.payment_term, 'dueDate', v_charge.due_date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('productName', l.product_name, 'variantName', l.variant_name,
        'sku', l.sku, 'quantityMilli', round(l.quantity * 1000)::bigint, 'unitPriceMinor', round(l.unit_price * 100)::bigint,
        'lineTotalMinor', round(l.line_total * 100)::bigint) order by l.product_name, l.variant_name, l.id)
      from app.invoice_lines l where l.tenant_id = p_tenant and l.invoice_id = p_invoice), '[]'::jsonb),
    'subtotalMinor', round(v_invoice.subtotal * 100)::bigint, 'discountMinor', round(v_invoice.discount_total * 100)::bigint,
    'taxMinor', round(v_invoice.tax_total * 100)::bigint, 'shippingFeeMinor', round(v_invoice.shipping_fee * 100)::bigint,
    'totalMinor', round(v_invoice.total * 100)::bigint,
    'settlements', coalesce((select jsonb_agg(s order by s->>'at', s->>'label') from (
        select jsonb_build_object('at', p.recorded_at, 'label', m.name || coalesce(' · ref ' || p.reference, ''),
          'amountMinor', round(a.amount * 100)::bigint) s
        from app.wholesale_payment_allocations a
        join app.wholesale_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
        join app.payment_methods m on m.tenant_id = p.tenant_id and m.id = p.payment_method_id
        where a.tenant_id = p_tenant and a.invoice_id = p_invoice
        union all
        select jsonb_build_object('at', n.recorded_at, 'label', 'Return · ' || n.reason, 'amountMinor', round(n.amount * 100)::bigint)
        from app.wholesale_credit_notes n where n.tenant_id = p_tenant and n.invoice_id = p_invoice
        union all
        select jsonb_build_object('at', c.recorded_at, 'label', 'Credit applied', 'amountMinor', round(c.amount * 100)::bigint)
        from app.wholesale_credit_applications c where c.tenant_id = p_tenant and c.invoice_id = p_invoice) x), '[]'::jsonb),
    'balanceMinor', round(v_balance * 100)::bigint,
    'status', case when v_charge.id is null then 'open' when v_balance <= 0 then 'paid'
      when v_charge.due_date < v_today then 'overdue' else 'open' end);
end;
$$;
revoke all on function app.load_reseller_invoice(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_invoice(uuid, uuid, uuid) to hcs_hyperdrive;

-- ---------------------------------------------------------------------------
-- 4. Return requests from resellers
-- ---------------------------------------------------------------------------
alter table app.files drop constraint files_kind_check;
alter table app.files add constraint files_kind_check check (kind in ('product_image', 'payment_proof', 'payment_qr', 'brand_logo', 'return_photo'));
alter table app.files add constraint files_return_photo_shape check (kind <> 'return_photo'
  or (mime_type in ('image/jpeg', 'image/png', 'image/webp') and uploaded_by_reseller_account_id is not null));

create table app.reseller_return_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  reseller_account_id uuid not null,
  invoice_id uuid not null,
  sales_order_id uuid,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 2 and 500),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint reseller_return_requests_decided check ((status = 'pending') = (decided_at is null) and (status = 'pending') = (decided_by is null)),
  constraint reseller_return_requests_decline_reason check (status <> 'declined' or decision_reason is not null),
  foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, invoice_id) references app.invoices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, decided_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);
create unique index reseller_return_requests_pending_idx on app.reseller_return_requests (tenant_id, invoice_id) where status = 'pending';
create index reseller_return_requests_recent_idx on app.reseller_return_requests (tenant_id, created_at desc);
create table app.reseller_return_request_lines (
  tenant_id uuid not null,
  request_id uuid not null,
  invoice_line_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0),
  primary key (tenant_id, request_id, invoice_line_id),
  foreign key (tenant_id, request_id) references app.reseller_return_requests (tenant_id, id) on delete restrict,
  foreign key (tenant_id, invoice_line_id) references app.invoice_lines (tenant_id, id) on delete restrict
);
create table app.reseller_return_request_photos (
  tenant_id uuid not null,
  request_id uuid not null,
  file_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, request_id, file_id),
  foreign key (tenant_id, request_id) references app.reseller_return_requests (tenant_id, id) on delete restrict,
  foreign key (tenant_id, file_id) references app.files (tenant_id, id) on delete restrict
);
alter table app.reseller_return_requests enable row level security;
alter table app.reseller_return_request_lines enable row level security;
alter table app.reseller_return_request_photos enable row level security;
revoke all on app.reseller_return_requests, app.reseller_return_request_lines, app.reseller_return_request_photos
  from public, anon, authenticated, hcs_hyperdrive;

-- Quantity of an invoice line that can still be asked back: invoiced, less recorded returns and pending requests.
create function app.reseller_returnable_quantity(p_tenant uuid, p_invoice_line uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(l.quantity
    - coalesce((select sum(nl.quantity) from app.wholesale_credit_note_lines nl where nl.tenant_id = l.tenant_id and nl.invoice_line_id = l.id), 0)
    - coalesce((select sum(rl.quantity) from app.reseller_return_request_lines rl
        join app.reseller_return_requests r on r.tenant_id = rl.tenant_id and r.id = rl.request_id
        where rl.tenant_id = l.tenant_id and rl.invoice_line_id = l.id and r.status = 'pending'), 0), 0)
  from app.invoice_lines l where l.tenant_id = p_tenant and l.id = p_invoice_line;
$$;
revoke all on function app.reseller_returnable_quantity(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.submit_reseller_return_request(p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_invoice app.invoices%rowtype; v_existing app.idempotency_records%rowtype;
  v_request uuid; v_item jsonb; v_response jsonb;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
    or jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('invoiceId', 'reason', 'lines'))
    or coalesce(p_payload->>'invoiceId', '') !~ '^[0-9a-f-]{36}$'
    or char_length(btrim(coalesce(p_payload->>'reason', ''))) not between 5 and 500
    or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100
    or exists (select 1 from jsonb_array_elements(p_payload->'lines') item where jsonb_typeof(item) is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('invoiceLineId', 'quantityMilli'))
      or coalesce(item->>'invoiceLineId', '') !~ '^[0-9a-f-]{36}$' or coalesce(item->>'quantityMilli', '') !~ '^[1-9][0-9]{0,14}$')
    or (select count(distinct item->>'invoiceLineId') from jsonb_array_elements(p_payload->'lines') item)
      <> jsonb_array_length(p_payload->'lines') then
    raise exception using errcode = 'HCRP3', message = 'Return request details are invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':return-requests:' || (p_payload->>'invoiceId'), 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.return_request:' || v_account.id::text and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  select * into v_invoice from app.invoices where tenant_id = p_tenant and id = (p_payload->>'invoiceId')::uuid
    and customer_id = v_account.customer_id;
  if not found then raise exception using errcode = 'HCRI1', message = 'The invoice was not found'; end if;
  if exists (select 1 from app.reseller_return_requests where tenant_id = p_tenant and invoice_id = v_invoice.id and status = 'pending') then
    raise exception using errcode = 'HCRR1', message = 'A return request for this invoice is waiting for review';
  end if;
  for v_item in select value from jsonb_array_elements(p_payload->'lines') loop
    if not exists (select 1 from app.invoice_lines l where l.tenant_id = p_tenant and l.invoice_id = v_invoice.id
        and l.id = (v_item->>'invoiceLineId')::uuid)
      or (v_item->>'quantityMilli')::numeric / 1000 > app.reseller_returnable_quantity(p_tenant, (v_item->>'invoiceLineId')::uuid) then
      raise exception using errcode = 'HCRR2', message = 'That is more than you can return for an item';
    end if;
  end loop;
  insert into app.reseller_return_requests (tenant_id, reseller_account_id, invoice_id, sales_order_id, reason)
  values (p_tenant, v_account.id, v_invoice.id, v_invoice.sales_order_id, btrim(p_payload->>'reason'))
  returning id into v_request;
  insert into app.reseller_return_request_lines (tenant_id, request_id, invoice_line_id, quantity)
  select p_tenant, v_request, (item->>'invoiceLineId')::uuid, (item->>'quantityMilli')::numeric / 1000
  from jsonb_array_elements(p_payload->'lines') item;
  v_response := jsonb_build_object('requestId', v_request, 'status', 'pending', 'invoiceNumber', v_invoice.invoice_number::text);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id, 'return_request.submitted', 'invoice', v_invoice.id,
    v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'return_request.submitted', 'invoice', v_invoice.id, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.return_request:' || v_account.id::text, p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;
revoke all on function app.submit_reseller_return_request(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function app.submit_reseller_return_request(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

create function app.assert_return_photo_upload(p_auth_user uuid, p_tenant uuid, p_request uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_status text;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select status into v_status from app.reseller_return_requests where tenant_id = p_tenant and id = p_request
    and reseller_account_id = v_account.id;
  if not found then raise exception using errcode = 'HCRR3', message = 'The return request was not found'; end if;
  if v_status <> 'pending' then raise exception using errcode = 'HCRR5', message = 'This return request was already reviewed'; end if;
  if (select count(*) from app.reseller_return_request_photos where tenant_id = p_tenant and request_id = p_request) >= 4 then
    raise exception using errcode = 'HCRR4', message = 'Up to 4 photos can be added';
  end if;
end;
$$;
revoke all on function app.assert_return_photo_upload(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.assert_return_photo_upload(uuid, uuid, uuid) to hcs_hyperdrive;

create function app.record_return_photo(p_auth_user uuid, p_tenant uuid, p_request uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_existing app.idempotency_records%rowtype; v_file uuid; v_response jsonb;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null then
    raise exception using errcode = 'HCFL2', message = 'Photo details are invalid';
  end if;
  perform app.validate_file_payload(p_payload, 5242880, false);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':return-photos:' || p_request::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.return_photo:' || v_account.id::text and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  perform app.assert_return_photo_upload(p_auth_user, p_tenant, p_request);
  if p_payload->>'mimeType' not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = 'HCFL2', message = 'Photo details are invalid';
  end if;
  v_file := (p_payload->>'fileId')::uuid;
  insert into app.files (id, tenant_id, kind, storage_key, thumb_storage_key, mime_type, size_bytes, thumb_size_bytes,
    sha256, original_filename, uploaded_by_reseller_account_id)
  values (v_file, p_tenant, 'return_photo', 't/' || p_tenant || '/return_photo/' || v_file || '/main',
    case when p_payload ? 'thumbSizeBytes' then 't/' || p_tenant || '/return_photo/' || v_file || '/thumb' end,
    p_payload->>'mimeType', (p_payload->>'sizeBytes')::integer, (p_payload->>'thumbSizeBytes')::integer,
    p_payload->>'sha256', btrim(p_payload->>'originalFilename'), v_account.id);
  insert into app.reseller_return_request_photos (tenant_id, request_id, file_id) values (p_tenant, p_request, v_file);
  v_response := jsonb_build_object('requestId', p_request, 'fileId', v_file,
    'photoCount', (select count(*) from app.reseller_return_request_photos where tenant_id = p_tenant and request_id = p_request));
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.return_photo:' || v_account.id::text, p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;
revoke all on function app.record_return_photo(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function app.record_return_photo(uuid, uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

create function app.return_request_json(p_tenant uuid, p_request uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('requestId', r.id, 'status', r.status, 'reason', r.reason, 'decisionReason', r.decision_reason,
    'createdAt', r.created_at, 'decidedAt', r.decided_at, 'invoiceId', r.invoice_id, 'invoiceNumber', i.invoice_number::text,
    'salesOrderId', r.sales_order_id, 'orderNumber', i.order_number_snapshot, 'customerName', i.customer_name_snapshot,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('invoiceLineId', l.id, 'productName', l.product_name,
        'variantName', l.variant_name, 'quantityMilli', round(rl.quantity * 1000)::bigint) order by l.product_name, l.variant_name, l.id), '[]'::jsonb)
      from app.reseller_return_request_lines rl join app.invoice_lines l on l.tenant_id = rl.tenant_id and l.id = rl.invoice_line_id
      where rl.tenant_id = r.tenant_id and rl.request_id = r.id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('storageKey', f.storage_key, 'thumbStorageKey', f.thumb_storage_key)
        order by p.created_at, f.id), '[]'::jsonb)
      from app.reseller_return_request_photos p join app.files f on f.tenant_id = p.tenant_id and f.id = p.file_id
      where p.tenant_id = r.tenant_id and p.request_id = r.id and f.status = 'active'))
  from app.reseller_return_requests r join app.invoices i on i.tenant_id = r.tenant_id and i.id = r.invoice_id
  where r.tenant_id = p_tenant and r.id = p_request;
$$;
revoke all on function app.return_request_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Back Office: pending requests and those decided in the last 30 days.
create function app.load_reseller_return_requests(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  return jsonb_build_object('requests', coalesce((select jsonb_agg(app.return_request_json(p_tenant, r.id)
      order by (r.status = 'pending') desc, r.created_at desc, r.id)
    from app.reseller_return_requests r where r.tenant_id = p_tenant
      and (r.status = 'pending' or r.decided_at > now() - interval '30 days')), '[]'::jsonb));
end;
$$;
revoke all on function app.load_reseller_return_requests(uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_return_requests(uuid, uuid) to hcs_hyperdrive;

create function app.decide_reseller_return_request(p_actor uuid, p_tenant uuid, p_request uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), ''); v_status text;
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('decision', 'reason'))
    or coalesce(p_payload->>'decision', '') not in ('approve', 'decline')
    or (p_payload->>'decision' = 'decline' and v_reason is null)
    or (v_reason is not null and char_length(v_reason) not between 2 and 500) then
    raise exception using errcode = 'HCRP3', message = 'Return decision is invalid';
  end if;
  v_status := case p_payload->>'decision' when 'approve' then 'approved' else 'declined' end;
  update app.reseller_return_requests set status = v_status, decision_reason = v_reason, decided_by = p_actor, decided_at = now()
  where tenant_id = p_tenant and id = p_request and status = 'pending';
  if not found then
    if exists (select 1 from app.reseller_return_requests where tenant_id = p_tenant and id = p_request) then
      raise exception using errcode = 'HCRA5', message = 'This return request was already reviewed';
    end if;
    raise exception using errcode = 'HCRA4', message = 'The return request was not found';
  end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'return_request.' || v_status, 'return_request', p_request,
    jsonb_build_object('reason', v_reason));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'return_request.' || v_status, 'return_request', p_request, jsonb_build_object('status', v_status));
  return app.return_request_json(p_tenant, p_request);
end;
$$;
revoke all on function app.decide_reseller_return_request(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.decide_reseller_return_request(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table app.reseller_notifications drop constraint reseller_notifications_kind_check;
alter table app.reseller_notifications add constraint reseller_notifications_kind_check check (kind in (
  'order_confirmed', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'payment_verified', 'payment_rejected',
  'order_expired', 'order_rejected', 'return_recorded', 'payment_due_soon', 'payment_overdue', 'payment_window_closing',
  'back_in_stock', 'parcel_shipped', 'return_request_approved', 'return_request_declined'));

create function app.sync_reseller_operations_notifications(p_tenant uuid, p_account uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_customer uuid; v_since timestamptz := now() - interval '30 days';
begin
  select customer_id into v_customer from app.reseller_accounts where tenant_id = p_tenant and id = p_account;
  insert into app.reseller_notifications (tenant_id, reseller_account_id, sales_order_id, kind, title, message, dedup_key, created_at)
  select p_tenant, p_account, e.order_id, e.kind, e.title, e.message, e.dedup_key, e.at
  from (
    select o.id order_id, 'parcel_shipped' kind, 'Part of order ' || o.order_number::text || ' is on the way' title,
      'Parcel ' || p.parcel_number || ' shipped by '
        || case p.courier when 'jnt' then 'J&T Express' when 'lalamove' then 'Lalamove' else 'courier' end
        || coalesce(' · tracking ' || p.tracking_number, '') || '. The rest of your order follows.' message,
      'parcel:' || p.id::text || ':shipped' dedup_key, p.shipped_at at
    from app.portal_parcels p join app.sales_orders o on o.tenant_id = p.tenant_id and o.id = p.sales_order_id
    where p.tenant_id = p_tenant and o.customer_id = v_customer and p.shipped_at > v_since
    union all
    select r.sales_order_id, 'return_request_' || r.status,
      'Return request for ' || i.invoice_number::text || case r.status when 'approved' then ' approved' else ' declined' end,
      case r.status when 'approved' then 'We will record the return once we receive the items.'
        else r.decision_reason end,
      'return-request:' || r.id::text || ':' || r.status, r.decided_at
    from app.reseller_return_requests r join app.invoices i on i.tenant_id = r.tenant_id and i.id = r.invoice_id
    where r.tenant_id = p_tenant and r.reseller_account_id = p_account and r.status in ('approved', 'declined')
      and r.decided_at > v_since
  ) e
  where e.at is not null
  on conflict (tenant_id, reseller_account_id, dedup_key) do nothing;
end;
$$;
revoke all on function app.sync_reseller_operations_notifications(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

CREATE OR REPLACE FUNCTION app.sync_reseller_notifications(p_tenant uuid, p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_customer uuid; v_since timestamptz := now() - interval '30 days'; v_today date;
begin
  select customer_id into v_customer from app.reseller_accounts where tenant_id = p_tenant and id = p_account;
  select (now() at time zone timezone)::date into v_today from app.tenants where id = p_tenant;
  insert into app.reseller_notifications (tenant_id, reseller_account_id, sales_order_id, kind, title, message, dedup_key, created_at)
  select p_tenant, p_account, e.order_id, e.kind, e.title, e.message, e.dedup_key, e.at
  from (
    -- Confirmed
    select o.id order_id, 'order_confirmed' kind, 'Order ' || o.order_number::text || ' confirmed' title,
      'Your payment was verified. We are packing your order.' message,
      'order:' || o.id::text || ':confirmed' dedup_key, o.confirmed_at at
    from app.sales_orders o
    where o.tenant_id = p_tenant and o.customer_id = v_customer and o.source = 'reseller_portal'
      and o.confirmed_at > v_since
    union all
    -- Ready for pickup
    select o.id, 'ready_for_pickup', 'Order ' || o.order_number::text || ' is ready for pickup',
      'Pick it up at ' || l.name || '.', 'order:' || o.id::text || ':ready', s.packed_at
    from app.sales_order_shipments s
    join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
    join app.locations l on l.tenant_id = o.tenant_id and l.id = o.location_id
    where s.tenant_id = p_tenant and o.customer_id = v_customer and s.method = 'pickup' and s.packed_at > v_since
    union all
    -- Shipped
    select o.id, 'shipped', 'Order ' || o.order_number::text || ' is on the way',
      'Shipped by ' || case s.courier when 'jnt' then 'J&T Express' when 'lalamove' then 'Lalamove' else 'courier' end
        || coalesce(' · tracking ' || s.tracking_number, '') || '.',
      'order:' || o.id::text || ':shipped', s.shipped_at
    from app.sales_order_shipments s
    join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
    where s.tenant_id = p_tenant and o.customer_id = v_customer and s.shipped_at > v_since
    union all
    -- Delivered or picked up
    select o.id, case s.method when 'pickup' then 'picked_up' else 'delivered' end,
      'Order ' || o.order_number::text || case s.method when 'pickup' then ' picked up' else ' delivered' end,
      'Thank you! ' || case when exists (select 1 from app.invoices i where i.tenant_id = o.tenant_id and i.sales_order_id = o.id
          and app.wholesale_invoice_open_balance(o.tenant_id, i.id) > 0)
        then 'There is still a balance to pay on this order.' else 'This order is complete.' end,
      'order:' || o.id::text || ':delivered', s.delivered_at
    from app.sales_order_shipments s
    join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
    where s.tenant_id = p_tenant and o.customer_id = v_customer and s.delivered_at > v_since
    union all
    -- Payments verified on their own in Balance payments (a payment verified with the order is covered by "confirmed")
    select o.id, 'payment_verified', 'Payment verified for ' || o.order_number::text,
      'We received your ' || to_char(p.amount, 'FM"₱"999,999,999,990.00') || ' payment (ref ' || p.reference || ').',
      'proof:' || p.id::text || ':accepted', p.reviewed_at
    from app.payment_proofs p
    join app.sales_orders o on o.tenant_id = p.tenant_id and o.id = p.sales_order_id
    where p.tenant_id = p_tenant and o.customer_id = v_customer and p.status = 'accepted' and p.reviewed_at > v_since
      and exists (select 1 from audit.audit_events e where e.tenant_id = o.tenant_id and e.entity_type = 'sales_order'
        and e.entity_id = o.id and e.action = 'payment_proof.accepted' and e.metadata->>'proofId' = p.id::text)
    union all
    -- Payment not accepted
    select o.id, 'payment_rejected', 'Payment for ' || o.order_number::text || ' was not accepted',
      coalesce(p.review_reason, 'Please check the payment details and send it again.'),
      'proof:' || p.id::text || ':rejected', p.reviewed_at
    from app.payment_proofs p
    join app.sales_orders o on o.tenant_id = p.tenant_id and o.id = p.sales_order_id
    where p.tenant_id = p_tenant and o.customer_id = v_customer and p.status = 'rejected' and p.reviewed_at > v_since
      and o.status <> 'cancelled'
    union all
    -- Cancelled: expired or not accepted
    select o.id,
      case when expired.id is not null then 'order_expired' else 'order_rejected' end,
      'Order ' || o.order_number::text || case when expired.id is not null then ' was cancelled' else ' was not accepted' end,
      coalesce(o.review_decision_reason, 'Contact the business for details.'),
      'order:' || o.id::text || ':cancelled', o.cancelled_at
    from app.sales_orders o
    left join lateral (select e.id from audit.audit_events e where e.tenant_id = o.tenant_id and e.entity_type = 'sales_order'
      and e.entity_id = o.id and e.action = 'sales_order.payment_expired' limit 1) expired on true
    where o.tenant_id = p_tenant and o.customer_id = v_customer and o.source = 'reseller_portal'
      and o.status = 'cancelled' and o.cancelled_at > v_since
    union all
    -- Returns recorded on the reseller's invoices
    select o.id, 'return_recorded', 'Return recorded for ' || coalesce(o.order_number::text, i.invoice_number::text),
      to_char(n.amount, 'FM"₱"999,999,999,990.00') || ' was taken off your balance'
        || case when n.customer_credit > 0 then ' (' || to_char(n.customer_credit, 'FM"₱"999,999,999,990.00') || ' as credit)' else '' end
        || '. Reason: ' || n.reason,
      'return:' || n.id::text, n.recorded_at
    from app.wholesale_credit_notes n
    join app.invoices i on i.tenant_id = n.tenant_id and i.id = n.invoice_id
    left join app.sales_orders o on o.tenant_id = i.tenant_id and o.id = i.sales_order_id
    where n.tenant_id = p_tenant and n.customer_id = v_customer and n.recorded_at > v_since
    union all
    -- Reminders: an invoice due tomorrow, an invoice past due (once each), and a payment window closing soon
    select i.sales_order_id, 'payment_due_soon', 'Payment due tomorrow: ' || i.invoice_number::text,
      to_char(app.wholesale_invoice_open_balance(p_tenant, i.id), 'FM"₱"999,999,999,990.00') || ' is due on ' || to_char(c.due_date, 'Mon DD') || '.',
      'invoice:' || i.id::text || ':due_soon', now()
    from app.invoices i join app.wholesale_invoice_charges c on c.tenant_id = i.tenant_id and c.invoice_id = i.id
    where i.tenant_id = p_tenant and i.customer_id = v_customer and c.due_date = v_today + 1
      and app.wholesale_invoice_open_balance(p_tenant, i.id) > 0
    union all
    select i.sales_order_id, 'payment_overdue', 'Payment overdue: ' || i.invoice_number::text,
      to_char(app.wholesale_invoice_open_balance(p_tenant, i.id), 'FM"₱"999,999,999,990.00') || ' was due on ' || to_char(c.due_date, 'Mon DD')
        || '. Please send your payment.',
      'invoice:' || i.id::text || ':overdue', now()
    from app.invoices i join app.wholesale_invoice_charges c on c.tenant_id = i.tenant_id and c.invoice_id = i.id
    where i.tenant_id = p_tenant and i.customer_id = v_customer and c.due_date < v_today and c.due_date >= v_today - 30
      and app.wholesale_invoice_open_balance(p_tenant, i.id) > 0
    union all
    select o.id, 'payment_window_closing', 'Send your payment for ' || o.order_number::text,
      'Your stock is held until ' || to_char(o.payment_due_at at time zone (select timezone from app.tenants where id = p_tenant), 'HH12:MI AM')
        || '. Upload your payment before then or the order is cancelled.',
      'order:' || o.id::text || ':window_closing', now()
    from app.sales_orders o
    where o.tenant_id = p_tenant and o.customer_id = v_customer and o.status = 'submitted' and o.review_reason = 'awaiting_payment'
      and o.payment_due_at > now() and o.payment_due_at <= now() + interval '1 hour'
      and not exists (select 1 from app.payment_proofs p where p.tenant_id = o.tenant_id and p.sales_order_id = o.id)
  ) e
  where e.at is not null
  on conflict (tenant_id, reseller_account_id, dedup_key) do nothing;
  perform app.sync_reseller_stock_alerts(p_tenant, p_account);
  perform app.sync_reseller_operations_notifications(p_tenant, p_account);
end;
$function$;

CREATE OR REPLACE FUNCTION app.sync_portal_notifications(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_location uuid;
begin
  if not app.reseller_portal_enabled(p_tenant_id) then return; end if;
  select fulfillment_location_id into v_location from app.reseller_portal_settings where tenant_id = p_tenant_id;

  -- Orders whose payment arrived (or that need review) and are waiting in the Orders tab.
  insert into app.notifications (tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata)
  select o.tenant_id, m.user_id, 'approval', 'attention',
    'Portal order ' || o.order_number::text || ' needs review',
    case when o.review_reason = 'payment_review'
      then coalesce(o.customer_name_snapshot, c.full_name) || ' sent a payment. Verify it and confirm the order.'
      else coalesce(o.customer_name_snapshot, c.full_name) || '''s order is waiting for review.' end,
    'sales_order', o.id, o.location_id, '/reseller-portal', 'portal:order-review',
    'portal-order:' || o.id::text || ':review:' || o.review_reason,
    jsonb_build_object('orderNumber', o.order_number::text, 'reviewReason', o.review_reason)
  from app.sales_orders o
  join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
  join app.tenant_memberships m on m.tenant_id = o.tenant_id and m.status = 'active'
  where o.tenant_id = p_tenant_id and o.source = 'reseller_portal' and o.status = 'submitted'
    and o.review_reason <> 'awaiting_payment' and o.created_at > now() - interval '30 days'
    and app.can_handle_reseller_portal_orders(m.user_id, p_tenant_id)
    and app.can_read_notification_location(m.user_id, p_tenant_id, o.location_id)
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;

  -- Balance payments sent after the order was confirmed (Balance payments tab).
  insert into app.notifications (tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata)
  select o.tenant_id, m.user_id, 'approval', 'attention',
    'Balance payment for ' || o.order_number::text,
    coalesce(o.customer_name_snapshot, c.full_name) || ' sent ' || to_char(p.amount, 'FM"₱"999,999,999,990.00')
      || ' by ' || case p.method when 'gcash' then 'GCash' else 'bank transfer' end || '. Verify it in Balance payments.',
    'sales_order', o.id, o.location_id, '/reseller-portal', 'portal:balance-payment',
    'payment-proof:' || p.id::text || ':pending',
    jsonb_build_object('orderNumber', o.order_number::text, 'amountMinor', round(p.amount * 100)::bigint)
  from app.payment_proofs p
  join app.sales_orders o on o.tenant_id = p.tenant_id and o.id = p.sales_order_id
  join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
  join app.tenant_memberships m on m.tenant_id = o.tenant_id and m.status = 'active'
  where p.tenant_id = p_tenant_id and p.status = 'pending' and o.status <> 'submitted'
    and p.created_at > now() - interval '30 days'
    and app.can_handle_reseller_portal_orders(m.user_id, p_tenant_id)
    and app.can_read_notification_location(m.user_id, p_tenant_id, o.location_id)
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;

  -- New reseller applications (Resellers tab).
  insert into app.notifications (tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata)
  select a.tenant_id, m.user_id, 'approval', 'info', 'New reseller application',
    a.full_name || coalesce(' (' || a.business_name || ')', '') || ' applied to become a reseller.',
    'reseller_application', a.id, v_location, '/reseller-portal', 'portal:application',
    'reseller-application:' || a.id::text,
    jsonb_build_object('city', a.city)
  from app.reseller_applications a
  join app.tenant_memberships m on m.tenant_id = a.tenant_id and m.status = 'active'
  where a.tenant_id = p_tenant_id and a.status = 'pending' and a.created_at > now() - interval '30 days'
    and app.can_manage_reseller_portal(m.user_id, p_tenant_id)
    and (m.is_owner or (v_location is not null and app.can_read_notification_location(m.user_id, p_tenant_id, v_location)))
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;

  -- Return requests from resellers (Returns tab).
  insert into app.notifications (tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata)
  select r.tenant_id, m.user_id, 'approval', 'attention', 'Return request for ' || i.invoice_number::text,
    i.customer_name_snapshot || ' wants to return items: ' || left(r.reason, 200),
    'invoice', i.id, i.location_id, '/reseller-portal', 'portal:return-request',
    'return-request:' || r.id::text, jsonb_build_object('invoiceNumber', i.invoice_number::text)
  from app.reseller_return_requests r
  join app.invoices i on i.tenant_id = r.tenant_id and i.id = r.invoice_id
  join app.tenant_memberships m on m.tenant_id = r.tenant_id and m.status = 'active'
  where r.tenant_id = p_tenant_id and r.status = 'pending' and r.created_at > now() - interval '30 days'
    and app.can_handle_reseller_portal_orders(m.user_id, p_tenant_id)
    and app.can_read_notification_location(m.user_id, p_tenant_id, i.location_id)
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION app.reseller_order_json(p_tenant uuid, p_order uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', o.id, 'orderNumber', o.order_number::text, 'status', o.status, 'source', o.source,
    'reviewReason', o.review_reason, 'reviewDecisionReason', o.review_decision_reason,
    'fulfillmentMethod', o.fulfillment_method, 'deliveryAddress', o.delivery_address,
    'paymentPreference', o.payment_preference, 'notes', o.notes,
    'customerId', o.customer_id, 'customerName', coalesce(o.customer_name_snapshot, customer.full_name),
    'customerNumber', coalesce(o.customer_number_snapshot, customer.customer_number::text),
    'locationName', location.name,
    'totalMinor', round(o.total * 100)::bigint, 'shippingFeeMinor', round(o.shipping_fee * 100)::bigint,
    'parcels', app.portal_parcels_json(o.tenant_id, o.id),
    'returnRequests', coalesce((select jsonb_agg(app.return_request_json(o.tenant_id, r.id) - 'photos' - 'customerName'
        || jsonb_build_object('photoCount', (select count(*) from app.reseller_return_request_photos p
          where p.tenant_id = r.tenant_id and p.request_id = r.id)) order by r.created_at, r.id)
      from app.reseller_return_requests r where r.tenant_id = o.tenant_id and r.sales_order_id = o.id), '[]'::jsonb),
    'createdAt', o.created_at, 'confirmedAt', o.confirmed_at,
    'cancelledAt', o.cancelled_at, 'paymentDueAt', o.payment_due_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'id', line.id, 'variantId', line.variant_id, 'productName', line.product_name_snapshot,
      'variantName', line.variant_name_snapshot, 'sku', line.sku_snapshot,
      'orderedQuantityMilli', round(line.ordered_quantity * 1000)::bigint,
      'fulfilledQuantityMilli', round(line.fulfilled_quantity * 1000)::bigint,
      'cancelledQuantityMilli', round(line.cancelled_quantity * 1000)::bigint,
      'unitPriceMinor', round(line.unit_price * 100)::bigint, 'lineTotalMinor', round(line.line_total * 100)::bigint,
      'stockStatus', app.reseller_stock_status(o.tenant_id, o.location_id, line.variant_id)
    ) order by line.product_name_snapshot, line.variant_name_snapshot, line.id)
      from app.sales_order_lines line where line.tenant_id = o.tenant_id and line.sales_order_id = o.id), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
      'id', invoice.id, 'invoiceNumber', invoice.invoice_number::text,
      'totalMinor', round(invoice.total * 100)::bigint, 'issuedAt', invoice.issued_at,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('invoiceLineId', il.id, 'productName', il.product_name,
          'variantName', il.variant_name, 'quantityMilli', round(il.quantity * 1000)::bigint,
          'returnableMilli', round(app.reseller_returnable_quantity(il.tenant_id, il.id) * 1000)::bigint)
          order by il.product_name, il.variant_name, il.id), '[]'::jsonb)
        from app.invoice_lines il where il.tenant_id = invoice.tenant_id and il.invoice_id = invoice.id)
    ) order by invoice.issued_at, invoice.id)
      from app.invoices invoice where invoice.tenant_id = o.tenant_id and invoice.sales_order_id = o.id), '[]'::jsonb),
    'paymentProofs', app.payment_proofs_json(o.tenant_id, o.id),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'invoiceNumber', i.invoice_number::text,
        'amountMinor', round(n.amount * 100)::bigint, 'creditMinor', round(n.customer_credit * 100)::bigint,
        'reason', n.reason, 'recordedAt', n.recorded_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('productName', il.product_name, 'variantName', il.variant_name,
            'quantityMilli', round(nl.quantity * 1000)::bigint, 'returnToStock', nl.return_to_stock) order by il.product_name, il.variant_name)
          from app.wholesale_credit_note_lines nl join app.invoice_lines il on il.tenant_id = nl.tenant_id and il.id = nl.invoice_line_id
          where nl.tenant_id = n.tenant_id and nl.credit_note_id = n.id), '[]'::jsonb)) order by n.recorded_at, n.id)
      from app.wholesale_credit_notes n join app.invoices i on i.tenant_id = n.tenant_id and i.id = n.invoice_id
      where n.tenant_id = o.tenant_id and i.sales_order_id = o.id), '[]'::jsonb),
    'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'trackingNumber', s.tracking_number,
        'packedAt', s.packed_at, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at)
      from app.sales_order_shipments s where s.tenant_id = o.tenant_id and s.sales_order_id = o.id)
  )
  from app.sales_orders o
  join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
  join app.locations location on location.tenant_id = o.tenant_id and location.id = o.location_id
  where o.tenant_id = p_tenant and o.id = p_order;
$function$;

commit;
