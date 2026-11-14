-- Resellers settle balances themselves: apply return credit, or pay with loyalty points; and the portal reminds them.
--   * Credit: a reseller applies credit from returns to an open invoice (oldest credit first).
--   * Points: the business sets what a point is worth; a reseller pays part of an open invoice with points. The
--     payment is recorded under a "Loyalty points" method so invoices, statements, and reports stay whole.
--   * Reminders: due tomorrow, overdue, and "payment window closes within the hour" notices (also pushed).
-- Owner direction 2026-10-31.
begin;

-- Who recorded it: a team member or, now, the reseller themself.
alter table app.wholesale_credit_applications alter column recorded_by drop not null,
  add column reseller_account_id uuid,
  add foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  add constraint wholesale_credit_applications_actor check (num_nonnulls(recorded_by, reseller_account_id) = 1);
alter table app.wholesale_payments alter column recorded_by drop not null,
  add column reseller_account_id uuid,
  add foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  add constraint wholesale_payments_actor check (num_nonnulls(recorded_by, reseller_account_id) = 1);

-- Points redemption settings live with the portal.
alter table app.reseller_portal_settings
  add column points_redeem_value numeric(18,2) check (points_redeem_value is null or (points_redeem_value > 0 and points_redeem_value <= 100000)),
  add column points_min_redeem integer not null default 1 check (points_min_redeem between 1 and 1000000);

alter table app.loyalty_transactions add column actor_reseller_account_id uuid,
  add foreign key (tenant_id, actor_reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict;
alter table app.loyalty_transactions drop constraint loyalty_transactions_transaction_type_check,
  drop constraint loyalty_transactions_check, drop constraint loyalty_transactions_check1;
alter table app.loyalty_transactions
  add constraint loyalty_transactions_transaction_type_check check (transaction_type in ('sale_earn', 'refund_reversal', 'redemption')),
  add constraint loyalty_transactions_type_shape check (
    (transaction_type = 'sale_earn' and points_delta > 0 and refund_id is null)
    or (transaction_type = 'refund_reversal' and points_delta < 0 and refund_id is not null)
    or (transaction_type = 'redemption' and points_delta < 0 and refund_id is null)),
  add constraint loyalty_transactions_actor check (num_nonnulls(actor_user_id, actor_employee_id, actor_reseller_account_id) = 1);

-- Redemptions spend points; they are not reversals.
create or replace function app.apply_loyalty_transaction_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_balance bigint;
begin
  insert into app.loyalty_accounts (tenant_id, customer_id)
  values (new.tenant_id, new.customer_id)
  on conflict do nothing;
  select balance_points into v_balance from app.loyalty_accounts
  where tenant_id = new.tenant_id and customer_id = new.customer_id for update;
  v_balance := v_balance + new.points_delta;
  if v_balance < 0 then
    raise exception using errcode = 'HCSC4', message = 'Loyalty balance cannot become negative';
  end if;
  new.balance_after_points := v_balance;
  update app.loyalty_accounts set
    balance_points = v_balance,
    lifetime_earned_points = lifetime_earned_points + greatest(new.points_delta, 0),
    lifetime_reversed_points = lifetime_reversed_points
      + case when new.transaction_type = 'refund_reversal' then -new.points_delta else 0 end,
    last_activity_at = new.occurred_at
  where tenant_id = new.tenant_id and customer_id = new.customer_id;
  return new;
end;
$$;

create function app.save_reseller_points_settings(p_actor uuid, p_tenant uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_value numeric; v_min integer;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('redeemValueMinor', 'minimumPoints'))
    or jsonb_typeof(p_payload->'redeemValueMinor') not in ('number', 'null')
    or jsonb_typeof(p_payload->'minimumPoints') is distinct from 'number' then
    raise exception using errcode = 'HCRP3', message = 'Points settings are invalid';
  end if;
  begin
    v_value := (p_payload->>'redeemValueMinor')::numeric / 100;
    v_min := (p_payload->>'minimumPoints')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'HCRP3', message = 'Points settings are invalid';
  end;
  if (v_value is not null and (v_value <= 0 or v_value > 100000 or v_value * 100 <> trunc(v_value * 100)))
    or v_min is null or v_min not between 1 and 1000000 then
    raise exception using errcode = 'HCRP3', message = 'Points settings are invalid';
  end if;
  update app.reseller_portal_settings set points_redeem_value = v_value, points_min_redeem = v_min where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.points_settings_saved', 'tenant', p_tenant,
    jsonb_build_object('redeemValueMinor', round(v_value * 100)::bigint, 'minimumPoints', v_min));
  return jsonb_build_object('redeemValueMinor', round(v_value * 100)::bigint, 'minimumPoints', v_min);
end;
$$;
revoke all on function app.save_reseller_points_settings(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.save_reseller_points_settings(uuid, uuid, jsonb, text) to hcs_hyperdrive;

-- Shared checks for reseller self-service on one of their invoices; returns the invoice, locked.
create function app.lock_reseller_invoice(p_account app.reseller_accounts, p_tenant uuid, p_invoice uuid)
returns app.invoices language plpgsql security definer set search_path = '' as $$
declare v_invoice app.invoices%rowtype;
begin
  perform 1 from app.customers where tenant_id = p_tenant and id = p_account.customer_id for update;
  select * into v_invoice from app.invoices where tenant_id = p_tenant and id = p_invoice
    and customer_id = p_account.customer_id for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The invoice was not found'; end if;
  if coalesce(app.wholesale_invoice_open_balance(p_tenant, v_invoice.id), 0) <= 0 then
    raise exception using errcode = 'HCRB1', message = 'This invoice has nothing left to pay';
  end if;
  return v_invoice;
end;
$$;
revoke all on function app.lock_reseller_invoice(app.reseller_accounts, uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Applies return credit to an open invoice, oldest credit first. Amount in centavos.
create function app.apply_reseller_credit(p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if v_amount > (select coalesce(sum(app.wholesale_credit_available(p_tenant, n.id)), 0) from app.wholesale_credit_notes n
    where n.tenant_id = p_tenant and n.customer_id = v_account.customer_id) then
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
$$;
revoke all on function app.apply_reseller_credit(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function app.apply_reseller_credit(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

-- Pays part of an open invoice with loyalty points at the business's set value per point.
create function app.redeem_reseller_points(p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_invoice app.invoices%rowtype; v_existing app.idempotency_records%rowtype;
  v_settings app.reseller_portal_settings%rowtype; v_policy app.loyalty_policies%rowtype; v_points bigint; v_amount numeric;
  v_method uuid; v_payment uuid := gen_random_uuid(); v_response jsonb; v_operation text; v_balance bigint;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('invoiceId', 'points'))
    or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string' or jsonb_typeof(p_payload->'points') is distinct from 'number'
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null or nullif(p_request_id, '') is null then
    raise exception using errcode = 'HCRP3', message = 'Points request is invalid';
  end if;
  begin v_points := (p_payload->>'points')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'HCRP3', message = 'Points request is invalid'; end;
  v_operation := 'reseller_portal.points_redeem:' || v_account.id::text;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || v_operation || ':' || p_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant and operation = v_operation and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  select * into v_policy from app.loyalty_policies where tenant_id = p_tenant;
  if v_settings.points_redeem_value is null or not coalesce(v_policy.enabled, false) then
    raise exception using errcode = 'HCRB4', message = 'Paying with points is not available';
  end if;
  if v_points is null or v_points < v_settings.points_min_redeem then
    raise exception using errcode = 'HCRB5', message = 'Use at least the minimum number of points';
  end if;
  v_invoice := app.lock_reseller_invoice(v_account, p_tenant, (p_payload->>'invoiceId')::uuid);
  v_amount := round(v_points * v_settings.points_redeem_value, 2);
  if v_amount > app.wholesale_invoice_open_balance(p_tenant, v_invoice.id) then
    raise exception using errcode = 'HCRB2', message = 'That is more than the invoice balance';
  end if;
  select balance_points into v_balance from app.loyalty_accounts where tenant_id = p_tenant and customer_id = v_account.customer_id for update;
  if coalesce(v_balance, 0) < v_points then
    raise exception using errcode = 'HCRB6', message = 'You do not have that many points';
  end if;
  select id into v_method from app.payment_methods where tenant_id = p_tenant and code = 'loyalty_points';
  if v_method is null then
    -- Inactive so it never appears in POS tenders or manual payment pickers; used only by redemptions.
    insert into app.payment_methods (tenant_id, code, name, method_type, is_system_default, is_active)
    values (p_tenant, 'loyalty_points', 'Loyalty points', 'other', true, false) returning id into v_method;
  end if;
  insert into app.wholesale_payments (id, tenant_id, customer_id, payment_method_id, amount, reference, reseller_account_id)
  values (v_payment, p_tenant, v_account.customer_id, v_method, v_amount, v_points || ' points', v_account.id);
  insert into app.wholesale_payment_allocations (tenant_id, payment_id, invoice_id, amount) values (p_tenant, v_payment, v_invoice.id, v_amount);
  insert into app.loyalty_transactions (tenant_id, customer_id, transaction_type, points_delta, balance_after_points,
    spend_per_point_centavos, sale_id, actor_reseller_account_id, occurred_at)
  values (p_tenant, v_account.customer_id, 'redemption', -v_points, 0,
    coalesce(round(v_policy.spend_per_point * 100)::bigint, 1), v_invoice.sale_id, v_account.id, now());
  v_response := jsonb_build_object('invoiceId', v_invoice.id, 'paymentId', v_payment, 'points', v_points,
    'amountMinor', round(v_amount * 100)::bigint,
    'balanceMinor', round(app.wholesale_invoice_open_balance(p_tenant, v_invoice.id) * 100)::bigint,
    'pointsLeft', v_balance - v_points);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id, 'loyalty.points_redeemed', 'invoice', v_invoice.id, v_invoice.location_id,
    v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id, 'source', 'reseller_portal'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'wholesale_payment.recorded', 'wholesale_payment', v_payment, v_response || jsonb_build_object('source', 'loyalty_points'));
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, v_operation, p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;
revoke all on function app.redeem_reseller_points(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function app.redeem_reseller_points(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

alter table app.reseller_notifications drop constraint reseller_notifications_kind_check;
alter table app.reseller_notifications add constraint reseller_notifications_kind_check check (kind in (
  'order_confirmed', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'payment_verified', 'payment_rejected',
  'order_expired', 'order_rejected', 'return_recorded', 'payment_due_soon', 'payment_overdue', 'payment_window_closing'));

-- Reminders join the reseller's notifications (and push).
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
end;
$function$;

-- The statement says whether points can pay invoices, and how many the reseller has.
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
          - coalesce((select sum(p.amount) from app.payment_proofs p where p.tenant_id = o.tenant_id and p.sales_order_id = o.id
            and p.status = 'accepted' and p.wholesale_payment_id is null), 0), 0) amount
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

-- Loyalty shows what a point is worth when paying.
CREATE OR REPLACE FUNCTION app.load_reseller_loyalty(p_auth_user uuid, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_account app.reseller_accounts%rowtype; v_policy app.loyalty_policies%rowtype; v_balance app.loyalty_accounts%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_policy from app.loyalty_policies where tenant_id = p_tenant;
  select * into v_balance from app.loyalty_accounts where tenant_id = p_tenant and customer_id = v_account.customer_id;
  return jsonb_build_object(
    'enabled', coalesce(v_policy.enabled, false),
    'spendPerPointMinor', case when v_policy.enabled then round(v_policy.spend_per_point * 100)::bigint end,
    'balancePoints', coalesce(v_balance.balance_points, 0),
    'lifetimeEarnedPoints', coalesce(v_balance.lifetime_earned_points, 0),
    'redeemValueMinor', case when v_policy.enabled then (select round(points_redeem_value * 100)::bigint
      from app.reseller_portal_settings where tenant_id = p_tenant) end,
    'minimumPoints', (select points_min_redeem from app.reseller_portal_settings where tenant_id = p_tenant),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'type', t.transaction_type, 'points', t.points_delta,
        'balanceAfter', t.balance_after_points, 'occurredAt', t.occurred_at,
        'invoiceNumber', (select i.invoice_number::text from app.invoices i where i.tenant_id = t.tenant_id and i.sale_id = t.sale_id),
        'orderNumber', (select o.order_number::text from app.invoices i join app.sales_orders o on o.tenant_id = i.tenant_id
          and o.id = i.sales_order_id where i.tenant_id = t.tenant_id and i.sale_id = t.sale_id),
        'receiptNumber', (select s.receipt_number::text from app.sales s where s.tenant_id = t.tenant_id and s.id = t.sale_id))
        order by t.occurred_at desc, t.id)
      from (select * from app.loyalty_transactions where tenant_id = p_tenant and customer_id = v_account.customer_id
        order by occurred_at desc, id limit 50) t), '[]'::jsonb));
end;
$function$;

-- Back Office shows the points settings.
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
    'canManage', app.can_manage_reseller_portal(p_actor, p_tenant),
    'tenantSlug', (select slug::text from app.tenants where id = p_tenant),
    'settings', case when v_settings.tenant_id is null then null else jsonb_build_object(
      'fulfillmentLocationId', v_settings.fulfillment_location_id, 'defaultPriceListId', v_settings.default_price_list_id,
      'applicationsOpen', v_settings.applications_open, 'autoConfirm', v_settings.auto_confirm,
      'paymentInstructions', v_settings.payment_instructions,
      'pointsRedeemValueMinor', round(v_settings.points_redeem_value * 100)::bigint,
      'pointsMinRedeem', v_settings.points_min_redeem,
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

commit;
