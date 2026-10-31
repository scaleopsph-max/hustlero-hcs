-- Reseller tiers (owner decisions 2026-10-31): Silver, Gold, Platinum.
--   * A reseller moves up when EITHER threshold is met: active direct referrals OR lifetime invoiced sales
--     (items less returns, no shipping). Defaults: Gold 5 referrals or ₱200,000; Platinum 15 or ₱500,000.
--   * Referrals come from each reseller's referral link; only direct referrals count, and only active ones
--     (an invoice in the last 90 days). Tiers move automatically, up and down.
--   * Only Platinum orders on credit: confirmed at once, billed with the Platinum term, within the credit limit
--     (default ₱20,000, net 15; per-reseller override ready). Over the limit, with an overdue invoice, or on
--     credit hold, the order is pay-first. Silver and Gold pay in full before confirmation (no credit).
--   * Points per tier: Silver ₱100, Gold ₱80, Platinum ₱50 per point. Credit orders earn points only once paid.
-- Customer credit settings stay the single source for credit checks: tier changes write a new revision.
begin;

alter table app.reseller_portal_settings
  add column tier_gold_min_referrals integer not null default 5 check (tier_gold_min_referrals between 1 and 100000),
  add column tier_gold_min_sales numeric(18,2) not null default 200000 check (tier_gold_min_sales > 0),
  add column tier_platinum_min_referrals integer not null default 15 check (tier_platinum_min_referrals between 1 and 100000),
  add column tier_platinum_min_sales numeric(18,2) not null default 500000 check (tier_platinum_min_sales > 0),
  add column tier_silver_spend_per_point numeric(18,2) not null default 100 check (tier_silver_spend_per_point > 0),
  add column tier_gold_spend_per_point numeric(18,2) not null default 80 check (tier_gold_spend_per_point > 0),
  add column tier_platinum_spend_per_point numeric(18,2) not null default 50 check (tier_platinum_spend_per_point > 0),
  add column platinum_credit_limit numeric(18,2) not null default 20000 check (platinum_credit_limit >= 0),
  add column platinum_payment_term text not null default 'net_15' check (platinum_payment_term in ('cod', 'net_7', 'net_15', 'net_30')),
  add column referral_active_days integer not null default 90 check (referral_active_days between 7 and 365),
  add column tiers_refreshed_at timestamptz;

alter table app.reseller_accounts
  add column tier text not null default 'silver' check (tier in ('silver', 'gold', 'platinum')),
  add column tier_changed_at timestamptz,
  add column referral_code text check (referral_code ~ '^[A-Z0-9]{6,12}$'),
  add column referred_by_account_id uuid,
  add column credit_hold boolean not null default false,
  add column credit_limit_override numeric(18,2) check (credit_limit_override is null or credit_limit_override >= 0),
  add constraint reseller_accounts_not_self_referred check (referred_by_account_id is distinct from id),
  add foreign key (tenant_id, referred_by_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict;
create unique index reseller_accounts_referral_code_idx on app.reseller_accounts (tenant_id, referral_code);
create index reseller_accounts_referred_by_idx on app.reseller_accounts (tenant_id, referred_by_account_id)
  where referred_by_account_id is not null;

alter table app.reseller_applications
  add column referred_by_account_id uuid,
  add foreign key (tenant_id, referred_by_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict;
alter table app.sales_orders add column on_credit boolean not null default false;

-- Short unique referral codes for every reseller account.
create function app.assign_referral_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  while new.referral_code is null or exists (select 1 from app.reseller_accounts a where a.tenant_id = new.tenant_id
      and a.referral_code = new.referral_code and a.id <> new.id) loop
    new.referral_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  end loop;
  return new;
end;
$$;
revoke all on function app.assign_referral_code() from public, anon, authenticated, hcs_hyperdrive;
create trigger reseller_accounts_referral_code before insert on app.reseller_accounts
  for each row execute function app.assign_referral_code();
update app.reseller_accounts a set referral_code = upper(substr(md5(a.id::text || clock_timestamp()::text), 1, 8))
where referral_code is null;
alter table app.reseller_accounts alter column referral_code set not null;

create function app.tenant_owner_user(p_tenant uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select user_id from app.tenant_memberships where tenant_id = p_tenant and is_owner and status = 'active'
  order by created_at, user_id limit 1;
$$;
revoke all on function app.tenant_owner_user(uuid) from public, anon, authenticated, hcs_hyperdrive;

-- ---------------------------------------------------------------------------
-- Tier rules
-- ---------------------------------------------------------------------------
create function app.reseller_tier_metrics(p_tenant uuid, p_account uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with account as (select * from app.reseller_accounts where tenant_id = p_tenant and id = p_account),
  settings as (select coalesce(s.referral_active_days, 90) days from app.tenants t
    left join app.reseller_portal_settings s on s.tenant_id = t.id where t.id = p_tenant)
  select jsonb_build_object(
    'activeReferrals', (select count(*)::int from app.reseller_accounts r, settings
      where r.tenant_id = p_tenant and r.referred_by_account_id = p_account and r.status = 'active'
        and exists (select 1 from app.invoices i where i.tenant_id = r.tenant_id and i.customer_id = r.customer_id
          and i.issued_at > now() - make_interval(days => settings.days))),
    'totalReferrals', (select count(*)::int from app.reseller_accounts r where r.tenant_id = p_tenant and r.referred_by_account_id = p_account),
    'lifetimeSales', greatest(
      coalesce((select sum(i.subtotal - i.discount_total) from app.invoices i, account a
        where i.tenant_id = p_tenant and i.customer_id = a.customer_id), 0)
      - coalesce((select sum(n.amount) from app.wholesale_credit_notes n, account a
        where n.tenant_id = p_tenant and n.customer_id = a.customer_id), 0), 0));
$$;
revoke all on function app.reseller_tier_metrics(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.reseller_tier_for(p_settings app.reseller_portal_settings, p_metrics jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when (p_metrics->>'activeReferrals')::int >= p_settings.tier_platinum_min_referrals
      or (p_metrics->>'lifetimeSales')::numeric >= p_settings.tier_platinum_min_sales then 'platinum'
    when (p_metrics->>'activeReferrals')::int >= p_settings.tier_gold_min_referrals
      or (p_metrics->>'lifetimeSales')::numeric >= p_settings.tier_gold_min_sales then 'gold'
    else 'silver' end;
$$;
revoke all on function app.reseller_tier_for(app.reseller_portal_settings, jsonb) from public, anon, authenticated, hcs_hyperdrive;

-- Writes a credit settings revision when the tier's credit differs from the current one.
create function app.sync_reseller_credit(p_tenant uuid, p_account uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype;
  v_current app.wholesale_customer_credit_settings%rowtype; v_term text; v_limit numeric; v_owner uuid;
begin
  select * into v_account from app.reseller_accounts where tenant_id = p_tenant and id = p_account;
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  if v_account.id is null or v_settings.tenant_id is null then return; end if;
  if v_account.tier = 'platinum' and not v_account.credit_hold then
    v_term := v_settings.platinum_payment_term;
    v_limit := coalesce(v_account.credit_limit_override, v_settings.platinum_credit_limit);
  else
    v_term := 'prepaid'; v_limit := 0;
  end if;
  perform 1 from app.customers where tenant_id = p_tenant and id = v_account.customer_id for update;
  select * into v_current from app.wholesale_customer_credit_settings
  where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
  if v_current.id is not null and v_current.payment_term = v_term and v_current.credit_limit = v_limit then return; end if;
  v_owner := app.tenant_owner_user(p_tenant);
  if v_owner is null then return; end if;
  insert into app.wholesale_customer_credit_settings (tenant_id, customer_id, revision, payment_term, credit_limit, reason, recorded_by)
  values (p_tenant, v_account.customer_id, coalesce(v_current.revision, 0) + 1, v_term, v_limit,
    case when v_account.credit_hold and v_account.tier = 'platinum' then 'Reseller credit on hold'
      else 'Reseller tier: ' || initcap(v_account.tier) end, v_owner);
end;
$$;
revoke all on function app.sync_reseller_credit(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Recomputes one reseller's tier; on a change, records it, tells the reseller, and updates their credit.
create function app.evaluate_reseller_tier(p_tenant uuid, p_account uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype; v_tier text;
  v_rank jsonb := '{"silver":1,"gold":2,"platinum":3}';
begin
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  if v_settings.tenant_id is null then return null; end if;
  select * into v_account from app.reseller_accounts where tenant_id = p_tenant and id = p_account for update;
  if not found then return null; end if;
  v_tier := app.reseller_tier_for(v_settings, app.reseller_tier_metrics(p_tenant, p_account));
  if v_tier <> v_account.tier then
    update app.reseller_accounts set tier = v_tier, tier_changed_at = now() where tenant_id = p_tenant and id = p_account;
    insert into app.reseller_notifications (tenant_id, reseller_account_id, kind, title, message, dedup_key)
    values (p_tenant, p_account, 'tier_changed',
      case when (v_rank->>v_tier)::int > (v_rank->>v_account.tier)::int
        then 'You are now ' || initcap(v_tier) || '!' else 'Your tier is now ' || initcap(v_tier) end,
      case v_tier
        when 'platinum' then 'You can now order on credit, and you earn 1 point for every ₱'
          || trim(to_char(v_settings.tier_platinum_spend_per_point, 'FM999,990.##')) || '.'
        when 'gold' then 'You now earn 1 point for every ₱' || trim(to_char(v_settings.tier_gold_spend_per_point, 'FM999,990.##')) || '.'
        else 'You earn 1 point for every ₱' || trim(to_char(v_settings.tier_silver_spend_per_point, 'FM999,990.##')) || '.' end,
      'tier:' || v_tier || ':' || floor(extract(epoch from clock_timestamp()))::bigint::text)
    on conflict (tenant_id, reseller_account_id, dedup_key) do nothing;
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
    values (p_tenant, 'reseller-tier:' || p_account::text, 'system', p_account, 'reseller.tier_changed', 'reseller_account', p_account,
      jsonb_build_object('from', v_account.tier, 'to', v_tier));
  end if;
  perform app.sync_reseller_credit(p_tenant, p_account);
  return v_tier;
end;
$$;
revoke all on function app.evaluate_reseller_tier(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Daily refresh (active referrals lapse with time). Called by the API cron; cheap when already done today.
create function app.refresh_reseller_tiers()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_account record; v_count integer := 0;
begin
  for v_tenant in select tenant_id from app.reseller_portal_settings
    where tiers_refreshed_at is null or tiers_refreshed_at < now() - interval '1 day' for update skip locked loop
    for v_account in select id from app.reseller_accounts where tenant_id = v_tenant and status <> 'suspended' loop
      perform app.evaluate_reseller_tier(v_tenant, v_account.id);
      v_count := v_count + 1;
    end loop;
    update app.reseller_portal_settings set tiers_refreshed_at = now() where tenant_id = v_tenant;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.refresh_reseller_tiers() from public, anon, authenticated;
grant execute on function app.refresh_reseller_tiers() to hcs_hyperdrive;

-- New invoices and returns move the reseller (and the reseller who referred them) right away.
create function app.reseller_tier_on_sale() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  select * into v_account from app.reseller_accounts where tenant_id = new.tenant_id and customer_id = new.customer_id;
  if found then
    perform app.evaluate_reseller_tier(new.tenant_id, v_account.id);
    if v_account.referred_by_account_id is not null then
      perform app.evaluate_reseller_tier(new.tenant_id, v_account.referred_by_account_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.reseller_tier_on_sale() from public, anon, authenticated, hcs_hyperdrive;
create trigger invoices_reseller_tier after insert on app.invoices for each row execute function app.reseller_tier_on_sale();
create trigger credit_notes_reseller_tier after insert on app.wholesale_credit_notes for each row execute function app.reseller_tier_on_sale();

-- An approved application links the new account to the reseller who referred it, then sets its tier and credit.
create function app.reseller_application_approved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reseller_account_id is not null then
    update app.reseller_accounts set referred_by_account_id = new.referred_by_account_id
    where tenant_id = new.tenant_id and id = new.reseller_account_id and referred_by_account_id is null
      and new.referred_by_account_id is distinct from new.reseller_account_id;
    perform app.evaluate_reseller_tier(new.tenant_id, new.reseller_account_id);
  end if;
  return null;
end;
$$;
revoke all on function app.reseller_application_approved() from public, anon, authenticated, hcs_hyperdrive;
create trigger reseller_applications_approved after update of status on app.reseller_applications
  for each row when (old.status is distinct from 'approved' and new.status = 'approved')
  execute function app.reseller_application_approved();

-- ---------------------------------------------------------------------------
-- Credit ordering for Platinum
-- ---------------------------------------------------------------------------
-- What a reseller can still order on credit now; null when credit ordering is not open to them.
create function app.reseller_credit_available(p_tenant uuid, p_account uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_credit app.wholesale_customer_credit_settings%rowtype; v_today date;
begin
  select * into v_account from app.reseller_accounts where tenant_id = p_tenant and id = p_account;
  if v_account.id is null or v_account.tier <> 'platinum' or v_account.credit_hold then return null; end if;
  select * into v_credit from app.wholesale_customer_credit_settings
  where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
  if v_credit.id is null or v_credit.payment_term = 'prepaid' or v_credit.credit_limit <= 0 then return null; end if;
  if app.wholesale_customer_has_unclassified_invoices(p_tenant, v_account.customer_id) then return null; end if;
  select (now() at time zone timezone)::date into v_today from app.tenants where id = p_tenant;
  if exists (select 1 from app.wholesale_invoice_charges c where c.tenant_id = p_tenant and c.customer_id = v_account.customer_id
      and c.due_date < v_today and app.wholesale_invoice_open_balance(p_tenant, c.invoice_id) > 0) then
    return null;
  end if;
  return greatest(v_credit.credit_limit - app.wholesale_credit_exposure(p_tenant, v_account.customer_id), 0);
end;
$$;
revoke all on function app.reseller_credit_available(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Why credit is not open right now (for the portal), or null when it is.
create function app.reseller_credit_block_reason(p_tenant uuid, p_account uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when a.tier <> 'platinum' then 'not_platinum'
    when a.credit_hold then 'on_hold'
    when exists (select 1 from app.wholesale_invoice_charges c where c.tenant_id = a.tenant_id and c.customer_id = a.customer_id
      and c.due_date < (select (now() at time zone timezone)::date from app.tenants where id = a.tenant_id)
      and app.wholesale_invoice_open_balance(a.tenant_id, c.invoice_id) > 0) then 'overdue'
    when app.reseller_credit_available(a.tenant_id, a.id) is null then 'unavailable'
    end
  from app.reseller_accounts a where a.tenant_id = p_tenant and a.id = p_account;
$$;
revoke all on function app.reseller_credit_block_reason(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

CREATE OR REPLACE FUNCTION app.submit_reseller_portal_order(p_auth_user uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype;
  v_customer app.customers%rowtype; v_credit app.wholesale_customer_credit_settings%rowtype;
  v_existing app.idempotency_records%rowtype; v_order app.sales_orders%rowtype;
  v_line jsonb; v_order_line app.sales_order_lines%rowtype; v_balance app.inventory_balances%rowtype; v_entry record;
  v_number bigint; v_order_number text; v_total numeric(18,2) := 0; v_line_count integer := 0;
  v_reason text; v_quantity numeric; v_response jsonb; v_method text; v_address text; v_due timestamptz;
  v_tracked boolean; v_ship numeric(18,2) := 0; v_on_credit boolean := false; v_available numeric;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  -- Expired holds give their stock back before this order checks availability.
  perform app.expire_reseller_payment_holds(p_tenant);
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
      -- Owner decision 2026-10-30: out-of-stock items cannot be ordered from the portal.
      if app.reseller_stock_status(p_tenant, v_settings.fulfillment_location_id, v_entry.variant_id) = 'out_of_stock' then
        raise exception using errcode = 'HCRP7', message = 'An order item is out of stock';
      end if;
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

  if v_method = 'delivery' and v_settings.shipping_fee > 0
    and (v_settings.free_shipping_minimum is null or v_total < v_settings.free_shipping_minimum) then
    v_ship := v_settings.shipping_fee;
  end if;
  -- Platinum resellers in good standing order on credit (owner decision 2026-10-31): the order is confirmed now
  -- and billed with their term. Everyone else pays first: stock is held four hours for the payment proof.
  v_available := app.reseller_credit_available(p_tenant, v_account.id);
  v_on_credit := v_available is not null and v_available >= v_total + v_ship;
  for v_order_line in select * from app.sales_order_lines where tenant_id = p_tenant and sales_order_id = v_order.id
    order by variant_id loop
    select variant.track_inventory into v_tracked from app.product_variants variant
    where variant.tenant_id = p_tenant and variant.id = v_order_line.variant_id;
    if not v_tracked then continue; end if;
    select * into v_balance from app.inventory_balances where tenant_id = p_tenant
      and location_id = v_order.location_id and variant_id = v_order_line.variant_id for update;
    if not found or v_balance.on_hand - v_balance.reserved - v_balance.damaged < v_order_line.ordered_quantity then
      raise exception using errcode = 'HCRP8', message = 'Not enough stock for an order item';
    end if;
    update app.inventory_balances set reserved = reserved + v_order_line.ordered_quantity, version = version + 1, updated_at = now()
    where tenant_id = p_tenant and location_id = v_order.location_id and variant_id = v_order_line.variant_id;
    insert into app.sales_order_reservation_ledger (
      tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason, actor_reseller_account_id
    ) values (
      p_tenant, v_order.id, v_order_line.id, v_order.location_id, v_order_line.variant_id,
      v_order_line.ordered_quantity, case when v_on_credit then 'order_confirmed' else 'payment_hold' end, v_account.id
    );
  end loop;
  if v_on_credit then
    select * into v_credit from app.wholesale_customer_credit_settings
    where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
    v_reason := null; v_due := null;
    update app.sales_orders set status = 'confirmed', review_reason = null, confirmed_at = now(), on_credit = true,
      subtotal = v_total, shipping_fee = v_ship, total = v_total + v_ship
    where tenant_id = p_tenant and id = v_order.id;
    insert into app.wholesale_order_credit_snapshots (tenant_id, sales_order_id, settings_id, payment_term, credit_limit)
    values (p_tenant, v_order.id, v_credit.id, v_credit.payment_term, v_credit.credit_limit);
    insert into app.sales_order_shipments (tenant_id, sales_order_id, method, updated_by)
    values (p_tenant, v_order.id, v_method, app.tenant_owner_user(p_tenant));
  else
    v_reason := 'awaiting_payment';
    update app.sales_orders set review_reason = v_reason, payment_due_at = now() + interval '4 hours',
      subtotal = v_total, shipping_fee = v_ship, total = v_total + v_ship
    where tenant_id = p_tenant and id = v_order.id
    returning payment_due_at into v_due;
  end if;

  v_response := jsonb_build_object('salesOrderId', v_order.id, 'orderNumber', v_order_number,
    'status', case when v_on_credit then 'confirmed' else 'submitted' end, 'reviewReason', v_reason, 'paymentDueAt', v_due,
    'lineCount', v_line_count, 'totalMinor', round((v_total + v_ship) * 100)::bigint,
    'shippingFeeMinor', round(v_ship * 100)::bigint, 'onCredit', v_on_credit);
  -- Portal actors are recorded as `system` with the reseller identity in metadata.
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id,
    case when v_on_credit then 'sales_order.confirmed' else 'sales_order.submitted' end, 'sales_order', v_order.id,
    v_order.location_id, v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id,
      'customerNumber', v_customer.customer_number::text, 'source', 'reseller_portal', 'paymentHold', not v_on_credit));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, case when v_on_credit then 'sales_order.confirmed' else 'sales_order.submitted' end,
    'sales_order', v_order.id, v_response || jsonb_build_object('source', 'reseller_portal'));
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant and operation = 'reseller_portal.order_submit:' || v_account.id::text and idempotency_key = p_key;
  return v_response;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Points per tier; credit orders earn once paid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.award_portal_loyalty(p_actor uuid, p_tenant uuid, p_order uuid, p_request_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_policy app.loyalty_policies%rowtype; v_sale app.sales%rowtype; v_points bigint; v_total bigint := 0; v_id uuid;
  v_ratio numeric; v_on_credit boolean;
begin
  select * into v_policy from app.loyalty_policies where tenant_id = p_tenant;
  if not found or not v_policy.enabled then return 0; end if;
  -- Each tier earns at its own rate (₱ per point); without a reseller account the loyalty policy applies.
  select case a.tier when 'platinum' then s.tier_platinum_spend_per_point when 'gold' then s.tier_gold_spend_per_point
      else s.tier_silver_spend_per_point end, o.on_credit
    into v_ratio, v_on_credit
  from app.sales_orders o
  left join app.reseller_accounts a on a.tenant_id = o.tenant_id and a.customer_id = o.customer_id
  left join app.reseller_portal_settings s on s.tenant_id = o.tenant_id
  where o.tenant_id = p_tenant and o.id = p_order;
  v_ratio := coalesce(v_ratio, v_policy.spend_per_point);
  for v_sale in
    select s.* from app.invoices i join app.sales s on s.tenant_id = i.tenant_id and s.id = i.sale_id
    where i.tenant_id = p_tenant and i.sales_order_id = p_order and s.customer_id is not null
      and not exists (select 1 from app.loyalty_transactions t where t.tenant_id = s.tenant_id and t.sale_id = s.id
        and t.transaction_type = 'sale_earn')
      -- Orders on credit earn only once their invoice is paid.
      and (not coalesce(v_on_credit, false) or coalesce(app.wholesale_invoice_open_balance(p_tenant, i.id), 1) <= 0)
    order by s.completed_at, s.id
  loop
    v_points := floor(round(v_sale.total * 100)::bigint / round(v_ratio * 100)::bigint)::bigint;
    continue when v_points <= 0;
    v_id := gen_random_uuid();
    insert into app.loyalty_transactions (id, tenant_id, customer_id, transaction_type, points_delta, balance_after_points,
      spend_per_point_centavos, sale_id, actor_user_id, occurred_at)
    values (v_id, p_tenant, v_sale.customer_id, 'sale_earn', v_points, 0, round(v_ratio * 100)::bigint,
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
$function$;

-- Paying a credit order's invoice (payment, credit, or return) awards its points.
create function app.award_points_when_paid() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_order uuid;
begin
  select o.id into v_order from app.invoices i join app.sales_orders o on o.tenant_id = i.tenant_id and o.id = i.sales_order_id
  where i.tenant_id = new.tenant_id and i.id = new.invoice_id and o.on_credit and o.source = 'reseller_portal';
  if v_order is not null and app.wholesale_invoice_open_balance(new.tenant_id, new.invoice_id) <= 0 then
    perform app.award_portal_loyalty(app.tenant_owner_user(new.tenant_id), new.tenant_id, v_order,
      'credit-paid:' || new.invoice_id::text);
  end if;
  return null;
end;
$$;
revoke all on function app.award_points_when_paid() from public, anon, authenticated, hcs_hyperdrive;
create trigger payment_allocations_award_points after insert on app.wholesale_payment_allocations
  for each row execute function app.award_points_when_paid();
create trigger credit_applications_award_points after insert on app.wholesale_credit_applications
  for each row execute function app.award_points_when_paid();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table app.reseller_notifications drop constraint reseller_notifications_kind_check;
alter table app.reseller_notifications add constraint reseller_notifications_kind_check check (kind in (
  'order_confirmed', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'payment_verified', 'payment_rejected',
  'order_expired', 'order_rejected', 'return_recorded', 'payment_due_soon', 'payment_overdue', 'payment_window_closing',
  'back_in_stock', 'parcel_shipped', 'return_request_approved', 'return_request_declined', 'tier_changed'));

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
      case when o.on_credit then 'Charged to your credit. We are packing your order.'
        else 'Your payment was verified. We are packing your order.' end message,
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
  perform app.sync_reseller_operations_notifications(p_tenant, p_account);
end;
$function$;

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

  -- Return requests from resellers (Returns tab).
  insert into app.notifications (tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata)
  select r.tenant_id, m.user_id, 'approval', 'attention', 'Return request for ' || i.invoice_number::text,
    i.customer_name_snapshot || ' wants to return items: ' || left(r.reason, 200),
    'invoice', i.id, i.location_id, '/reseller-portal', 'portal:return-request',
    'return-request:' || r.id::text, jsonb_build_object('invoiceNumber', i.invoice_number::text)
  from app.reseller_return_requests r
  join app.invoices i on i.tenant_id = r.tenant_id and i.id = r.invoice_id
  join app.tenant_memberships m on m.tenant_id = r.tenant_id and m.status = 'active'
  where r.tenant_id = p_tenant_id and r.status = 'pending' and r.created_at > now() - interval '30 days'
    and app.can_handle_reseller_portal_orders(m.user_id, p_tenant_id)
    and app.can_read_notification_location(m.user_id, p_tenant_id, i.location_id)
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;

  -- Platinum orders placed on credit go straight to Logistics.
  insert into app.notifications (tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata)
  select o.tenant_id, m.user_id, 'alert', 'info', 'Credit order ' || o.order_number::text || ' to pack',
    coalesce(o.customer_name_snapshot, 'A Platinum reseller') || ' ordered ' || to_char(o.total, 'FM"₱"999,999,999,990.00')
      || ' on credit. It is in Logistics.',
    'sales_order', o.id, o.location_id, '/reseller-portal', 'portal:credit-order', 'credit-order:' || o.id::text,
    jsonb_build_object('orderNumber', o.order_number::text)
  from app.sales_orders o
  join app.tenant_memberships m on m.tenant_id = o.tenant_id and m.status = 'active'
  where o.tenant_id = p_tenant_id and o.source = 'reseller_portal' and o.on_credit and o.confirmed_at > now() - interval '30 days'
    and app.can_handle_reseller_portal_orders(m.user_id, p_tenant_id)
    and app.can_read_notification_location(m.user_id, p_tenant_id, o.location_id)
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Referral link on the application form
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.submit_reseller_application(p_tenant_slug text, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      where key not in ('fullName', 'businessName', 'email', 'phone', 'city', 'message', 'referralCode'))
    or nullif(btrim(p_request_id), '') is null then
    raise exception using errcode = 'HCRP3', message = 'Application details are invalid';
  end if;
  begin
    -- An unknown or inactive referral code is ignored, never refused.
    insert into app.reseller_applications (tenant_id, full_name, business_name, email, phone, city, message, request_id,
      referred_by_account_id)
    values (v_tenant, btrim(p_payload->>'fullName'), nullif(btrim(p_payload->>'businessName'), ''), v_email, v_phone,
      nullif(btrim(p_payload->>'city'), ''), nullif(btrim(p_payload->>'message'), ''), p_request_id,
      (select a.id from app.reseller_accounts a where a.tenant_id = v_tenant and a.status = 'active'
        and a.referral_code = upper(btrim(coalesce(p_payload->>'referralCode', '')))));
  exception
    -- A second pending application for the same email is acknowledged without revealing that one exists.
    when unique_violation then null;
    when check_violation or not_null_violation then
      raise exception using errcode = 'HCRP3', message = 'Application details are invalid';
  end;
  return jsonb_build_object('status', 'received');
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

-- The reseller's tier card: where they are, what the next tier needs, their referral link and referrals.
create function app.load_reseller_tier(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_settings app.reseller_portal_settings%rowtype; v_metrics jsonb;
  v_credit app.wholesale_customer_credit_settings%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_settings from app.reseller_portal_settings where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  v_metrics := app.reseller_tier_metrics(p_tenant, v_account.id);
  select * into v_credit from app.wholesale_customer_credit_settings
  where tenant_id = p_tenant and customer_id = v_account.customer_id order by revision desc limit 1;
  return jsonb_build_object(
    'tier', v_account.tier, 'tierChangedAt', v_account.tier_changed_at,
    'activeReferrals', (v_metrics->>'activeReferrals')::int, 'totalReferrals', (v_metrics->>'totalReferrals')::int,
    'lifetimeSalesMinor', round((v_metrics->>'lifetimeSales')::numeric * 100)::bigint,
    'activeDays', v_settings.referral_active_days,
    'tiers', jsonb_build_array(
      jsonb_build_object('tier', 'silver', 'minReferrals', 0, 'minSalesMinor', 0,
        'spendPerPointMinor', round(v_settings.tier_silver_spend_per_point * 100)::bigint, 'credit', false),
      jsonb_build_object('tier', 'gold', 'minReferrals', v_settings.tier_gold_min_referrals,
        'minSalesMinor', round(v_settings.tier_gold_min_sales * 100)::bigint,
        'spendPerPointMinor', round(v_settings.tier_gold_spend_per_point * 100)::bigint, 'credit', false),
      jsonb_build_object('tier', 'platinum', 'minReferrals', v_settings.tier_platinum_min_referrals,
        'minSalesMinor', round(v_settings.tier_platinum_min_sales * 100)::bigint,
        'spendPerPointMinor', round(v_settings.tier_platinum_spend_per_point * 100)::bigint, 'credit', true)),
    'referralCode', v_account.referral_code,
    'tenantSlug', (select slug::text from app.tenants where id = p_tenant),
    'referrals', coalesce((select jsonb_agg(jsonb_build_object('name', c.full_name, 'joinedAt', coalesce(r.activated_at, r.created_at),
        'active', r.status = 'active' and exists (select 1 from app.invoices i where i.tenant_id = r.tenant_id
          and i.customer_id = r.customer_id and i.issued_at > now() - make_interval(days => v_settings.referral_active_days)))
        order by coalesce(r.activated_at, r.created_at) desc, r.id)
      from app.reseller_accounts r join app.customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
      where r.tenant_id = p_tenant and r.referred_by_account_id = v_account.id), '[]'::jsonb),
    'credit', jsonb_build_object(
      'limitMinor', case when v_credit.payment_term <> 'prepaid' then round(v_credit.credit_limit * 100)::bigint end,
      'paymentTerm', v_credit.payment_term,
      'availableMinor', round(app.reseller_credit_available(p_tenant, v_account.id) * 100)::bigint,
      'blockedReason', app.reseller_credit_block_reason(p_tenant, v_account.id)));
end;
$$;
revoke all on function app.load_reseller_tier(uuid, uuid) from public, anon, authenticated;
grant execute on function app.load_reseller_tier(uuid, uuid) to hcs_hyperdrive;

-- Back Office: tier thresholds, points per tier, and Platinum credit.
create function app.save_reseller_tier_settings(p_actor uuid, p_tenant uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account record; v_n jsonb;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_payload)) <> 10
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('goldMinReferrals', 'goldMinSalesMinor',
      'platinumMinReferrals', 'platinumMinSalesMinor', 'silverSpendPerPointMinor', 'goldSpendPerPointMinor',
      'platinumSpendPerPointMinor', 'platinumCreditLimitMinor', 'platinumPaymentTerm', 'activeDays'))
    or exists (select 1 from jsonb_each(p_payload) e where e.key <> 'platinumPaymentTerm'
      and (jsonb_typeof(e.value) is distinct from 'number' or (e.value)::text !~ '^[0-9]{1,15}$'))
    or coalesce(p_payload->>'platinumPaymentTerm', '') not in ('cod', 'net_7', 'net_15', 'net_30') then
    raise exception using errcode = 'HCRP3', message = 'Tier settings are invalid';
  end if;
  v_n := p_payload;
  if (v_n->>'goldMinReferrals')::int < 1 or (v_n->>'platinumMinReferrals')::int <= (v_n->>'goldMinReferrals')::int
    or (v_n->>'goldMinSalesMinor')::numeric < 100 or (v_n->>'platinumMinSalesMinor')::numeric <= (v_n->>'goldMinSalesMinor')::numeric
    or (v_n->>'silverSpendPerPointMinor')::numeric < 100 or (v_n->>'goldSpendPerPointMinor')::numeric < 100
    or (v_n->>'platinumSpendPerPointMinor')::numeric < 100
    or (v_n->>'platinumCreditLimitMinor')::numeric > 10000000000
    or (v_n->>'activeDays')::int not between 7 and 365 then
    raise exception using errcode = 'HCRP3', message = 'Tier settings are invalid';
  end if;
  update app.reseller_portal_settings set
    tier_gold_min_referrals = (v_n->>'goldMinReferrals')::int, tier_gold_min_sales = (v_n->>'goldMinSalesMinor')::numeric / 100,
    tier_platinum_min_referrals = (v_n->>'platinumMinReferrals')::int,
    tier_platinum_min_sales = (v_n->>'platinumMinSalesMinor')::numeric / 100,
    tier_silver_spend_per_point = (v_n->>'silverSpendPerPointMinor')::numeric / 100,
    tier_gold_spend_per_point = (v_n->>'goldSpendPerPointMinor')::numeric / 100,
    tier_platinum_spend_per_point = (v_n->>'platinumSpendPerPointMinor')::numeric / 100,
    platinum_credit_limit = (v_n->>'platinumCreditLimitMinor')::numeric / 100,
    platinum_payment_term = v_n->>'platinumPaymentTerm', referral_active_days = (v_n->>'activeDays')::int,
    tiers_refreshed_at = now()
  where tenant_id = p_tenant;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  for v_account in select id from app.reseller_accounts where tenant_id = p_tenant and status <> 'suspended' loop
    perform app.evaluate_reseller_tier(p_tenant, v_account.id);
  end loop;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.tier_settings_saved', 'tenant', p_tenant, p_payload);
  return app.reseller_tier_settings_json(p_tenant);
end;
$$;

create function app.reseller_tier_settings_json(p_tenant uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('goldMinReferrals', s.tier_gold_min_referrals,
    'goldMinSalesMinor', round(s.tier_gold_min_sales * 100)::bigint,
    'platinumMinReferrals', s.tier_platinum_min_referrals,
    'platinumMinSalesMinor', round(s.tier_platinum_min_sales * 100)::bigint,
    'silverSpendPerPointMinor', round(s.tier_silver_spend_per_point * 100)::bigint,
    'goldSpendPerPointMinor', round(s.tier_gold_spend_per_point * 100)::bigint,
    'platinumSpendPerPointMinor', round(s.tier_platinum_spend_per_point * 100)::bigint,
    'platinumCreditLimitMinor', round(s.platinum_credit_limit * 100)::bigint,
    'platinumPaymentTerm', s.platinum_payment_term, 'activeDays', s.referral_active_days)
  from app.reseller_portal_settings s where s.tenant_id = p_tenant;
$$;
revoke all on function app.reseller_tier_settings_json(uuid) from public, anon, authenticated, hcs_hyperdrive;
revoke all on function app.save_reseller_tier_settings(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.save_reseller_tier_settings(uuid, uuid, jsonb, text) to hcs_hyperdrive;

-- Back Office: credit hold, a credit limit just for this reseller, and who referred them.
create function app.save_reseller_account_controls(p_actor uuid, p_tenant uuid, p_account uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_referrer uuid; v_old uuid;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('creditHold', 'creditLimitOverrideMinor', 'referredByAccountId'))
    or (p_payload ? 'creditHold' and jsonb_typeof(p_payload->'creditHold') is distinct from 'boolean')
    or (p_payload ? 'creditLimitOverrideMinor' and not (jsonb_typeof(p_payload->'creditLimitOverrideMinor') = 'null'
      or (jsonb_typeof(p_payload->'creditLimitOverrideMinor') = 'number' and (p_payload->>'creditLimitOverrideMinor') ~ '^[0-9]{1,12}$')))
    or (p_payload ? 'referredByAccountId' and not (jsonb_typeof(p_payload->'referredByAccountId') = 'null'
      or coalesce(p_payload->>'referredByAccountId', '') ~ '^[0-9a-f-]{36}$')) then
    raise exception using errcode = 'HCRP3', message = 'Reseller account details are invalid';
  end if;
  select * into v_account from app.reseller_accounts where tenant_id = p_tenant and id = p_account for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The reseller account was not found'; end if;
  v_old := v_account.referred_by_account_id;
  if p_payload ? 'referredByAccountId' then
    v_referrer := nullif(p_payload->>'referredByAccountId', '')::uuid;
    if v_referrer = p_account or (v_referrer is not null and not exists (select 1 from app.reseller_accounts
        where tenant_id = p_tenant and id = v_referrer)) then
      raise exception using errcode = 'HCRP3', message = 'Reseller account details are invalid';
    end if;
    -- No loops: the referrer may not be someone this reseller referred, directly or further down.
    if v_referrer is not null and exists (with recursive down(id) as (
        select id from app.reseller_accounts where tenant_id = p_tenant and referred_by_account_id = p_account
        union select a.id from app.reseller_accounts a join down d on a.referred_by_account_id = d.id where a.tenant_id = p_tenant)
      select 1 from down where id = v_referrer) then
      raise exception using errcode = 'HCRP3', message = 'Reseller account details are invalid';
    end if;
  end if;
  update app.reseller_accounts set
    credit_hold = case when p_payload ? 'creditHold' then (p_payload->>'creditHold')::boolean else credit_hold end,
    credit_limit_override = case when p_payload ? 'creditLimitOverrideMinor'
      then (nullif(p_payload->>'creditLimitOverrideMinor', ''))::numeric / 100 else credit_limit_override end,
    referred_by_account_id = case when p_payload ? 'referredByAccountId' then v_referrer else referred_by_account_id end
  where tenant_id = p_tenant and id = p_account;
  perform app.evaluate_reseller_tier(p_tenant, p_account);
  if v_old is not null then perform app.evaluate_reseller_tier(p_tenant, v_old); end if;
  if v_referrer is not null then perform app.evaluate_reseller_tier(p_tenant, v_referrer); end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller.account_controls_saved', 'reseller_account', p_account, p_payload);
  return app.reseller_account_tier_json(p_tenant, p_account);
end;
$$;

create function app.reseller_account_tier_json(p_tenant uuid, p_account uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tier', a.tier, 'referralCode', a.referral_code, 'referredByAccountId', a.referred_by_account_id,
    'referredByName', (select c.full_name from app.reseller_accounts r join app.customers c on c.tenant_id = r.tenant_id
      and c.id = r.customer_id where r.tenant_id = a.tenant_id and r.id = a.referred_by_account_id),
    'activeReferrals', (m->>'activeReferrals')::int, 'lifetimeSalesMinor', round((m->>'lifetimeSales')::numeric * 100)::bigint,
    'creditHold', a.credit_hold, 'creditLimitOverrideMinor', round(a.credit_limit_override * 100)::bigint)
  from app.reseller_accounts a, lateral app.reseller_tier_metrics(a.tenant_id, a.id) m
  where a.tenant_id = p_tenant and a.id = p_account;
$$;
revoke all on function app.reseller_account_tier_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;
revoke all on function app.save_reseller_account_controls(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.save_reseller_account_controls(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;

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
        'businessName', a.business_name, 'email', a.email::text, 'phone', a.phone, 'city', a.city, 'message', a.message,
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

-- Pay-first orders are confirmed only when the payment covers the whole order (owner decision 2026-10-31).
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
    -- Without open credit (Silver, Gold, or Platinum over the limit), the payment must cover the whole order.
    if app.reseller_credit_available(p_tenant, (select a.id from app.reseller_accounts a where a.tenant_id = p_tenant
        and a.customer_id = v_order.customer_id)) is null and v_override is null
      and coalesce((select sum(amount) from app.payment_proofs where tenant_id = p_tenant and sales_order_id = p_order
        and status in ('pending', 'accepted')), 0) < v_order.total then
      raise exception using errcode = 'HCRT1', message = 'The payment does not cover the order total';
    end if;
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

-- Existing resellers get their tier now; credit follows the tier (owner decision: credit only for Platinum).
do $$ begin perform app.refresh_reseller_tiers(); end $$;

commit;
