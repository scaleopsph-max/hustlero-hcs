-- Faster ordering for resellers: favorite products, "notify me" when an out-of-stock item is back, and a "New"
-- flag for products added in the last 14 days. Back-in-stock alerts become reseller notifications (and push)
-- the next time notifications are built. Owner selection 2026-10-31.
begin;

create table app.reseller_favorites (
  tenant_id uuid not null,
  reseller_account_id uuid not null,
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, reseller_account_id, product_id),
  foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references app.products (tenant_id, id) on delete cascade
);
alter table app.reseller_favorites enable row level security;
revoke all on app.reseller_favorites from public, anon, authenticated, hcs_hyperdrive;

create table app.reseller_stock_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  reseller_account_id uuid not null,
  variant_id uuid not null,
  requested_at timestamptz not null default now(),
  notified_at timestamptz,
  foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete cascade
);
create unique index reseller_stock_alerts_open_idx on app.reseller_stock_alerts (tenant_id, reseller_account_id, variant_id)
  where notified_at is null;
alter table app.reseller_stock_alerts enable row level security;
revoke all on app.reseller_stock_alerts from public, anon, authenticated, hcs_hyperdrive;

alter table app.reseller_notifications drop constraint reseller_notifications_kind_check;
alter table app.reseller_notifications add constraint reseller_notifications_kind_check check (kind in (
  'order_confirmed', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'payment_verified', 'payment_rejected',
  'order_expired', 'order_rejected', 'return_recorded', 'payment_due_soon', 'payment_overdue', 'payment_window_closing',
  'back_in_stock'));

-- True when the variant is sellable and on the reseller's price list.
create function app.reseller_can_see_variant(p_tenant uuid, p_account uuid, p_variant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.reseller_accounts account
    join app.price_list_entries entry on entry.tenant_id = account.tenant_id and entry.price_list_id = account.price_list_id
    join app.product_variants variant on variant.tenant_id = entry.tenant_id and variant.id = entry.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    where account.tenant_id = p_tenant and account.id = p_account and variant.id = p_variant
      and variant.is_active and product.status = 'active');
$$;
revoke all on function app.reseller_can_see_variant(uuid, uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Adds or removes a product from the reseller's favorites. Setting the same state twice is harmless.
create function app.save_reseller_favorite(p_auth_user uuid, p_tenant uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_product uuid;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('productId', 'favorite'))
    or coalesce(p_payload->>'productId', '') !~ '^[0-9a-f-]{36}$'
    or jsonb_typeof(p_payload->'favorite') is distinct from 'boolean' then
    raise exception using errcode = 'HCRP3', message = 'Favorite details are invalid';
  end if;
  v_product := (p_payload->>'productId')::uuid;
  if (p_payload->>'favorite')::boolean then
    if not exists (select 1 from app.product_variants v where v.tenant_id = p_tenant and v.product_id = v_product
      and app.reseller_can_see_variant(p_tenant, v_account.id, v.id)) then
      raise exception using errcode = 'HCRF1', message = 'This product is not in your catalog';
    end if;
    insert into app.reseller_favorites (tenant_id, reseller_account_id, product_id)
    values (p_tenant, v_account.id, v_product) on conflict do nothing;
  else
    delete from app.reseller_favorites where tenant_id = p_tenant and reseller_account_id = v_account.id and product_id = v_product;
  end if;
  return jsonb_build_object('productId', v_product, 'favorite', (p_payload->>'favorite')::boolean);
end;
$$;
revoke all on function app.save_reseller_favorite(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.save_reseller_favorite(uuid, uuid, jsonb) to hcs_hyperdrive;

-- Turns "notify me when back in stock" on or off for one out-of-stock variant.
create function app.save_reseller_stock_alert(p_auth_user uuid, p_tenant uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_variant uuid; v_location uuid;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('variantId', 'notify'))
    or coalesce(p_payload->>'variantId', '') !~ '^[0-9a-f-]{36}$'
    or jsonb_typeof(p_payload->'notify') is distinct from 'boolean' then
    raise exception using errcode = 'HCRP3', message = 'Alert details are invalid';
  end if;
  v_variant := (p_payload->>'variantId')::uuid;
  if (p_payload->>'notify')::boolean then
    if not app.reseller_can_see_variant(p_tenant, v_account.id, v_variant) then
      raise exception using errcode = 'HCRF1', message = 'This product is not in your catalog';
    end if;
    select fulfillment_location_id into v_location from app.reseller_portal_settings where tenant_id = p_tenant;
    if app.reseller_stock_status(p_tenant, v_location, v_variant) <> 'out_of_stock' then
      raise exception using errcode = 'HCRF2', message = 'This item is in stock';
    end if;
    insert into app.reseller_stock_alerts (tenant_id, reseller_account_id, variant_id)
    values (p_tenant, v_account.id, v_variant)
    on conflict (tenant_id, reseller_account_id, variant_id) where notified_at is null do nothing;
  else
    delete from app.reseller_stock_alerts where tenant_id = p_tenant and reseller_account_id = v_account.id
      and variant_id = v_variant and notified_at is null;
  end if;
  return jsonb_build_object('variantId', v_variant, 'notify', (p_payload->>'notify')::boolean);
end;
$$;
revoke all on function app.save_reseller_stock_alert(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.save_reseller_stock_alert(uuid, uuid, jsonb) to hcs_hyperdrive;

-- Turns open alerts whose item is available again into one notification each. Alerts for items that left the
-- reseller's catalog are closed without a notification.
create function app.sync_reseller_stock_alerts(p_tenant uuid, p_account uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_location uuid; v_row record;
begin
  select fulfillment_location_id into v_location from app.reseller_portal_settings where tenant_id = p_tenant;
  if v_location is null then return; end if;
  for v_row in
    select a.id, a.variant_id, product.name product_name, variant.name variant_name,
      app.reseller_can_see_variant(p_tenant, p_account, a.variant_id) visible
    from app.reseller_stock_alerts a
    join app.product_variants variant on variant.tenant_id = a.tenant_id and variant.id = a.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    where a.tenant_id = p_tenant and a.reseller_account_id = p_account and a.notified_at is null
    for update of a skip locked
  loop
    if v_row.visible and app.reseller_stock_status(p_tenant, v_location, v_row.variant_id) = 'out_of_stock' then
      continue;
    end if;
    if v_row.visible then
      insert into app.reseller_notifications (tenant_id, reseller_account_id, kind, title, message, dedup_key)
      values (p_tenant, p_account, 'back_in_stock', left(v_row.product_name || ' is back in stock', 200),
        left(v_row.variant_name || ' is available again. Order now while stock lasts.', 1000), 'stock:' || v_row.id::text)
      on conflict (tenant_id, reseller_account_id, dedup_key) do nothing;
    end if;
    update app.reseller_stock_alerts set notified_at = now() where id = v_row.id;
  end loop;
end;
$$;
revoke all on function app.sync_reseller_stock_alerts(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

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
end;
$function$;

commit;
