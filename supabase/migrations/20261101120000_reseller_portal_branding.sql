-- Branding per business for the reseller portal: a portal name, an accent color, and a logo.
-- Shown to resellers in the portal and on the application page. Logos use the file foundation
-- (kind `brand_logo`, keys derived here, bytes in R2). Owner direction 2026-10-31.
begin;

alter table app.files drop constraint files_kind_check;
alter table app.files add constraint files_kind_check check (kind in ('product_image', 'payment_proof', 'payment_qr', 'brand_logo'));
alter table app.files add constraint files_brand_logo_shape check (kind <> 'brand_logo'
  or (mime_type in ('image/jpeg', 'image/png', 'image/webp') and uploaded_by_user_id is not null));

alter table app.reseller_portal_settings
  add column brand_name text check (brand_name is null or char_length(btrim(brand_name)) between 2 and 60),
  add column brand_accent text not null default 'gold' check (brand_accent in ('gold', 'emerald', 'sky', 'rose', 'violet', 'orange')),
  add column brand_logo_file_id uuid,
  add foreign key (tenant_id, brand_logo_file_id) references app.files (tenant_id, id) on delete restrict;

create function app.reseller_branding_json(p_tenant uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'portalName', coalesce(s.brand_name, t.name),
    'businessName', t.name,
    'accentColor', coalesce(s.brand_accent, 'gold'),
    'logoStorageKey', (select f.storage_key from app.files f where f.tenant_id = s.tenant_id and f.id = s.brand_logo_file_id
      and f.status = 'active'))
  from app.tenants t left join app.reseller_portal_settings s on s.tenant_id = t.id
  where t.id = p_tenant;
$$;
revoke all on function app.reseller_branding_json(uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.save_reseller_portal_branding(p_actor uuid, p_tenant uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text := nullif(btrim(coalesce(p_payload->>'portalName', '')), ''); v_previous uuid;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('portalName', 'accentColor', 'removeLogo'))
    or jsonb_typeof(p_payload->'portalName') not in ('string', 'null')
    or coalesce(p_payload->>'accentColor', '') not in ('gold', 'emerald', 'sky', 'rose', 'violet', 'orange')
    or (p_payload ? 'removeLogo' and jsonb_typeof(p_payload->'removeLogo') is distinct from 'boolean')
    or (v_name is not null and char_length(v_name) not between 2 and 60) then
    raise exception using errcode = 'HCRP3', message = 'Branding details are invalid';
  end if;
  select brand_logo_file_id into v_previous from app.reseller_portal_settings where tenant_id = p_tenant for update;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  update app.reseller_portal_settings set brand_name = v_name, brand_accent = p_payload->>'accentColor',
    brand_logo_file_id = case when coalesce((p_payload->>'removeLogo')::boolean, false) then null else brand_logo_file_id end,
    updated_by = p_actor
  where tenant_id = p_tenant;
  if coalesce((p_payload->>'removeLogo')::boolean, false) and v_previous is not null then
    update app.files set status = 'archived', archived_at = now(), archived_by = p_actor
    where tenant_id = p_tenant and id = v_previous and status = 'active';
  end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.branding_saved', 'tenant', p_tenant,
    jsonb_build_object('portalName', v_name, 'accentColor', p_payload->>'accentColor',
      'removeLogo', coalesce((p_payload->>'removeLogo')::boolean, false)));
  return app.reseller_branding_json(p_tenant);
end;
$$;
revoke all on function app.save_reseller_portal_branding(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.save_reseller_portal_branding(uuid, uuid, jsonb, text) to hcs_hyperdrive;

create function app.assert_brand_logo_upload(p_actor uuid, p_tenant uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_reseller_portal(p_actor, p_tenant) then
    raise exception using errcode = 'HCFL1', message = 'Reseller portal management is not allowed';
  end if;
  if not exists (select 1 from app.reseller_portal_settings where tenant_id = p_tenant) then
    raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured';
  end if;
end;
$$;
revoke all on function app.assert_brand_logo_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function app.assert_brand_logo_upload(uuid, uuid) to hcs_hyperdrive;

-- Records an uploaded logo and archives the previous one.
create function app.record_brand_logo(p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_file uuid; v_previous uuid; v_response jsonb;
begin
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null then
    raise exception using errcode = 'HCFL2', message = 'File details are invalid';
  end if;
  perform app.validate_file_payload(p_payload, 2621440, true);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':brand-logo', 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.brand_logo' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  perform app.assert_brand_logo_upload(p_actor, p_tenant);
  v_file := (p_payload->>'fileId')::uuid;
  insert into app.files (id, tenant_id, kind, storage_key, thumb_storage_key, mime_type, size_bytes, thumb_size_bytes,
    sha256, original_filename, uploaded_by_user_id)
  values (v_file, p_tenant, 'brand_logo', 't/' || p_tenant || '/brand_logo/' || v_file || '/main',
    case when p_payload ? 'thumbSizeBytes' then 't/' || p_tenant || '/brand_logo/' || v_file || '/thumb' end,
    p_payload->>'mimeType', (p_payload->>'sizeBytes')::integer, (p_payload->>'thumbSizeBytes')::integer,
    p_payload->>'sha256', btrim(p_payload->>'originalFilename'), p_actor);
  select brand_logo_file_id into v_previous from app.reseller_portal_settings where tenant_id = p_tenant for update;
  update app.reseller_portal_settings set brand_logo_file_id = v_file, updated_by = p_actor where tenant_id = p_tenant;
  if v_previous is not null then
    update app.files set status = 'archived', archived_at = now(), archived_by = p_actor
    where tenant_id = p_tenant and id = v_previous and status = 'active';
  end if;
  v_response := jsonb_build_object('status', 'uploaded', 'fileId', v_file);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.brand_logo_uploaded', 'tenant', p_tenant,
    v_response || jsonb_build_object('previousFileId', v_previous, 'sha256', p_payload->>'sha256'));
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.brand_logo', p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;
revoke all on function app.record_brand_logo(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function app.record_brand_logo(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

-- Resellers see the business's branding in the portal.
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
$function$;

-- And on the application page.
CREATE OR REPLACE FUNCTION app.load_reseller_portal_public(p_tenant_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant app.tenants%rowtype; v_open boolean;
begin
  select * into v_tenant from app.tenants where slug = lower(btrim(coalesce(p_tenant_slug, '')));
  if not found or not app.reseller_portal_enabled(v_tenant.id) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  select applications_open into v_open from app.reseller_portal_settings where tenant_id = v_tenant.id;
  return jsonb_build_object('tenantSlug', v_tenant.slug::text, 'businessName', v_tenant.name,
    'branding', app.reseller_branding_json(v_tenant.id),
    'configured', v_open is not null, 'applicationsOpen', coalesce(v_open, false));
end;
$function$;

-- Back Office edits it.
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
