-- Reseller Portal R1: applications, reseller accounts, portal catalog, and portal sales orders.
-- Portal orders are Advanced Wholesale sales orders on the same shared inventory. An order that
-- passes stock and credit checks is confirmed (reserved) atomically on submit; any other order
-- waits in the Back Office review queue with status `submitted` and never touches inventory.
begin;

-- ---------------------------------------------------------------------------
-- Feature entitlement and permission
-- ---------------------------------------------------------------------------
insert into app.features (code, name, platform_available) values ('reseller_portal', 'Reseller portal', true)
on conflict (code) do update set name = excluded.name, platform_available = excluded.platform_available, updated_at = now();

insert into app.tenant_entitlements (tenant_id, feature_code, entitled, enabled)
select tenant.id, 'reseller_portal', false, false from app.tenants tenant
on conflict (tenant_id, feature_code) do nothing;

create function app.initialize_tenant_reseller_portal_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into app.tenant_entitlements (tenant_id, feature_code, entitled, enabled)
  values (new.id, 'reseller_portal', false, false)
  on conflict (tenant_id, feature_code) do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_tenant_reseller_portal_entitlement() from public, anon, authenticated;
create trigger tenants_initialize_reseller_portal_entitlement
after insert on app.tenants for each row execute function app.initialize_tenant_reseller_portal_entitlement();

insert into app.permissions (code, description) values
  ('reseller_portal.manage', 'Configure the reseller portal, approve applications, and review portal orders')
on conflict (code) do update set description = excluded.description;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, 'reseller_portal.manage' from app.roles role where lower(role.code::text) = 'owner'
on conflict do nothing;

create function app.initialize_owner_reseller_portal_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) = 'owner' then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values (new.tenant_id, new.id, 'reseller_portal.manage') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_owner_reseller_portal_permissions() from public, anon, authenticated;
create trigger roles_initialize_reseller_portal_permissions
after insert on app.roles for each row execute function app.initialize_owner_reseller_portal_permissions();

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table app.reseller_portal_settings (
  tenant_id uuid primary key references app.tenants (id) on delete restrict,
  fulfillment_location_id uuid not null,
  default_price_list_id uuid,
  applications_open boolean not null default true,
  auto_confirm boolean not null default true,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, fulfillment_location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, default_price_list_id) references app.price_lists (tenant_id, id) on delete restrict,
  foreign key (tenant_id, updated_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);

create table app.reseller_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  full_name text not null,
  business_name text,
  email extensions.citext not null,
  phone text not null,
  city text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  reseller_account_id uuid,
  request_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, reviewed_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint reseller_applications_name check (char_length(btrim(full_name)) between 2 and 160),
  constraint reseller_applications_business check (business_name is null or char_length(btrim(business_name)) between 2 and 160),
  constraint reseller_applications_email check (email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email::text) <= 254),
  constraint reseller_applications_phone check (phone ~ '^\+?[0-9]{7,15}$'),
  constraint reseller_applications_city check (city is null or char_length(btrim(city)) between 2 and 120),
  constraint reseller_applications_message check (message is null or char_length(message) <= 1000),
  constraint reseller_applications_decision check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status = 'approved' and reviewed_by is not null and reviewed_at is not null and reseller_account_id is not null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null
      and char_length(btrim(coalesce(decision_reason, ''))) between 2 and 500)
  )
);
create unique index reseller_applications_pending_email_idx on app.reseller_applications (tenant_id, email) where status = 'pending';
create index reseller_applications_status_idx on app.reseller_applications (tenant_id, status, created_at desc);

create table app.reseller_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  customer_id uuid not null,
  email extensions.citext not null,
  auth_user_id uuid references auth.users (id) on delete restrict,
  price_list_id uuid not null,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  application_id uuid,
  created_by uuid not null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, customer_id),
  unique (tenant_id, email),
  unique (tenant_id, auth_user_id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, price_list_id) references app.price_lists (tenant_id, id) on delete restrict,
  foreign key (tenant_id, application_id) references app.reseller_applications (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint reseller_accounts_email check (email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint reseller_accounts_link check (
    (status = 'invited' and auth_user_id is null) or (status = 'active' and auth_user_id is not null) or status = 'suspended'
  )
);
alter table app.reseller_applications add foreign key (tenant_id, reseller_account_id)
  references app.reseller_accounts (tenant_id, id) on delete restrict;

create table app.reseller_order_counters (
  tenant_id uuid primary key references app.tenants (id) on delete restrict,
  last_number bigint not null default 0 check (last_number >= 0)
);

alter table app.reseller_portal_settings enable row level security;
alter table app.reseller_applications enable row level security;
alter table app.reseller_accounts enable row level security;
alter table app.reseller_order_counters enable row level security;
revoke all on app.reseller_portal_settings, app.reseller_applications, app.reseller_accounts, app.reseller_order_counters
  from public, anon, authenticated, hcs_hyperdrive;

create trigger reseller_portal_settings_set_updated_at before update on app.reseller_portal_settings
  for each row execute function app.set_updated_at();
create trigger reseller_applications_set_updated_at before update on app.reseller_applications
  for each row execute function app.set_updated_at();
create trigger reseller_accounts_set_updated_at before update on app.reseller_accounts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sales orders: portal source, reseller actor, and the `submitted` review state
-- ---------------------------------------------------------------------------
alter table app.sales_orders
  add column source text not null default 'backoffice' check (source in ('backoffice', 'reseller_portal')),
  add column created_by_reseller_account_id uuid,
  add column review_reason text check (review_reason in
    ('manual_review', 'credit_settings_missing', 'credit_review', 'stock_insufficient', 'credit_limit')),
  add column review_decision_reason text check (review_decision_reason is null or char_length(btrim(review_decision_reason)) between 2 and 500),
  add column fulfillment_method text check (fulfillment_method in ('delivery', 'pickup')),
  add column delivery_address text check (delivery_address is null or char_length(btrim(delivery_address)) between 5 and 500),
  add column payment_preference text check (payment_preference in ('gcash', 'bank_transfer')),
  add foreign key (tenant_id, created_by_reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict;
alter table app.sales_orders alter column created_by drop not null;
alter table app.sales_orders add constraint sales_orders_creator check (
  num_nonnulls(created_by, created_by_reseller_account_id) = 1
  and (source = 'reseller_portal') = (created_by_reseller_account_id is not null)
);
alter table app.sales_orders add constraint sales_orders_portal_details check (
  source = 'backoffice'
  or (fulfillment_method is not null and payment_preference is not null
    and (fulfillment_method = 'pickup' or delivery_address is not null))
);
alter table app.sales_orders drop constraint sales_orders_status_check;
alter table app.sales_orders add constraint sales_orders_status_check
  check (status in ('draft', 'submitted', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled'));
alter table app.sales_orders drop constraint sales_orders_confirmation_state;
alter table app.sales_orders add constraint sales_orders_confirmation_state check (
  (status in ('draft', 'submitted') and confirmed_at is null and cancelled_at is null)
  or (status in ('confirmed', 'partially_fulfilled', 'fulfilled') and confirmed_at is not null and cancelled_at is null)
  or (status = 'cancelled' and cancelled_at is not null)
);
alter table app.sales_orders add constraint sales_orders_submitted_state check (
  status <> 'submitted' or (source = 'reseller_portal' and review_reason is not null)
);
create index sales_orders_review_queue_idx on app.sales_orders (tenant_id, created_at) where status = 'submitted';
create index sales_orders_reseller_account_idx on app.sales_orders (tenant_id, created_by_reseller_account_id, created_at desc)
  where created_by_reseller_account_id is not null;

alter table app.sales_order_reservation_ledger add column actor_reseller_account_id uuid,
  add foreign key (tenant_id, actor_reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict;
alter table app.sales_order_reservation_ledger alter column actor_user_id drop not null;
alter table app.sales_order_reservation_ledger add constraint sales_order_reservation_actor
  check (num_nonnulls(actor_user_id, actor_reseller_account_id) = 1);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------
create function app.reseller_portal_enabled(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.tenants tenant where tenant.id = p_tenant and tenant.status = 'active')
    and (select count(*) = 2 from app.tenant_entitlements entitlement
      join app.features feature on feature.code = entitlement.feature_code
      where entitlement.tenant_id = p_tenant and entitlement.feature_code in ('advanced_wholesale', 'reseller_portal')
        and entitlement.entitled and entitlement.enabled and feature.platform_available
        and (entitlement.starts_at is null or entitlement.starts_at <= now())
        and (entitlement.ends_at is null or entitlement.ends_at > now()));
$$;
revoke all on function app.reseller_portal_enabled(uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.can_manage_reseller_portal(p_actor uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant and membership.user_id = p_actor and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id
          and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = p_tenant and membership_role.user_id = p_actor
          and permission.permission_code = 'reseller_portal.manage'))
  );
$$;
revoke all on function app.can_manage_reseller_portal(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Same exposure basis as app.assert_wholesale_credit_capacity, without raising.
create function app.wholesale_customer_credit_exposure(p_tenant uuid, p_customer uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from app.wholesale_receivable_charges where tenant_id = p_tenant and customer_id = p_customer), 0)
    + coalesce((select sum(amount) from app.wholesale_invoice_charges where tenant_id = p_tenant and customer_id = p_customer), 0)
    + coalesce((select sum(round((line.ordered_quantity - line.fulfilled_quantity - line.cancelled_quantity) * line.unit_price, 2))
      from app.sales_orders orders join app.sales_order_lines line on line.tenant_id = orders.tenant_id and line.sales_order_id = orders.id
      where orders.tenant_id = p_tenant and orders.customer_id = p_customer and orders.status in ('confirmed', 'partially_fulfilled')), 0);
$$;
revoke all on function app.wholesale_customer_credit_exposure(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.wholesale_customer_has_unclassified_invoices(p_tenant uuid, p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.invoices invoice where invoice.tenant_id = p_tenant and invoice.customer_id = p_customer
    and not exists (select 1 from app.wholesale_receivable_charges charge where charge.tenant_id = p_tenant and charge.invoice_id = invoice.id)
    and not exists (select 1 from app.wholesale_invoice_charges charge where charge.tenant_id = p_tenant and charge.invoice_id = invoice.id));
$$;
revoke all on function app.wholesale_customer_has_unclassified_invoices(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Resolves the active portal account of a verified Supabase user inside one tenant.
create function app.resolve_reseller_account(p_auth_user uuid, p_tenant uuid)
returns app.reseller_accounts language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  if not app.reseller_portal_enabled(p_tenant) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  select account.* into v_account from app.reseller_accounts account
  join app.customers customer on customer.tenant_id = account.tenant_id and customer.id = account.customer_id
  where account.tenant_id = p_tenant and account.auth_user_id = p_auth_user and account.status = 'active'
    and customer.status = 'active' and customer.customer_type = 'reseller';
  if not found then raise exception using errcode = 'HCRP1', message = 'Reseller access is not allowed'; end if;
  return v_account;
end;
$$;
revoke all on function app.resolve_reseller_account(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.reseller_price_list_valid(p_tenant uuid, p_customer uuid, p_price_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.price_lists price_list where price_list.tenant_id = p_tenant and price_list.id = p_price_list
    and price_list.is_active and price_list.pricing_type in ('wholesale', 'dealer')
    and (price_list.is_default or exists (select 1 from app.customer_price_list_assignments assignment
      where assignment.tenant_id = p_tenant and assignment.customer_id = p_customer and assignment.price_list_id = p_price_list)));
$$;
revoke all on function app.reseller_price_list_valid(uuid, uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- In stock / low / out badge for one variant at the portal fulfillment branch.
create function app.reseller_stock_status(p_tenant uuid, p_location uuid, p_variant uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not variant.track_inventory then 'in_stock'
    when coalesce(balance.on_hand - balance.reserved - balance.damaged, 0) <= 0 then 'out_of_stock'
    when policy.reorder_level is not null and balance.on_hand - balance.reserved - balance.damaged <= policy.reorder_level then 'low_stock'
    else 'in_stock' end
  from app.product_variants variant
  left join app.inventory_balances balance on balance.tenant_id = variant.tenant_id
    and balance.location_id = p_location and balance.variant_id = variant.id
  left join app.inventory_reorder_policies policy on policy.tenant_id = variant.tenant_id
    and policy.location_id = p_location and policy.variant_id = variant.id and policy.is_active
  where variant.tenant_id = p_tenant and variant.id = p_variant;
$$;
revoke all on function app.reseller_stock_status(uuid, uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.reseller_order_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'orderNumber', o.order_number::text, 'status', o.status, 'source', o.source,
    'reviewReason', o.review_reason, 'reviewDecisionReason', o.review_decision_reason,
    'fulfillmentMethod', o.fulfillment_method, 'deliveryAddress', o.delivery_address,
    'paymentPreference', o.payment_preference, 'notes', o.notes,
    'customerId', o.customer_id, 'customerName', coalesce(o.customer_name_snapshot, customer.full_name),
    'customerNumber', coalesce(o.customer_number_snapshot, customer.customer_number::text),
    'locationName', location.name,
    'totalMinor', round(o.total * 100)::bigint, 'createdAt', o.created_at, 'confirmedAt', o.confirmed_at,
    'cancelledAt', o.cancelled_at,
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
      from app.invoices invoice where invoice.tenant_id = o.tenant_id and invoice.sales_order_id = o.id), '[]'::jsonb)
  )
  from app.sales_orders o
  join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
  join app.locations location on location.tenant_id = o.tenant_id and location.id = o.location_id
  where o.tenant_id = p_tenant and o.id = p_order;
$$;
revoke all on function app.reseller_order_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- ---------------------------------------------------------------------------
-- Public application form (no sign-in)
-- ---------------------------------------------------------------------------
create function app.load_reseller_portal_public(p_tenant_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tenant app.tenants%rowtype; v_open boolean;
begin
  select * into v_tenant from app.tenants where slug = lower(btrim(coalesce(p_tenant_slug, '')));
  if not found or not app.reseller_portal_enabled(v_tenant.id) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  select applications_open into v_open from app.reseller_portal_settings where tenant_id = v_tenant.id;
  return jsonb_build_object('tenantSlug', v_tenant.slug::text, 'businessName', v_tenant.name,
    'configured', v_open is not null, 'applicationsOpen', coalesce(v_open, false));
end;
$$;

create function app.submit_reseller_application(p_tenant_slug text, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_open boolean;
  v_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_phone text := regexp_replace(coalesce(p_payload->>'phone', ''), '[^0-9+]', '', 'g');
begin
  select tenant.id into v_tenant from app.tenants tenant where tenant.slug = lower(btrim(coalesce(p_tenant_slug, '')));
  if v_tenant is null or not app.reseller_portal_enabled(v_tenant) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  select applications_open into v_open from app.reseller_portal_settings where tenant_id = v_tenant;
  if not coalesce(v_open, false) then
    raise exception using errcode = 'HCRP6', message = 'Reseller applications are closed';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('fullName', 'businessName', 'email', 'phone', 'city', 'message'))
    or nullif(btrim(p_request_id), '') is null then
    raise exception using errcode = 'HCRP3', message = 'Application details are invalid';
  end if;
  begin
    insert into app.reseller_applications (tenant_id, full_name, business_name, email, phone, city, message, request_id)
    values (v_tenant, btrim(p_payload->>'fullName'), nullif(btrim(p_payload->>'businessName'), ''), v_email, v_phone,
      nullif(btrim(p_payload->>'city'), ''), nullif(btrim(p_payload->>'message'), ''), p_request_id);
  exception
    -- A second pending application for the same email is acknowledged without revealing that one exists.
    when unique_violation then null;
    when check_violation or not_null_violation then
      raise exception using errcode = 'HCRP3', message = 'Application details are invalid';
  end;
  return jsonb_build_object('status', 'received');
end;
$$;

-- ---------------------------------------------------------------------------
-- Reseller (portal) commands — callers are verified Supabase users
-- ---------------------------------------------------------------------------
create function app.load_reseller_portal_session(p_auth_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select lower(users.email) into v_email from auth.users users
  where users.id = p_auth_user and users.email_confirmed_at is not null and users.deleted_at is null;
  -- First sign-in with the invited, verified email links the account.
  if v_email is not null then
    update app.reseller_accounts account set auth_user_id = p_auth_user, status = 'active', activated_at = now()
    where account.status = 'invited' and account.auth_user_id is null and account.email = v_email::extensions.citext
      and not exists (select 1 from app.reseller_accounts other
        where other.tenant_id = account.tenant_id and other.auth_user_id = p_auth_user);
  end if;
  return jsonb_build_object('accounts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tenantId', tenant.id, 'tenantSlug', tenant.slug::text, 'businessName', tenant.name,
      'accountId', account.id, 'customerId', customer.id, 'customerName', customer.full_name,
      'customerNumber', customer.customer_number::text, 'email', account.email::text
    ) order by tenant.name, tenant.id)
    from app.reseller_accounts account
    join app.tenants tenant on tenant.id = account.tenant_id
    join app.customers customer on customer.tenant_id = account.tenant_id and customer.id = account.customer_id
    where account.auth_user_id = p_auth_user and account.status = 'active'
      and customer.status = 'active' and customer.customer_type = 'reseller'
      and app.reseller_portal_enabled(account.tenant_id)
  ), '[]'::jsonb));
end;
$$;

create function app.load_reseller_portal_catalog(p_auth_user uuid, p_tenant uuid)
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

create function app.list_reseller_portal_orders(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  -- Back Office drafts are internal working copies and stay hidden from the reseller.
  return jsonb_build_object('orders', coalesce((
    select jsonb_agg(app.reseller_order_json(p_tenant, o.id) order by o.created_at desc, o.id desc)
    from (select id, created_at from app.sales_orders
      where tenant_id = p_tenant and customer_id = v_account.customer_id and status <> 'draft'
      order by created_at desc, id desc limit 100) o
  ), '[]'::jsonb));
end;
$$;

create function app.submit_reseller_portal_order(
  p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype;
  v_customer app.customers%rowtype; v_credit app.wholesale_customer_credit_settings%rowtype;
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype;
  v_line jsonb; v_order_line app.sales_order_lines%rowtype; v_balance app.inventory_balances%rowtype; v_entry record;
  v_number bigint; v_order_number text; v_total numeric(18,2) := 0; v_line_count integer := 0;
  v_reason text; v_quantity numeric; v_response jsonb; v_method text; v_address text;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;

  v_method := p_payload->>'fulfillmentMethod';
  v_address := nullif(btrim(coalesce(p_payload->>'deliveryAddress', '')), '');
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('lines', 'fulfillmentMethod', 'deliveryAddress', 'paymentPreference', 'notes'))
    or jsonb_typeof(p_payload->'lines') is distinct from 'array'
    or jsonb_array_length(p_payload->'lines') not between 1 and 100
    or coalesce(v_method, '') not in ('delivery', 'pickup')
    or (v_method = 'delivery' and (v_address is null or char_length(v_address) not between 5 and 500))
    or coalesce(p_payload->>'paymentPreference', '') not in ('gcash', 'bank_transfer')
    or char_length(coalesce(p_payload->>'notes', '')) > 1000
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null or nullif(p_request_id, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Order details are invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-order:submit:' || p_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.order_submit:' || v_account.id::text and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant, 'reseller_portal.order_submit:' || v_account.id::text, p_key, p_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;

  -- The customer lock serializes this credit decision with Back Office confirmations and fulfilments.
  select * into v_customer from app.customers where tenant_id = p_tenant and id = v_account.customer_id
    and status = 'active' and customer_type = 'reseller' for update;
  if not found then raise exception using errcode = 'HCRP1', message = 'Reseller access is not allowed'; end if;
  if not app.reseller_price_list_valid(p_tenant, v_account.customer_id, v_account.price_list_id) then
    raise exception using errcode = 'HCRP4', message = 'The reseller price list is unavailable';
  end if;
  if not exists (select 1 from app.locations where tenant_id = p_tenant and id = v_settings.fulfillment_location_id and is_active) then
    raise exception using errcode = 'HCRP2', message = 'The fulfillment branch is unavailable';
  end if;

  insert into app.reseller_order_counters (tenant_id, last_number) values (p_tenant, 1)
  on conflict (tenant_id) do update set last_number = app.reseller_order_counters.last_number + 1
  returning last_number into v_number;
  v_order_number := 'RP-' || lpad(v_number::text, 6, '0');
  while exists (select 1 from app.sales_orders where tenant_id = p_tenant and order_number = v_order_number::extensions.citext) loop
    update app.reseller_order_counters set last_number = last_number + 1 where tenant_id = p_tenant returning last_number into v_number;
    v_order_number := 'RP-' || lpad(v_number::text, 6, '0');
  end loop;

  insert into app.sales_orders (
    tenant_id, order_number, customer_id, location_id, price_list_id, pricing_type, status, source,
    customer_number_snapshot, customer_name_snapshot, notes, created_by_reseller_account_id,
    review_reason, fulfillment_method, delivery_address, payment_preference
  )
  select p_tenant, v_order_number, v_account.customer_id, v_settings.fulfillment_location_id, price_list.id,
    price_list.pricing_type, 'submitted', 'reseller_portal', v_customer.customer_number::text, v_customer.full_name,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_account.id, 'manual_review', v_method,
    case when v_method = 'delivery' then v_address end, p_payload->>'paymentPreference'
  from app.price_lists price_list where price_list.tenant_id = p_tenant and price_list.id = v_account.price_list_id
  returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    begin
      if jsonb_typeof(v_line) is distinct from 'object' or jsonb_typeof(v_line->'quantityMilli') is distinct from 'number' then
        raise invalid_text_representation;
      end if;
      v_quantity := (v_line->>'quantityMilli')::numeric;
      if v_quantity <> trunc(v_quantity) or v_quantity < 1 or v_quantity > 999999999999 then raise invalid_text_representation; end if;
      select variant.id variant_id, product.name product_name, variant.name variant_name, variant.sku::text sku,
        entry.pricing_group_id, entry.unit_price
      into v_entry from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      join app.price_list_entries entry on entry.tenant_id = variant.tenant_id and entry.variant_id = variant.id
        and entry.price_list_id = v_account.price_list_id
      where variant.tenant_id = p_tenant and variant.id = (v_line->>'variantId')::uuid and variant.is_active and product.status = 'active';
      if not found then raise exception using errcode = 'HCRP4', message = 'An order item is no longer available'; end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'HCRP3', message = 'Order details are invalid';
    end;
    begin
      insert into app.sales_order_lines (
        tenant_id, sales_order_id, variant_id, pricing_group_id, product_name_snapshot, variant_name_snapshot,
        sku_snapshot, ordered_quantity, unit_price, line_total
      ) values (
        p_tenant, v_order.id, v_entry.variant_id, v_entry.pricing_group_id, v_entry.product_name, v_entry.variant_name,
        v_entry.sku, v_quantity / 1000, v_entry.unit_price, round((v_quantity / 1000) * v_entry.unit_price, 2)
      );
    exception when unique_violation then
      raise exception using errcode = 'HCRP3', message = 'Each item may appear only once in an order';
    end;
    v_total := v_total + round((v_quantity / 1000) * v_entry.unit_price, 2);
    v_line_count := v_line_count + 1;
  end loop;

  if exists (
    select 1 from app.sales_order_lines line
    join app.pricing_groups pricing_group on pricing_group.tenant_id = line.tenant_id and pricing_group.id = line.pricing_group_id
    where line.tenant_id = p_tenant and line.sales_order_id = v_order.id
    group by pricing_group.id, pricing_group.threshold_quantity
    having sum(line.ordered_quantity) < pricing_group.threshold_quantity
  ) then raise exception using errcode = 'HCRP5', message = 'A wholesale minimum quantity has not been met'; end if;

  -- Decide whether the order can be confirmed now; holds are recorded, never raised.
  select * into v_credit from app.wholesale_customer_credit_settings
  where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
  if not v_settings.auto_confirm then
    v_reason := 'manual_review';
  elsif v_credit.id is null then
    v_reason := 'credit_settings_missing';
  elsif app.wholesale_customer_has_unclassified_invoices(p_tenant, v_account.customer_id) then
    v_reason := 'credit_review';
  end if;
  if v_reason is null then
    for v_order_line in select * from app.sales_order_lines where tenant_id = p_tenant and sales_order_id = v_order.id
      order by variant_id for update loop
      select * into v_balance from app.inventory_balances where tenant_id = p_tenant
        and location_id = v_order.location_id and variant_id = v_order_line.variant_id for update;
      if not found or v_balance.on_hand - v_balance.reserved - v_balance.damaged < v_order_line.ordered_quantity then
        v_reason := 'stock_insufficient';
      end if;
    end loop;
  end if;
  if v_reason is null and app.wholesale_customer_credit_exposure(p_tenant, v_account.customer_id) + v_total > v_credit.credit_limit then
    v_reason := 'credit_limit';
  end if;

  if v_reason is null then
    for v_order_line in select * from app.sales_order_lines where tenant_id = p_tenant and sales_order_id = v_order.id order by variant_id loop
      update app.inventory_balances set reserved = reserved + v_order_line.ordered_quantity, version = version + 1, updated_at = now()
      where tenant_id = p_tenant and location_id = v_order.location_id and variant_id = v_order_line.variant_id;
      insert into app.sales_order_reservation_ledger (
        tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason, actor_reseller_account_id
      ) values (
        p_tenant, v_order.id, v_order_line.id, v_order.location_id, v_order_line.variant_id,
        v_order_line.ordered_quantity, 'order_confirmed', v_account.id
      );
    end loop;
    update app.sales_orders set status = 'confirmed', review_reason = null, confirmed_at = now(), subtotal = v_total, total = v_total
    where tenant_id = p_tenant and id = v_order.id;
    insert into app.wholesale_order_credit_snapshots (tenant_id, sales_order_id, settings_id, payment_term, credit_limit)
    values (p_tenant, v_order.id, v_credit.id, v_credit.payment_term, v_credit.credit_limit);
  else
    update app.sales_orders set review_reason = v_reason, subtotal = v_total, total = v_total
    where tenant_id = p_tenant and id = v_order.id;
  end if;

  v_response := jsonb_build_object('salesOrderId', v_order.id, 'orderNumber', v_order_number,
    'status', case when v_reason is null then 'confirmed' else 'submitted' end, 'reviewReason', v_reason,
    'lineCount', v_line_count, 'totalMinor', round(v_total * 100)::bigint);
  -- Portal actors are recorded as `system` with the reseller identity in metadata.
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id,
    case when v_reason is null then 'sales_order.confirmed' else 'sales_order.submitted' end, 'sales_order', v_order.id,
    v_order.location_id, v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id,
      'customerNumber', v_customer.customer_number::text, 'source', 'reseller_portal', 'autoConfirmed', v_reason is null));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, case when v_reason is null then 'sales_order.confirmed' else 'sales_order.submitted' end,
    'sales_order', v_order.id, v_response || jsonb_build_object('source', 'reseller_portal'));
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant and operation = 'reseller_portal.order_submit:' || v_account.id::text and idempotency_key = p_key;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Back Office commands
-- ---------------------------------------------------------------------------
create function app.assert_reseller_portal_admin(p_actor uuid, p_tenant uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.reseller_portal_enabled(p_tenant) then
    raise exception using errcode = 'HCRP0', message = 'The reseller portal is not available';
  end if;
  if not app.can_manage_reseller_portal(p_actor, p_tenant) then
    raise exception using errcode = 'HCRA1', message = 'Reseller portal management is not allowed';
  end if;
end;
$$;
revoke all on function app.assert_reseller_portal_admin(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.load_reseller_portal_admin(p_actor uuid, p_tenant uuid)
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
      from app.sales_orders o where o.tenant_id = p_tenant and o.status = 'submitted'), '[]'::jsonb)
  );
end;
$$;

create function app.save_reseller_portal_settings(
  p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb; v_location uuid; v_list uuid;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array['fulfillmentLocationId', 'applicationsOpen', 'autoConfirm'])
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('fulfillmentLocationId', 'defaultPriceListId', 'applicationsOpen', 'autoConfirm'))
    or jsonb_typeof(p_payload->'applicationsOpen') is distinct from 'boolean'
    or jsonb_typeof(p_payload->'autoConfirm') is distinct from 'boolean'
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Portal settings are invalid'; end if;
  begin
    v_location := (p_payload->>'fulfillmentLocationId')::uuid;
    v_list := nullif(p_payload->>'defaultPriceListId', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'HCRP3', message = 'Portal settings are invalid';
  end;
  if not exists (select 1 from app.locations where tenant_id = p_tenant and id = v_location and is_active)
    or (v_list is not null and not exists (select 1 from app.price_lists where tenant_id = p_tenant and id = v_list
      and is_active and pricing_type in ('wholesale', 'dealer'))) then
    raise exception using errcode = 'HCRP3', message = 'The branch or price list is unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-portal:settings:' || p_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.settings' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  insert into app.reseller_portal_settings (tenant_id, fulfillment_location_id, default_price_list_id, applications_open, auto_confirm, updated_by)
  values (p_tenant, v_location, v_list, (p_payload->>'applicationsOpen')::boolean, (p_payload->>'autoConfirm')::boolean, p_actor)
  on conflict (tenant_id) do update set fulfillment_location_id = excluded.fulfillment_location_id,
    default_price_list_id = excluded.default_price_list_id, applications_open = excluded.applications_open,
    auto_confirm = excluded.auto_confirm, updated_by = excluded.updated_by;
  v_response := jsonb_build_object('status', 'saved', 'fulfillmentLocationId', v_location, 'defaultPriceListId', v_list,
    'applicationsOpen', (p_payload->>'applicationsOpen')::boolean, 'autoConfirm', (p_payload->>'autoConfirm')::boolean);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.settings_saved', 'tenant', p_tenant, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'reseller_portal.settings_saved', 'tenant', p_tenant, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.settings', p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

-- Shared core: creates the invited portal account for an active reseller customer.
create function app.create_reseller_account_core(
  p_actor uuid, p_tenant uuid, p_customer uuid, p_email text, p_price_list uuid, p_application uuid, p_request_id text
)
returns app.reseller_accounts language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform 1 from app.customers where tenant_id = p_tenant and id = p_customer and status = 'active' and customer_type = 'reseller' for update;
  if not found then raise exception using errcode = 'HCRA2', message = 'An active reseller customer is required'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using errcode = 'HCRP3', message = 'The sign-in email is invalid';
  end if;
  if not exists (select 1 from app.price_lists where tenant_id = p_tenant and id = p_price_list and is_active
    and pricing_type in ('wholesale', 'dealer')) then
    raise exception using errcode = 'HCRP4', message = 'The reseller price list is unavailable';
  end if;
  insert into app.customer_price_list_assignments (tenant_id, customer_id, price_list_id)
  select p_tenant, p_customer, p_price_list from app.price_lists
  where tenant_id = p_tenant and id = p_price_list and not is_default
  on conflict do nothing;
  begin
    insert into app.reseller_accounts (tenant_id, customer_id, email, price_list_id, application_id, created_by)
    values (p_tenant, p_customer, v_email, p_price_list, p_application, p_actor) returning * into v_account;
  exception when unique_violation then
    raise exception using errcode = 'HCRA3', message = 'This customer or email already has portal access';
  end;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_account.invited', 'customer', p_customer,
    jsonb_build_object('resellerAccountId', v_account.id, 'priceListId', p_price_list, 'applicationId', p_application));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'reseller_account.invited', 'customer', p_customer,
    jsonb_build_object('resellerAccountId', v_account.id, 'email', v_email));
  return v_account;
end;
$$;
revoke all on function app.create_reseller_account_core(uuid, uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated, hcs_hyperdrive;

create function app.invite_reseller_account(
  p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_account app.reseller_accounts%rowtype; v_response jsonb;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object' or not (p_payload ?& array['customerId', 'email', 'priceListId'])
    or exists (select 1 from jsonb_object_keys(p_payload) key where key not in ('customerId', 'email', 'priceListId'))
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
  then raise exception using errcode = 'HCRP3', message = 'Invitation details are invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':reseller-account:invite:' || p_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.account_invite' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  begin
    v_account := app.create_reseller_account_core(p_actor, p_tenant, (p_payload->>'customerId')::uuid, p_payload->>'email',
      (p_payload->>'priceListId')::uuid, null, p_request_id);
  exception when invalid_text_representation then
    raise exception using errcode = 'HCRP3', message = 'Invitation details are invalid';
  end;
  v_response := jsonb_build_object('status', 'invited', 'accountId', v_account.id, 'customerId', v_account.customer_id);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.account_invite', p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create function app.decide_reseller_application(
  p_actor uuid, p_tenant uuid, p_application uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;

create function app.set_reseller_account_status(
  p_actor uuid, p_tenant uuid, p_account uuid, p_status text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_status text;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  select * into v_account from app.reseller_accounts where tenant_id = p_tenant and id = p_account for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The reseller account was not found'; end if;
  if p_status = 'suspended' then
    v_status := 'suspended';
  elsif p_status = 'active' then
    if v_account.status <> 'suspended' then raise exception using errcode = 'HCRA5', message = 'Only suspended accounts can be reactivated'; end if;
    v_status := case when v_account.auth_user_id is null then 'invited' else 'active' end;
  else
    raise exception using errcode = 'HCRP3', message = 'Account status is invalid';
  end if;
  update app.reseller_accounts set status = v_status where tenant_id = p_tenant and id = p_account;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_account.' || v_status, 'customer', v_account.customer_id,
    jsonb_build_object('resellerAccountId', p_account, 'status', v_status));
  return jsonb_build_object('accountId', p_account, 'status', v_status);
end;
$$;

create function app.review_reseller_portal_order(
  p_actor uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype; v_response jsonb;
  v_decision text := p_payload->>'decision'; v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_override uuid;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
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

  if v_decision = 'reject' then
    update app.sales_orders set status = 'cancelled', cancelled_at = now(), review_decision_reason = v_reason
    where tenant_id = p_tenant and id = p_order;
    v_response := jsonb_build_object('salesOrderId', p_order, 'status', 'cancelled');
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor, 'sales_order.rejected', 'sales_order', p_order, v_reason, v_response);
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (p_tenant, 'sales_order.rejected', 'sales_order', p_order, v_response || jsonb_build_object('source', 'reseller_portal'));
  else
    -- Approval reuses the audited Back Office confirmation (permission, price refresh, stock and credit checks).
    update app.sales_orders set status = 'draft', review_decision_reason = v_reason where tenant_id = p_tenant and id = p_order;
    if v_override is null then
      v_response := app.confirm_wholesale_order(p_actor, p_tenant, p_order, p_key, p_hash, p_request_id);
    else
      v_response := app.confirm_wholesale_order_with_credit_override(p_actor, p_tenant, p_order, p_key, p_hash, p_request_id, v_override);
    end if;
    update app.sales_orders set review_reason = null where tenant_id = p_tenant and id = p_order;
  end if;
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.order_review', p_key, p_hash, 200, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only the API role may execute public entry points.
-- ---------------------------------------------------------------------------
revoke all on function app.load_reseller_portal_public(text) from public, anon, authenticated;
revoke all on function app.submit_reseller_application(text, jsonb, text) from public, anon, authenticated;
revoke all on function app.load_reseller_portal_session(uuid) from public, anon, authenticated;
revoke all on function app.load_reseller_portal_catalog(uuid, uuid) from public, anon, authenticated;
revoke all on function app.list_reseller_portal_orders(uuid, uuid) from public, anon, authenticated;
revoke all on function app.submit_reseller_portal_order(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.load_reseller_portal_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function app.save_reseller_portal_settings(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.invite_reseller_account(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.decide_reseller_application(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.set_reseller_account_status(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function app.review_reseller_portal_order(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;

grant execute on function app.load_reseller_portal_public(text) to hcs_hyperdrive;
grant execute on function app.submit_reseller_application(text, jsonb, text) to hcs_hyperdrive;
grant execute on function app.load_reseller_portal_session(uuid) to hcs_hyperdrive;
grant execute on function app.load_reseller_portal_catalog(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.list_reseller_portal_orders(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.submit_reseller_portal_order(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.load_reseller_portal_admin(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.save_reseller_portal_settings(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.invite_reseller_account(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.decide_reseller_application(uuid, uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.set_reseller_account_status(uuid, uuid, uuid, text, text) to hcs_hyperdrive;
grant execute on function app.review_reseller_portal_order(uuid, uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;

commit;
