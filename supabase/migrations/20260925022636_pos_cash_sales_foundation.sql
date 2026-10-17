begin;

insert into app.permissions (code, description) values
  ('sales.read', 'View completed sales and receipts'),
  ('sales.create', 'Complete sales from an active register session')
on conflict (code) do update set description = excluded.description;

create table app.receipt_counters (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  location_id uuid not null,
  business_date date not null,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, business_date),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict
);

create table app.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  location_id uuid not null,
  register_id uuid not null,
  register_session_id uuid not null,
  employee_id uuid not null,
  receipt_number text not null,
  status text not null default 'completed' check (status in ('completed', 'voided', 'partially_refunded', 'refunded')),
  subtotal numeric(18,2) not null check (subtotal >= 0),
  discount_total numeric(18,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(18,2) not null default 0 check (tax_total >= 0),
  total numeric(18,2) not null check (total >= 0),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, receipt_number),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, register_id) references app.registers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, register_session_id) references app.register_sessions (tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references app.employees (tenant_id, id) on delete restrict,
  constraint sales_receipt_not_blank check (btrim(receipt_number) <> ''),
  constraint sales_total_equation check (total = subtotal - discount_total + tax_total)
);

create table app.sale_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sale_id uuid not null,
  variant_id uuid not null,
  product_name text not null,
  variant_name text not null,
  sku text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  unit_cost numeric(18,2),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sale_id, variant_id),
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  constraint sale_lines_product_not_blank check (btrim(product_name) <> ''),
  constraint sale_lines_variant_not_blank check (btrim(variant_name) <> ''),
  constraint sale_lines_sku_not_blank check (btrim(sku) <> ''),
  constraint sale_lines_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0)
);

create table app.sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sale_id uuid not null,
  payment_method_id uuid not null,
  amount numeric(18,2) not null check (amount > 0),
  tendered_amount numeric(18,2) not null check (tendered_amount >= amount),
  change_amount numeric(18,2) not null check (change_amount = tendered_amount - amount),
  status text not null default 'completed' check (status in ('completed', 'voided', 'refunded')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id) on delete restrict,
  foreign key (tenant_id, payment_method_id) references app.payment_methods (tenant_id, id) on delete restrict
);

create index sales_tenant_completed_idx on app.sales (tenant_id, completed_at desc, id);
create index sales_location_completed_idx on app.sales (tenant_id, location_id, completed_at desc, id);
create index sales_register_session_idx on app.sales (tenant_id, register_session_id, completed_at desc);
create index sale_lines_sale_idx on app.sale_lines (tenant_id, sale_id, id);
create index sale_lines_variant_idx on app.sale_lines (tenant_id, variant_id, created_at desc);
create index sale_payments_sale_idx on app.sale_payments (tenant_id, sale_id, id);
create index sale_payments_method_idx on app.sale_payments (tenant_id, payment_method_id, created_at desc);

create trigger sales_set_updated_at before update on app.sales
for each row execute function app.set_updated_at();

alter table app.receipt_counters enable row level security;
alter table app.sales enable row level security;
alter table app.sale_lines enable row level security;
alter table app.sale_payments enable row level security;
revoke all on table app.receipt_counters, app.sales, app.sale_lines, app.sale_payments
  from public, anon, authenticated, hcs_hyperdrive;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r
join app.permissions p on p.code = any(case lower(r.code::text)
  when 'owner' then array['sales.read', 'sales.create']
  when 'admin' then array['sales.read', 'sales.create']
  when 'manager' then array['sales.read', 'sales.create']
  when 'cashier' then array['sales.create']
  else array[]::text[] end)
where lower(r.code::text) in ('owner', 'admin', 'manager', 'cashier')
on conflict do nothing;

create function app.initialize_role_sales_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.role_permissions (tenant_id, role_id, permission_code)
  select new.tenant_id, new.id, p.code
  from app.permissions p
  where p.code = any(case lower(new.code::text)
    when 'owner' then array['sales.read', 'sales.create']
    when 'admin' then array['sales.read', 'sales.create']
    when 'manager' then array['sales.read', 'sales.create']
    when 'cashier' then array['sales.create']
    else array[]::text[] end)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_role_sales_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_sales_permissions after insert on app.roles
for each row execute function app.initialize_role_sales_permissions();

create function app.load_pos_sales_context(p_session_token_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session app.pos_employee_sessions%rowtype;
begin
  select s.* into v_session
  from app.pos_employee_sessions s
  join app.pos_devices d on d.tenant_id = s.tenant_id and d.id = s.device_id
  join app.employees e on e.tenant_id = s.tenant_id and e.id = s.employee_id
  join app.registers r on r.tenant_id = s.tenant_id and r.id = s.register_id
  join app.locations l on l.tenant_id = s.tenant_id and l.id = s.location_id
  where s.token_hash = p_session_token_hash and s.revoked_at is null and s.expires_at > now()
    and d.status = 'active' and e.status = 'active' and r.status = 'active' and l.is_active;
  if v_session.id is null then
    raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired';
  end if;

  update app.pos_employee_sessions set last_seen_at = now() where id = v_session.id;
  update app.pos_devices set last_seen_at = now() where id = v_session.device_id;

  return jsonb_build_object(
    'employee', (select jsonb_build_object('id', e.id, 'employeeCode', e.employee_code::text, 'displayName', e.display_name) from app.employees e where e.tenant_id = v_session.tenant_id and e.id = v_session.employee_id),
    'device', (select jsonb_build_object('id', d.id, 'name', d.name, 'tenantId', d.tenant_id, 'tenantName', t.name, 'locationId', d.location_id, 'locationName', l.name, 'registerId', d.register_id, 'registerName', r.name)
      from app.pos_devices d join app.tenants t on t.id = d.tenant_id join app.locations l on l.tenant_id = d.tenant_id and l.id = d.location_id join app.registers r on r.tenant_id = d.tenant_id and r.id = d.register_id where d.id = v_session.device_id),
    'registerSession', (select jsonb_build_object('id', rs.id, 'openedAt', rs.opened_at, 'openingCashCentavos', round(rs.opening_cash * 100)::bigint)
      from app.register_sessions rs where rs.tenant_id = v_session.tenant_id and rs.register_id = v_session.register_id and rs.status = 'open'),
    'categories', coalesce((select jsonb_agg(distinct c.name order by c.name) from app.product_categories c join app.products p on p.tenant_id = c.tenant_id and p.category_id = c.id join app.product_variants v on v.tenant_id = p.tenant_id and v.product_id = p.id where c.tenant_id = v_session.tenant_id and c.status = 'active' and p.status = 'active' and v.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'variantId', v.id, 'productName', p.name, 'variantName', v.name, 'sku', v.sku::text,
      'barcode', (select b.barcode::text from app.product_barcodes b where b.tenant_id = v.tenant_id and b.variant_id = v.id order by b.is_primary desc, b.created_at limit 1),
      'category', c.name, 'retailPriceCentavos', round(v.retail_price * 100)::bigint,
      'availableMilli', case when v.track_inventory then greatest(round((coalesce(ib.on_hand, 0) - coalesce(ib.reserved, 0) - coalesce(ib.damaged, 0)) * 1000)::bigint, 0) else null end,
      'trackInventory', v.track_inventory
    ) order by lower(p.name), lower(v.name), v.id)
      from app.product_variants v join app.products p on p.tenant_id = v.tenant_id and p.id = v.product_id left join app.product_categories c on c.tenant_id = p.tenant_id and c.id = p.category_id left join app.inventory_balances ib on ib.tenant_id = v.tenant_id and ib.location_id = v_session.location_id and ib.variant_id = v.id
      where v.tenant_id = v_session.tenant_id and v.is_active and p.status = 'active'), '[]'::jsonb),
    'paymentMethods', coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'code', pm.code::text, 'name', pm.name, 'type', pm.method_type) order by pm.name) from app.payment_methods pm where pm.tenant_id = v_session.tenant_id and pm.is_active), '[]'::jsonb)
  );
end;
$$;

create function app.open_pos_register_session(p_session_token_hash text, p_opening_cash_centavos bigint, p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_existing app.idempotency_records%rowtype;
  v_open app.register_sessions%rowtype;
  v_id uuid;
  v_response jsonb;
begin
  if p_opening_cash_centavos < 0 then raise exception using errcode = 'HCS91', message = 'Opening cash cannot be negative'; end if;
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
  if not exists (select 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code='registers.operate') then raise exception using errcode = 'HCS93', message = 'Employee cannot operate registers'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text || ':pos-register.open:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id=v_pos.tenant_id and operation='pos-register.open' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(v_pos.tenant_id,'pos-register.open',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;
  select * into v_open from app.register_sessions where tenant_id=v_pos.tenant_id and register_id=v_pos.register_id and status='open' for update;
  if v_open.id is not null then
    if v_open.employee_id<>v_pos.employee_id then raise exception using errcode='HCS92',message='Register is already open by another employee'; end if;
    v_response:=jsonb_build_object('registerSessionId',v_open.id,'status','open','openedAt',v_open.opened_at,'openingCashCentavos',round(v_open.opening_cash*100)::bigint);
  else
    insert into app.register_sessions(tenant_id,register_id,location_id,employee_id,opening_cash) values(v_pos.tenant_id,v_pos.register_id,v_pos.location_id,v_pos.employee_id,p_opening_cash_centavos::numeric/100) returning id into v_id;
    insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,actor_employee_id) values(v_pos.tenant_id,v_id,v_pos.location_id,'opening_cash',p_opening_cash_centavos::numeric/100,'register_session',v_id,v_pos.employee_id);
    v_response:=jsonb_build_object('registerSessionId',v_id,'status','open','openedAt',now(),'openingCashCentavos',p_opening_cash_centavos);
    insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'register.opened','register_session',v_id,v_pos.location_id,jsonb_build_object('openingCashCentavos',p_opening_cash_centavos));
    insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'register.opened','register_session',v_id,v_response);
  end if;
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=v_pos.tenant_id and operation='pos-register.open' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function app.complete_pos_cash_sale(p_session_token_hash text, p_lines jsonb, p_cash_received_centavos bigint, p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_register_session app.register_sessions%rowtype;
  v_existing app.idempotency_records%rowtype;
  v_line jsonb;
  v_variant record;
  v_balance app.inventory_balances%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_business_date date;
  v_receipt_seq bigint;
  v_receipt text;
  v_subtotal numeric(18,2) := 0;
  v_quantity numeric(18,3);
  v_line_total numeric(18,2);
  v_cash numeric(18,2);
  v_cash_method_id uuid;
  v_response jsonb;
begin
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>200 then raise exception using errcode='HCS94',message='Sale lines are invalid'; end if;
  if p_cash_received_centavos<0 then raise exception using errcode='HCS94',message='Cash received is invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) x where (x->>'variantId') is null or (x->>'quantityMilli') is null or (x->>'quantityMilli') !~ '^[1-9][0-9]*$') then raise exception using errcode='HCS94',message='Sale lines are invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'variantId' having count(*)>1) then raise exception using errcode='HCS94',message='Duplicate sale variants are not allowed'; end if;
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  if not exists(select 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code='sales.create') then raise exception using errcode='HCS93',message='Employee cannot complete sales'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text || ':pos-sale.complete:' || p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=v_pos.tenant_id and operation='pos-sale.complete' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(v_pos.tenant_id,'pos-sale.complete',p_idempotency_key,p_request_hash,now()+interval '24 hours'); end if;
  select * into v_register_session from app.register_sessions where tenant_id=v_pos.tenant_id and register_id=v_pos.register_id and employee_id=v_pos.employee_id and status='open' for update;
  if v_register_session.id is null then raise exception using errcode='HCS95',message='Open register session is required'; end if;
  select id into v_cash_method_id from app.payment_methods where tenant_id=v_pos.tenant_id and method_type='cash' and is_active order by is_system_default desc,created_at limit 1;
  if v_cash_method_id is null then raise exception using errcode='HCS96',message='Active cash payment method is required'; end if;

  select (now() at time zone coalesce(l.timezone,t.timezone,'Asia/Manila'))::date into v_business_date from app.locations l join app.tenants t on t.id=l.tenant_id where l.tenant_id=v_pos.tenant_id and l.id=v_pos.location_id;
  insert into app.receipt_counters(tenant_id,location_id,business_date,last_number) values(v_pos.tenant_id,v_pos.location_id,v_business_date,1) on conflict(tenant_id,location_id,business_date) do update set last_number=app.receipt_counters.last_number+1,updated_at=now() returning last_number into v_receipt_seq;
  select upper(l.code::text)||'-'||to_char(v_business_date,'YYYYMMDD')||'-'||lpad(v_receipt_seq::text,6,'0') into v_receipt from app.locations l where l.tenant_id=v_pos.tenant_id and l.id=v_pos.location_id;
  insert into app.sales(id,tenant_id,location_id,register_id,register_session_id,employee_id,receipt_number,subtotal,total) values(v_sale_id,v_pos.tenant_id,v_pos.location_id,v_pos.register_id,v_register_session.id,v_pos.employee_id,v_receipt,0,0);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity:=((v_line->>'quantityMilli')::bigint)::numeric/1000;
    select v.id,v.product_id,v.name variant_name,v.sku::text sku,v.retail_price,v.unit_cost,v.track_inventory,p.name product_name into v_variant
    from app.product_variants v join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    where v.tenant_id=v_pos.tenant_id and v.id=(v_line->>'variantId')::uuid and v.is_active and p.status='active' for update of v;
    if v_variant.id is null then raise exception using errcode='HCS97',message='Product variant is unavailable'; end if;
    if v_variant.track_inventory then
      select * into v_balance from app.inventory_balances where tenant_id=v_pos.tenant_id and location_id=v_pos.location_id and variant_id=v_variant.id for update;
      if v_balance.variant_id is null or (v_balance.on_hand-v_balance.reserved-v_balance.damaged)<v_quantity then raise exception using errcode='HCS98',message='Insufficient available stock'; end if;
    end if;
    v_line_total:=round(v_variant.retail_price*v_quantity,2);
    v_subtotal:=v_subtotal+v_line_total;
    insert into app.sale_lines(id,tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total) values(gen_random_uuid(),v_pos.tenant_id,v_sale_id,v_variant.id,v_variant.product_name,v_variant.variant_name,v_variant.sku,v_quantity,v_variant.retail_price,v_variant.unit_cost,v_line_total);
    if v_variant.track_inventory then
      update app.inventory_balances set on_hand=on_hand-v_quantity,version=version+1,updated_at=now() where tenant_id=v_pos.tenant_id and location_id=v_pos.location_id and variant_id=v_variant.id;
      insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,occurred_at) values(v_pos.tenant_id,v_pos.location_id,v_variant.id,'SALE',-v_quantity,coalesce(v_balance.average_unit_cost,v_variant.unit_cost),'sale',v_sale_id::text,now());
    end if;
  end loop;

  v_cash:=p_cash_received_centavos::numeric/100;
  if v_cash<v_subtotal then raise exception using errcode='HCS99',message='Cash received is less than sale total'; end if;
  update app.sales set subtotal=v_subtotal,total=v_subtotal where tenant_id=v_pos.tenant_id and id=v_sale_id;
  insert into app.sale_payments(tenant_id,sale_id,payment_method_id,amount,tendered_amount,change_amount) values(v_pos.tenant_id,v_sale_id,v_cash_method_id,v_subtotal,v_cash,v_cash-v_subtotal);
  insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,actor_employee_id) values(v_pos.tenant_id,v_register_session.id,v_pos.location_id,'cash_sale',v_subtotal,'sale',v_sale_id,v_pos.employee_id);
  v_response:=jsonb_build_object('saleId',v_sale_id,'receiptNumber',v_receipt,'status','completed','subtotalCentavos',round(v_subtotal*100)::bigint,'totalCentavos',round(v_subtotal*100)::bigint,'cashReceivedCentavos',p_cash_received_centavos,'changeCentavos',round((v_cash-v_subtotal)*100)::bigint,'completedAt',now());
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'sale.completed','sale',v_sale_id,v_pos.location_id,v_response);
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'sale.completed','sale',v_sale_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=v_pos.tenant_id and operation='pos-sale.complete' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function app.list_sales(p_actor_user_id uuid,p_tenant_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='sales.read'))) then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
  return jsonb_build_object('sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'receiptNumber',s.receipt_number,'status',s.status,'locationName',l.name,'registerName',r.name,'employeeName',e.display_name,'itemCount',(select coalesce(sum(sl.quantity),0) from app.sale_lines sl where sl.tenant_id=s.tenant_id and sl.sale_id=s.id),'totalCentavos',round(s.total*100)::bigint,'completedAt',s.completed_at) order by s.completed_at desc,s.id) from (select * from app.sales where tenant_id=p_tenant_id order by completed_at desc,id limit least(greatest(p_limit,1),200)) s join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id join app.employees e on e.tenant_id=s.tenant_id and e.id=s.employee_id),'[]'::jsonb));
end;
$$;

revoke all on function app.load_pos_sales_context(text), app.open_pos_register_session(text,bigint,text,text,text), app.complete_pos_cash_sale(text,jsonb,bigint,text,text,text), app.list_sales(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function app.load_pos_sales_context(text), app.open_pos_register_session(text,bigint,text,text,text), app.complete_pos_cash_sale(text,jsonb,bigint,text,text,text), app.list_sales(uuid,uuid,integer) to hcs_hyperdrive;

commit;
