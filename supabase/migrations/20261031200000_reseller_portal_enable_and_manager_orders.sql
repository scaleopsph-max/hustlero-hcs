-- Reseller portal: owners turn the portal on or off from the Back Office; managers handle portal orders;
-- portal sales earn loyalty points on the invoice total after discounts.
--   * `reseller_portal.orders` (owner, admin, manager): review and confirm orders, verify payments, update shipping.
--     `reseller_portal.manage` (owner, admin) still governs settings, payment accounts, applications, and accounts.
--   * Owner decision 2026-10-30: managers may confirm portal orders; points use the total after discount.
begin;

-- Turning the portal on or off ----------------------------------------------------

create function app.load_reseller_portal_availability(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member app.tenant_memberships%rowtype; v_entitlement app.tenant_entitlements%rowtype; v_feature app.features%rowtype;
begin
  select * into v_member from app.tenant_memberships where tenant_id = p_tenant and user_id = p_actor and status = 'active';
  if not found then raise exception using errcode = 'HCRA1', message = 'Reseller portal management is not allowed'; end if;
  select * into v_entitlement from app.tenant_entitlements where tenant_id = p_tenant and feature_code = 'reseller_portal';
  select * into v_feature from app.features where code = 'reseller_portal';
  return jsonb_build_object(
    'entitled', coalesce(v_entitlement.entitled and v_feature.platform_available
      and (v_entitlement.starts_at is null or v_entitlement.starts_at <= now())
      and (v_entitlement.ends_at is null or v_entitlement.ends_at > now()), false),
    'enabled', app.reseller_portal_enabled(p_tenant),
    'advancedWholesaleEnabled', exists (select 1 from app.tenant_entitlements e where e.tenant_id = p_tenant
      and e.feature_code = 'advanced_wholesale' and e.entitled and e.enabled
      and (e.starts_at is null or e.starts_at <= now()) and (e.ends_at is null or e.ends_at > now())),
    'canToggle', v_member.is_owner,
    'canManage', app.can_manage_reseller_portal(p_actor, p_tenant),
    'canHandleOrders', app.can_handle_reseller_portal_orders(p_actor, p_tenant));
end;
$$;

create function app.set_reseller_portal_enabled(p_actor uuid, p_tenant uuid, p_enabled boolean, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_entitlement app.tenant_entitlements%rowtype;
begin
  if p_enabled is null or nullif(p_request_id, '') is null then
    raise exception using errcode = 'HCRP3', message = 'Choose on or off';
  end if;
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant and user_id = p_actor
    and status = 'active' and is_owner) then
    raise exception using errcode = 'HCRA8', message = 'Only the owner can turn the reseller portal on or off';
  end if;
  select * into v_entitlement from app.tenant_entitlements where tenant_id = p_tenant and feature_code = 'reseller_portal' for update;
  if p_enabled and (not found or not v_entitlement.entitled
    or not exists (select 1 from app.features where code = 'reseller_portal' and platform_available)
    or (v_entitlement.starts_at is not null and v_entitlement.starts_at > now())
    or (v_entitlement.ends_at is not null and v_entitlement.ends_at <= now())) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not included in this plan';
  end if;
  if p_enabled and not exists (select 1 from app.tenant_entitlements e where e.tenant_id = p_tenant
    and e.feature_code = 'advanced_wholesale' and e.entitled and e.enabled) then
    raise exception using errcode = 'HCRA9', message = 'Turn on Advanced wholesale first';
  end if;
  if found and v_entitlement.enabled is distinct from p_enabled then
    update app.tenant_entitlements set enabled = p_enabled where tenant_id = p_tenant and feature_code = 'reseller_portal';
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor,
      case when p_enabled then 'reseller_portal.enabled' else 'reseller_portal.disabled' end, 'tenant', p_tenant,
      jsonb_build_object('featureCode', 'reseller_portal', 'enabled', p_enabled));
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (p_tenant, case when p_enabled then 'reseller_portal.enabled' else 'reseller_portal.disabled' end, 'tenant', p_tenant,
      jsonb_build_object('featureCode', 'reseller_portal', 'enabled', p_enabled));
  end if;
  return app.load_reseller_portal_availability(p_actor, p_tenant);
end;
$$;

-- Managers handle portal orders ---------------------------------------------------

insert into app.permissions (code, description) values
  ('reseller_portal.orders', 'Review and confirm reseller portal orders, verify their payments, and update shipping')
on conflict (code) do update set description = excluded.description;
insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, 'reseller_portal.orders' from app.roles role
where lower(role.code::text) in ('owner', 'admin', 'manager')
on conflict do nothing;

create function app.initialize_reseller_portal_order_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) in ('owner', 'admin', 'manager') then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values (new.tenant_id, new.id, 'reseller_portal.orders') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_reseller_portal_order_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_reseller_portal_order_permissions after insert on app.roles
  for each row execute function app.initialize_reseller_portal_order_permissions();

create function app.can_handle_reseller_portal_orders(p_actor uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.can_manage_reseller_portal(p_actor, p_tenant) or exists (
    select 1 from app.tenant_memberships m
    join app.membership_roles mr on mr.tenant_id = m.tenant_id and mr.user_id = m.user_id
    join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
    where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active'
      and rp.permission_code = 'reseller_portal.orders');
$$;
revoke all on function app.can_handle_reseller_portal_orders(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.assert_reseller_portal_orders(p_actor uuid, p_tenant uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.reseller_portal_enabled(p_tenant) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  if not app.can_handle_reseller_portal_orders(p_actor, p_tenant) then
    raise exception using errcode = 'HCRA1', message = 'Reseller portal order handling is not allowed';
  end if;
end;
$$;
revoke all on function app.assert_reseller_portal_orders(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

revoke all on function app.load_reseller_portal_availability(uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_portal_availability(uuid, uuid) to hcs_hyperdrive;
revoke all on function app.set_reseller_portal_enabled(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function app.set_reseller_portal_enabled(uuid, uuid, boolean, text) to hcs_hyperdrive;

-- Order work accepts either permission (bodies unchanged apart from the check). ---------------

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

CREATE OR REPLACE FUNCTION app.review_payment_proof(p_actor uuid, p_tenant uuid, p_proof uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_proof app.payment_proofs%rowtype; v_decision text := p_payload->>'decision';
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), ''); v_response jsonb;
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
  if coalesce(v_decision, '') not in ('accept', 'reject') or (v_decision = 'reject' and v_reason is null)
    or (v_reason is not null and char_length(v_reason) not between 2 and 500) then
    raise exception using errcode = 'HCRP3', message = 'Review decision is invalid';
  end if;
  select * into v_proof from app.payment_proofs where tenant_id = p_tenant and id = p_proof for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The payment proof was not found'; end if;
  if v_proof.status <> 'pending' then raise exception using errcode = 'HCRA5', message = 'The payment proof was already reviewed'; end if;
  update app.payment_proofs set status = case when v_decision = 'accept' then 'accepted' else 'rejected' end,
    review_reason = v_reason, reviewed_by = p_actor, reviewed_at = now()
  where tenant_id = p_tenant and id = p_proof;
  v_response := jsonb_build_object('proofId', p_proof, 'salesOrderId', v_proof.sales_order_id,
    'status', case when v_decision = 'accept' then 'accepted' else 'rejected' end);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'payment_proof.' || (v_response->>'status'), 'sales_order',
    v_proof.sales_order_id, v_reason, v_response || jsonb_build_object('reference', v_proof.reference,
      'amountMinor', round(v_proof.amount * 100)::bigint));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'payment_proof.' || (v_response->>'status'), 'sales_order', v_proof.sales_order_id, v_response);
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION app.list_pending_payment_proofs(p_actor uuid, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
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
$function$;

CREATE OR REPLACE FUNCTION app.update_portal_shipment_core(p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_shipment app.sales_order_shipments%rowtype; v_next text := p_payload->>'status'; v_response jsonb;
  v_courier text := nullif(p_payload->>'courier', ''); v_tracking text := nullif(btrim(coalesce(p_payload->>'trackingNumber', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
begin
  perform app.assert_reseller_portal_orders(p_actor, p_tenant);
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
$function$;

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
  return v_response;
end;
$function$;

-- Managers load the same screen; settings, accounts, and applications stay read-only for them.
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

-- Managers get the order and payment alerts; applications stay with portal managers.
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
end;
$function$;

-- Loyalty --------------------------------------------------------------------------

-- Awards points once per invoice sale, on the sale total after discounts (owner decision 2026-10-30).
create function app.award_portal_loyalty(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_policy app.loyalty_policies%rowtype; v_sale app.sales%rowtype; v_points bigint; v_total bigint := 0; v_id uuid;
begin
  select * into v_policy from app.loyalty_policies where tenant_id = p_tenant;
  if not found or not v_policy.enabled then return 0; end if;
  for v_sale in
    select s.* from app.invoices i join app.sales s on s.tenant_id = i.tenant_id and s.id = i.sale_id
    where i.tenant_id = p_tenant and i.sales_order_id = p_order and s.customer_id is not null
      and not exists (select 1 from app.loyalty_transactions t where t.tenant_id = s.tenant_id and t.sale_id = s.id
        and t.transaction_type = 'sale_earn')
    order by s.completed_at, s.id
  loop
    v_points := floor(round(v_sale.total * 100)::bigint / round(v_policy.spend_per_point * 100)::bigint)::bigint;
    continue when v_points <= 0;
    v_id := gen_random_uuid();
    insert into app.loyalty_transactions (id, tenant_id, customer_id, transaction_type, points_delta, balance_after_points,
      spend_per_point_centavos, sale_id, actor_user_id, occurred_at)
    values (v_id, p_tenant, v_sale.customer_id, 'sale_earn', v_points, 0, round(v_policy.spend_per_point * 100)::bigint,
      v_sale.id, p_actor, now());
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor, 'loyalty.points_earned', 'loyalty_transaction', v_id, v_sale.location_id,
      jsonb_build_object('saleId', v_sale.id, 'customerId', v_sale.customer_id, 'points', v_points, 'source', 'reseller_portal'));
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (p_tenant, 'loyalty.points_earned', 'customer', v_sale.customer_id,
      jsonb_build_object('transactionId', v_id, 'saleId', v_sale.id, 'points', v_points));
    v_total := v_total + v_points;
  end loop;
  return v_total;
end;
$$;
revoke all on function app.award_portal_loyalty(uuid, uuid, uuid, text) from public, anon, authenticated, hcs_hyperdrive;

-- Completing a portal sale (shipping or pickup) now also awards loyalty points.
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

commit;
