-- Reseller statement of account, loyalty history in the portal, returns on portal orders, and portal insights.
--   * Statement: what the reseller owes (open invoices with due dates and age, orders not invoiced yet), payments,
--     returns, and pending proofs. Read-only.
--   * Loyalty: the earning rule, balance, and every earn or reversal for this reseller.
--   * Returns use the existing audited wholesale return (credit notes, restock, loyalty reversal through refunds);
--     resellers now see them on the order, in the statement, and as a notification.
--   * Insights (Reports): balances by age, paid vs expired per reseller, and how long each step takes.
begin;

-- Statement of account -------------------------------------------------------------

create function app.load_reseller_statement(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
$$;
revoke all on function app.load_reseller_statement(uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_statement(uuid, uuid) to hcs_hyperdrive;

-- Loyalty in the portal ------------------------------------------------------------

create function app.load_reseller_loyalty(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
$$;
revoke all on function app.load_reseller_loyalty(uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_loyalty(uuid, uuid) to hcs_hyperdrive;

-- Returns on portal orders -----------------------------------------------------------

alter table app.reseller_notifications drop constraint reseller_notifications_kind_check;
alter table app.reseller_notifications add constraint reseller_notifications_kind_check check (kind in (
  'order_confirmed', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'payment_verified', 'payment_rejected',
  'order_expired', 'order_rejected', 'return_recorded'));

-- Orders now list their returns (credit notes).
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

-- Resellers are told when a return is recorded.
CREATE OR REPLACE FUNCTION app.sync_reseller_notifications(p_tenant uuid, p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_customer uuid; v_since timestamptz := now() - interval '30 days';
begin
  select customer_id into v_customer from app.reseller_accounts where tenant_id = p_tenant and id = p_account;
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
  ) e
  where e.at is not null
  on conflict (tenant_id, reseller_account_id, dedup_key) do nothing;
end;
$function$;

-- Logistics cards carry the invoice id so Back Office can open a return for it.
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
$function$;

-- Insights for Reports ---------------------------------------------------------------

create function app.load_reseller_portal_insights(p_actor uuid, p_tenant uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz; v_today date;
begin
  if not (app.can_handle_reseller_portal_orders(p_actor, p_tenant) or exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active'
      and (m.is_owner or exists (select 1 from app.membership_roles mr
        join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = p_tenant and mr.user_id = p_actor and rp.permission_code = 'reports.read'))))
  then raise exception using errcode = 'HCSD0', message = 'Reporting access is not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  select timezone into v_timezone from app.tenants where id = p_tenant;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;
  v_today := (now() at time zone v_timezone)::date;
  return (
    with resellers as (
      select a.customer_id, c.full_name, c.customer_number::text customer_number
      from app.reseller_accounts a join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      where a.tenant_id = p_tenant
    ), open_invoices as (
      select i.customer_id, app.wholesale_invoice_open_balance(p_tenant, i.id) balance,
        greatest(v_today - coalesce(ch.due_date, (i.issued_at at time zone v_timezone)::date), 0) days_overdue
      from app.invoices i
      left join app.wholesale_invoice_charges ch on ch.tenant_id = i.tenant_id and ch.invoice_id = i.id
      where i.tenant_id = p_tenant and i.customer_id in (select customer_id from resellers)
    ), aging as (
      select r.customer_id, r.full_name, r.customer_number,
        coalesce(sum(o.balance) filter (where o.days_overdue = 0), 0) not_due,
        coalesce(sum(o.balance) filter (where o.days_overdue between 1 and 7), 0) d1_7,
        coalesce(sum(o.balance) filter (where o.days_overdue between 8 and 15), 0) d8_15,
        coalesce(sum(o.balance) filter (where o.days_overdue between 16 and 30), 0) d16_30,
        coalesce(sum(o.balance) filter (where o.days_overdue > 30), 0) over_30,
        coalesce(max(o.days_overdue) filter (where o.balance > 0), 0) oldest
      from resellers r join open_invoices o on o.customer_id = r.customer_id and o.balance > 0
      group by r.customer_id, r.full_name, r.customer_number
    ), orders as (
      select o.id, o.customer_id, o.created_at, o.confirmed_at, o.status, o.review_reason,
        exists (select 1 from audit.audit_events e where e.tenant_id = o.tenant_id and e.entity_type = 'sales_order'
          and e.entity_id = o.id and e.action = 'sales_order.payment_expired') expired,
        (select min(p.created_at) from app.payment_proofs p where p.tenant_id = o.tenant_id and p.sales_order_id = o.id) first_proof,
        s.method, s.shipped_at, s.delivered_at,
        case when s.method = 'pickup' then s.delivered_at else s.shipped_at end sent_at
      from app.sales_orders o
      left join app.sales_order_shipments s on s.tenant_id = o.tenant_id and s.sales_order_id = o.id
      where o.tenant_id = p_tenant and o.source = 'reseller_portal' and o.created_at >= v_start and o.created_at < v_end
    ), conversion as (
      select r.customer_id, r.full_name, count(*) placed,
        count(*) filter (where o.confirmed_at is not null) paid,
        count(*) filter (where o.expired) expired,
        count(*) filter (where o.status = 'cancelled' and not o.expired) rejected,
        count(*) filter (where o.status = 'submitted') open
      from orders o join resellers r on r.customer_id = o.customer_id
      group by r.customer_id, r.full_name
    ), steps as (
      select 'order_to_payment' step, 1 position, extract(epoch from first_proof - created_at) / 3600 hours from orders where first_proof is not null
      union all select 'payment_to_confirmed', 2, extract(epoch from confirmed_at - first_proof) / 3600 from orders
        where confirmed_at is not null and first_proof is not null and confirmed_at >= first_proof
      union all select 'confirmed_to_sent', 3, extract(epoch from sent_at - confirmed_at) / 3600 from orders
        where sent_at is not null and confirmed_at is not null
      union all select 'sent_to_delivered', 4, extract(epoch from delivered_at - shipped_at) / 3600 from orders
        where method = 'delivery' and delivered_at is not null and shipped_at is not null
      union all select 'order_to_delivered', 5, extract(epoch from delivered_at - created_at) / 3600 from orders
        where delivered_at is not null
    )
    select jsonb_build_object(
      'aging', jsonb_build_object('asOf', v_today,
        'totals', jsonb_build_object(
          'notDueMinor', (select round(coalesce(sum(not_due), 0) * 100)::bigint from aging),
          'days1To7Minor', (select round(coalesce(sum(d1_7), 0) * 100)::bigint from aging),
          'days8To15Minor', (select round(coalesce(sum(d8_15), 0) * 100)::bigint from aging),
          'days16To30Minor', (select round(coalesce(sum(d16_30), 0) * 100)::bigint from aging),
          'over30Minor', (select round(coalesce(sum(over_30), 0) * 100)::bigint from aging)),
        'resellers', coalesce((select jsonb_agg(jsonb_build_object('customerId', customer_id, 'customerName', full_name,
            'customerNumber', customer_number, 'notDueMinor', round(not_due * 100)::bigint,
            'days1To7Minor', round(d1_7 * 100)::bigint, 'days8To15Minor', round(d8_15 * 100)::bigint,
            'days16To30Minor', round(d16_30 * 100)::bigint, 'over30Minor', round(over_30 * 100)::bigint,
            'totalMinor', round((not_due + d1_7 + d8_15 + d16_30 + over_30) * 100)::bigint, 'oldestDaysOverdue', oldest)
            order by oldest desc, (not_due + d1_7 + d8_15 + d16_30 + over_30) desc, full_name) from aging), '[]'::jsonb)),
      'conversion', coalesce((select jsonb_agg(jsonb_build_object('customerId', customer_id, 'customerName', full_name,
          'placed', placed, 'paid', paid, 'expired', expired, 'rejected', rejected, 'open', open,
          'paidPercent', case when placed - open > 0 then round(100.0 * paid / (placed - open)) end)
          order by expired desc, placed desc, full_name) from conversion), '[]'::jsonb),
      'speed', (select jsonb_agg(jsonb_build_object('step', s.step, 'orders', coalesce(x.n, 0),
          'medianHours', round(x.median::numeric, 1), 'averageHours', round(x.average::numeric, 1)) order by s.position)
        from (values ('order_to_payment', 1), ('payment_to_confirmed', 2), ('confirmed_to_sent', 3),
          ('sent_to_delivered', 4), ('order_to_delivered', 5)) s(step, position)
        left join (select step, count(*) n, percentile_cont(0.5) within group (order by hours) median, avg(hours) average
          from steps group by step) x on x.step = s.step)));
end;
$$;
revoke all on function app.load_reseller_portal_insights(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function app.load_reseller_portal_insights(uuid, uuid, date, date) to hcs_hyperdrive;

commit;
