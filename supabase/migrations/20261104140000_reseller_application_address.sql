-- Reseller applications ask for a delivery address and refuse duplicates (owner direction 2026-11-04).
--   * Address: province, city or municipality, and barangay picked from the PSGC lists in the portal, plus the
--     house number, street, and building typed by the applicant. Kept on the application and copied to the
--     reseller account on approval as the default delivery address.
--   * Duplicates: within one business, an email or mobile number already on a pending or approved application,
--     or on a reseller account, cannot apply again. Declined applicants may reapply. Other businesses are not
--     checked. Mobile numbers are compared in the 09XXXXXXXXX form.
begin;

create function app.normalize_ph_mobile(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^63[0-9]{10}$' then '0' || substr(d, 3)
    when d ~ '^9[0-9]{9}$' then '0' || d
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') d) x;
$$;

create function app.valid_reseller_address(p_address jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_address) = 'object'
    and (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_address) k)
      = array['barangay', 'barangayCode', 'city', 'cityCode', 'line', 'province', 'provinceCode']
    and coalesce(p_address->>'barangayCode', '') ~ '^[0-9]{10}$'
    and coalesce(p_address->>'cityCode', '') ~ '^[0-9]{10}$'
    and coalesce(p_address->>'provinceCode', '') ~ '^[0-9]{10}$'
    and char_length(btrim(coalesce(p_address->>'barangay', ''))) between 1 and 120
    and char_length(btrim(coalesce(p_address->>'city', ''))) between 2 and 120
    and char_length(btrim(coalesce(p_address->>'province', ''))) between 2 and 120
    and char_length(btrim(coalesce(p_address->>'line', ''))) between 5 and 200;
$$;

revoke all on function app.normalize_ph_mobile(text) from public, anon, authenticated;
revoke all on function app.valid_reseller_address(jsonb) from public, anon, authenticated;

alter table app.reseller_applications
  add column address jsonb check (address is null or app.valid_reseller_address(address));
alter table app.reseller_accounts
  add column delivery_address jsonb check (delivery_address is null or app.valid_reseller_address(delivery_address));
create index reseller_applications_mobile_idx on app.reseller_applications (tenant_id, app.normalize_ph_mobile(phone))
  where status in ('pending', 'approved');

CREATE OR REPLACE FUNCTION app.submit_reseller_application(p_tenant_slug text, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid; v_open boolean;
  v_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_phone text := app.normalize_ph_mobile(p_payload->>'phone');
  v_address jsonb;
begin
  select tenant.id into v_tenant from app.tenants tenant where tenant.slug = lower(btrim(coalesce(p_tenant_slug, '')));
  if v_tenant is null or not app.reseller_portal_enabled(v_tenant) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  -- One application at a time per business, so two quick submissions cannot both pass the duplicate check.
  select applications_open into v_open from app.reseller_portal_settings where tenant_id = v_tenant for update;
  if not coalesce(v_open, false) then
    raise exception using errcode = 'HCRP6', message = 'Reseller applications are closed';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('fullName', 'businessName', 'email', 'phone', 'address', 'message', 'referralCode'))
    or nullif(btrim(p_request_id), '') is null
    or v_phone !~ '^09[0-9]{9}$'
    or not app.valid_reseller_address(p_payload->'address') then
    raise exception using errcode = 'HCRP3', message = 'Application details are invalid';
  end if;
  v_address := jsonb_build_object(
    'line', btrim(p_payload->'address'->>'line'),
    'barangayCode', p_payload->'address'->>'barangayCode', 'barangay', btrim(p_payload->'address'->>'barangay'),
    'cityCode', p_payload->'address'->>'cityCode', 'city', btrim(p_payload->'address'->>'city'),
    'provinceCode', p_payload->'address'->>'provinceCode', 'province', btrim(p_payload->'address'->>'province'));
  if exists (select 1 from app.reseller_applications a where a.tenant_id = v_tenant and a.status in ('pending', 'approved')
      and (a.email = v_email::extensions.citext or app.normalize_ph_mobile(a.phone) = v_phone))
    or exists (select 1 from app.reseller_accounts r where r.tenant_id = v_tenant and r.email = v_email::extensions.citext)
    or exists (select 1 from app.reseller_accounts r join app.customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
      where r.tenant_id = v_tenant and app.normalize_ph_mobile(c.phone) = v_phone) then
    raise exception using errcode = 'HCRPA', message = 'This email or mobile number is already used for this business';
  end if;
  begin
    -- An unknown or inactive referral code is ignored, never refused.
    insert into app.reseller_applications (tenant_id, full_name, business_name, email, phone, city, address, message,
      request_id, referred_by_account_id)
    values (v_tenant, btrim(p_payload->>'fullName'), nullif(btrim(p_payload->>'businessName'), ''), v_email, v_phone,
      v_address->>'city', v_address, nullif(btrim(p_payload->>'message'), ''), p_request_id,
      (select a.id from app.reseller_accounts a where a.tenant_id = v_tenant and a.status = 'active'
        and a.referral_code = upper(btrim(coalesce(p_payload->>'referralCode', '')))));
  exception
    when unique_violation then
      raise exception using errcode = 'HCRPA', message = 'This email or mobile number is already used for this business';
    when check_violation or not_null_violation then
      raise exception using errcode = 'HCRP3', message = 'Application details are invalid';
  end;
  return jsonb_build_object('status', 'received');
end;
$function$;

CREATE OR REPLACE FUNCTION app.decide_reseller_application(p_actor uuid, p_tenant uuid, p_application uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing app.idempotency_records%rowtype; v_application app.reseller_applications%rowtype;
  v_account app.reseller_accounts%rowtype; v_customer uuid; v_created jsonb; v_response jsonb;
  v_decision text := p_payload->>'decision'; v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(v_decision, '') not in ('approve', 'reject')
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('decision', 'reason', 'customerId', 'priceListId', 'paymentTerm', 'creditLimitMinor'))
    or (v_decision = 'reject' and (v_reason is null or char_length(v_reason) not between 2 and 500))
    or (v_decision = 'approve' and (not (p_payload ?& array['priceListId', 'paymentTerm', 'creditLimitMinor'])
      or jsonb_typeof(p_payload->'creditLimitMinor') is distinct from 'number'))
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,120}$' or nullif(p_hash, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Application decision is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-application:' || p_application::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.application_decision' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  select * into v_application from app.reseller_applications where tenant_id = p_tenant and id = p_application for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The application was not found'; end if;
  if v_application.status <> 'pending' then raise exception using errcode = 'HCRA5', message = 'The application was already decided'; end if;

  if v_decision = 'reject' then
    update app.reseller_applications set status = 'rejected', decision_reason = v_reason, reviewed_by = p_actor, reviewed_at = now()
    where tenant_id = p_tenant and id = p_application;
    v_response := jsonb_build_object('status', 'rejected', 'applicationId', p_application);
  else
    begin
      v_customer := nullif(p_payload->>'customerId', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'HCRP3', message = 'Application decision is invalid';
    end;
    if v_customer is null then
      -- Nested commands keep their own permission checks, audit, and idempotency under derived keys.
      v_created := app.create_customer(p_actor, p_tenant, v_application.full_name, v_application.email::text,
        v_application.phone, null, 'reseller', false, false, p_key || '-cust', p_hash, p_request_id);
      v_customer := (v_created->>'customerId')::uuid;
    end if;
    perform app.save_wholesale_customer_credit_settings(p_actor, p_tenant, jsonb_build_object(
      'customerId', v_customer, 'paymentTerm', p_payload->>'paymentTerm',
      'creditLimitMinor', p_payload->'creditLimitMinor', 'reason', 'Reseller portal application approved'),
      p_key || '-crdt', p_hash, p_request_id);
    begin
      v_account := app.create_reseller_account_core(p_actor, p_tenant, v_customer, v_application.email::text,
        (p_payload->>'priceListId')::uuid, p_application, p_request_id);
    exception when invalid_text_representation then
      raise exception using errcode = 'HCRP3', message = 'Application decision is invalid';
    end;
    -- The address given when applying becomes the reseller's default delivery address.
    if v_application.address is not null then
      update app.reseller_accounts set delivery_address = v_application.address, updated_at = now()
      where tenant_id = p_tenant and id = v_account.id;
    end if;
    update app.reseller_applications set status = 'approved', reviewed_by = p_actor, reviewed_at = now(),
      reseller_account_id = v_account.id, decision_reason = v_reason
    where tenant_id = p_tenant and id = p_application;
    v_response := jsonb_build_object('status', 'approved', 'applicationId', p_application,
      'accountId', v_account.id, 'customerId', v_customer);
  end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_application.' || (v_response->>'status'),
    'reseller_application', p_application, v_reason, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'reseller_application.' || (v_response->>'status'), 'reseller_application', p_application, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.application_decision', p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
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
    'branding', app.reseller_branding_json(p_tenant),
    'canManage', app.can_manage_reseller_portal(p_actor, p_tenant),
    'tenantSlug', (select slug::text from app.tenants where id = p_tenant),
    'settings', case when v_settings.tenant_id is null then null else jsonb_build_object(
      'fulfillmentLocationId', v_settings.fulfillment_location_id, 'defaultPriceListId', v_settings.default_price_list_id,
      'applicationsOpen', v_settings.applications_open, 'autoConfirm', v_settings.auto_confirm,
      'paymentInstructions', v_settings.payment_instructions,
      'pointsRedeemValueMinor', round(v_settings.points_redeem_value * 100)::bigint,
      'pointsMinRedeem', v_settings.points_min_redeem,
      'shippingFeeMinor', round(v_settings.shipping_fee * 100)::bigint,
      'freeShippingAboveMinor', round(v_settings.free_shipping_minimum * 100)::bigint,
      'tiers', app.reseller_tier_settings_json(p_tenant),
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
        'businessName', a.business_name, 'email', a.email::text, 'phone', a.phone, 'city', a.city, 'address', a.address,
        'message', a.message,
        'status', a.status, 'decisionReason', a.decision_reason, 'reviewedAt', a.reviewed_at, 'createdAt', a.created_at,
        'referredByName', (select c.full_name from app.reseller_accounts r join app.customers c on c.tenant_id = r.tenant_id
          and c.id = r.customer_id where r.tenant_id = a.tenant_id and r.id = a.referred_by_account_id))
        order by (a.status = 'pending') desc, a.created_at desc, a.id)
      from (select * from app.reseller_applications where tenant_id = p_tenant
        order by (status = 'pending') desc, created_at desc limit 200) a), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'customerId', c.id, 'customerName', c.full_name,
        'customerNumber', c.customer_number::text, 'email', a.email::text, 'status', a.status,
        'priceListId', a.price_list_id, 'priceListName', p.name, 'activatedAt', a.activated_at, 'createdAt', a.created_at)
        || app.reseller_account_tier_json(a.tenant_id, a.id)
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
