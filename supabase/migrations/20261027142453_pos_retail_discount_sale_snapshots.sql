begin;

-- Only the new discounted-sale path uses these records. Existing POS posting
-- and reversal entry points retain their current behavior and grants.
create table app.pos_sale_discount_snapshots(
 tenant_id uuid not null,sale_id uuid not null,discount_id uuid not null,discount_revision integer not null,
 definition_snapshot jsonb not null,subtotal_minor numeric(11,0) not null,discount_minor numeric(11,0) not null,
 payable_minor numeric(11,0) not null,applied_by_employee_id uuid not null,applied_at timestamptz not null,
 primary key(tenant_id,sale_id),
 foreign key(tenant_id,sale_id) references app.sales(tenant_id,id) on delete restrict,
 foreign key(tenant_id,discount_id,discount_revision) references app.retail_discount_versions(tenant_id,discount_id,revision) on delete restrict,
 foreign key(tenant_id,applied_by_employee_id) references app.employees(tenant_id,id) on delete restrict,
 check(subtotal_minor>0 and discount_minor>0 and payable_minor>0 and payable_minor=subtotal_minor-discount_minor)
);
alter table app.sale_lines add constraint sale_lines_discount_parent_identity unique(tenant_id,sale_id,id);
create table app.pos_sale_line_discounts(
 tenant_id uuid not null,sale_id uuid not null,sale_line_id uuid not null,
 gross_minor numeric(11,0) not null,discount_minor numeric(11,0) not null,net_minor numeric(11,0) not null,
 primary key(tenant_id,sale_line_id),
 foreign key(tenant_id,sale_id) references app.pos_sale_discount_snapshots(tenant_id,sale_id) on delete restrict,
 foreign key(tenant_id,sale_id,sale_line_id) references app.sale_lines(tenant_id,sale_id,id) on delete restrict,
 check(gross_minor>=0 and discount_minor>=0 and net_minor>=0 and net_minor=gross_minor-discount_minor)
);
alter table app.pos_sale_discount_snapshots enable row level security;
alter table app.pos_sale_line_discounts enable row level security;
revoke all on app.pos_sale_discount_snapshots,app.pos_sale_line_discounts from public,anon,authenticated,hcs_hyperdrive;
create function app.reject_pos_discount_snapshot_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='HCDP3',message='POS discount snapshots are immutable'; end; $$;
revoke all on function app.reject_pos_discount_snapshot_mutation() from public,anon,authenticated,hcs_hyperdrive;
create trigger pos_sale_discount_snapshots_immutable before update or delete on app.pos_sale_discount_snapshots
for each row execute function app.reject_pos_discount_snapshot_mutation();
create trigger pos_sale_line_discounts_immutable before update or delete on app.pos_sale_line_discounts
for each row execute function app.reject_pos_discount_snapshot_mutation();

create function app.lock_pos_discount_scope(p_hash text,p_require_apply boolean) returns app.pos_employee_sessions
language plpgsql security definer set search_path='' as $$
declare v_pos app.pos_employee_sessions%rowtype;v_ent app.tenant_entitlements%rowtype;v_permission text;
begin
 select * into v_pos from app.pos_employee_sessions where token_hash=p_hash;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform 1 from app.tenants where id=v_pos.tenant_id and status='active' for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform 1 from app.features where code='sales' and platform_available for share;
 if not found then raise exception using errcode='HCDP0',message='POS discounts are unavailable'; end if;
 select * into v_ent from app.tenant_entitlements where tenant_id=v_pos.tenant_id and feature_code='sales' for share;
 if not found or not v_ent.entitled or not v_ent.enabled or v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp()
 then raise exception using errcode='HCDP0',message='POS discounts are unavailable'; end if;
 perform 1 from app.employees where tenant_id=v_pos.tenant_id and id=v_pos.employee_id and status='active' for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform 1 from app.locations where tenant_id=v_pos.tenant_id and id=v_pos.location_id and is_active for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform 1 from app.registers where tenant_id=v_pos.tenant_id and id=v_pos.register_id and location_id=v_pos.location_id and status='active' for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform 1 from app.pos_devices where tenant_id=v_pos.tenant_id and id=v_pos.device_id and register_id=v_pos.register_id and location_id=v_pos.location_id and status='active' for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform 1 from app.employee_locations where tenant_id=v_pos.tenant_id and employee_id=v_pos.employee_id and location_id=v_pos.location_id for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 select * into v_pos from app.pos_employee_sessions where token_hash=p_hash and revoked_at is null and expires_at>clock_timestamp() for share;
 if not found then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 if p_require_apply then
  foreach v_permission in array array['discounts.apply','sales.create'] loop
   perform 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id
   where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code=v_permission
   order by er.role_id for share of er,rp;
   if not found then raise exception using errcode='HCS93',message='Employee cannot apply retail discounts'; end if;
  end loop;
 end if;
 if v_pos.expires_at<=clock_timestamp() then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 if v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp()
 then raise exception using errcode='HCDP0',message='POS discounts are unavailable'; end if;
 return v_pos;
end; $$;
revoke all on function app.lock_pos_discount_scope(text,boolean) from public,anon,authenticated,hcs_hyperdrive;

create function app.load_pos_discount_options(p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_pos app.pos_employee_sessions%rowtype;v_can boolean;v_rows jsonb;
begin
 v_pos:=app.lock_pos_discount_scope(p_hash,false);
 select count(distinct rp.permission_code)=2 into v_can from app.employee_roles er
 join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id
 where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code in ('discounts.apply','sales.create');
 if not v_can then return jsonb_build_object('canApplyDiscount',false,'discounts','[]'::jsonb); end if;
 perform app.lock_pos_discount_scope(p_hash,true);
 select coalesce(jsonb_agg(app.retail_discount_json(d) order by lower(d.name),d.id),'[]'::jsonb)
 into v_rows from app.retail_discounts d where tenant_id=v_pos.tenant_id and status='active';
 perform app.lock_pos_discount_scope(p_hash,true);
 return jsonb_build_object('canApplyDiscount',true,'discounts',v_rows);
end; $$;
revoke all on function app.load_pos_discount_options(text) from public,anon,authenticated;
grant execute on function app.load_pos_discount_options(text) to hcs_hyperdrive;

create function app.complete_pos_discounted_sale_core(
  p_session_token_hash text,
  p_lines jsonb,
  p_payments jsonb,
  p_customer_id uuid,
  p_pricing_type text,
  p_discount jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_register_session app.register_sessions%rowtype;
  v_existing app.idempotency_records%rowtype;
  v_customer app.customers%rowtype;
  v_price_list app.price_lists%rowtype;
  v_line jsonb;
  v_payment jsonb;
  v_variant record;
  v_balance app.inventory_balances%rowtype;
  v_method app.payment_methods%rowtype;
  v_entry record;
  v_sale_id uuid := gen_random_uuid();
  v_business_date date;
  v_receipt_seq bigint;
  v_receipt text;
  v_subtotal numeric(18,2) := 0;
  v_quantity numeric(18,3);
  v_group_quantity numeric(18,3);
  v_unit_price numeric(18,2);
  v_line_total numeric(18,2);
  v_payment_total numeric(18,2);
  v_amount numeric(18,2);
  v_tendered numeric(18,2);
  v_change numeric(18,2);
  v_cash_received_centavos bigint := 0;
  v_change_centavos bigint := 0;
  v_payment_response jsonb := '[]'::jsonb;
  v_response jsonb;
  v_policy app.loyalty_policies%rowtype;
  v_points bigint := 0;
  v_line_pricing_type text;
  v_any_wholesale boolean := false;
  v_loyalty_balance bigint := 0;
  v_loyalty_transaction_id uuid;
  v_discount app.retail_discounts%rowtype;
  v_definition jsonb;
  v_discount_revision numeric;
  v_gross_minor numeric;
  v_discount_minor numeric;
  v_payable numeric(18,2);
  v_gross_through numeric:=0;
  v_discount_through numeric:=0;
  v_cumulative numeric;
  v_saved_line record;
begin
  if jsonb_typeof(p_discount) is distinct from 'object' then raise exception using errcode='HCDP2',message='Invalid predefined discount selection'; end if;
  if jsonb_typeof(p_discount->'discountId') is distinct from 'string' or jsonb_typeof(p_discount->'expectedRevision') is distinct from 'number'
  or exists(select 1 from jsonb_object_keys(p_discount) k where k not in ('discountId','expectedRevision'))
  then raise exception using errcode='HCDP2',message='Invalid predefined discount selection'; end if;
  v_discount_revision:=(p_discount->>'expectedRevision')::numeric;
  if v_discount_revision<>trunc(v_discount_revision) or v_discount_revision not between 1 and 2147483647
  then raise exception using errcode='HCDP2',message='Invalid predefined discount selection'; end if;
  if p_pricing_type is null or p_pricing_type not in ('auto','retail','wholesale','dealer') then
    raise exception using errcode = 'HCSW0', message = 'Pricing type is invalid';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200
    or exists (select 1 from jsonb_array_elements(p_lines) line where (line->>'variantId') is null
      or (line->>'quantityMilli') is null or (line->>'quantityMilli') !~ '^[1-9][0-9]*$')
    or exists (select 1 from jsonb_array_elements(p_lines) line group by line->>'variantId' having count(*) > 1) then
    raise exception using errcode = 'HCS94', message = 'Sale lines are invalid';
  end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 or jsonb_array_length(p_payments) > 10
    or exists (select 1 from jsonb_array_elements(p_payments) payment where (payment->>'paymentMethodId') is null
      or (payment->>'paymentMethodId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (payment->>'amountCentavos') is null or (payment->>'amountCentavos') !~ '^[1-9][0-9]*$'
      or (payment->>'tenderedCentavos') is null or (payment->>'tenderedCentavos') !~ '^[1-9][0-9]*$')
    or exists (select 1 from jsonb_array_elements(p_payments) payment group by payment->>'paymentMethodId' having count(*) > 1) then
    raise exception using errcode = 'HCS94', message = 'Sale payments are invalid';
  end if;

  v_pos:=app.lock_pos_discount_scope(p_session_token_hash,true);
  if not app.is_location_inventory_cutover_ready(v_pos.tenant_id, v_pos.location_id) then
    raise exception using errcode = 'HCSC0', message = 'Opening inventory must be posted and reconciled before sales can begin';
  end if;
  if not exists (select 1 from app.employee_roles employee_role
    join app.role_permissions permission on permission.tenant_id = employee_role.tenant_id and permission.role_id = employee_role.role_id
    where employee_role.tenant_id = v_pos.tenant_id and employee_role.employee_id = v_pos.employee_id
      and permission.permission_code = 'sales.create') then
    raise exception using errcode = 'HCS93', message = 'Employee cannot complete sales';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text || ':pos-sale.complete:' || p_idempotency_key, 0));
  perform app.lock_pos_discount_scope(p_session_token_hash,true);
  select * into v_existing from app.idempotency_records where tenant_id = v_pos.tenant_id
    and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at)
    values (v_pos.tenant_id, 'pos-sale.complete', p_idempotency_key, p_request_hash, now() + interval '24 hours');
  end if;

  select * into v_discount from app.retail_discounts where tenant_id=v_pos.tenant_id and id=(p_discount->>'discountId')::uuid for share;
  perform app.lock_pos_discount_scope(p_session_token_hash,true);
  if v_discount.id is null or v_discount.status<>'active' or v_discount.revision<>v_discount_revision
  then raise exception using errcode='HCDP1',message='Selected discount changed or is unavailable'; end if;
  select snapshot into v_definition from app.retail_discount_versions where tenant_id=v_pos.tenant_id and discount_id=v_discount.id and revision=v_discount.revision;

  if p_customer_id is not null then
    select * into v_customer from app.customers where tenant_id = v_pos.tenant_id and id = p_customer_id and status = 'active' for share;
    if not found then raise exception using errcode = 'HCSB1', message = 'Customer was not found'; end if;
  end if;
  if p_pricing_type <> 'retail' then
    if p_pricing_type <> 'auto' and (v_customer.id is null or v_customer.customer_type <> 'reseller') then
      raise exception using errcode = 'HCSW1', message = 'An active reseller customer is required for wholesale or dealer pricing';
    end if;
    select price_list.* into v_price_list from app.customer_price_list_assignments assignment
    join app.price_lists price_list on price_list.tenant_id = assignment.tenant_id and price_list.id = assignment.price_list_id
    where assignment.tenant_id = v_pos.tenant_id and assignment.customer_id = p_customer_id
      and price_list.pricing_type = case when p_pricing_type='auto' then 'wholesale' else p_pricing_type end and price_list.is_active
    order by price_list.updated_at desc, price_list.id limit 1;
    if v_price_list.id is null then
      select * into v_price_list from app.price_lists where tenant_id = v_pos.tenant_id
        and pricing_type = case when p_pricing_type='auto' then 'wholesale' else p_pricing_type end and is_default and is_active order by updated_at desc, id limit 1;
    end if;
    if v_price_list.id is null and p_pricing_type <> 'auto' then raise exception using errcode = 'HCSW2', message = 'No active price list is available'; end if;
  end if;

  select * into v_register_session from app.register_sessions where tenant_id = v_pos.tenant_id
    and register_id = v_pos.register_id and employee_id = v_pos.employee_id and status = 'open' for update;
  if v_register_session.id is null then raise exception using errcode = 'HCS95', message = 'Open register session is required'; end if;

  select (now() at time zone coalesce(location.timezone, tenant.timezone, 'Asia/Manila'))::date into v_business_date
  from app.locations location join app.tenants tenant on tenant.id = location.tenant_id
  where location.tenant_id = v_pos.tenant_id and location.id = v_pos.location_id;
  insert into app.receipt_counters (tenant_id, location_id, business_date, last_number)
  values (v_pos.tenant_id, v_pos.location_id, v_business_date, 1)
  on conflict (tenant_id, location_id, business_date) do update
    set last_number = app.receipt_counters.last_number + 1, updated_at = now()
  returning last_number into v_receipt_seq;
  select upper(location.code::text) || '-' || to_char(v_business_date, 'YYYYMMDD') || '-' || lpad(v_receipt_seq::text, 6, '0')
  into v_receipt from app.locations location where location.tenant_id = v_pos.tenant_id and location.id = v_pos.location_id;
  insert into app.sales (id, tenant_id, location_id, register_id, register_session_id, employee_id, customer_id,
    receipt_number, subtotal, total, pricing_type, price_list_id)
  values (v_sale_id, v_pos.tenant_id, v_pos.location_id, v_pos.register_id, v_register_session.id, v_pos.employee_id,
    p_customer_id, v_receipt, 0, 0, case when p_pricing_type='auto' then 'retail' else p_pricing_type end, case when p_pricing_type='auto' then null else v_price_list.id end);

  -- Serialize active product/category snapshots with catalog edits before variant
  -- and stock admission. All product locks are taken in deterministic order.
  perform 1 from app.products p where p.tenant_id=v_pos.tenant_id and p.id in
    (select v.product_id from app.product_variants v join jsonb_array_elements(p_lines) x on v.id=(x->>'variantId')::uuid where v.tenant_id=v_pos.tenant_id)
    order by p.id for share;
  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'variantId' loop
    v_quantity := ((v_line->>'quantityMilli')::bigint)::numeric / 1000;
    if v_quantity*1000>9007199254740991 then
      raise exception using errcode='HCS94',message='Sale quantity exceeds the supported range';
    end if;
    select variant.id, variant.product_id, variant.name variant_name, variant.sku::text sku, variant.retail_price,
      variant.unit_cost, variant.track_inventory, product.name product_name, product.category_id into v_variant
    from app.product_variants variant join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    where variant.tenant_id = v_pos.tenant_id and variant.id = (v_line->>'variantId')::uuid
      and variant.is_active and product.status = 'active' for update of variant;
    if v_variant.id is null then raise exception using errcode = 'HCS97', message = 'Product variant is unavailable'; end if;
    v_unit_price := v_variant.retail_price;
    v_group_quantity := null;
    v_line_pricing_type := case when p_pricing_type='auto' then 'retail' else p_pricing_type end;
    select null::numeric unit_price,null::uuid pricing_group_id,null::numeric threshold_quantity,null::uuid category_id into v_entry;
    if p_pricing_type='auto' then
      select coalesce(sum((line->>'quantityMilli')::bigint::numeric/1000),0) into v_group_quantity
      from jsonb_array_elements(p_lines) line
      join app.product_variants variant on variant.tenant_id=v_pos.tenant_id and variant.id=(line->>'variantId')::uuid
      join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id
      where product.category_id=v_variant.category_id and product.status='active' and variant.is_active;
      select entry.unit_price,entry.pricing_group_id,g.threshold_quantity,g.category_id into v_entry
      from app.price_list_entries entry join app.pricing_groups g
        on g.tenant_id=entry.tenant_id and g.id=entry.pricing_group_id and g.is_active
      where entry.tenant_id=v_pos.tenant_id and entry.price_list_id=v_price_list.id and entry.variant_id=v_variant.id
      for share of entry,g;
      if v_entry.category_id is not null and v_entry.category_id=v_variant.category_id
        and v_group_quantity>=v_entry.threshold_quantity then
        if v_customer.id is null or v_customer.customer_type<>'reseller' then
          raise exception using errcode='HCSW1',message='An active reseller customer is required for wholesale or dealer pricing';
        end if;
        v_unit_price:=v_entry.unit_price;
        v_line_pricing_type:='wholesale';
        v_any_wholesale:=true;
      end if;
    elsif p_pricing_type <> 'retail' then
      select entry.unit_price, entry.pricing_group_id, pricing_group.threshold_quantity into v_entry
      from app.price_list_entries entry join app.pricing_groups pricing_group
        on pricing_group.tenant_id = entry.tenant_id and pricing_group.id = entry.pricing_group_id and pricing_group.is_active
      where entry.tenant_id = v_pos.tenant_id and entry.price_list_id = v_price_list.id and entry.variant_id = v_variant.id;
      if v_entry.pricing_group_id is null then
        raise exception using errcode = 'HCSW2', message = 'A cart item is not included in the selected price list';
      end if;
      select coalesce(sum(((line->>'quantityMilli')::bigint)::numeric / 1000),0) into v_group_quantity
      from jsonb_array_elements(p_lines) line join app.price_list_entries grouped_entry
        on grouped_entry.tenant_id = v_pos.tenant_id and grouped_entry.price_list_id = v_price_list.id
        and grouped_entry.variant_id = (line->>'variantId')::uuid
      where grouped_entry.pricing_group_id = v_entry.pricing_group_id;
      if v_group_quantity < v_entry.threshold_quantity then
        raise exception using errcode = 'HCSW3', message = 'The pricing-group quantity threshold has not been met';
      end if;
      v_unit_price := v_entry.unit_price;
    end if;
    if v_group_quantity*1000>9007199254740991 then
      raise exception using errcode='HCS94',message='Pricing quantity exceeds the supported range';
    end if;
    if v_variant.track_inventory then
      select * into v_balance from app.inventory_balances where tenant_id = v_pos.tenant_id
        and location_id = v_pos.location_id and variant_id = v_variant.id for update;
      if v_balance.variant_id is null or (v_balance.on_hand - v_balance.reserved - v_balance.damaged) < v_quantity then
        raise exception using errcode = 'HCS98', message = 'Insufficient available stock';
      end if;
    end if;
    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    if v_unit_price*100>9007199254740991 or v_subtotal*100>9007199254740991 then
      raise exception using errcode='HCS99',message='Sale total exceeds the supported range';
    end if;
    insert into app.sale_lines (id, tenant_id, sale_id, variant_id, product_name, variant_name, sku, quantity, unit_price, unit_cost, line_total,
      pricing_type,pricing_basis,pricing_category_id,pricing_group_id,pricing_quantity,pricing_threshold_quantity,pricing_price_list_id)
    values (gen_random_uuid(), v_pos.tenant_id, v_sale_id, v_variant.id, v_variant.product_name, v_variant.variant_name,
      v_variant.sku, v_quantity, v_unit_price, v_variant.unit_cost, v_line_total,
      v_line_pricing_type,case when p_pricing_type='auto' then 'category' else 'manual' end,
      case when p_pricing_type='auto' then v_variant.category_id else null end,
      case when v_line_pricing_type<>'retail' then v_entry.pricing_group_id else null end,
      v_group_quantity,case when v_line_pricing_type<>'retail' then v_entry.threshold_quantity else null end,
      case when v_line_pricing_type<>'retail' then v_price_list.id else null end);
    if v_variant.track_inventory then
      update app.inventory_balances set on_hand = on_hand - v_quantity, version = version + 1, updated_at = now()
      where tenant_id = v_pos.tenant_id and location_id = v_pos.location_id and variant_id = v_variant.id;
      insert into app.inventory_movements (tenant_id, location_id, variant_id, movement_type, quantity, unit_cost, source_type, source_reference, occurred_at)
      values (v_pos.tenant_id, v_pos.location_id, v_variant.id, 'SALE', -v_quantity,
        coalesce(v_balance.average_unit_cost, v_variant.unit_cost), 'sale', v_sale_id::text, now());
    end if;
  end loop;

  perform app.lock_pos_discount_scope(p_session_token_hash,true);
  if p_pricing_type in ('wholesale','dealer') or v_any_wholesale
  or exists(select 1 from app.sale_lines where tenant_id=v_pos.tenant_id and sale_id=v_sale_id and pricing_type<>'retail')
  or exists(select 1 from app.sales where tenant_id=v_pos.tenant_id and id=v_sale_id and (discount_total<>0 or tax_total<>0))
  then raise exception using errcode='HCDP2',message='Discounts require an untaxed retail-only ticket without stacking'; end if;
  v_gross_minor:=round(v_subtotal*100);
  if v_gross_minor<=0 or v_gross_minor>99999999999 then raise exception using errcode='HCDP2',message='Discount subtotal is outside the supported range'; end if;
  v_discount_minor:=case when v_discount.kind='fixed' then v_discount.amount_minor else round(v_gross_minor*v_discount.rate_bps/10000) end;
  if v_discount_minor<=0 or v_discount_minor>=v_gross_minor then raise exception using errcode='HCDP2',message='Discount must leave a positive payable amount'; end if;
  v_payable:=(v_gross_minor-v_discount_minor)/100;
  insert into app.pos_sale_discount_snapshots(tenant_id,sale_id,discount_id,discount_revision,definition_snapshot,subtotal_minor,discount_minor,payable_minor,applied_by_employee_id,applied_at)
  values(v_pos.tenant_id,v_sale_id,v_discount.id,v_discount.revision,v_definition,v_gross_minor,v_discount_minor,v_gross_minor-v_discount_minor,v_pos.employee_id,now());
  for v_saved_line in select * from app.sale_lines where tenant_id=v_pos.tenant_id and sale_id=v_sale_id order by id loop
    v_gross_through:=v_gross_through+round(v_saved_line.line_total*100);
    v_cumulative:=round(v_discount_minor*v_gross_through/v_gross_minor);
    insert into app.pos_sale_line_discounts(tenant_id,sale_id,sale_line_id,gross_minor,discount_minor,net_minor)
    values(v_pos.tenant_id,v_sale_id,v_saved_line.id,round(v_saved_line.line_total*100),v_cumulative-v_discount_through,round(v_saved_line.line_total*100)-(v_cumulative-v_discount_through));
    v_discount_through:=v_cumulative;
  end loop;

  select sum((payment->>'amountCentavos')::bigint)::numeric / 100 into v_payment_total from jsonb_array_elements(p_payments) payment;
  if v_payment_total <> v_payable then raise exception using errcode = 'HCS99', message = 'Payment allocation must equal the sale total'; end if;
  for v_payment in select value from jsonb_array_elements(p_payments) order by value->>'paymentMethodId' loop
    select * into v_method from app.payment_methods where tenant_id = v_pos.tenant_id
      and id = (v_payment->>'paymentMethodId')::uuid and is_active for share;
    if not found then raise exception using errcode = 'HCS96', message = 'An active payment method is required'; end if;
    v_amount := (v_payment->>'amountCentavos')::bigint::numeric / 100;
    v_tendered := (v_payment->>'tenderedCentavos')::bigint::numeric / 100;
    if (v_method.method_type = 'cash' and v_tendered < v_amount)
      or (v_method.method_type <> 'cash' and v_tendered <> v_amount) then
      raise exception using errcode = 'HCS99', message = 'Tender amount is invalid';
    end if;
    v_change := v_tendered - v_amount;
    insert into app.sale_payments (tenant_id, sale_id, payment_method_id, amount, tendered_amount, change_amount)
    values (v_pos.tenant_id, v_sale_id, v_method.id, v_amount, v_tendered, v_change);
    if v_method.method_type = 'cash' then
      insert into app.cash_movements (tenant_id, register_session_id, location_id, movement_type, amount, source_type, source_id, actor_employee_id)
      values (v_pos.tenant_id, v_register_session.id, v_pos.location_id, 'cash_sale', v_amount, 'sale', v_sale_id, v_pos.employee_id);
      v_cash_received_centavos := v_cash_received_centavos + round(v_tendered * 100)::bigint;
      v_change_centavos := v_change_centavos + round(v_change * 100)::bigint;
    end if;
    v_payment_response := v_payment_response || jsonb_build_array(jsonb_build_object(
      'paymentMethodId', v_method.id, 'methodName', v_method.name, 'methodType', v_method.method_type,
      'amountCentavos', round(v_amount * 100)::bigint, 'tenderedCentavos', round(v_tendered * 100)::bigint,
      'changeCentavos', round(v_change * 100)::bigint) || case when v_method.method_type in ('e_wallet','bank_transfer')
      then jsonb_build_object('referenceLastFour',v_payment->>'referenceLastFour') else '{}'::jsonb end);
  end loop;

  update app.sales set subtotal=v_subtotal,discount_total=v_discount_minor/100,total=v_payable,
    pricing_type=case when p_pricing_type='auto' then case when v_any_wholesale then 'wholesale' else 'retail' end else p_pricing_type end,
    price_list_id=case when p_pricing_type='auto' and not v_any_wholesale then null else v_price_list.id end
    where tenant_id=v_pos.tenant_id and id=v_sale_id;
  if p_customer_id is not null then
    insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
    values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'sale.customer_linked', 'sale', v_sale_id,
      v_pos.location_id, jsonb_build_object('customerId', p_customer_id));
    insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (v_pos.tenant_id, 'sale.customer_linked', 'sale', v_sale_id,
      jsonb_build_object('saleId', v_sale_id, 'customerId', p_customer_id));
    select * into v_policy from app.loyalty_policies where tenant_id = v_pos.tenant_id;
    if v_policy.enabled then
      v_points := floor(round(v_payable * 100)::bigint / round(v_policy.spend_per_point * 100)::bigint)::bigint;
      if v_points > 0 then
        v_loyalty_transaction_id := gen_random_uuid();
        insert into app.loyalty_transactions (id, tenant_id, customer_id, transaction_type, points_delta,
          balance_after_points, spend_per_point_centavos, sale_id, actor_employee_id, occurred_at)
        values (v_loyalty_transaction_id, v_pos.tenant_id, p_customer_id, 'sale_earn', v_points, 0,
          round(v_policy.spend_per_point * 100)::bigint, v_sale_id, v_pos.employee_id, now());
        insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
        values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'loyalty.points_earned',
          'loyalty_transaction', v_loyalty_transaction_id, v_pos.location_id,
          jsonb_build_object('saleId', v_sale_id, 'customerId', p_customer_id, 'points', v_points));
        insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
        values (v_pos.tenant_id, 'loyalty.points_earned', 'customer', p_customer_id,
          jsonb_build_object('transactionId', v_loyalty_transaction_id, 'saleId', v_sale_id,
            'customerId', p_customer_id, 'points', v_points));
      end if;
    end if;
    select coalesce(balance_points,0) into v_loyalty_balance from app.loyalty_accounts
      where tenant_id = v_pos.tenant_id and customer_id = p_customer_id;
  end if;
  v_response := jsonb_build_object(
    'saleId', v_sale_id, 'receiptNumber', v_receipt, 'status', 'completed',
    'subtotalCentavos', round(v_subtotal * 100)::bigint, 'totalCentavos', round(v_payable * 100)::bigint,
    'discountCentavos',v_discount_minor,'discountSnapshot',v_definition,
    'discountLines',(select jsonb_agg(jsonb_build_object('saleLineId',d.sale_line_id,'variantId',sl.variant_id,'quantityMilli',round(sl.quantity*1000)::bigint,
      'grossMinor',d.gross_minor,'discountMinor',d.discount_minor,'netMinor',d.net_minor) order by d.sale_line_id)
      from app.pos_sale_line_discounts d join app.sale_lines sl on sl.tenant_id=d.tenant_id and sl.id=d.sale_line_id where d.tenant_id=v_pos.tenant_id and d.sale_id=v_sale_id),
    'cashReceivedCentavos', v_cash_received_centavos, 'changeCentavos', v_change_centavos,
    'payments', v_payment_response, 'completedAt', now(), 'customerId', p_customer_id,
    'customerName', v_customer.full_name, 'loyaltyEarnedPoints', v_points,
    'loyaltyBalancePoints', case when p_customer_id is null then null else v_loyalty_balance end,
    'pricingType',case when p_pricing_type='auto' then case when v_any_wholesale then 'wholesale' else 'retail' end else p_pricing_type end,
    'priceListId',case when p_pricing_type='auto' and not v_any_wholesale then null else v_price_list.id end,
    'priceListName',case when p_pricing_type='auto' and not v_any_wholesale then null else v_price_list.name end);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'sale.completed', 'sale', v_sale_id, v_pos.location_id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (v_pos.tenant_id, 'sale.completed', 'sale', v_sale_id, v_response);
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now()
  where tenant_id = v_pos.tenant_id and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  perform app.lock_pos_discount_scope(p_session_token_hash,true);
  return v_response;
end;
$$;
revoke all on function app.complete_pos_discounted_sale_core(text,jsonb,jsonb,uuid,text,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;


create function app.complete_pos_discounted_sale(p_hash text,p_lines jsonb,p_payments jsonb,p_customer uuid,p_pricing text,p_discount jsonb,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pos app.pos_employee_sessions%rowtype;v_hash text;v_replay boolean;v_result jsonb;v_payment jsonb;v_method app.payment_methods%rowtype;
begin
 v_pos:=app.lock_pos_discount_scope(p_hash,true);
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='HCS94',message='Invalid sale request key'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('tenant',v_pos.tenant_id,'employee',v_pos.employee_id,'device',v_pos.device_id,
  'register',v_pos.register_id,'location',v_pos.location_id,'lines',p_lines,'payments',p_payments,'customer',p_customer,'pricing',p_pricing,'discount',p_discount)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text||':pos-sale.complete:'||p_key,0));
 perform app.lock_pos_discount_scope(p_hash,true);
 select exists(select 1 from app.idempotency_records where tenant_id=v_pos.tenant_id and operation='pos-sale.complete' and idempotency_key=p_key and completed_at is not null) into v_replay;
 if not v_replay then
  if jsonb_typeof(p_payments) is distinct from 'array' then raise exception using errcode='HCS94',message='Sale payments are invalid'; end if;
  for v_payment in select value from jsonb_array_elements(p_payments) order by value->>'paymentMethodId' loop
   select * into v_method from app.payment_methods where tenant_id=v_pos.tenant_id and id::text=v_payment->>'paymentMethodId' and is_active for share;
   if v_method.method_type in ('e_wallet','bank_transfer') and (jsonb_typeof(v_payment->'referenceLastFour') is distinct from 'string' or coalesce(v_payment->>'referenceLastFour','') !~ '^[0-9]{4}$')
   then raise exception using errcode='HCDP4',message='Enter exactly four transaction reference digits for online payments'; end if;
  end loop;
 end if;
 v_result:=app.complete_pos_discounted_sale_core(p_hash,p_lines,p_payments,p_customer,p_pricing,p_discount,p_key,v_hash,p_request_id);
 if not v_replay then
  insert into app.pos_payment_references(tenant_id,sale_payment_id,reference_last_four,method_name_snapshot,method_type_snapshot,recorded_at)
  select p.tenant_id,p.id,entry.value->>'referenceLastFour',method.name,method.method_type,(v_result->>'completedAt')::timestamptz
  from app.sale_payments p join app.payment_methods method on method.tenant_id=p.tenant_id and method.id=p.payment_method_id
  join jsonb_array_elements(p_payments) entry on entry.value->>'paymentMethodId'=p.payment_method_id::text
  where p.tenant_id=v_pos.tenant_id and p.sale_id=(v_result->>'saleId')::uuid and method.method_type in ('e_wallet','bank_transfer');
 end if;
 perform app.lock_pos_discount_scope(p_hash,true);
 return v_result;
end; $$;
revoke all on function app.complete_pos_discounted_sale(text,jsonb,jsonb,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function app.complete_pos_discounted_sale(text,jsonb,jsonb,uuid,text,jsonb,text,text) to hcs_hyperdrive;
commit;
