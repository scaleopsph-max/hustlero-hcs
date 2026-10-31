-- Reseller portal: structured payment accounts (owner direction 2026-10-30).
-- The business lists its GCash and bank accounts, each with an optional QR image, in Back Office.
-- Resellers pick GCash or Bank and see the matching QR and account details. QR images use the same
-- file foundation as product photos (kind `payment_qr`, keys derived here, bytes in R2).

begin;

alter table app.files drop constraint files_kind_check;
alter table app.files add constraint files_kind_check check (kind in ('product_image', 'payment_proof', 'payment_qr'));
alter table app.files add constraint files_payment_qr_shape check (kind <> 'payment_qr'
  or (mime_type in ('image/jpeg', 'image/png', 'image/webp') and uploaded_by_user_id is not null));

create table app.reseller_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  method text not null check (method in ('gcash', 'bank_transfer')),
  provider_name text not null check (char_length(btrim(provider_name)) between 2 and 80),
  account_name text not null check (char_length(btrim(account_name)) between 2 and 120),
  account_number text not null check (char_length(btrim(account_number)) between 4 and 40),
  qr_file_id uuid,
  is_active boolean not null default true,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, qr_file_id) references app.files (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, updated_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);
create index reseller_payment_accounts_tenant_idx on app.reseller_payment_accounts (tenant_id, method, created_at);
alter table app.reseller_payment_accounts enable row level security;
revoke all on app.reseller_payment_accounts from public, anon, authenticated, hcs_hyperdrive;
create trigger reseller_payment_accounts_set_updated_at before update on app.reseller_payment_accounts
  for each row execute function app.set_updated_at();

-- Accounts with QR storage keys for the API to sign. GCash first, then bank, oldest first.
create function app.reseller_payment_accounts_json(p_tenant uuid, p_active_only boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', account.id, 'method', account.method, 'providerName', account.provider_name,
    'accountName', account.account_name, 'accountNumber', account.account_number, 'isActive', account.is_active,
    'qrStorageKey', case when file.status = 'active' then file.storage_key end
  ) order by account.method = 'bank_transfer', account.created_at, account.id), '[]'::jsonb)
  from app.reseller_payment_accounts account
  left join app.files file on file.tenant_id = account.tenant_id and file.id = account.qr_file_id
  where account.tenant_id = p_tenant and (not p_active_only or account.is_active);
$$;
revoke all on function app.reseller_payment_accounts_json(uuid, boolean) from public, anon, authenticated, hcs_hyperdrive;

-- Adds or edits one account. A new account needs no id; at most 6 accounts can be shown at once.
create function app.save_reseller_payment_account(
  p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_id uuid; v_active boolean; v_response jsonb;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('id', 'method', 'providerName', 'accountName', 'accountNumber', 'isActive'))
    or coalesce(p_payload->>'method', '') not in ('gcash', 'bank_transfer')
    or char_length(btrim(coalesce(p_payload->>'providerName', ''))) not between 2 and 80
    or char_length(btrim(coalesce(p_payload->>'accountName', ''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload->>'accountNumber', ''))) not between 4 and 40
    or (p_payload ? 'isActive' and jsonb_typeof(p_payload->'isActive') is distinct from 'boolean')
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Payment account details are invalid'; end if;
  begin
    v_id := nullif(p_payload->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'HCRP3', message = 'Payment account details are invalid';
  end;
  v_active := coalesce((p_payload->>'isActive')::boolean, true);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-payment-accounts', 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.payment_account' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  if v_active and (select count(*) from app.reseller_payment_accounts
      where tenant_id = p_tenant and is_active and id is distinct from v_id) >= 6 then
    raise exception using errcode = 'HCRA7', message = 'At most 6 payment accounts can be shown';
  end if;
  if v_id is null then
    insert into app.reseller_payment_accounts (tenant_id, method, provider_name, account_name, account_number, is_active, created_by, updated_by)
    values (p_tenant, p_payload->>'method', btrim(p_payload->>'providerName'), btrim(p_payload->>'accountName'),
      btrim(p_payload->>'accountNumber'), v_active, p_actor, p_actor)
    returning id into v_id;
  else
    update app.reseller_payment_accounts set method = p_payload->>'method', provider_name = btrim(p_payload->>'providerName'),
      account_name = btrim(p_payload->>'accountName'), account_number = btrim(p_payload->>'accountNumber'),
      is_active = v_active, updated_by = p_actor
    where tenant_id = p_tenant and id = v_id;
    if not found then raise exception using errcode = 'HCRA4', message = 'The payment account was not found'; end if;
  end if;
  v_response := jsonb_build_object('status', 'saved', 'accountId', v_id, 'isActive', v_active);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.payment_account_saved', 'tenant', p_tenant,
    v_response || jsonb_build_object('method', p_payload->>'method', 'providerName', btrim(p_payload->>'providerName'),
      'accountName', btrim(p_payload->>'accountName'), 'accountNumber', btrim(p_payload->>'accountNumber')));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'reseller_portal.payment_account_saved', 'tenant', p_tenant, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.payment_account', p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create function app.assert_payment_qr_upload(p_actor uuid, p_tenant uuid, p_account uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_reseller_portal(p_actor, p_tenant) then
    raise exception using errcode = 'HCFL1', message = 'Reseller portal management is not allowed';
  end if;
  if not exists (select 1 from app.reseller_payment_accounts where tenant_id = p_tenant and id = p_account) then
    raise exception using errcode = 'HCFL3', message = 'The payment account was not found';
  end if;
end;
$$;

-- Records an uploaded QR image and archives the account's previous one.
create function app.record_payment_qr(
  p_actor uuid, p_tenant uuid, p_account uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_file uuid; v_previous uuid; v_response jsonb;
begin
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null then
    raise exception using errcode = 'HCFL2', message = 'File details are invalid';
  end if;
  perform app.validate_file_payload(p_payload, 2621440, true);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':payment-qr:' || p_account::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.payment_qr' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  perform app.assert_payment_qr_upload(p_actor, p_tenant, p_account);
  v_file := (p_payload->>'fileId')::uuid;
  insert into app.files (id, tenant_id, kind, storage_key, thumb_storage_key, mime_type, size_bytes, thumb_size_bytes,
    sha256, original_filename, uploaded_by_user_id)
  values (v_file, p_tenant, 'payment_qr', 't/' || p_tenant || '/payment_qr/' || v_file || '/main',
    case when p_payload ? 'thumbSizeBytes' then 't/' || p_tenant || '/payment_qr/' || v_file || '/thumb' end,
    p_payload->>'mimeType', (p_payload->>'sizeBytes')::integer, (p_payload->>'thumbSizeBytes')::integer,
    p_payload->>'sha256', btrim(p_payload->>'originalFilename'), p_actor);
  select qr_file_id into v_previous from app.reseller_payment_accounts where tenant_id = p_tenant and id = p_account for update;
  update app.reseller_payment_accounts set qr_file_id = v_file, updated_by = p_actor where tenant_id = p_tenant and id = p_account;
  if v_previous is not null then
    update app.files set status = 'archived', archived_at = now(), archived_by = p_actor
    where tenant_id = p_tenant and id = v_previous and status = 'active';
  end if;
  v_response := jsonb_build_object('status', 'uploaded', 'accountId', p_account, 'fileId', v_file);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.payment_qr_uploaded', 'tenant', p_tenant,
    v_response || jsonb_build_object('previousFileId', v_previous, 'sha256', p_payload->>'sha256'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'reseller_portal.payment_qr_uploaded', 'tenant', p_tenant, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.payment_qr', p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create or replace function app.load_reseller_portal_admin(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_settings app.reseller_portal_settings%rowtype;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  return jsonb_build_object(
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
    'awaitingPayment', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'orderNumber', o.order_number::text,
        'customerName', coalesce(o.customer_name_snapshot, c.full_name), 'totalMinor', round(o.total * 100)::bigint,
        'createdAt', o.created_at, 'paymentDueAt', o.payment_due_at) order by o.payment_due_at, o.id)
      from app.sales_orders o join app.customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = p_tenant and o.status = 'submitted' and o.review_reason = 'awaiting_payment'), '[]'::jsonb)
  );
end;
$$;

create or replace function app.load_reseller_portal_catalog(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
$$;

revoke all on function app.save_reseller_payment_account(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.assert_payment_qr_upload(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.record_payment_qr(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function app.save_reseller_payment_account(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.assert_payment_qr_upload(uuid, uuid, uuid) to hcs_hyperdrive;
grant execute on function app.record_payment_qr(uuid, uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

commit;
