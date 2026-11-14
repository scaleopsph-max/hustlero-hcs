-- Reseller portal notifications (in-app). No email or push yet.
--   * Back Office bell: portal orders waiting for payment verification, balance payments to verify, and new
--     reseller applications, for members who manage the portal at the portal branch.
--   * Reseller portal inbox: confirmed, ready for pickup, shipped (with courier and tracking), delivered or
--     picked up, payment verified or not accepted, and cancelled orders (expired or not accepted).
-- Both follow the existing notification center pattern: rows are derived from the source records when the
-- inbox loads, deduplicated by key, and only read state ever changes. Events older than 30 days are not added.
begin;

-- Back Office ------------------------------------------------------------------

alter function app.sync_core_notifications(uuid) rename to sync_core_notifications_base;
revoke all on function app.sync_core_notifications_base(uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.sync_portal_notifications(p_tenant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
    and app.can_manage_reseller_portal(m.user_id, p_tenant_id)
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
    and app.can_manage_reseller_portal(m.user_id, p_tenant_id)
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
end;
$$;
revoke all on function app.sync_portal_notifications(uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.sync_core_notifications(p_tenant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.sync_core_notifications_base(p_tenant_id);
  perform app.sync_portal_notifications(p_tenant_id);
end;
$$;
revoke all on function app.sync_core_notifications(uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Reseller portal --------------------------------------------------------------

create table app.reseller_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  reseller_account_id uuid not null,
  sales_order_id uuid,
  kind text not null check (kind in ('order_confirmed', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up',
    'payment_verified', 'payment_rejected', 'order_expired', 'order_rejected')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  dedup_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reseller_account_id, dedup_key),
  foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict
);
create index reseller_notifications_inbox_idx on app.reseller_notifications (tenant_id, reseller_account_id, created_at desc, id);
alter table app.reseller_notifications enable row level security;
revoke all on app.reseller_notifications from public, anon, authenticated, hcs_hyperdrive;

create function app.protect_reseller_notification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'notifications cannot be deleted'; end if;
  if (to_jsonb(new) - 'read_at') <> (to_jsonb(old) - 'read_at') then
    raise exception 'notification history fields are immutable';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_reseller_notification() from public, anon, authenticated, hcs_hyperdrive;
create trigger reseller_notifications_protect before update or delete on app.reseller_notifications
  for each row execute function app.protect_reseller_notification();

create function app.sync_reseller_notifications(p_tenant uuid, p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
  ) e
  where e.at is not null
  on conflict (tenant_id, reseller_account_id, dedup_key) do nothing;
end;
$$;
revoke all on function app.sync_reseller_notifications(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.load_reseller_notifications(p_auth_user uuid, p_tenant uuid, p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'HCRP3', message = 'Notification filters are invalid';
  end if;
  perform app.sync_reseller_notifications(p_tenant, v_account.id);
  return jsonb_build_object(
    'unreadCount', (select count(*)::integer from app.reseller_notifications
      where tenant_id = p_tenant and reseller_account_id = v_account.id and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title,
        'message', n.message, 'salesOrderId', n.sales_order_id, 'createdAt', n.created_at, 'readAt', n.read_at)
        order by n.created_at desc, n.id)
      from (select * from app.reseller_notifications where tenant_id = p_tenant and reseller_account_id = v_account.id
        order by created_at desc, id limit p_limit) n), '[]'::jsonb));
end;
$$;
revoke all on function app.load_reseller_notifications(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function app.load_reseller_notifications(uuid, uuid, integer) to hcs_hyperdrive;

-- Marks one notification, or all of them when p_notification is null, as read.
create function app.mark_reseller_notifications_read(p_auth_user uuid, p_tenant uuid, p_notification uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if p_notification is not null and not exists (select 1 from app.reseller_notifications
    where tenant_id = p_tenant and reseller_account_id = v_account.id and id = p_notification) then
    raise exception using errcode = 'HCRA4', message = 'The notification was not found';
  end if;
  update app.reseller_notifications set read_at = now()
  where tenant_id = p_tenant and reseller_account_id = v_account.id and read_at is null
    and (p_notification is null or id = p_notification);
  return jsonb_build_object('unreadCount', (select count(*)::integer from app.reseller_notifications
    where tenant_id = p_tenant and reseller_account_id = v_account.id and read_at is null));
end;
$$;
revoke all on function app.mark_reseller_notifications_read(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.mark_reseller_notifications_read(uuid, uuid, uuid) to hcs_hyperdrive;

commit;
