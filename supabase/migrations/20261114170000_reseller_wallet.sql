-- Reseller wallet (owner direction 2026-11-14). Credit from approved returns is the reseller's "wallet": shown
-- on the Account page and usable at checkout when the reseller chooses (on by default). No top-ups and no expiry.
--   * An order records how much wallet it uses (`wallet_amount`). That amount is held for the order and counts as
--     paid; when the order is invoiced it is applied to the invoice from the oldest credit (`wallet_applied`).
--   * A wallet that covers the whole order confirms it at once, like a paid order; otherwise the reseller pays the
--     rest with a payment proof.
--   * Held wallet is released when an order is cancelled, declined, or expires, and the business cannot apply or
--     refund credit that is held for an open order.
begin;

alter table app.sales_orders
  add column wallet_amount numeric(18,2) not null default 0 check (wallet_amount >= 0),
  add column wallet_applied numeric(18,2) not null default 0,
  add constraint sales_orders_wallet_applied check (wallet_applied between 0 and wallet_amount);

-- Wallet amounts promised to open portal orders and not yet applied to an invoice.
create function app.reseller_wallet_held(p_tenant uuid, p_customer uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.wallet_amount - o.wallet_applied), 0) from app.sales_orders o
  where o.tenant_id = p_tenant and o.customer_id = p_customer and o.source = 'reseller_portal'
    and o.status in ('submitted', 'confirmed', 'partially_fulfilled');
$$;

-- What the reseller can spend now: credit from returns, less what open orders already hold.
create function app.reseller_wallet_balance(p_tenant uuid, p_customer uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(coalesce((select sum(app.wholesale_credit_available(p_tenant, n.id)) from app.wholesale_credit_notes n
    where n.tenant_id = p_tenant and n.customer_id = p_customer), 0) - app.reseller_wallet_held(p_tenant, p_customer), 0);
$$;
revoke all on function app.reseller_wallet_held(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;
revoke all on function app.reseller_wallet_balance(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Applies an order's held wallet to its invoices, oldest credit first, after any payment proofs.
create function app.apply_portal_wallet(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_order app.sales_orders%rowtype; v_account uuid; v_invoice record; v_note record; v_left numeric; v_need numeric;
  v_take numeric; v_applied numeric := 0;
begin
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  if not found or v_order.wallet_amount <= v_order.wallet_applied then return 0; end if;
  select id into v_account from app.reseller_accounts where tenant_id = p_tenant and customer_id = v_order.customer_id;
  v_left := v_order.wallet_amount - v_order.wallet_applied;
  for v_invoice in select i.id, app.wholesale_invoice_open_balance(p_tenant, i.id) balance from app.invoices i
    where i.tenant_id = p_tenant and i.sales_order_id = p_order order by i.issued_at, i.id for update loop
    exit when v_left <= 0;
    continue when coalesce(v_invoice.balance, 0) <= 0;
    v_need := least(v_left, v_invoice.balance);
    for v_note in select n.id, app.wholesale_credit_available(p_tenant, n.id) available from app.wholesale_credit_notes n
      where n.tenant_id = p_tenant and n.customer_id = v_order.customer_id order by n.recorded_at, n.id for update loop
      exit when v_need <= 0;
      continue when v_note.available <= 0;
      v_take := least(v_need, v_note.available);
      insert into app.wholesale_credit_applications (tenant_id, credit_note_id, invoice_id, amount, request_body, reseller_account_id)
      values (p_tenant, v_note.id, v_invoice.id, v_take,
        jsonb_build_object('source', 'reseller_wallet', 'salesOrderId', p_order, 'requestId', p_request_id), v_account);
      v_need := v_need - v_take; v_left := v_left - v_take; v_applied := v_applied + v_take;
    end loop;
  end loop;
  if v_applied > 0 then
    update app.sales_orders set wallet_applied = wallet_applied + v_applied where tenant_id = p_tenant and id = p_order;
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_wallet.applied', 'sales_order', p_order, v_order.location_id,
      jsonb_build_object('amountMinor', round(v_applied * 100)::bigint, 'resellerAccountId', v_account));
  end if;
  return v_applied;
end;
$$;
revoke all on function app.apply_portal_wallet(uuid, uuid, uuid, text) from public, anon, authenticated, hcs_hyperdrive;

CREATE OR REPLACE FUNCTION app.wholesale_verified_prepayments(p_tenant uuid, p_customer uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(least(paid.amount + orders.wallet_amount - orders.wallet_applied, remaining.amount)), 0)
  from app.sales_orders orders
  join lateral (select coalesce(sum(proof.amount - coalesce(proof.recorded_amount, 0)), 0) amount from app.payment_proofs proof
    where proof.tenant_id = orders.tenant_id and proof.sales_order_id = orders.id and proof.status = 'accepted') paid on true
  join lateral (select coalesce(sum(round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * line.unit_price, 2)), 0) amount
    from app.sales_order_lines line where line.tenant_id = orders.tenant_id and line.sales_order_id = orders.id) remaining on true
  where orders.tenant_id = p_tenant and orders.customer_id = p_customer and orders.source = 'reseller_portal'
    and orders.status in ('confirmed', 'partially_fulfilled');
$function$;

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
  v_tracked boolean; v_ship numeric(18,2) := 0; v_on_credit boolean := false; v_available numeric;
  v_wallet numeric(18,2) := 0; v_paid boolean := false;
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
      where key not in ('lines', 'fulfillmentMethod', 'deliveryAddress', 'paymentPreference', 'notes', 'useWallet'))
    or (p_payload ? 'useWallet' and jsonb_typeof(p_payload->'useWallet') is distinct from 'boolean')
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

  if v_method = 'delivery' and v_settings.shipping_fee > 0
    and (v_settings.free_shipping_minimum is null or v_total < v_settings.free_shipping_minimum) then
    v_ship := v_settings.shipping_fee;
  end if;
  -- Platinum resellers in good standing order on credit (owner decision 2026-10-31): the order is confirmed now
  -- and billed with their term. Everyone else pays first: stock is held four hours for the payment proof.
  -- The wallet goes first when the reseller chose it; a wallet that covers everything makes the order paid.
  if coalesce((p_payload->>'useWallet')::boolean, false) then
    v_wallet := least(app.reseller_wallet_balance(p_tenant, v_account.customer_id), v_total + v_ship);
  end if;
  v_paid := v_wallet > 0 and v_wallet >= v_total + v_ship;
  v_available := app.reseller_credit_available(p_tenant, v_account.id);
  v_on_credit := not v_paid and v_available is not null and v_available >= v_total + v_ship - v_wallet;
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
      v_order_line.ordered_quantity, case when v_on_credit or v_paid then 'order_confirmed' else 'payment_hold' end, v_account.id
    );
  end loop;
  if v_on_credit or v_paid then
    select * into v_credit from app.wholesale_customer_credit_settings
    where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
    if v_credit.id is null then
      raise exception using errcode = 'HCCR2', message = 'Explicit customer credit settings are required';
    end if;
    v_reason := null; v_due := null;
    update app.sales_orders set status = 'confirmed', review_reason = null, confirmed_at = now(), on_credit = v_on_credit,
      subtotal = v_total, shipping_fee = v_ship, total = v_total + v_ship, wallet_amount = v_wallet
    where tenant_id = p_tenant and id = v_order.id;
    insert into app.wholesale_order_credit_snapshots (tenant_id, sales_order_id, settings_id, payment_term, credit_limit)
    values (p_tenant, v_order.id, v_credit.id, v_credit.payment_term, v_credit.credit_limit);
    insert into app.sales_order_shipments (tenant_id, sales_order_id, method, updated_by)
    values (p_tenant, v_order.id, v_method, app.tenant_owner_user(p_tenant));
  else
    v_reason := 'awaiting_payment';
    update app.sales_orders set review_reason = v_reason, payment_due_at = now() + interval '4 hours',
      subtotal = v_total, shipping_fee = v_ship, total = v_total + v_ship, wallet_amount = v_wallet
    where tenant_id = p_tenant and id = v_order.id
    returning payment_due_at into v_due;
  end if;

  v_response := jsonb_build_object('salesOrderId', v_order.id, 'orderNumber', v_order_number,
    'status', case when v_on_credit or v_paid then 'confirmed' else 'submitted' end, 'reviewReason', v_reason, 'paymentDueAt', v_due,
    'lineCount', v_line_count, 'totalMinor', round((v_total + v_ship) * 100)::bigint,
    'shippingFeeMinor', round(v_ship * 100)::bigint, 'onCredit', v_on_credit,
    'walletMinor', round(v_wallet * 100)::bigint, 'amountDueMinor', round((v_total + v_ship - v_wallet) * 100)::bigint);
  -- Portal actors are recorded as `system` with the reseller identity in metadata.
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id,
    case when v_on_credit or v_paid then 'sales_order.confirmed' else 'sales_order.submitted' end, 'sales_order', v_order.id,
    v_order.location_id, v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id,
      'customerNumber', v_customer.customer_number::text, 'source', 'reseller_portal', 'paymentHold', not (v_on_credit or v_paid)));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, case when v_on_credit or v_paid then 'sales_order.confirmed' else 'sales_order.submitted' end,
    'sales_order', v_order.id, v_response || jsonb_build_object('source', 'reseller_portal'));
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant and operation = 'reseller_portal.order_submit:' || v_account.id::text and idempotency_key = p_key;
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.review_reseller_portal_order(p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype; v_response jsonb;
  v_decision text := p_payload->>'decision'; v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_override uuid;
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
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
    -- Without open credit (Silver, Gold, or Platinum over the limit), the payment must cover the whole order.
    if app.reseller_credit_available(p_tenant, (select a.id from app.reseller_accounts a where a.tenant_id = p_tenant
        and a.customer_id = v_order.customer_id)) is null and v_override is null
      and coalesce((select sum(amount) from app.payment_proofs where tenant_id = p_tenant and sales_order_id = p_order
        and status in ('pending', 'accepted')), 0) + v_order.wallet_amount < v_order.total then
      raise exception using errcode = 'HCRT1', message = 'The payment does not cover the order total';
    end if;
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
$function$;

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
  perform app.apply_portal_wallet(p_actor, p_tenant, p_order, p_request_id);
  return round(v_total * 100)::bigint;
end;
$function$;

CREATE OR REPLACE FUNCTION app.apply_reseller_credit(p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_account app.reseller_accounts%rowtype; v_invoice app.invoices%rowtype; v_existing app.idempotency_records%rowtype;
  v_amount numeric; v_left numeric; v_note record; v_take numeric; v_count integer := 0; v_response jsonb; v_operation text;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('invoiceId', 'amountMinor'))
    or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string' or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number'
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null or nullif(p_request_id, '') is null then
    raise exception using errcode = 'HCRP3', message = 'Credit request is invalid';
  end if;
  begin v_amount := (p_payload->>'amountMinor')::numeric / 100;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'HCRP3', message = 'Credit request is invalid'; end;
  if v_amount <= 0 or v_amount * 100 <> trunc(v_amount * 100) then
    raise exception using errcode = 'HCRP3', message = 'Credit request is invalid';
  end if;
  v_operation := 'reseller_portal.credit_apply:' || v_account.id::text;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || v_operation || ':' || p_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant and operation = v_operation and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  v_invoice := app.lock_reseller_invoice(v_account, p_tenant, (p_payload->>'invoiceId')::uuid);
  if v_amount > app.wholesale_invoice_open_balance(p_tenant, v_invoice.id) then
    raise exception using errcode = 'HCRB2', message = 'That is more than the invoice balance';
  end if;
  if v_amount > app.reseller_wallet_balance(p_tenant, v_account.customer_id) then
    raise exception using errcode = 'HCRB3', message = 'That is more than your available credit';
  end if;
  v_left := v_amount;
  for v_note in select n.id, app.wholesale_credit_available(p_tenant, n.id) available from app.wholesale_credit_notes n
    where n.tenant_id = p_tenant and n.customer_id = v_account.customer_id order by n.recorded_at, n.id for update loop
    exit when v_left <= 0;
    continue when v_note.available <= 0;
    v_take := least(v_left, v_note.available);
    insert into app.wholesale_credit_applications (tenant_id, credit_note_id, invoice_id, amount, request_body, reseller_account_id)
    values (p_tenant, v_note.id, v_invoice.id, v_take, p_payload, v_account.id);
    v_left := v_left - v_take; v_count := v_count + 1;
  end loop;
  v_response := jsonb_build_object('invoiceId', v_invoice.id, 'amountMinor', round(v_amount * 100)::bigint,
    'balanceMinor', round(app.wholesale_invoice_open_balance(p_tenant, v_invoice.id) * 100)::bigint, 'applications', v_count);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id, 'wholesale_credit.applied', 'invoice', v_invoice.id, v_invoice.location_id,
    v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id, 'source', 'reseller_portal'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'wholesale_credit.applied', 'invoice', v_invoice.id, v_response || jsonb_build_object('source', 'reseller_portal'));
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, v_operation, p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.command_wholesale_credit(p_actor uuid, p_tenant uuid, p_operation text, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_note app.wholesale_credit_notes%rowtype; v_source app.invoices%rowtype; v_target app.invoices%rowtype;
 v_existing app.idempotency_records%rowtype; v_method app.payment_methods%rowtype; v_session app.register_sessions%rowtype;
 v_amount numeric; v_id uuid:=gen_random_uuid(); v_response jsonb; v_operation text; v_customer uuid; v_note_id uuid; v_target_id uuid; v_method_id uuid; v_session_id uuid;
 v_permission text; v_effective_at timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if p_operation is null or p_operation not in ('apply','refund') then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 v_operation:='wholesale_credit.'||p_operation;
 v_permission:=case when p_operation='apply' then 'wholesale_credits.apply' else 'wholesale_credits.refund' end;
 perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 if not(p_payload ?& array['creditNoteId','amountMinor','reason'])
 or jsonb_typeof(p_payload->'creditNoteId') is distinct from 'string' or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 if p_operation='apply' and (not(p_payload ? 'invoiceId') or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('creditNoteId','invoiceId','amountMinor','reason')))
 then raise exception using errcode='HCWR1',message='Invalid credit application'; end if;
 if p_operation='refund' and (not(p_payload ?& array['paymentMethodId','registerSessionId','referenceLastFour','payoutConfirmed'])
 or jsonb_typeof(p_payload->'paymentMethodId') is distinct from 'string' or p_payload->'payoutConfirmed' is distinct from 'true'::jsonb
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('creditNoteId','paymentMethodId','registerSessionId','referenceLastFour','payoutConfirmed','amountMinor','reason')))
 then raise exception using errcode='HCWR1',message='Invalid confirmed refund'; end if;
 begin
 v_note_id:=(p_payload->>'creditNoteId')::uuid; v_amount:=(p_payload->>'amountMinor')::numeric;
 v_target_id:=(p_payload->>'invoiceId')::uuid; v_method_id:=(p_payload->>'paymentMethodId')::uuid; v_session_id:=(p_payload->>'registerSessionId')::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCWR1',message='Invalid credit action'; end;
 if v_amount<=0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception using errcode='HCWR1',message='Invalid credit amount'; end if;
 v_amount:=v_amount/100;
 select customer_id into v_customer from app.wholesale_credit_notes where tenant_id=p_tenant and id=v_note_id;
 if not found then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 select * into v_note from app.wholesale_credit_notes where tenant_id=p_tenant and id=v_note_id;
 select * into v_source from app.invoices where tenant_id=p_tenant and id=v_note.invoice_id;
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_source.location_id) then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 perform app.lock_wholesale_return_location(p_actor,p_tenant,v_source.location_id);
 if p_operation='apply' then
   select * into v_target from app.invoices where tenant_id=p_tenant and id=v_target_id and customer_id=v_customer and location_id=v_source.location_id for update;
   if not found or not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_target.location_id) then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||v_operation||':'||p_key,0));
 perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation=v_operation and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   if p_operation='apply' and not exists(select 1 from app.wholesale_credit_applications where tenant_id=p_tenant and id=(v_existing.response_body->>'applicationId')::uuid and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   if p_operation='refund' and not exists(select 1 from app.wholesale_credit_payouts where tenant_id=p_tenant and id=(v_existing.response_body->>'payoutId')::uuid and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 if v_amount>app.wholesale_credit_available(p_tenant,v_note.id) then raise exception using errcode='HCWR4',message='Credit exceeds available balance'; end if;
 if app.reseller_wallet_held(p_tenant,v_note.customer_id)>0 and v_amount>app.reseller_wallet_balance(p_tenant,v_note.customer_id)
 then raise exception using errcode='HCWR4',message='Part of this credit is held for the reseller''s open order'; end if;
 if p_operation='apply' then
   if app.wholesale_invoice_open_balance(p_tenant,v_target.id) is null or v_amount>app.wholesale_invoice_open_balance(p_tenant,v_target.id)
   then raise exception using errcode='HCWR4',message='Credit exceeds open invoice balance'; end if;
   perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
   v_effective_at:=clock_timestamp();
   insert into app.wholesale_credit_applications(id,tenant_id,credit_note_id,invoice_id,amount,request_body,recorded_by,recorded_at)
   values(v_id,p_tenant,v_note.id,v_target.id,v_amount,p_payload,p_actor,v_effective_at);
   v_response:=jsonb_build_object('applicationId',v_id,'creditNoteId',v_note.id,'invoiceId',v_target.id,'amountMinor',(v_amount*100)::bigint);
 else
   -- Allocated receipts require a separate approved, audited fund-reversal workflow.
   if app.wholesale_invoice_has_funded_receipts(p_tenant,v_source.id)
   then raise exception using errcode='HCWR5',message='Funded receipt requires audited reversal before payout'; end if;
   select * into v_method from app.payment_methods where tenant_id=p_tenant and id=v_method_id and is_active for share;
   -- These availability denials happen only after the original-key replay check.
   if not found or v_method.method_type not in ('cash','e_wallet','bank_transfer') then raise exception using errcode='HCWR6',message='Refund method unavailable'; end if;
   if v_amount+coalesce((select sum(p.amount) from app.wholesale_credit_payouts p join app.wholesale_credit_notes n on n.tenant_id=p.tenant_id and n.id=p.credit_note_id where p.tenant_id=p_tenant and n.invoice_id=v_source.id and p.payment_method_id=v_method.id),0)
     >coalesce((select sum(a.amount) from app.wholesale_payment_allocations a join app.wholesale_payments p on p.tenant_id=a.tenant_id and p.id=a.payment_id where a.tenant_id=p_tenant and a.invoice_id=v_source.id and p.payment_method_id=v_method.id),0)
   then raise exception using errcode='HCWR4',message='Refund exceeds original method collection'; end if;
   if v_method.method_type='cash' then
     if v_session_id is null or p_payload->'referenceLastFour' is distinct from 'null'::jsonb then raise exception using errcode='HCWR1',message='Cash refund requires a register session and no external reference'; end if;
     select * into v_session from app.register_sessions where tenant_id=p_tenant and id=v_session_id and location_id=v_source.location_id and status='open' for update;
     if not found or not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active' and(m.is_owner or (
       exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='registers.operate')
       and exists(select 1 from app.employees e where e.tenant_id=p_tenant and e.id=v_session.employee_id and e.user_id=p_actor and e.status='active'))))
     then raise exception using errcode='HCWR6',message='Authorized open cash session required'; end if;
     if coalesce((select sum(amount) from app.cash_movements where tenant_id=p_tenant and register_session_id=v_session.id),0)<v_amount
     then raise exception using errcode='HCWR4',message='Register cash is insufficient'; end if;
   else
     if p_payload->'registerSessionId' is distinct from 'null'::jsonb or jsonb_typeof(p_payload->'referenceLastFour') is distinct from 'string' or (p_payload->>'referenceLastFour') !~ '^[0-9]{4}$'
     then raise exception using errcode='HCWR1',message='External refund requires exactly four reference digits'; end if;
   end if;
   perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
   v_effective_at:=clock_timestamp();
   insert into app.wholesale_credit_payouts(id,tenant_id,credit_note_id,payment_method_id,register_session_id,amount,reference_last_four,request_body,recorded_by,recorded_at)
   values(v_id,p_tenant,v_note.id,v_method.id,v_session_id,v_amount,p_payload->>'referenceLastFour',p_payload,p_actor,v_effective_at);
   if v_method.method_type='cash' then
     insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,reason,actor_user_id,occurred_at)
     values(p_tenant,v_session.id,v_source.location_id,'cash_refund',-v_amount,'wholesale_credit_payout',v_id,btrim(p_payload->>'reason'),p_actor,v_effective_at);
   end if;
   v_response:=jsonb_build_object('payoutId',v_id,'creditNoteId',v_note.id,'paymentMethodId',v_method.id,'registerSessionId',v_session_id,'amountMinor',(v_amount*100)::bigint,'referenceLastFour',p_payload->>'referenceLastFour');
 end if;
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,v_operation,'wholesale_credit',v_id,v_source.location_id,btrim(p_payload->>'reason'),v_response,v_effective_at);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,v_operation,'wholesale_credit',v_id,v_response,v_effective_at,v_effective_at);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,v_operation,p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
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
    'walletMinor', round(o.wallet_amount * 100)::bigint, 'amountDueMinor', round((o.total - o.wallet_amount) * 100)::bigint,
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
        where tenant_id = p_tenant and customer_id = v_account.customer_id), 0),
      'tier', v_account.tier,
      'deliveryAddress', v_account.delivery_address,
      'walletMinor', round(app.reseller_wallet_balance(p_tenant, v_account.customer_id) * 100)::bigint,
      -- Set when this reseller can order on credit right now: how much is left.
      'creditOrderingMinor', round(app.reseller_credit_available(p_tenant, v_account.id) * 100)::bigint
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
            where p.tenant_id = o.tenant_id and p.sales_order_id = o.id and p.status = 'accepted'), 0)
          - (o.wallet_amount - o.wallet_applied), 0) amount
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
        'creditAvailableMinor', round(app.reseller_wallet_balance(p_tenant, v_account.customer_id) * 100)::bigint,
        'walletHeldMinor', round(app.reseller_wallet_held(p_tenant, v_account.customer_id) * 100)::bigint),
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

-- The wallet page: balance, what open orders hold, and where the money came from and went.
create function app.load_reseller_wallet(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  return jsonb_build_object(
    'balanceMinor', round(app.reseller_wallet_balance(p_tenant, v_account.customer_id) * 100)::bigint,
    'heldMinor', round(app.reseller_wallet_held(p_tenant, v_account.customer_id) * 100)::bigint,
    'held', coalesce((select jsonb_agg(jsonb_build_object('orderNumber', o.order_number::text,
        'amountMinor', round((o.wallet_amount - o.wallet_applied) * 100)::bigint) order by o.created_at)
      from app.sales_orders o where o.tenant_id = p_tenant and o.customer_id = v_account.customer_id and o.source = 'reseller_portal'
        and o.status in ('submitted', 'confirmed', 'partially_fulfilled') and o.wallet_amount > o.wallet_applied), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(entry order by entry->>'at' desc, entry->>'id') from (select entry from (
      select jsonb_build_object('id', 'in:' || ci.credit_note_id || ':' || ci.recorded_at, 'at', ci.recorded_at, 'kind', 'return_credit',
          'label', 'Return credit · ' || i.invoice_number::text, 'amountMinor', round(ci.amount * 100)::bigint) entry
      from app.wholesale_customer_credit_issues ci
      join app.wholesale_credit_notes n on n.tenant_id = ci.tenant_id and n.id = ci.credit_note_id
      join app.invoices i on i.tenant_id = n.tenant_id and i.id = n.invoice_id
      where ci.tenant_id = p_tenant and n.customer_id = v_account.customer_id
      union all
      select jsonb_build_object('id', 'use:' || a.id, 'at', a.recorded_at, 'kind', 'used',
          'label', 'Used for ' || coalesce('order ' || o.order_number::text || ' · ', '') || i.invoice_number::text,
          'amountMinor', -round(a.amount * 100)::bigint)
      from app.wholesale_credit_applications a
      join app.wholesale_credit_notes n on n.tenant_id = a.tenant_id and n.id = a.credit_note_id
      join app.invoices i on i.tenant_id = a.tenant_id and i.id = a.invoice_id
      left join app.sales_orders o on o.tenant_id = i.tenant_id and o.id = i.sales_order_id
      where a.tenant_id = p_tenant and n.customer_id = v_account.customer_id
      union all
      select jsonb_build_object('id', 'out:' || p.id, 'at', p.recorded_at, 'kind', 'refunded',
          'label', 'Refunded to you · ' || m.name, 'amountMinor', -round(p.amount * 100)::bigint)
      from app.wholesale_credit_payouts p
      join app.wholesale_credit_notes n on n.tenant_id = p.tenant_id and n.id = p.credit_note_id
      join app.payment_methods m on m.tenant_id = p.tenant_id and m.id = p.payment_method_id
      where p.tenant_id = p_tenant and n.customer_id = v_account.customer_id
      ) everything order by entry->>'at' desc limit 100) rows), '[]'::jsonb));
end;
$$;
revoke all on function app.load_reseller_wallet(uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_wallet(uuid, uuid) to hcs_hyperdrive;

commit;
