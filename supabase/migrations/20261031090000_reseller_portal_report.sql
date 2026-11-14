-- Reseller portal report: orders, sales per reseller, top products, verified payments, and logistics
-- for a date range in the business's time zone. Read-only; it records nothing.
--   * Orders, sales, and products use the date the reseller placed the order.
--   * Payments use the date the reseller sent the proof; only accepted proofs count as received.
--   * Logistics uses the date the order entered Logistics (when it was confirmed).
begin;

create function app.load_reseller_portal_report(p_actor uuid, p_tenant uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz; v_result jsonb;
begin
  if not (app.can_manage_reseller_portal(p_actor, p_tenant) or exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr
        join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = p_tenant and mr.user_id = p_actor and rp.permission_code = 'reports.read'))))
  then
    raise exception using errcode = 'HCSD0', message = 'Reporting access is not allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  select timezone into v_timezone from app.tenants where id = p_tenant;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with orders as (
    select o.id, o.order_number, o.customer_id, coalesce(o.customer_name_snapshot, c.full_name) customer_name,
      coalesce(o.customer_number_snapshot, c.customer_number::text) customer_number, o.total, o.created_at,
      case
        when o.status = 'submitted' and o.review_reason = 'awaiting_payment' then 'awaiting_payment'
        when o.status = 'submitted' then 'for_confirmation'
        when o.status in ('confirmed', 'partially_fulfilled', 'fulfilled') then 'confirmed'
        when exists (select 1 from audit.audit_events e where e.tenant_id = o.tenant_id and e.entity_type = 'sales_order'
          and e.entity_id = o.id and e.action = 'sales_order.payment_expired') then 'expired'
        else 'rejected'
      end bucket,
      coalesce((select sum(p.amount) from app.payment_proofs p where p.tenant_id = o.tenant_id and p.sales_order_id = o.id
        and p.status = 'accepted'), 0) paid
    from app.sales_orders o
    join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
    where o.tenant_id = p_tenant and o.source = 'reseller_portal' and o.created_at >= v_start and o.created_at < v_end
  ), confirmed as (
    select *, greatest(total - paid, 0) outstanding from orders where bucket = 'confirmed'
  ), proofs as (
    select p.id, p.method, p.amount, p.reference, p.created_at, p.reviewed_at, o.order_number,
      coalesce(o.customer_name_snapshot, c.full_name) customer_name
    from app.payment_proofs p
    join app.sales_orders o on o.tenant_id = p.tenant_id and o.id = p.sales_order_id
    join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
    where p.tenant_id = p_tenant and p.status = 'accepted' and p.created_at >= v_start and p.created_at < v_end
  ), shipments as (
    select s.*, o.order_number, coalesce(o.customer_name_snapshot, c.full_name) customer_name
    from app.sales_order_shipments s
    join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
    join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
    where s.tenant_id = p_tenant and s.created_at >= v_start and s.created_at < v_end
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', v_timezone,
    'summary', jsonb_build_object(
      'orderCount', (select count(*) from orders),
      'confirmedCount', (select count(*) from confirmed),
      'salesMinor', (select round(coalesce(sum(total), 0) * 100)::bigint from confirmed),
      'verifiedPaymentsMinor', (select round(coalesce(sum(amount), 0) * 100)::bigint from proofs),
      'outstandingMinor', (select round(coalesce(sum(outstanding), 0) * 100)::bigint from confirmed),
      'shipmentCount', (select count(*) from shipments),
      'deliveredCount', (select count(*) from shipments where status = 'delivered')),
    'byStatus', (select jsonb_agg(jsonb_build_object('status', b.status,
        'orderCount', (select count(*) from orders where bucket = b.status),
        'totalMinor', (select round(coalesce(sum(total), 0) * 100)::bigint from orders where bucket = b.status))
        order by b.position)
      from unnest(array['awaiting_payment', 'for_confirmation', 'confirmed', 'expired', 'rejected'])
        with ordinality b(status, position)),
    'byReseller', coalesce((select jsonb_agg(j order by (j->>'salesMinor')::bigint desc, j->>'customerName') from (
      select jsonb_build_object('customerId', customer_id, 'customerName', min(customer_name),
        'customerNumber', min(customer_number), 'orderCount', count(*),
        'confirmedCount', count(*) filter (where bucket = 'confirmed'),
        'salesMinor', round(coalesce(sum(total) filter (where bucket = 'confirmed'), 0) * 100)::bigint,
        'paidMinor', round(coalesce(sum(least(paid, total)) filter (where bucket = 'confirmed'), 0) * 100)::bigint,
        'outstandingMinor', round(coalesce(sum(greatest(total - paid, 0)) filter (where bucket = 'confirmed'), 0) * 100)::bigint
      ) j from orders group by customer_id) r), '[]'::jsonb),
    'topProducts', coalesce((select jsonb_agg(j order by (j->>'salesMinor')::bigint desc, j->>'productName') from (
      select jsonb_build_object('variantId', line.variant_id, 'productName', min(line.product_name_snapshot),
        'variantName', min(line.variant_name_snapshot), 'sku', min(line.sku_snapshot),
        'quantityMilli', round(sum(line.ordered_quantity - line.cancelled_quantity) * 1000)::bigint,
        'orderCount', count(distinct line.sales_order_id),
        'salesMinor', round(sum(round((line.ordered_quantity - line.cancelled_quantity) * line.unit_price, 2)) * 100)::bigint
      ) j
      from app.sales_order_lines line join confirmed o on o.id = line.sales_order_id
      where line.tenant_id = p_tenant group by line.variant_id
      order by sum(round((line.ordered_quantity - line.cancelled_quantity) * line.unit_price, 2)) desc limit 20) r), '[]'::jsonb),
    'payments', jsonb_build_object(
      'byMethod', (select jsonb_agg(jsonb_build_object('method', m.method,
          'count', (select count(*) from proofs where method = m.method),
          'amountMinor', (select round(coalesce(sum(amount), 0) * 100)::bigint from proofs where method = m.method)))
        from unnest(array['gcash', 'bank_transfer']) m(method)),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'orderNumber', order_number::text,
          'customerName', customer_name, 'method', method, 'reference', reference,
          'amountMinor', round(amount * 100)::bigint, 'sentAt', created_at, 'verifiedAt', reviewed_at)
          order by created_at desc, id)
        from (select * from proofs order by created_at desc, id limit 500) p), '[]'::jsonb)),
    'logistics', jsonb_build_object(
      'byStatus', (select jsonb_agg(jsonb_build_object('status', st.status,
          'deliveryCount', (select count(*) from shipments where status = st.status and method = 'delivery'),
          'pickupCount', (select count(*) from shipments where status = st.status and method = 'pickup'))
          order by st.position)
        from unnest(array['to_pack', 'packed', 'shipped', 'delivered']) with ordinality st(status, position)),
      'byCourier', coalesce((select jsonb_agg(jsonb_build_object('courier', courier,
          'shipmentCount', count, 'deliveredCount', delivered) order by count desc, courier)
        from (select coalesce(courier, 'none') courier, count(*) count, count(*) filter (where status = 'delivered') delivered
          from shipments where method = 'delivery' and status in ('shipped', 'delivered') group by 1) g), '[]'::jsonb),
      'shipments', coalesce((select jsonb_agg(jsonb_build_object('orderId', sales_order_id,
          'orderNumber', order_number::text, 'customerName', customer_name, 'method', method, 'status', status,
          'courier', courier, 'trackingNumber', tracking_number, 'shippedAt', shipped_at, 'deliveredAt', delivered_at)
          order by coalesce(shipped_at, created_at) desc, sales_order_id)
        from (select * from shipments order by coalesce(shipped_at, created_at) desc, sales_order_id limit 500) s), '[]'::jsonb))
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function app.load_reseller_portal_report(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function app.load_reseller_portal_report(uuid, uuid, date, date) to hcs_hyperdrive;

commit;
