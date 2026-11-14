-- Reseller portal: pay first (owner decision 2026-10-30).
--
-- Every portal order now holds its stock for four hours and waits for the reseller's payment proof.
--   1. Submit: stock is reserved as a `payment_hold`; the order is `submitted` / `awaiting_payment`
--      with `payment_due_at = now() + 4 hours`. Items without enough available stock are refused (HCRP8).
--   2. First proof (a downpayment is allowed): `awaiting_payment` -> `payment_review`; the order enters
--      the Back Office review queue with its proofs.
--   3. Review: one step verifies the pending proofs and confirms the order through the existing Back
--      Office confirmation (stock and credit checks), or rejects both with a reason. The hold is released
--      first in the same transaction.
--   4. No proof within four hours: `app.expire_reseller_payment_holds` cancels the order and releases the
--      hold. The API Worker runs it every five minutes; portal commands also run it for their tenant.
-- Accepting a proof still never posts money; payments are recorded through the wholesale payment commands.

begin;

alter table app.sales_orders add column payment_due_at timestamptz;
alter table app.sales_orders drop constraint sales_orders_review_reason_check;
alter table app.sales_orders add constraint sales_orders_review_reason_check check (review_reason in (
  'manual_review', 'credit_settings_missing', 'credit_review', 'stock_insufficient', 'credit_limit',
  'awaiting_payment', 'payment_review'));
alter table app.sales_orders add constraint sales_orders_payment_due check (
  review_reason is distinct from 'awaiting_payment' or payment_due_at is not null);
create index sales_orders_payment_due_idx on app.sales_orders (payment_due_at)
  where status = 'submitted' and review_reason = 'awaiting_payment';

alter table app.sales_order_reservation_ledger drop constraint sales_order_reservation_ledger_reason_check;
alter table app.sales_order_reservation_ledger add constraint sales_order_reservation_ledger_reason_check check (reason in (
  'order_confirmed', 'order_cancelled', 'order_fulfilled', 'payment_hold', 'payment_hold_released'));

alter table app.reseller_portal_settings add column payment_instructions text
  check (payment_instructions is null or char_length(btrim(payment_instructions)) between 2 and 1000);

-- Releases whatever stock an order still holds for payment. Safe to call when nothing is held.
create function app.release_reseller_payment_hold(p_tenant uuid, p_order uuid, p_actor_user uuid, p_actor_reseller uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_line record;
begin
  for v_line in
    select ledger.sales_order_line_id, ledger.location_id, ledger.variant_id, sum(ledger.quantity_delta) held
    from app.sales_order_reservation_ledger ledger
    where ledger.tenant_id = p_tenant and ledger.sales_order_id = p_order
      and ledger.reason in ('payment_hold', 'payment_hold_released')
    group by ledger.sales_order_line_id, ledger.location_id, ledger.variant_id
    having sum(ledger.quantity_delta) > 0
    order by ledger.variant_id, ledger.sales_order_line_id
  loop
    update app.inventory_balances set reserved = reserved - v_line.held, version = version + 1, updated_at = now()
    where tenant_id = p_tenant and location_id = v_line.location_id and variant_id = v_line.variant_id
      and reserved >= v_line.held;
    if not found then
      raise exception using errcode = 'HCRP9', message = 'Reserved stock does not match the payment hold';
    end if;
    insert into app.sales_order_reservation_ledger (
      tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason,
      actor_user_id, actor_reseller_account_id
    ) values (
      p_tenant, p_order, v_line.sales_order_line_id, v_line.location_id, v_line.variant_id, -v_line.held,
      'payment_hold_released', p_actor_user, case when p_actor_user is null then p_actor_reseller end
    );
  end loop;
end;
$$;
revoke all on function app.release_reseller_payment_hold(uuid, uuid, uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Cancels pay-first orders whose four-hour window passed without a proof. A null tenant sweeps every tenant.
create function app.expire_reseller_payment_holds(p_tenant uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_order app.sales_orders%rowtype; v_count integer := 0; v_payload jsonb;
begin
  for v_order in
    select * from app.sales_orders
    where (p_tenant is null or tenant_id = p_tenant) and status = 'submitted'
      and review_reason = 'awaiting_payment' and payment_due_at <= now()
    order by payment_due_at, id
    for update skip locked
  loop
    perform app.release_reseller_payment_hold(v_order.tenant_id, v_order.id, null, v_order.created_by_reseller_account_id);
    update app.sales_orders set status = 'cancelled', cancelled_at = now(),
      review_decision_reason = 'Payment was not received within 4 hours.'
    where tenant_id = v_order.tenant_id and id = v_order.id;
    v_payload := jsonb_build_object('salesOrderId', v_order.id, 'orderNumber', v_order.order_number::text,
      'status', 'cancelled', 'reason', 'payment_window_expired', 'paymentDueAt', v_order.payment_due_at,
      'source', 'reseller_portal');
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, reason, metadata)
    values (v_order.tenant_id, 'payment-hold-expiry', 'system', null, 'sales_order.payment_expired', 'sales_order', v_order.id,
      v_order.location_id, 'Payment was not received within 4 hours.', v_payload);
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (v_order.tenant_id, 'sales_order.payment_expired', 'sales_order', v_order.id, v_payload);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.expire_reseller_payment_holds(uuid) from public, anon, authenticated;
grant execute on function app.expire_reseller_payment_holds(uuid) to hcs_hyperdrive;

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
    'paymentProofs', app.payment_proofs_json(o.tenant_id, o.id)
  )
  from app.sales_orders o
  join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
  join app.locations location on location.tenant_id = o.tenant_id and location.id = o.location_id
  where o.tenant_id = p_tenant and o.id = p_order;
$$;

create or replace function app.assert_payment_proof_upload(p_auth_user uuid, p_tenant uuid, p_order uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_order app.sales_orders%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order and customer_id = v_account.customer_id;
  if not found then raise exception using errcode = 'HCFL3', message = 'The order was not found'; end if;
  if (v_order.status = 'submitted' and v_order.review_reason = 'awaiting_payment' and v_order.payment_due_at <= now())
    or (v_order.status = 'cancelled' and v_order.review_reason = 'awaiting_payment') then
    raise exception using errcode = 'HCFL6', message = 'The payment window for this order has closed';
  end if;
  if v_order.status not in ('submitted', 'confirmed', 'partially_fulfilled', 'fulfilled') then
    raise exception using errcode = 'HCFL5', message = 'Payment proof is not accepted for this order';
  end if;
  if (select count(*) from app.payment_proofs where tenant_id = p_tenant and sales_order_id = p_order and status = 'pending') >= 5 then
    raise exception using errcode = 'HCFL4', message = 'Wait for the pending proofs to be checked first';
  end if;
end;
$$;

create or replace function app.record_payment_proof(
  p_auth_user uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_account app.reseller_accounts%rowtype; v_order app.sales_orders%rowtype; v_existing app.idempotency_records%rowtype;
  v_file uuid; v_proof uuid; v_amount numeric; v_method text; v_response jsonb;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
    or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number'
    or char_length(btrim(coalesce(p_payload->>'reference', ''))) not between 4 and 64
    or coalesce(p_payload->>'method', '') not in ('gcash', 'bank_transfer') then
    raise exception using errcode = 'HCFL2', message = 'Payment proof details are invalid';
  end if;
  perform app.validate_file_payload(p_payload - 'amountMinor' - 'reference' - 'method', 5242880, false);
  v_amount := (p_payload->>'amountMinor')::numeric;
  if v_amount <> trunc(v_amount) or v_amount < 1 or v_amount > 9007199254740991 then
    raise exception using errcode = 'HCFL2', message = 'Payment proof details are invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':payment-proofs:' || p_order::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.payment_proof:' || v_account.id::text and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  perform app.expire_reseller_payment_holds(p_tenant);
  perform app.assert_payment_proof_upload(p_auth_user, p_tenant, p_order);
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order;
  v_method := p_payload->>'method';
  v_file := (p_payload->>'fileId')::uuid;
  insert into app.files (id, tenant_id, kind, storage_key, thumb_storage_key, mime_type, size_bytes, thumb_size_bytes,
    sha256, original_filename, uploaded_by_reseller_account_id)
  values (v_file, p_tenant, 'payment_proof', 't/' || p_tenant || '/payment_proof/' || v_file || '/main',
    case when p_payload ? 'thumbSizeBytes' then 't/' || p_tenant || '/payment_proof/' || v_file || '/thumb' end,
    p_payload->>'mimeType', (p_payload->>'sizeBytes')::integer, (p_payload->>'thumbSizeBytes')::integer,
    p_payload->>'sha256', btrim(p_payload->>'originalFilename'), v_account.id);
  insert into app.payment_proofs (tenant_id, sales_order_id, file_id, reseller_account_id, method, amount, reference)
  values (p_tenant, p_order, v_file, v_account.id, v_method, v_amount / 100, btrim(p_payload->>'reference'))
  returning id into v_proof;
  -- The first proof moves a pay-first order from "awaiting payment" to the team's review queue.
  update app.sales_orders set review_reason = 'payment_review'
  where tenant_id = p_tenant and id = p_order and status = 'submitted' and review_reason = 'awaiting_payment';
  v_response := jsonb_build_object('proofId', v_proof, 'fileId', v_file, 'salesOrderId', p_order, 'status', 'pending',
    'amountMinor', v_amount::bigint, 'method', v_method);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id, 'payment_proof.submitted', 'sales_order', p_order,
    v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id,
      'orderNumber', v_order.order_number::text, 'fileId', v_file, 'sha256', p_payload->>'sha256'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'payment_proof.submitted', 'sales_order', p_order, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.payment_proof:' || v_account.id::text, p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create or replace function app.list_pending_payment_proofs(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  return jsonb_build_object('proofs', coalesce((select jsonb_agg(jsonb_build_object(
    'id', proof.id, 'salesOrderId', o.id, 'orderNumber', o.order_number::text, 'orderStatus', o.status,
    'orderTotalMinor', round(o.total * 100)::bigint,
    'customerName', coalesce(o.customer_name_snapshot, customer.full_name),
    'method', proof.method, 'amountMinor', round(proof.amount * 100)::bigint, 'reference', proof.reference,
    'createdAt', proof.created_at, 'mimeType', file.mime_type,
    'storageKey', file.storage_key, 'thumbStorageKey', file.thumb_storage_key
  ) order by proof.created_at, proof.id)
    from app.payment_proofs proof
    join app.files file on file.tenant_id = proof.tenant_id and file.id = proof.file_id
    join app.sales_orders o on o.tenant_id = proof.tenant_id and o.id = proof.sales_order_id
    join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
    where proof.tenant_id = p_tenant and proof.status = 'pending'
      -- Proofs on orders still in review are handled from the review card.
      and o.status <> 'submitted'), '[]'::jsonb));
end;
$$;

create or replace function app.submit_reseller_portal_order(
  p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype;
  v_customer app.customers%rowtype; v_credit app.wholesale_customer_credit_settings%rowtype;
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype;
  v_line jsonb; v_order_line app.sales_order_lines%rowtype; v_balance app.inventory_balances%rowtype; v_entry record;
  v_number bigint; v_order_number text; v_total numeric(18,2) := 0; v_line_count integer := 0;
  v_reason text; v_quantity numeric; v_response jsonb; v_method text; v_address text; v_due timestamptz;
  v_tracked boolean;
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
  update app.sales_orders set review_reason = v_reason, payment_due_at = now() + interval '4 hours',
    subtotal = v_total, total = v_total
  where tenant_id = p_tenant and id = v_order.id
  returning payment_due_at into v_due;

  v_response := jsonb_build_object('salesOrderId', v_order.id, 'orderNumber', v_order_number,
    'status', 'submitted', 'reviewReason', v_reason, 'paymentDueAt', v_due,
    'lineCount', v_line_count, 'totalMinor', round(v_total * 100)::bigint);
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
    'awaitingPayment', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'orderNumber', o.order_number::text,
        'customerName', coalesce(o.customer_name_snapshot, c.full_name), 'totalMinor', round(o.total * 100)::bigint,
        'createdAt', o.created_at, 'paymentDueAt', o.payment_due_at) order by o.payment_due_at, o.id)
      from app.sales_orders o join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = p_tenant and o.status = 'submitted' and o.review_reason = 'awaiting_payment'), '[]'::jsonb)
  );
end;
$$;

create or replace function app.save_reseller_portal_settings(
  p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb; v_location uuid; v_list uuid; v_instructions text;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array['fulfillmentLocationId', 'applicationsOpen'])
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('fulfillmentLocationId', 'defaultPriceListId', 'applicationsOpen', 'autoConfirm', 'paymentInstructions'))
    or jsonb_typeof(p_payload->'applicationsOpen') is distinct from 'boolean'
    or (p_payload ? 'autoConfirm' and jsonb_typeof(p_payload->'autoConfirm') is distinct from 'boolean')
    or (p_payload ? 'paymentInstructions' and jsonb_typeof(p_payload->'paymentInstructions') not in ('string', 'null'))
    or char_length(btrim(coalesce(p_payload->>'paymentInstructions', 'ok'))) not between 2 and 1000
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Portal settings are invalid'; end if;
  begin
    v_location := (p_payload->>'fulfillmentLocationId')::uuid;
    v_list := nullif(p_payload->>'defaultPriceListId', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'HCRP3', message = 'Portal settings are invalid';
  end;
  if not exists (select 1 from app.locations where tenant_id = p_tenant and id = v_location and is_active)
    or (v_list is not null and not exists (select 1 from app.price_lists where tenant_id = p_tenant and id = v_list
      and is_active and pricing_type in ('wholesale', 'dealer'))) then
    raise exception using errcode = 'HCRP3', message = 'The branch or price list is unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-portal:settings:' || p_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.settings' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  v_instructions := nullif(btrim(coalesce(p_payload->>'paymentInstructions', '')), '');
  -- Portal orders are always pay first now; auto_confirm is kept only for older clients.
  insert into app.reseller_portal_settings (tenant_id, fulfillment_location_id, default_price_list_id, applications_open,
    auto_confirm, payment_instructions, updated_by)
  values (p_tenant, v_location, v_list, (p_payload->>'applicationsOpen')::boolean,
    coalesce((p_payload->>'autoConfirm')::boolean, false), v_instructions, p_actor)
  on conflict (tenant_id) do update set fulfillment_location_id = excluded.fulfillment_location_id,
    default_price_list_id = excluded.default_price_list_id, applications_open = excluded.applications_open,
    auto_confirm = excluded.auto_confirm, payment_instructions = excluded.payment_instructions, updated_by = excluded.updated_by;
  v_response := jsonb_build_object('status', 'saved', 'fulfillmentLocationId', v_location, 'defaultPriceListId', v_list,
    'applicationsOpen', (p_payload->>'applicationsOpen')::boolean,
    'autoConfirm', coalesce((p_payload->>'autoConfirm')::boolean, false), 'paymentInstructions', v_instructions);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.settings_saved', 'tenant', p_tenant, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'reseller_portal.settings_saved', 'tenant', p_tenant, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.settings', p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create or replace function app.load_reseller_portal_catalog(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'fulfillmentLocationName', (select name from app.locations where tenant_id = p_tenant and id = v_settings.fulfillment_location_id),
    'payment', jsonb_build_object('instructions', v_settings.payment_instructions, 'holdHours', 4),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variantId', variant.id, 'productId', product.id, 'productName', product.name, 'variantName', variant.name,
        'sku', variant.sku::text, 'categoryName', category.name,
        'unitPriceMinor', round(entry.unit_price * 100)::bigint, 'srpMinor', round(variant.retail_price * 100)::bigint,
        'pricingGroupId', pricing_group.id, 'pricingGroupName', pricing_group.name,
        'thresholdMilli', round(pricing_group.threshold_quantity * 1000)::bigint,
        'stockStatus', app.reseller_stock_status(p_tenant, v_settings.fulfillment_location_id, variant.id)
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
$$;

commit;
