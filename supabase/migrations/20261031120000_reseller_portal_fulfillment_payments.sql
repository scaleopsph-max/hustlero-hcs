-- Reseller portal orders become real sales when they leave the warehouse, and verified payment proofs are recorded.
--   * Shipping a delivery (or handing over a pickup) runs the audited wholesale fulfillment: stock leaves on hand and
--     the reservation, an invoice is issued, and the invoice is charged to the reseller with its credit-snapshot term.
--   * Every accepted payment proof on the order is recorded as a wholesale payment allocated to that invoice. Proofs
--     accepted later (balance payments) are recorded the moment they are accepted.
-- Owner approval to record money from verified proofs: 2026-10-30 (ADR-045).
begin;

alter table app.payment_proofs
  add column wholesale_payment_id uuid,
  add column recorded_amount numeric(18,2),
  add foreign key (tenant_id, wholesale_payment_id) references app.wholesale_payments (tenant_id, id) on delete restrict,
  add constraint payment_proofs_recording check (
    (wholesale_payment_id is null) = (recorded_amount is null)
    and (wholesale_payment_id is null or (status = 'accepted' and recorded_amount > 0 and recorded_amount <= amount)));
create unique index payment_proofs_wholesale_payment_idx on app.payment_proofs (tenant_id, wholesale_payment_id)
  where wholesale_payment_id is not null;

-- GCash proofs record under the business's e-wallet method, bank proofs under bank transfer.
create function app.portal_payment_method(p_tenant uuid, p_proof_method text)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from app.payment_methods m
  where m.tenant_id = p_tenant and m.is_active
    and m.method_type = case p_proof_method when 'gcash' then 'e_wallet' else 'bank_transfer' end
  order by (m.code::text = case p_proof_method when 'gcash' then 'e_wallet' else 'bank_transfer' end) desc,
    m.is_system_default desc, m.created_at, m.id
  limit 1;
$$;
revoke all on function app.portal_payment_method(uuid, text) from public, anon, authenticated, hcs_hyperdrive;

-- Records the order's accepted, not-yet-recorded proofs against its open invoices. Returns centavos recorded.
-- Does nothing before the order has an invoice; overpayment beyond the open balance is left unrecorded.
create function app.record_portal_proof_payments(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
returns bigint language plpgsql security definer set search_path = '' as $$
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
    where tenant_id = p_tenant and sales_order_id = p_order and status = 'accepted' and wholesale_payment_id is null
    order by reviewed_at, created_at, id for update
  loop
    v_left := v_proof.amount; v_allocations := '[]'::jsonb; v_allocated := 0;
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
    update app.payment_proofs set wholesale_payment_id = v_payment, recorded_amount = v_allocated
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
$$;
revoke all on function app.record_portal_proof_payments(uuid, uuid, uuid, text) from public, anon, authenticated, hcs_hyperdrive;

-- Releases the order's remaining stock, issues and charges the invoice, then records verified payments.
-- Safe to call again: an order that is already fulfilled only has its new proofs recorded.
create function app.fulfill_portal_order(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order app.sales_orders%rowtype; v_term text; v_lines jsonb; v_fulfilled jsonb; v_invoice app.invoices%rowtype;
  v_due date; v_recorded bigint;
begin
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  if not found or v_order.source <> 'reseller_portal' then
    raise exception using errcode = 'HCRA4', message = 'The order was not found';
  end if;
  if v_order.status in ('confirmed', 'partially_fulfilled') then
    select payment_term into v_term from app.wholesale_order_credit_snapshots where tenant_id = p_tenant and sales_order_id = p_order;
    if v_term is null then raise exception using errcode = 'HCCR2', message = 'Explicit customer credit settings are required'; end if;
    select jsonb_agg(jsonb_build_object('salesOrderLineId', line.id,
        'quantityMilli', round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * 1000)::bigint)
        order by line.variant_id, line.id::text)
      into v_lines
    from app.sales_order_lines line
    where line.tenant_id = p_tenant and line.sales_order_id = p_order
      and line.ordered_quantity > line.fulfilled_quantity + line.cancelled_quantity;
    v_fulfilled := app.fulfill_wholesale_order_inventory_core(p_actor, p_tenant, p_order, coalesce(v_lines, '[]'::jsonb),
      'portal_fulfill_' || replace(p_order::text, '-', ''), 'portal-fulfill:' || p_order::text, p_request_id);
    select * into v_invoice from app.invoices where tenant_id = p_tenant and id = (v_fulfilled->>'invoiceId')::uuid;
    if not exists (select 1 from app.wholesale_invoice_charges where tenant_id = p_tenant and invoice_id = v_invoice.id) then
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
    end if;
  elsif v_order.status <> 'fulfilled' then
    raise exception using errcode = 'HCSQ6', message = 'Only confirmed orders with remaining quantity can be fulfilled';
  end if;
  v_recorded := app.record_portal_proof_payments(p_actor, p_tenant, p_order, p_request_id);
  return jsonb_build_object(
    'invoiceNumber', (select invoice_number::text from app.invoices where tenant_id = p_tenant and sales_order_id = p_order
      order by issued_at desc, id limit 1),
    'recordedPaymentMinor', v_recorded,
    'balanceMinor', coalesce((select round(sum(app.wholesale_invoice_open_balance(p_tenant, i.id)) * 100)::bigint
      from app.invoices i where i.tenant_id = p_tenant and i.sales_order_id = p_order), 0));
end;
$$;
revoke all on function app.fulfill_portal_order(uuid, uuid, uuid, text) from public, anon, authenticated, hcs_hyperdrive;

-- Shipping a delivery or handing over a pickup now completes the sale in the same transaction.
alter function app.update_portal_shipment(uuid, uuid, uuid, jsonb, text) rename to update_portal_shipment_core;
revoke all on function app.update_portal_shipment_core(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated, hcs_hyperdrive;

create function app.update_portal_shipment(p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb; v_status text;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  -- Order before shipment, matching the confirmation path that creates shipments.
  perform 1 from app.sales_orders where tenant_id = p_tenant and id = p_order for update;
  v_response := app.update_portal_shipment_core(p_actor, p_tenant, p_order, p_payload, p_request_id);
  select status into v_status from app.sales_orders where tenant_id = p_tenant and id = p_order;
  if v_response->>'status' in ('shipped', 'delivered') and v_status in ('confirmed', 'partially_fulfilled', 'fulfilled') then
    v_response := v_response || app.fulfill_portal_order(p_actor, p_tenant, p_order, p_request_id);
  end if;
  return v_response;
end;
$$;
revoke all on function app.update_portal_shipment(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.update_portal_shipment(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;

-- A proof accepted after the invoice exists (a balance payment) is recorded right away.
create function app.record_portal_proof_on_accept()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.record_portal_proof_payments(new.reviewed_by, new.tenant_id, new.sales_order_id, 'payment-proof:' || new.id::text);
  return null;
end;
$$;
revoke all on function app.record_portal_proof_on_accept() from public, anon, authenticated, hcs_hyperdrive;
create trigger payment_proofs_record_on_accept after update of status on app.payment_proofs
  for each row when (old.status is distinct from 'accepted' and new.status = 'accepted')
  execute function app.record_portal_proof_on_accept();

-- Logistics cards and reseller orders show the invoice once the sale is complete.
create or replace function app.portal_shipment_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'salesOrderId', o.id, 'orderNumber', o.order_number::text,
    'customerName', coalesce(o.customer_name_snapshot, c.full_name), 'customerPhone', c.phone,
    'method', s.method, 'status', s.status, 'courier', s.courier, 'trackingNumber', s.tracking_number, 'note', s.note,
    'deliveryAddress', o.delivery_address, 'locationName', l.name, 'totalMinor', round(o.total * 100)::bigint,
    'confirmedAt', o.confirmed_at, 'packedAt', s.packed_at, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at,
    'invoiceNumber', (select i.invoice_number::text from app.invoices i where i.tenant_id = o.tenant_id
      and i.sales_order_id = o.id order by i.issued_at desc, i.id limit 1),
    'balanceMinor', (select round(sum(app.wholesale_invoice_open_balance(o.tenant_id, i.id)) * 100)::bigint
      from app.invoices i where i.tenant_id = o.tenant_id and i.sales_order_id = o.id),
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

-- Orders already shipped or handed over before this migration are completed now, by the person who moved them.
-- One that cannot be completed (for example, stock no longer matches) is left as it was and logged here.
do $$
declare v_row record;
begin
  for v_row in
    select s.tenant_id, s.sales_order_id, s.updated_by from app.sales_order_shipments s
    join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
    where s.status in ('shipped', 'delivered') and o.status in ('confirmed', 'partially_fulfilled')
    order by s.tenant_id, s.created_at, s.sales_order_id
  loop
    begin
      perform app.fulfill_portal_order(v_row.updated_by, v_row.tenant_id, v_row.sales_order_id, 'portal-fulfillment-backfill');
    exception when others then
      raise notice 'Portal order % was not completed: % (%)', v_row.sales_order_id, sqlerrm, sqlstate;
    end;
  end loop;
end;
$$;

commit;
