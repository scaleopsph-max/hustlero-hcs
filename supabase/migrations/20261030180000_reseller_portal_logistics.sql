-- Reseller portal: logistics tracking, and verified payments count against credit exposure.
--
-- 1. Credit: a portal order confirmed after its payment proofs are verified must not count as unpaid
--    debt. Exposure now subtracts accepted portal proofs on confirmed (not yet released) orders, capped
--    at each order's remaining value. Proofs still never post money; release/invoicing records it.
-- 2. Logistics: every confirmed portal order gets one shipment that moves forward only:
--      delivery: to_pack -> packed -> shipped (courier + tracking) -> delivered
--      pickup:   to_pack -> packed (ready for pickup) -> delivered (picked up)
--    The reseller sees the status, courier and tracking number on the order.

begin;

-- ---------------------------------------------------------------------------
-- Credit exposure
-- ---------------------------------------------------------------------------
create function app.wholesale_verified_prepayments(p_tenant uuid, p_customer uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(least(paid.amount, remaining.amount)), 0)
  from app.sales_orders orders
  join lateral (select coalesce(sum(proof.amount), 0) amount from app.payment_proofs proof
    where proof.tenant_id = orders.tenant_id and proof.sales_order_id = orders.id and proof.status = 'accepted') paid on true
  join lateral (select coalesce(sum(round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * line.unit_price, 2)), 0) amount
    from app.sales_order_lines line where line.tenant_id = orders.tenant_id and line.sales_order_id = orders.id) remaining on true
  where orders.tenant_id = p_tenant and orders.customer_id = p_customer and orders.source = 'reseller_portal'
    and orders.status = 'confirmed';
$$;
revoke all on function app.wholesale_verified_prepayments(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create or replace function app.wholesale_credit_exposure(p_tenant uuid,p_customer uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_exposure numeric;
begin
 if exists(select 1 from app.invoices where tenant_id=p_tenant and customer_id=p_customer and app.wholesale_invoice_open_balance(p_tenant,id) is null) then
   raise exception using errcode='HCCR4',message='Historical invoice classification is required'; end if;
 select coalesce((select sum(app.wholesale_invoice_open_balance(p_tenant,id)) from app.invoices where tenant_id=p_tenant and customer_id=p_customer),0)
   +coalesce((select sum(round((line.ordered_quantity-line.fulfilled_quantity-line.cancelled_quantity)*line.unit_price,2))
   from app.sales_orders orders join app.sales_order_lines line on line.tenant_id=orders.tenant_id and line.sales_order_id=orders.id
   where orders.tenant_id=p_tenant and orders.customer_id=p_customer and orders.status in ('confirmed','partially_fulfilled')),0)
   -app.wholesale_verified_prepayments(p_tenant,p_customer) into v_exposure;
 return v_exposure;
end;
$$;

create or replace function app.wholesale_customer_credit_exposure(p_tenant uuid, p_customer uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from app.wholesale_receivable_charges where tenant_id = p_tenant and customer_id = p_customer), 0)
    + coalesce((select sum(amount) from app.wholesale_invoice_charges where tenant_id = p_tenant and customer_id = p_customer), 0)
    + coalesce((select sum(round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * line.unit_price, 2))
      from app.sales_orders orders join app.sales_order_lines line on line.tenant_id = orders.tenant_id and line.sales_order_id = orders.id
      where orders.tenant_id = p_tenant and orders.customer_id = p_customer and orders.status in ('confirmed', 'partially_fulfilled')), 0)
    - app.wholesale_verified_prepayments(p_tenant, p_customer);
$$;

-- ---------------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------------
create table app.sales_order_shipments (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sales_order_id uuid not null,
  method text not null check (method in ('delivery', 'pickup')),
  status text not null default 'to_pack' check (status in ('to_pack', 'packed', 'shipped', 'delivered')),
  courier text check (courier in ('jnt', 'lalamove', 'other')),
  tracking_number text check (tracking_number is null or char_length(btrim(tracking_number)) between 3 and 80),
  note text check (note is null or char_length(btrim(note)) between 2 and 500),
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sales_order_id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, updated_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint sales_order_shipments_pickup check (method = 'delivery' or status <> 'shipped'),
  constraint sales_order_shipments_courier check (status <> 'shipped' or method <> 'delivery' or courier is not null)
);
create index sales_order_shipments_open_idx on app.sales_order_shipments (tenant_id, status, created_at);
alter table app.sales_order_shipments enable row level security;
revoke all on app.sales_order_shipments from public, anon, authenticated, hcs_hyperdrive;
create trigger sales_order_shipments_set_updated_at before update on app.sales_order_shipments
  for each row execute function app.set_updated_at();

-- Portal orders confirmed before this migration start in "to pack".
insert into app.sales_order_shipments (tenant_id, sales_order_id, method, updated_by)
select o.tenant_id, o.id, coalesce(o.fulfillment_method, 'delivery'),
  coalesce(o.created_by, (select m.user_id from app.tenant_memberships m where m.tenant_id = o.tenant_id and m.is_owner
    order by m.created_at limit 1))
from app.sales_orders o
where o.source = 'reseller_portal' and o.status in ('confirmed', 'partially_fulfilled', 'fulfilled')
  and coalesce(o.created_by, (select m.user_id from app.tenant_memberships m where m.tenant_id = o.tenant_id and m.is_owner
    order by m.created_at limit 1)) is not null
on conflict do nothing;

create function app.portal_shipment_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'salesOrderId', o.id, 'orderNumber', o.order_number::text,
    'customerName', coalesce(o.customer_name_snapshot, c.full_name), 'customerPhone', c.phone,
    'method', s.method, 'status', s.status, 'courier', s.courier, 'trackingNumber', s.tracking_number, 'note', s.note,
    'deliveryAddress', o.delivery_address, 'locationName', l.name, 'totalMinor', round(o.total * 100)::bigint,
    'confirmedAt', o.confirmed_at, 'packedAt', s.packed_at, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('productName', line.product_name_snapshot,
        'variantName', line.variant_name_snapshot, 'sku', line.sku_snapshot,
        'quantityMilli', round((line.ordered_quantity - line.cancelled_quantity) * 1000)::bigint)
        order by line.product_name_snapshot, line.variant_name_snapshot, line.id)
      from app.sales_order_lines line where line.tenant_id = o.tenant_id and line.sales_order_id = o.id), '[]'::jsonb))
  from app.sales_order_shipments s
  join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
  join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
  join app.locations l on l.tenant_id = o.tenant_id and l.id = o.location_id
  where s.tenant_id = p_tenant and s.sales_order_id = p_order;
$$;
revoke all on function app.portal_shipment_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Moves a shipment one step forward. Shipping a delivery needs a courier; tracking is optional for Lalamove.
create function app.update_portal_shipment(p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shipment app.sales_order_shipments%rowtype; v_next text := p_payload->>'status'; v_response jsonb;
  v_courier text := nullif(p_payload->>'courier', ''); v_tracking text := nullif(btrim(coalesce(p_payload->>'trackingNumber', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key where key not in ('status', 'courier', 'trackingNumber', 'note'))
    or coalesce(v_next, '') not in ('packed', 'shipped', 'delivered')
    or (v_courier is not null and v_courier not in ('jnt', 'lalamove', 'other'))
    or (v_tracking is not null and char_length(v_tracking) not between 3 and 80)
    or (v_note is not null and char_length(v_note) not between 2 and 500)
  then raise exception using errcode = 'HCRP3', message = 'Shipment update is invalid'; end if;
  select * into v_shipment from app.sales_order_shipments where tenant_id = p_tenant and sales_order_id = p_order for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The shipment was not found'; end if;
  if not (
    (v_shipment.status = 'to_pack' and v_next = 'packed')
    or (v_shipment.status = 'packed' and v_next = 'shipped' and v_shipment.method = 'delivery')
    or (v_shipment.status = 'packed' and v_next = 'delivered' and v_shipment.method = 'pickup')
    or (v_shipment.status = 'shipped' and v_next = 'delivered')
  ) then
    raise exception using errcode = 'HCRA5', message = 'The shipment is not at that step';
  end if;
  if v_next = 'shipped' and v_courier is null then
    raise exception using errcode = 'HCRP3', message = 'Choose the courier';
  end if;
  update app.sales_order_shipments set status = v_next,
    courier = case when v_next = 'shipped' then v_courier else courier end,
    tracking_number = case when v_next = 'shipped' then v_tracking else tracking_number end,
    note = coalesce(v_note, note),
    packed_at = case when v_next = 'packed' then now() else packed_at end,
    shipped_at = case when v_next = 'shipped' then now() else shipped_at end,
    delivered_at = case when v_next = 'delivered' then now() else delivered_at end,
    updated_by = p_actor
  where tenant_id = p_tenant and sales_order_id = p_order;
  v_response := jsonb_build_object('salesOrderId', p_order, 'status', v_next);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'sales_order.shipment_' || v_next, 'sales_order', p_order,
    v_response || jsonb_build_object('courier', v_courier, 'trackingNumber', v_tracking));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'sales_order.shipment_' || v_next, 'sales_order', p_order,
    v_response || jsonb_build_object('courier', v_courier, 'trackingNumber', v_tracking));
  return v_response;
end;
$$;
revoke all on function app.update_portal_shipment(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.update_portal_shipment(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;

create or replace function app.reseller_order_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'orderNumber', o.order_number::text, 'status', o.status, 'source', o.source,
    'reviewReason', o.review_reason, 'reviewDecisionReason', o.review_decision_reason,
    'fulfillmentMethod', o.fulfillment_method, 'deliveryAddress', o.delivery_address,
    'paymentPreference', o.payment_preference, 'notes', o.notes,
    'customerId', o.customer_id, 'customerName', coalesce(o.customer_name_snapshot, customer.full_name),
    'customerNumber', coalesce(o.customer_number_snapshot, customer.customer_number::text),
    'locationName', location.name,
    'totalMinor', round(o.total * 100)::bigint, 'createdAt', o.created_at, 'confirmedAt', o.confirmed_at,
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
      'totalMinor', round(invoice.total * 100)::bigint, 'issuedAt', invoice.issued_at
    ) order by invoice.issued_at, invoice.id)
      from app.invoices invoice where invoice.tenant_id = o.tenant_id and invoice.sales_order_id = o.id), '[]'::jsonb),
    'paymentProofs', app.payment_proofs_json(o.tenant_id, o.id),
    'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'trackingNumber', s.tracking_number,
        'packedAt', s.packed_at, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at)
      from app.sales_order_shipments s where s.tenant_id = o.tenant_id and s.sales_order_id = o.id)
  )
  from app.sales_orders o
  join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
  join app.locations location on location.tenant_id = o.tenant_id and location.id = o.location_id
  where o.tenant_id = p_tenant and o.id = p_order;
$$;

create or replace function app.review_reseller_portal_order(
  p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype; v_response jsonb;
  v_decision text := p_payload->>'decision'; v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_override uuid;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(v_decision, '') not in ('approve', 'reject')
    or exists (select 1 from jsonb_object_keys(p_payload) key where key not in ('decision', 'reason', 'creditOverrideId'))
    or (v_decision = 'reject' and (v_reason is null or char_length(v_reason) not between 2 and 500))
    or (v_reason is not null and char_length(v_reason) not between 2 and 500)
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Review decision is invalid'; end if;
  begin
    v_override := nullif(p_payload->>'creditOverrideId', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'HCRP3', message = 'Review decision is invalid';
  end;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':wholesale-order:confirm:' || p_order::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.order_review' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The portal order was not found'; end if;
  if v_order.status <> 'submitted' then raise exception using errcode = 'HCRA5', message = 'The portal order was already reviewed'; end if;
  if v_order.review_reason = 'awaiting_payment' then
    raise exception using errcode = 'HCRA6', message = 'The order is still waiting for the reseller''s payment';
  end if;
  -- The payment hold is released first; approval then reserves again through the Back Office confirmation.
  perform app.release_reseller_payment_hold(p_tenant, p_order, p_actor, null);

  if v_decision = 'reject' then
    update app.payment_proofs set status = 'rejected', review_reason = v_reason, reviewed_by = p_actor, reviewed_at = now()
    where tenant_id = p_tenant and sales_order_id = p_order and status = 'pending';
    update app.sales_orders set status = 'cancelled', cancelled_at = now(), review_decision_reason = v_reason
    where tenant_id = p_tenant and id = p_order;
    v_response := jsonb_build_object('salesOrderId', p_order, 'status', 'cancelled');
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor, 'sales_order.rejected', 'sales_order', p_order, v_reason, v_response);
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (p_tenant, 'sales_order.rejected', 'sales_order', p_order, v_response || jsonb_build_object('source', 'reseller_portal'));
  else
    -- One step: the pending proofs are verified and the order is confirmed together, or nothing changes.
    update app.payment_proofs set status = 'accepted', reviewed_by = p_actor, reviewed_at = now()
    where tenant_id = p_tenant and sales_order_id = p_order and status = 'pending';
    -- Approval reuses the audited Back Office confirmation (permission, price refresh, stock and credit checks).
    update app.sales_orders set status = 'draft', review_decision_reason = v_reason where tenant_id = p_tenant and id = p_order;
    if v_override is null then
      v_response := app.confirm_wholesale_order(p_actor, p_tenant, p_order, p_key, p_hash, p_request_id);
    else
      v_response := app.confirm_wholesale_order_with_credit_override(p_actor, p_tenant, p_order, p_key, p_hash, p_request_id, v_override);
    end if;
    update app.sales_orders set review_reason = null where tenant_id = p_tenant and id = p_order;
    -- Confirmed portal orders go straight to Logistics as "to pack".
    insert into app.sales_order_shipments (tenant_id, sales_order_id, method, updated_by)
    values (p_tenant, p_order, coalesce(v_order.fulfillment_method, 'delivery'), p_actor)
    on conflict (tenant_id, sales_order_id) do nothing;
  end if;
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.order_review', p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create or replace function app.load_reseller_portal_admin(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_settings app.reseller_portal_settings%rowtype;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  return jsonb_build_object(
    'tenantSlug', (select slug::text from app.tenants where id = p_tenant),
    'settings', case when v_settings.tenant_id is null then null else jsonb_build_object(
      'fulfillmentLocationId', v_settings.fulfillment_location_id, 'defaultPriceListId', v_settings.default_price_list_id,
      'applicationsOpen', v_settings.applications_open, 'autoConfirm', v_settings.auto_confirm,
      'paymentInstructions', v_settings.payment_instructions,
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
$$;

commit;
