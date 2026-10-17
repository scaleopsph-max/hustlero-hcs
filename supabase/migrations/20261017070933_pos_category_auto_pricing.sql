begin;

alter table app.pricing_groups add column category_id uuid;
alter table app.pricing_groups add constraint pricing_groups_category_fkey
  foreign key (tenant_id,category_id) references app.product_categories(tenant_id,id) on delete restrict;
create index pricing_groups_category_idx on app.pricing_groups(tenant_id,category_id) where category_id is not null;
-- NULL means historical/unclassified; do not relabel old receipt lines.
alter table app.sale_lines add column pricing_type text check (pricing_type in ('retail','wholesale','dealer'));
alter table app.sale_lines add column pricing_basis text check (pricing_basis in ('manual','category'));
alter table app.sale_lines add column pricing_category_id uuid;
alter table app.sale_lines add column pricing_group_id uuid;
alter table app.sale_lines add column pricing_quantity numeric(18,3) check (pricing_quantity >= 0);
alter table app.sale_lines add column pricing_threshold_quantity numeric(18,3) check (pricing_threshold_quantity > 0);
alter table app.sale_lines add column pricing_price_list_id uuid;
alter table app.sale_lines add constraint sale_lines_pricing_price_list_fkey
  foreign key (tenant_id,pricing_price_list_id) references app.price_lists(tenant_id,id) on delete restrict;
alter table app.sale_lines add constraint sale_lines_pricing_category_fkey
  foreign key (tenant_id,pricing_category_id) references app.product_categories(tenant_id,id) on delete restrict;
alter table app.sale_lines add constraint sale_lines_pricing_group_fkey
  foreign key (tenant_id,pricing_group_id) references app.pricing_groups(tenant_id,id) on delete restrict;

alter function app.upsert_price_list(uuid,uuid,jsonb,text,text,text) rename to upsert_price_list_category_core;
revoke all on function app.upsert_price_list_category_core(uuid,uuid,jsonb,text,text,text)
  from public,anon,authenticated,hcs_hyperdrive;
create function app.upsert_price_list(p_actor_user_id uuid,p_tenant_id uuid,p_payload jsonb,
  p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_replay boolean; v_category uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':price-list.upsert:'||p_idempotency_key,0));
  select exists(select 1 from app.idempotency_records where tenant_id=p_tenant_id
    and operation='price-list.upsert' and idempotency_key=p_idempotency_key and completed_at is not null) into v_replay;
  v_result:=app.upsert_price_list_category_core(p_actor_user_id,p_tenant_id,p_payload,p_idempotency_key,p_request_hash,p_request_id);
  if not v_replay and (p_payload->'pricingGroup') ? 'categoryId' then
    begin v_category:=(p_payload->'pricingGroup'->>'categoryId')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='HCSP1',message='Choose a valid pricing category';
    end;
    if v_category is not null and not exists(select 1 from app.product_categories where tenant_id=p_tenant_id and id=v_category) then
      raise exception using errcode='HCSP1',message='Choose a valid pricing category';
    end if;
    update app.pricing_groups set category_id=v_category where tenant_id=p_tenant_id and id=(v_result->>'pricingGroupId')::uuid;
  end if;
  return v_result;
end;
$$;
revoke all on function app.upsert_price_list(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.upsert_price_list(uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;

alter function app.load_pricing_context(uuid,uuid) rename to pricing_context_category_core;
revoke all on function app.pricing_context_category_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.load_pricing_context(p_actor_user_id uuid,p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=app.pricing_context_category_core(p_actor_user_id,p_tenant_id);
  return v_result || jsonb_build_object(
    'variants',coalesce((select jsonb_agg(item.value || jsonb_build_object('categoryId',product.category_id,'categoryName',category.name) order by item.ordinality)
      from jsonb_array_elements(v_result->'variants') with ordinality item(value,ordinality)
      join app.product_variants variant on variant.tenant_id=p_tenant_id and variant.id=(item.value->>'id')::uuid
      join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id
      left join app.product_categories category on category.tenant_id=product.tenant_id and category.id=product.category_id),'[]'::jsonb),
    'priceLists',coalesce((select jsonb_agg(jsonb_set(item.value,'{pricingGroup,categoryId}',coalesce(to_jsonb(g.category_id),'null'::jsonb)) order by item.ordinality)
      from jsonb_array_elements(v_result->'priceLists') with ordinality item(value,ordinality)
      join app.pricing_groups g on g.tenant_id=p_tenant_id and g.id=(item.value->'pricingGroup'->>'id')::uuid),'[]'::jsonb));
end;
$$;
revoke all on function app.load_pricing_context(uuid,uuid) from public,anon,authenticated;
grant execute on function app.load_pricing_context(uuid,uuid) to hcs_hyperdrive;

alter function app.load_pos_sales_context(text) rename to pos_sales_context_category_core;
revoke all on function app.pos_sales_context_category_core(text) from public,anon,authenticated,hcs_hyperdrive;
create function app.load_pos_sales_context(p_session_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_tenant uuid;
begin
  v_result:=app.pos_sales_context_category_core(p_session_token_hash);
  v_tenant:=(v_result->'device'->>'tenantId')::uuid;
  return v_result || jsonb_build_object('items',coalesce((
    select jsonb_agg(item.value || jsonb_build_object('categoryId',product.category_id) order by item.ordinality)
    from jsonb_array_elements(v_result->'items') with ordinality item(value,ordinality)
    join app.product_variants variant on variant.tenant_id=v_tenant and variant.id=(item.value->>'variantId')::uuid
    join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id
  ),'[]'::jsonb));
end;
$$;
revoke all on function app.load_pos_sales_context(text) from public,anon,authenticated;
grant execute on function app.load_pos_sales_context(text) to hcs_hyperdrive;

create or replace function app.load_pos_pricing_options(p_session_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tenant_id uuid;
begin
  select session.tenant_id into v_tenant_id from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id=session.tenant_id and device.id=session.device_id and device.status='active'
  where session.token_hash=p_session_token_hash and session.revoked_at is null and session.expires_at>now();
  if v_tenant_id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'variantId',e.variant_id,'priceListId',l.id,'priceListName',l.name,'priceListUpdatedAt',l.updated_at,
    'pricingType',l.pricing_type,'pricingGroupId',g.id,'pricingGroupName',g.name,'categoryId',g.category_id,
    'thresholdMilli',round(g.threshold_quantity*1000)::bigint,'unitPriceCentavos',round(e.unit_price*100)::bigint,
    'isDefault',l.is_default,'customerIds',coalesce((select jsonb_agg(a.customer_id) from app.customer_price_list_assignments a
      where a.tenant_id=l.tenant_id and a.price_list_id=l.id),'[]'::jsonb)
  ) order by l.updated_at desc,l.id,e.variant_id)
  from app.price_list_entries e join app.price_lists l on l.tenant_id=e.tenant_id and l.id=e.price_list_id
  join app.pricing_groups g on g.tenant_id=e.tenant_id and g.id=e.pricing_group_id
  where e.tenant_id=v_tenant_id and l.is_active and g.is_active),'[]'::jsonb);
end;
$$;

create or replace function app.load_sale_receipt(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform app.require_sale_location_access(p_actor_user_id,p_tenant_id,p_sale_id,'sales.read');
  v_result:=app.sale_receipt_scope_core(p_actor_user_id,p_tenant_id,p_sale_id);
  return jsonb_set(v_result,'{lines}',coalesce((select jsonb_agg(item.value || jsonb_build_object(
    'pricingType',line.pricing_type,'pricingBasis',line.pricing_basis,'pricingCategoryId',line.pricing_category_id,
    'pricingGroupId',line.pricing_group_id,'pricingQuantityMilli',round(line.pricing_quantity*1000)::bigint,
    'pricingThresholdMilli',round(line.pricing_threshold_quantity*1000)::bigint,'pricingPriceListId',line.pricing_price_list_id) order by item.ordinality)
    from jsonb_array_elements(v_result->'lines') with ordinality item(value,ordinality)
    join app.sale_lines line on line.tenant_id=p_tenant_id and line.sale_id=p_sale_id and line.id=(item.value->>'id')::uuid),'[]'::jsonb));
end;
$$;

-- The server-authoritative command below retains the reference wrapper and its idempotency lock.
create or replace function app.complete_pos_priced_sale_reference_core(
  p_session_token_hash text,
  p_lines jsonb,
  p_payments jsonb,
  p_customer_id uuid,
  p_pricing_type text,
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
begin
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

  select session.* into v_pos from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id = session.tenant_id and device.id = session.device_id and device.status = 'active'
  where session.token_hash = p_session_token_hash and session.revoked_at is null and session.expires_at > now();
  if v_pos.id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
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
  select * into v_existing from app.idempotency_records where tenant_id = v_pos.tenant_id
    and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at)
    values (v_pos.tenant_id, 'pos-sale.complete', p_idempotency_key, p_request_hash, now() + interval '24 hours');
  end if;

  if p_customer_id is not null then
    select * into v_customer from app.customers where tenant_id = v_pos.tenant_id and id = p_customer_id and status = 'active';
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

  select sum((payment->>'amountCentavos')::bigint)::numeric / 100 into v_payment_total from jsonb_array_elements(p_payments) payment;
  if v_payment_total <> v_subtotal then raise exception using errcode = 'HCS99', message = 'Payment allocation must equal the sale total'; end if;
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
      'changeCentavos', round(v_change * 100)::bigint));
  end loop;

  update app.sales set subtotal=v_subtotal,total=v_subtotal,
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
      v_points := floor(round(v_subtotal * 100)::bigint / round(v_policy.spend_per_point * 100)::bigint)::bigint;
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
    'subtotalCentavos', round(v_subtotal * 100)::bigint, 'totalCentavos', round(v_subtotal * 100)::bigint,
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
  return v_response;
end;
$$;

revoke all on function app.complete_pos_priced_sale_reference_core(text,jsonb,jsonb,uuid,text,text,text,text)
  from public,anon,authenticated,hcs_hyperdrive;

commit;
