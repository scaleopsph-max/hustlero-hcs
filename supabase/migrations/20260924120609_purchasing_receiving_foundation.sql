begin;

insert into app.permissions (code, description) values
  ('purchasing.read', 'View suppliers and purchase orders'),
  ('purchasing.manage', 'Create purchase orders and record receipts')
on conflict (code) do update set description = excluded.description;

create table app.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint suppliers_name_not_blank check (btrim(name) <> '')
);
create unique index suppliers_tenant_name_unique_idx on app.suppliers (tenant_id, lower(btrim(name))) where status = 'active';
create table app.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  supplier_id uuid not null,
  location_id uuid not null,
  order_number text not null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  ordered_at timestamptz,
  expected_at timestamptz,
  notes text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_number),
  foreign key (tenant_id, supplier_id) references app.suppliers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  constraint purchase_orders_number_not_blank check (btrim(order_number) <> '')
);
create index purchase_orders_tenant_status_created_idx on app.purchase_orders (tenant_id, status, created_at desc);
create table app.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  purchase_order_id uuid not null,
  variant_id uuid not null,
  ordered_quantity numeric(18, 3) not null check (ordered_quantity > 0),
  received_quantity numeric(18, 3) not null default 0 check (received_quantity >= 0 and received_quantity <= ordered_quantity),
  unit_cost numeric(18, 2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, purchase_order_id, variant_id),
  foreign key (tenant_id, purchase_order_id) references app.purchase_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict
);
create table app.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  purchase_order_id uuid not null,
  location_id uuid not null,
  delivery_reference text,
  received_by uuid not null references auth.users (id) on delete restrict,
  received_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references app.purchase_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict
);
create table app.purchase_receipt_lines (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  receipt_id uuid not null,
  purchase_order_line_id uuid not null,
  quantity numeric(18, 3) not null check (quantity > 0),
  unit_cost numeric(18, 2) not null check (unit_cost >= 0),
  primary key (tenant_id, receipt_id, purchase_order_line_id),
  foreign key (tenant_id, receipt_id) references app.purchase_receipts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, purchase_order_line_id) references app.purchase_order_lines (tenant_id, id) on delete restrict
);

create trigger suppliers_set_updated_at before update on app.suppliers for each row execute function app.set_updated_at();
create trigger purchase_orders_set_updated_at before update on app.purchase_orders for each row execute function app.set_updated_at();
alter table app.suppliers enable row level security;
alter table app.purchase_orders enable row level security;
alter table app.purchase_order_lines enable row level security;
alter table app.purchase_receipts enable row level security;
alter table app.purchase_receipt_lines enable row level security;
revoke all on table app.suppliers, app.purchase_orders, app.purchase_order_lines, app.purchase_receipts, app.purchase_receipt_lines from public, anon, authenticated, hcs_hyperdrive;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, permission.code
from app.roles role cross join app.permissions permission
where lower(role.code::text) = 'owner' and permission.code in ('purchasing.read', 'purchasing.manage')
on conflict do nothing;

create function app.initialize_owner_purchasing_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) = 'owner' then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values (new.tenant_id, new.id, 'purchasing.read'), (new.tenant_id, new.id, 'purchasing.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_owner_purchasing_permissions() from public, anon, authenticated;
create trigger roles_initialize_purchasing_permissions after insert on app.roles for each row execute function app.initialize_owner_purchasing_permissions();

create function app.list_purchasing_context(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_allowed boolean;
begin
  select membership.is_owner or exists (
    select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
    where mr.tenant_id = membership.tenant_id and mr.user_id = membership.user_id and rp.permission_code in ('purchasing.read','purchasing.manage')
  ) into v_allowed
  from app.tenant_memberships membership
  where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active';
  if not found or not v_allowed then raise exception using errcode = 'HCS30', message = 'Purchasing access is not allowed'; end if;
  return pg_catalog.jsonb_build_object(
    'suppliers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'name', s.name, 'contactName', s.contact_name, 'contactPhone', s.contact_phone, 'contactEmail', s.contact_email, 'status', s.status) order by s.name) from app.suppliers s where s.tenant_id = p_tenant_id), '[]'::jsonb),
    'locations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name) order by l.name) from app.locations l where l.tenant_id = p_tenant_id and l.is_active), '[]'::jsonb),
    'variants', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', variant.id, 'productName', product.name, 'variantName', variant.name, 'sku', variant.sku::text, 'defaultUnitCostMinor', case when variant.unit_cost is null then null else round(variant.unit_cost*100)::bigint end) order by product.name, variant.name) from app.product_variants variant join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id where variant.tenant_id=p_tenant_id and variant.is_active and product.status='active'), '[]'::jsonb),
    'orders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', po.id, 'supplierId', po.supplier_id, 'supplierName', s.name, 'locationId', po.location_id, 'locationName', l.name,
      'orderNumber', po.order_number, 'status', po.status, 'orderedAt', po.ordered_at, 'expectedAt', po.expected_at, 'notes', po.notes,
      'lines', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', line.id, 'variantId', line.variant_id, 'productName', product.name, 'variantName', variant.name, 'sku', variant.sku::text, 'orderedQuantityMilli', round(line.ordered_quantity*1000)::bigint, 'receivedQuantityMilli', round(line.received_quantity*1000)::bigint, 'unitCostMinor', round(line.unit_cost*100)::bigint) order by product.name, variant.name), '[]'::jsonb) from app.purchase_order_lines line join app.product_variants variant on variant.tenant_id=line.tenant_id and variant.id=line.variant_id join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id where line.tenant_id=po.tenant_id and line.purchase_order_id=po.id)
    ) order by po.created_at desc) from app.purchase_orders po join app.suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id join app.locations l on l.tenant_id=po.tenant_id and l.id=po.location_id where po.tenant_id=p_tenant_id), '[]'::jsonb)
  );
end;
$$;

create function app.create_supplier(p_actor_user_id uuid, p_tenant_id uuid, p_name text, p_contact_name text, p_contact_phone text, p_contact_email text, p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing app.idempotency_records%rowtype; v_response jsonb;
begin
  if not exists (select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists (select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='purchasing.manage'))) then raise exception using errcode='HCS30', message='Purchasing management is not allowed'; end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(p_name)>160 then raise exception using errcode='HCS31', message='Supplier name is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':supplier:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='supplier.create' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with different supplier'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values(p_tenant_id,'supplier.create',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours'); end if;
  insert into app.suppliers(tenant_id,name,contact_name,contact_phone,contact_email,created_by) values(p_tenant_id,btrim(p_name),nullif(btrim(p_contact_name),''),nullif(btrim(p_contact_phone),''),nullif(btrim(p_contact_email),''),p_actor_user_id) returning id into v_id;
  v_response:=pg_catalog.jsonb_build_object('supplierId',v_id,'status','created');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'supplier.created','supplier',v_id);
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'supplier.created','supplier',v_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='supplier.create' and idempotency_key=p_idempotency_key;
  return v_response;
exception when unique_violation then raise exception using errcode='HCS32', message='An active supplier with this name already exists';
end;
$$;

create function app.create_purchase_order(p_actor_user_id uuid, p_tenant_id uuid, p_supplier_id uuid, p_location_id uuid, p_order_number text, p_expected_at timestamptz, p_notes text, p_lines jsonb, p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_line jsonb; v_existing app.idempotency_records%rowtype; v_response jsonb; v_count integer;
begin
  if not exists (select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists (select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='purchasing.manage'))) then raise exception using errcode='HCS30', message='Purchasing management is not allowed'; end if;
  if p_order_number is null or char_length(btrim(p_order_number))<2 or p_lines is null or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>500 then raise exception using errcode='HCS33', message='Purchase order details are invalid'; end if;
  if not exists(select 1 from app.suppliers where tenant_id=p_tenant_id and id=p_supplier_id and status='active') or not exists(select 1 from app.locations where tenant_id=p_tenant_id and id=p_location_id and is_active) then raise exception using errcode='HCS34', message='Supplier or receiving location was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':purchase-order:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='purchase_order.create' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with different purchase order'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values(p_tenant_id,'purchase_order.create',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours'); end if;
  insert into app.purchase_orders(tenant_id,supplier_id,location_id,order_number,status,expected_at,notes,created_by) values(p_tenant_id,p_supplier_id,p_location_id,btrim(p_order_number),'draft',p_expected_at,nullif(btrim(p_notes),''),p_actor_user_id) returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'variantId') is null or (v_line->>'quantityMilli')::bigint <= 0 or (v_line->>'unitCostMinor')::bigint < 0 then raise exception using errcode='HCS33', message='Purchase order line is invalid'; end if;
    if not exists (
      select 1
      from app.product_variants variant
      join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id
      where variant.tenant_id=p_tenant_id and variant.id=(v_line->>'variantId')::uuid and variant.is_active and product.status='active'
    ) then raise exception using errcode='HCS34', message='Purchase order variant was not found'; end if;
    insert into app.purchase_order_lines(tenant_id,purchase_order_id,variant_id,ordered_quantity,unit_cost) values(p_tenant_id,v_id,(v_line->>'variantId')::uuid,((v_line->>'quantityMilli')::numeric/1000),((v_line->>'unitCostMinor')::numeric/100));
    v_count:=coalesce(v_count,0)+1;
  end loop;
  v_response:=pg_catalog.jsonb_build_object('purchaseOrderId',v_id,'status','draft','lineCount',v_count);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'purchase_order.created','purchase_order',v_id,p_location_id);
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'purchase_order.created','purchase_order',v_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='purchase_order.create' and idempotency_key=p_idempotency_key;
  return v_response;
exception when unique_violation then raise exception using errcode='HCS35', message='Purchase order number or line already exists';
end;
$$;

create function app.send_purchase_order(p_actor_user_id uuid, p_tenant_id uuid, p_purchase_order_id uuid, p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_status text; v_response jsonb;
begin
  if not exists (select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists (select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='purchasing.manage'))) then raise exception using errcode='HCS30', message='Purchasing management is not allowed'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':purchase-order:send:'||p_purchase_order_id::text,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='purchase_order.send' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different order action'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values(p_tenant_id,'purchase_order.send',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours'); end if;
  select status into v_status from app.purchase_orders where tenant_id=p_tenant_id and id=p_purchase_order_id for update;
  if not found then raise exception using errcode='HCS36', message='Purchase order was not found'; end if;
  if v_status<>'draft' then raise exception using errcode='HCS37', message='Only draft purchase orders can be sent'; end if;
  update app.purchase_orders set status='ordered',ordered_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=p_purchase_order_id;
  v_response:=pg_catalog.jsonb_build_object('purchaseOrderId',p_purchase_order_id,'status','ordered');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'purchase_order.sent','purchase_order',p_purchase_order_id);
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'purchase_order.sent','purchase_order',p_purchase_order_id,v_response);
  update app.idempotency_records set response_status=200,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='purchase_order.send' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function app.receive_purchase_order(p_actor_user_id uuid, p_tenant_id uuid, p_purchase_order_id uuid, p_lines jsonb, p_delivery_reference text, p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_order app.purchase_orders%rowtype; v_receipt_id uuid; v_line jsonb; v_po_line app.purchase_order_lines%rowtype; v_balance app.inventory_balances%rowtype; v_qty numeric; v_new_on_hand numeric; v_new_avg numeric; v_total numeric; v_response jsonb; v_received_count integer := 0; v_remaining numeric;
begin
  if not exists (select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists (select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='purchasing.manage'))) then raise exception using errcode='HCS30', message='Purchasing management is not allowed'; end if;
  if p_lines is null or jsonb_array_length(p_lines)<1 then raise exception using errcode='HCS38', message='At least one receipt line is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':purchase-order:receive:'||p_purchase_order_id::text,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='purchase_order.receive' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different receipt'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values(p_tenant_id,'purchase_order.receive',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours'); end if;
  select * into v_order from app.purchase_orders where tenant_id=p_tenant_id and id=p_purchase_order_id for update;
  if not found or v_order.status not in ('ordered','partially_received') then raise exception using errcode='HCS36', message='Purchase order is not available for receiving'; end if;
  insert into app.purchase_receipts(tenant_id,purchase_order_id,location_id,delivery_reference,received_by) values(p_tenant_id,p_purchase_order_id,v_order.location_id,nullif(btrim(p_delivery_reference),''),p_actor_user_id) returning id into v_receipt_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_po_line from app.purchase_order_lines where tenant_id=p_tenant_id and id=(v_line->>'purchaseOrderLineId')::uuid and purchase_order_id=p_purchase_order_id for update;
    if not found then raise exception using errcode='HCS39', message='Purchase order line was not found'; end if;
    v_qty:=(v_line->>'quantityMilli')::numeric/1000; v_remaining:=v_po_line.ordered_quantity-v_po_line.received_quantity;
    if v_qty is null or v_qty<=0 or v_qty>v_remaining then raise exception using errcode='HCS40', message='Receipt exceeds the remaining ordered quantity'; end if;
    insert into app.purchase_receipt_lines(tenant_id,receipt_id,purchase_order_line_id,quantity,unit_cost) values(p_tenant_id,v_receipt_id,v_po_line.id,v_qty,v_po_line.unit_cost);
    update app.purchase_order_lines set received_quantity=received_quantity+v_qty where tenant_id=p_tenant_id and id=v_po_line.id;
    select * into v_balance from app.inventory_balances where tenant_id=p_tenant_id and location_id=v_order.location_id and variant_id=v_po_line.variant_id for update;
    if not found then
      insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost,version) values(p_tenant_id,v_order.location_id,v_po_line.variant_id,v_qty,v_po_line.unit_cost,1);
      v_new_on_hand:=v_qty;
    else
      v_new_on_hand:=v_balance.on_hand+v_qty;
      v_new_avg:=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,v_po_line.unit_cost)+v_qty*v_po_line.unit_cost)/v_new_on_hand,2);
      update app.inventory_balances set on_hand=v_new_on_hand,average_unit_cost=v_new_avg,version=version+1,updated_at=now() where tenant_id=p_tenant_id and location_id=v_order.location_id and variant_id=v_po_line.variant_id;
    end if;
    insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id) values(p_tenant_id,v_order.location_id,v_po_line.variant_id,'PURCHASE_RECEIPT',v_qty,v_po_line.unit_cost,'purchase_receipt',v_receipt_id::text,p_actor_user_id);
    v_received_count:=v_received_count+1;
  end loop;
  if not exists(select 1 from app.purchase_order_lines where tenant_id=p_tenant_id and purchase_order_id=p_purchase_order_id and received_quantity<ordered_quantity) then update app.purchase_orders set status='received',updated_at=now() where tenant_id=p_tenant_id and id=p_purchase_order_id; else update app.purchase_orders set status='partially_received',updated_at=now() where tenant_id=p_tenant_id and id=p_purchase_order_id; end if;
  select status into v_order.status from app.purchase_orders where tenant_id=p_tenant_id and id=p_purchase_order_id;
  v_response:=pg_catalog.jsonb_build_object('purchaseReceiptId',v_receipt_id,'purchaseOrderId',p_purchase_order_id,'status',v_order.status,'lineCount',v_received_count);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'purchase.received','purchase_receipt',v_receipt_id,v_order.location_id,pg_catalog.jsonb_build_object('purchaseOrderId',p_purchase_order_id,'lineCount',v_received_count));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'purchase.received','purchase_receipt',v_receipt_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='purchase_order.receive' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function app.list_purchasing_context(uuid,uuid), app.create_supplier(uuid,uuid,text,text,text,text,text,text,text), app.create_purchase_order(uuid,uuid,uuid,uuid,text,timestamptz,text,jsonb,text,text,text), app.send_purchase_order(uuid,uuid,uuid,text,text,text), app.receive_purchase_order(uuid,uuid,uuid,jsonb,text,text,text,text) from public, anon, authenticated;
grant execute on function app.list_purchasing_context(uuid,uuid), app.create_supplier(uuid,uuid,text,text,text,text,text,text,text), app.create_purchase_order(uuid,uuid,uuid,uuid,text,timestamptz,text,jsonb,text,text,text), app.send_purchase_order(uuid,uuid,uuid,text,text,text), app.receive_purchase_order(uuid,uuid,uuid,jsonb,text,text,text,text) to hcs_hyperdrive;

commit;
