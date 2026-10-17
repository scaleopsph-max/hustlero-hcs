begin;

insert into app.permissions (code, description) values
  ('sales.refund', 'Record item and quantity refunds'),
  ('sales.void', 'Void a completed sale')
on conflict (code) do update set description = excluded.description;

create table app.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sale_id uuid not null,
  reversal_type text not null check (reversal_type in ('refund', 'void')),
  status text not null default 'completed' check (status = 'completed'),
  amount numeric(18,2) not null check (amount > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 240),
  completed_by uuid not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id) on delete restrict,
  foreign key (tenant_id, completed_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);
create unique index refunds_one_void_per_sale_idx on app.refunds (tenant_id, sale_id) where reversal_type = 'void';
create index refunds_sale_completed_idx on app.refunds (tenant_id, sale_id, completed_at desc, id);

create table app.refund_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  refund_id uuid not null,
  sale_line_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0),
  amount numeric(18,2) not null check (amount >= 0),
  returned_to_stock boolean not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, refund_id, sale_line_id),
  foreign key (tenant_id, refund_id) references app.refunds (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_line_id) references app.sale_lines (tenant_id, id) on delete restrict
);
create index refund_items_sale_line_idx on app.refund_items (tenant_id, sale_line_id, created_at desc);

create table app.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  refund_id uuid not null,
  sale_payment_id uuid not null,
  amount numeric(18,2) not null check (amount > 0),
  status text not null default 'completed' check (status = 'completed'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, refund_id) references app.refunds (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_payment_id) references app.sale_payments (tenant_id, id) on delete restrict
);
create index payment_reversals_payment_idx on app.payment_reversals (tenant_id, sale_payment_id, created_at desc);

alter table app.refunds enable row level security;
alter table app.refund_items enable row level security;
alter table app.payment_reversals enable row level security;
revoke all on table app.refunds, app.refund_items, app.payment_reversals from public, anon, authenticated, hcs_hyperdrive;

create function app.reject_sale_reversal_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'HCSA8', message = 'Sale reversals are append-only';
end;
$$;
revoke all on function app.reject_sale_reversal_mutation() from public, anon, authenticated, hcs_hyperdrive;
create trigger refunds_append_only before update or delete on app.refunds for each row execute function app.reject_sale_reversal_mutation();
create trigger refund_items_append_only before update or delete on app.refund_items for each row execute function app.reject_sale_reversal_mutation();
create trigger payment_reversals_append_only before update or delete on app.payment_reversals for each row execute function app.reject_sale_reversal_mutation();

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r join app.permissions p on p.code = any(case lower(r.code::text)
  when 'owner' then array['sales.refund', 'sales.void']
  when 'admin' then array['sales.refund', 'sales.void']
  when 'manager' then array['sales.refund', 'sales.void']
  else array[]::text[] end)
where lower(r.code::text) in ('owner', 'admin', 'manager')
on conflict do nothing;

create function app.initialize_role_sales_reversal_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.role_permissions (tenant_id, role_id, permission_code)
  select new.tenant_id, new.id, p.code from app.permissions p
  where p.code = any(case lower(new.code::text)
    when 'owner' then array['sales.refund', 'sales.void']
    when 'admin' then array['sales.refund', 'sales.void']
    when 'manager' then array['sales.refund', 'sales.void']
    else array[]::text[] end)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_role_sales_reversal_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_sales_reversal_permissions after insert on app.roles
for each row execute function app.initialize_role_sales_reversal_permissions();

create function app.load_sale_receipt(p_actor_user_id uuid, p_tenant_id uuid, p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sale app.sales%rowtype; v_can_reverse boolean; v_register_open boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='sales.read'))) then
    raise exception using errcode='HCSA0', message='Sales access is not allowed';
  end if;
  select * into v_sale from app.sales where tenant_id=p_tenant_id and id=p_sale_id;
  if not found then raise exception using errcode='HCSA1', message='Sale was not found'; end if;
  select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code in ('sales.refund','sales.void')))) into v_can_reverse;
  select exists(select 1 from app.register_sessions rs where rs.tenant_id=p_tenant_id and rs.id=v_sale.register_session_id and rs.status='open') into v_register_open;
  return jsonb_build_object(
    'id',v_sale.id,'receiptNumber',v_sale.receipt_number,'status',v_sale.status,
    'locationName',(select name from app.locations where tenant_id=p_tenant_id and id=v_sale.location_id),
    'registerName',(select name from app.registers where tenant_id=p_tenant_id and id=v_sale.register_id),
    'employeeName',(select display_name from app.employees where tenant_id=p_tenant_id and id=v_sale.employee_id),
    'completedAt',v_sale.completed_at,'subtotalCentavos',round(v_sale.subtotal*100)::bigint,
    'discountCentavos',round(v_sale.discount_total*100)::bigint,'taxCentavos',round(v_sale.tax_total*100)::bigint,
    'totalCentavos',round(v_sale.total*100)::bigint,
    'refundedCentavos',round(coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=p_tenant_id and r.sale_id=v_sale.id and r.status='completed'),0)*100)::bigint,
    'refundableCentavos',greatest(round((v_sale.total-coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=p_tenant_id and r.sale_id=v_sale.id and r.status='completed'),0))*100)::bigint,0),
    'canReverse',v_can_reverse and v_register_open and v_sale.status in ('completed','partially_refunded'),
    'reversalBlockedReason',case when v_sale.status in ('voided','refunded') then 'This receipt is already fully reversed.' when not v_register_open then 'The original register session is closed.' when not v_can_reverse then 'Your role cannot reverse this sale.' else null end,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('id',sl.id,'productName',sl.product_name,'variantName',sl.variant_name,'sku',sl.sku,'quantityMilli',round(sl.quantity*1000)::bigint,'refundedQuantityMilli',round(coalesce((select sum(ri.quantity) from app.refund_items ri join app.refunds r on r.tenant_id=ri.tenant_id and r.id=ri.refund_id where ri.tenant_id=sl.tenant_id and ri.sale_line_id=sl.id and r.status='completed'),0)*1000)::bigint,'refundableQuantityMilli',round((sl.quantity-coalesce((select sum(ri.quantity) from app.refund_items ri join app.refunds r on r.tenant_id=ri.tenant_id and r.id=ri.refund_id where ri.tenant_id=sl.tenant_id and ri.sale_line_id=sl.id and r.status='completed'),0))*1000)::bigint,'unitPriceCentavos',round(sl.unit_price*100)::bigint,'lineTotalCentavos',round(sl.line_total*100)::bigint) order by sl.created_at,sl.id) from app.sale_lines sl where sl.tenant_id=p_tenant_id and sl.sale_id=v_sale.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',sp.id,'methodName',pm.name,'methodType',pm.method_type,'amountCentavos',round(sp.amount*100)::bigint,'tenderedCentavos',round(sp.tendered_amount*100)::bigint,'changeCentavos',round(sp.change_amount*100)::bigint,'refundedCentavos',round(coalesce((select sum(pr.amount) from app.payment_reversals pr where pr.tenant_id=sp.tenant_id and pr.sale_payment_id=sp.id and pr.status='completed'),0)*100)::bigint) order by sp.created_at,sp.id) from app.sale_payments sp join app.payment_methods pm on pm.tenant_id=sp.tenant_id and pm.id=sp.payment_method_id where sp.tenant_id=p_tenant_id and sp.sale_id=v_sale.id),'[]'::jsonb),
    'reversals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',r.reversal_type,'amountCentavos',round(r.amount*100)::bigint,'reason',r.reason,'completedAt',r.completed_at) order by r.completed_at desc,r.id) from app.refunds r where r.tenant_id=p_tenant_id and r.sale_id=v_sale.id),'[]'::jsonb)
  );
end;
$$;

create function app.reverse_sale(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid,p_reversal_type text,p_lines jsonb,p_reason text,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype; v_sale app.sales%rowtype; v_register_session app.register_sessions%rowtype;
  v_payment record; v_line jsonb; v_sale_line app.sale_lines%rowtype; v_refund_id uuid:=gen_random_uuid();
  v_quantity numeric(18,3); v_refunded_quantity numeric(18,3); v_amount numeric(18,2):=0; v_refunded_total numeric(18,2);
  v_return_to_stock boolean; v_new_status text; v_response jsonb; v_operation text;
begin
  if p_reversal_type not in ('refund','void') or p_reason is null or char_length(btrim(p_reason)) not between 3 and 240 then raise exception using errcode='HCSA2',message='Sale reversal is invalid'; end if;
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code=case when p_reversal_type='void' then 'sales.void' else 'sales.refund' end))) then raise exception using errcode='HCSA0',message='Sale reversal access is not allowed'; end if;
  v_operation:='sale.'||p_reversal_type;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||v_operation||':'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation=v_operation and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,v_operation,p_idempotency_key,p_request_hash,now()+interval '24 hours'); end if;
  select * into v_sale from app.sales where tenant_id=p_tenant_id and id=p_sale_id for update;
  if not found then raise exception using errcode='HCSA1',message='Sale was not found'; end if;
  if p_reversal_type='void' and v_sale.status<>'completed' or p_reversal_type='refund' and v_sale.status not in ('completed','partially_refunded') then raise exception using errcode='HCSA3',message='Sale cannot be reversed in its current state'; end if;
  if v_sale.discount_total<>0 or v_sale.tax_total<>0 then raise exception using errcode='HCSA7',message='Discounted or taxed sale reversals are not available yet'; end if;
  select * into v_register_session from app.register_sessions where tenant_id=p_tenant_id and id=v_sale.register_session_id for update;
  if v_register_session.status<>'open' then raise exception using errcode='HCSA6',message='Original register session must be open'; end if;
  select sp.*,pm.method_type into v_payment from app.sale_payments sp join app.payment_methods pm on pm.tenant_id=sp.tenant_id and pm.id=sp.payment_method_id where sp.tenant_id=p_tenant_id and sp.sale_id=p_sale_id for update of sp;
  if not found or v_payment.method_type<>'cash' then raise exception using errcode='HCSA7',message='Only cash sale reversals are available'; end if;
  if p_reversal_type='void' then
    select coalesce(jsonb_agg(jsonb_build_object('saleLineId',sl.id,'quantityMilli',round((sl.quantity-coalesce(x.refunded,0))*1000)::bigint,'returnToStock',true)) filter(where sl.quantity>coalesce(x.refunded,0)),'[]'::jsonb) into p_lines from app.sale_lines sl left join (select ri.sale_line_id,sum(ri.quantity) refunded from app.refund_items ri join app.refunds r on r.tenant_id=ri.tenant_id and r.id=ri.refund_id where ri.tenant_id=p_tenant_id and r.sale_id=p_sale_id group by ri.sale_line_id) x on x.sale_line_id=sl.id where sl.tenant_id=p_tenant_id and sl.sale_id=p_sale_id;
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>200 or exists(select 1 from jsonb_array_elements(p_lines) x where (x->>'saleLineId') is null or (x->>'quantityMilli') !~ '^[1-9][0-9]*$' or (x->>'returnToStock') not in ('true','false')) or exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'saleLineId' having count(*)>1) then raise exception using errcode='HCSA2',message='Sale reversal lines are invalid'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity:=((v_line->>'quantityMilli')::bigint)::numeric/1000;
    select * into v_sale_line from app.sale_lines where tenant_id=p_tenant_id and sale_id=p_sale_id and id=(v_line->>'saleLineId')::uuid for update;
    if not found then raise exception using errcode='HCSA4',message='Sale line was not found'; end if;
    select coalesce(sum(ri.quantity),0) into v_refunded_quantity from app.refund_items ri join app.refunds r on r.tenant_id=ri.tenant_id and r.id=ri.refund_id where ri.tenant_id=p_tenant_id and ri.sale_line_id=v_sale_line.id and r.status='completed';
    if v_quantity>v_sale_line.quantity-v_refunded_quantity then raise exception using errcode='HCSA5',message='Refund quantity exceeds the remaining quantity'; end if;
    v_amount:=v_amount+round(v_quantity*v_sale_line.unit_price,2);
  end loop;
  select coalesce(sum(pr.amount),0) into v_refunded_total from app.payment_reversals pr where pr.tenant_id=p_tenant_id and pr.sale_payment_id=v_payment.id and pr.status='completed';
  if v_amount<=0 or v_amount>v_payment.amount-v_refunded_total then raise exception using errcode='HCSA5',message='Refund amount exceeds the remaining payment'; end if;
  insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by) values(v_refund_id,p_tenant_id,p_sale_id,p_reversal_type,v_amount,btrim(p_reason),p_actor_user_id);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity:=((v_line->>'quantityMilli')::bigint)::numeric/1000; v_return_to_stock:=(v_line->>'returnToStock')::boolean;
    select * into v_sale_line from app.sale_lines where tenant_id=p_tenant_id and sale_id=p_sale_id and id=(v_line->>'saleLineId')::uuid;
    insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock) values(p_tenant_id,v_refund_id,v_sale_line.id,v_quantity,round(v_quantity*v_sale_line.unit_price,2),v_return_to_stock);
    if v_return_to_stock and exists(select 1 from app.inventory_balances where tenant_id=p_tenant_id and location_id=v_sale.location_id and variant_id=v_sale_line.variant_id) then
      update app.inventory_balances set on_hand=on_hand+v_quantity,version=version+1,updated_at=now() where tenant_id=p_tenant_id and location_id=v_sale.location_id and variant_id=v_sale_line.variant_id;
      insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id) values(p_tenant_id,v_sale.location_id,v_sale_line.variant_id,'REFUND',v_quantity,v_sale_line.unit_cost,p_reversal_type,v_refund_id::text,p_actor_user_id);
    end if;
  end loop;
  insert into app.payment_reversals(tenant_id,refund_id,sale_payment_id,amount) values(p_tenant_id,v_refund_id,v_payment.id,v_amount);
  insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,reason,actor_user_id) values(p_tenant_id,v_sale.register_session_id,v_sale.location_id,'cash_refund',-v_amount,p_reversal_type,v_refund_id,btrim(p_reason),p_actor_user_id);
  v_refunded_total:=v_refunded_total+v_amount;
  v_new_status:=case when p_reversal_type='void' then 'voided' when v_refunded_total>=v_sale.total then 'refunded' else 'partially_refunded' end;
  update app.sales set status=v_new_status where tenant_id=p_tenant_id and id=p_sale_id;
  if v_refunded_total>=v_payment.amount then update app.sale_payments set status=case when p_reversal_type='void' then 'voided' else 'refunded' end where tenant_id=p_tenant_id and id=v_payment.id; end if;
  v_response:=jsonb_build_object('reversalId',v_refund_id,'saleId',p_sale_id,'receiptNumber',v_sale.receipt_number,'type',p_reversal_type,'saleStatus',v_new_status,'amountCentavos',round(v_amount*100)::bigint,'completedAt',now());
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'sale.'||case when p_reversal_type='void' then 'voided' else 'refunded' end,p_reversal_type,v_refund_id,v_sale.location_id,btrim(p_reason),jsonb_build_object('saleId',p_sale_id,'amount',v_amount));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'sale.'||case when p_reversal_type='void' then 'voided' else 'refunded' end,p_reversal_type,v_refund_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation=v_operation and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create or replace function app.list_sales(p_actor_user_id uuid,p_tenant_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='sales.read'))) then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
  return jsonb_build_object('sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'receiptNumber',s.receipt_number,'status',s.status,'locationName',l.name,'registerName',r.name,'employeeName',e.display_name,'itemCount',(select coalesce(sum(sl.quantity),0) from app.sale_lines sl where sl.tenant_id=s.tenant_id and sl.sale_id=s.id),'totalCentavos',round(s.total*100)::bigint,'refundedCentavos',round(coalesce((select sum(rf.amount) from app.refunds rf where rf.tenant_id=s.tenant_id and rf.sale_id=s.id),0)*100)::bigint,'netCentavos',round((s.total-coalesce((select sum(rf.amount) from app.refunds rf where rf.tenant_id=s.tenant_id and rf.sale_id=s.id),0))*100)::bigint,'completedAt',s.completed_at) order by s.completed_at desc,s.id) from (select * from app.sales where tenant_id=p_tenant_id order by completed_at desc,id limit least(greatest(p_limit,1),200)) s join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id join app.employees e on e.tenant_id=s.tenant_id and e.id=s.employee_id),'[]'::jsonb));
end;
$$;

revoke all on function app.load_sale_receipt(uuid,uuid,uuid), app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function app.load_sale_receipt(uuid,uuid,uuid), app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text) to hcs_hyperdrive;

commit;
