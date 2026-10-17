begin;
create table app.wholesale_credit_override_consumptions (
  tenant_id uuid not null, override_id uuid not null, sales_order_id uuid not null,
  customer_id uuid not null, action text not null check(action in ('confirm','fulfill')),
  idempotency_key text not null, request_hash text not null,
  exposure numeric(18,2) not null, credit_limit numeric(18,2) not null check(credit_limit>=0),
  excess numeric(18,2) not null check(excess>0 and exposure-credit_limit=excess),
  consumed_by uuid not null, consumed_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,override_id), unique(tenant_id,action,idempotency_key),
  foreign key(tenant_id,override_id) references app.wholesale_credit_overrides(tenant_id,id) on delete restrict,
  foreign key(tenant_id,sales_order_id) references app.sales_orders(tenant_id,id) on delete restrict,
  foreign key(tenant_id,customer_id) references app.customers(tenant_id,id) on delete restrict,
  foreign key(tenant_id,consumed_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_override_consumptions_order_idx on app.wholesale_credit_override_consumptions(tenant_id,sales_order_id);
create index wholesale_override_consumptions_customer_idx on app.wholesale_credit_override_consumptions(tenant_id,customer_id);
create index wholesale_override_consumptions_actor_idx on app.wholesale_credit_override_consumptions(tenant_id,consumed_by);
alter table app.wholesale_credit_override_consumptions enable row level security;
revoke all on app.wholesale_credit_override_consumptions from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_override_consumptions_immutable before update or delete on app.wholesale_credit_override_consumptions
  for each row execute function app.reject_invoice_mutation();

create function app.wholesale_credit_exposure(p_tenant uuid,p_customer uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_exposure numeric;
begin
  if exists(select 1 from app.invoices invoice where invoice.tenant_id=p_tenant and invoice.customer_id=p_customer
    and not exists(select 1 from app.wholesale_receivable_charges charge where charge.tenant_id=p_tenant and charge.invoice_id=invoice.id)
    and not exists(select 1 from app.wholesale_invoice_charges charge where charge.tenant_id=p_tenant and charge.invoice_id=invoice.id)) then
    raise exception using errcode='HCCR4',message='Historical invoice classification is required'; end if;
  select coalesce((select sum(amount) from app.wholesale_receivable_charges where tenant_id=p_tenant and customer_id=p_customer),0)
    +coalesce((select sum(amount) from app.wholesale_invoice_charges where tenant_id=p_tenant and customer_id=p_customer),0)
    +coalesce((select sum(round((line.ordered_quantity-line.fulfilled_quantity-line.cancelled_quantity)*line.unit_price,2))
      from app.sales_orders orders join app.sales_order_lines line on line.tenant_id=orders.tenant_id and line.sales_order_id=orders.id
      where orders.tenant_id=p_tenant and orders.customer_id=p_customer and orders.status in ('confirmed','partially_fulfilled')),0) into v_exposure;
  return v_exposure;
end;
$$;
revoke all on function app.wholesale_credit_exposure(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create or replace function app.assert_wholesale_credit_capacity(p_tenant uuid,p_customer uuid,p_limit numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
  if app.wholesale_credit_exposure(p_tenant,p_customer)>p_limit or p_limit is null then
    raise exception using errcode='HCCR1',message='Customer credit limit exceeded'; end if;
end;
$$;

-- Only command wrappers holding order/customer locks can invoke this helper.
create function app.consume_wholesale_credit_override(p_actor uuid,p_tenant uuid,p_order uuid,p_customer uuid,
  p_action text,p_override uuid,p_limit numeric,p_key text,p_hash text,p_request_id text)
returns void language plpgsql security definer set search_path='' as $$
declare v_approval app.wholesale_credit_overrides%rowtype; v_exposure numeric; v_excess numeric; v_payload jsonb;
begin
  select * into v_approval from app.wholesale_credit_overrides where tenant_id=p_tenant and id=p_override;
  if not found or v_approval.sales_order_id<>p_order or v_approval.customer_id<>p_customer or v_approval.action<>p_action then
    raise exception using errcode='HCCO6',message='Credit approval is not valid for this command'; end if;
  if v_approval.expires_at<=clock_timestamp()
    or exists(select 1 from app.wholesale_credit_override_revocations where tenant_id=p_tenant and override_id=p_override)
    or exists(select 1 from app.wholesale_credit_override_consumptions where tenant_id=p_tenant and override_id=p_override) then
    raise exception using errcode='HCCO6',message='Credit approval is not valid for this command'; end if;
  v_exposure:=app.wholesale_credit_exposure(p_tenant,p_customer); v_excess:=v_exposure-p_limit;
  if p_limit is null then raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
  if v_excess<=0 or v_excess>v_approval.approved_excess then
    raise exception using errcode='HCCO6',message='Credit approval is not valid for this command'; end if;
  insert into app.wholesale_credit_override_consumptions(tenant_id,override_id,sales_order_id,customer_id,action,
    idempotency_key,request_hash,exposure,credit_limit,excess,consumed_by)
    values(p_tenant,p_override,p_order,p_customer,p_action,p_key,p_hash,v_exposure,p_limit,v_excess,p_actor);
  v_payload:=jsonb_build_object('overrideId',p_override,'salesOrderId',p_order,'action',p_action,
    'exposureMinor',(v_exposure*100)::bigint,'creditLimitMinor',(p_limit*100)::bigint,'excessMinor',(v_excess*100)::bigint);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
    values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_credit_override.consumed','wholesale_credit_override',p_override,v_approval.reason,v_payload);
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
    values(p_tenant,'wholesale_credit_override.consumed','wholesale_credit_override',p_override,v_payload);
end;
$$;
revoke all on function app.consume_wholesale_credit_override(uuid,uuid,uuid,uuid,text,uuid,numeric,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.assert_wholesale_override_replay(p_tenant uuid,p_order uuid,p_action text,p_override uuid,p_key text,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from app.wholesale_credit_override_consumptions where tenant_id=p_tenant and sales_order_id=p_order
    and action=p_action and override_id=p_override and idempotency_key=p_key and request_hash=p_hash) then
    raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
end;
$$;
revoke all on function app.assert_wholesale_override_replay(uuid,uuid,text,uuid,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.confirm_wholesale_order_with_credit_override(p_actor uuid,p_tenant uuid,p_order uuid,
  p_key text,p_hash text,p_request_id text,p_override uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order app.sales_orders%rowtype; v_settings app.wholesale_customer_credit_settings%rowtype; v_response jsonb;
begin
  perform app.assert_wholesale_order_credit_access(p_actor,p_tenant);
  select * into v_order from app.sales_orders where tenant_id=p_tenant and id=p_order for update;
  if not found then raise exception using errcode='HCSQ7',message='The wholesale order was not found'; end if;
  perform 1 from app.customers where tenant_id=p_tenant and id=v_order.customer_id and status='active' and customer_type='reseller' for update;
  if not found then raise exception using errcode='HCSQ3',message='An active reseller customer is required'; end if;
  if v_order.status<>'draft' and not exists(select 1 from app.wholesale_order_credit_snapshots where tenant_id=p_tenant and sales_order_id=p_order) then
    raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
  v_response:=app.confirm_wholesale_order_inventory_core(p_actor,p_tenant,p_order,p_key,p_hash,p_request_id);
  if exists(select 1 from app.wholesale_order_credit_snapshots where tenant_id=p_tenant and sales_order_id=p_order) then
    perform app.assert_wholesale_override_replay(p_tenant,p_order,'confirm',p_override,p_key,p_hash); return v_response; end if;
  select * into v_settings from app.wholesale_customer_credit_settings where tenant_id=p_tenant and customer_id=v_order.customer_id order by revision desc limit 1;
  if not found then raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
  perform app.consume_wholesale_credit_override(p_actor,p_tenant,p_order,v_order.customer_id,'confirm',p_override,v_settings.credit_limit,p_key,p_hash,p_request_id);
  insert into app.wholesale_order_credit_snapshots(tenant_id,sales_order_id,settings_id,payment_term,credit_limit)
    values(p_tenant,p_order,v_settings.id,v_settings.payment_term,v_settings.credit_limit);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
    values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_credit.confirmed','sales_order',p_order,
      jsonb_build_object('settingsId',v_settings.id,'paymentTerm',v_settings.payment_term,'creditLimitMinor',(v_settings.credit_limit*100)::bigint,'overrideId',p_override));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
    values(p_tenant,'wholesale_credit.confirmed','sales_order',p_order,jsonb_build_object('paymentTerm',v_settings.payment_term,'settingsId',v_settings.id,'overrideId',p_override));
  return v_response;
end;
$$;

create function app.fulfill_wholesale_order_with_credit_override(p_actor uuid,p_tenant uuid,p_order uuid,p_lines jsonb,
  p_key text,p_hash text,p_request_id text,p_override uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order app.sales_orders%rowtype; v_snapshot app.wholesale_order_credit_snapshots%rowtype; v_limit numeric;
  v_response jsonb; v_invoice app.invoices%rowtype; v_due date; v_lines jsonb;
begin
  perform app.assert_wholesale_order_credit_access(p_actor,p_tenant);
  select * into v_order from app.sales_orders where tenant_id=p_tenant and id=p_order for update;
  if not found then raise exception using errcode='HCSQ7',message='The wholesale order was not found'; end if;
  perform 1 from app.customers where tenant_id=p_tenant and id=v_order.customer_id and status='active' and customer_type='reseller' for update;
  if not found then raise exception using errcode='HCSQ3',message='An active reseller customer is required'; end if;
  select * into v_snapshot from app.wholesale_order_credit_snapshots where tenant_id=p_tenant and sales_order_id=p_order;
  if not found then raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
  if v_snapshot.payment_term in ('prepaid','cod') then raise exception using errcode='HCCR3',message='Full payment is required at fulfillment'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception using errcode='HCSR1',message='Fulfillment lines are invalid'; end if;
  select jsonb_agg(item.value order by line.variant_id,item.value->>'salesOrderLineId') into v_lines from jsonb_array_elements(p_lines) item
    left join app.sales_order_lines line on line.tenant_id=p_tenant and line.sales_order_id=p_order and line.id::text=item.value->>'salesOrderLineId';
  v_response:=app.fulfill_wholesale_order_inventory_core(p_actor,p_tenant,p_order,coalesce(v_lines,'[]'::jsonb),p_key,p_hash,p_request_id);
  if exists(select 1 from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=(v_response->>'invoiceId')::uuid) then
    perform app.assert_wholesale_override_replay(p_tenant,p_order,'fulfill',p_override,p_key,p_hash); return v_response; end if;
  select * into v_invoice from app.invoices where tenant_id=p_tenant and id=(v_response->>'invoiceId')::uuid;
  select (v_invoice.issued_at at time zone coalesce(location.timezone,tenant.timezone))::date
    +case v_snapshot.payment_term when 'net_7' then 7 when 'net_15' then 15 when 'net_30' then 30 end into v_due
    from app.locations location join app.tenants tenant on tenant.id=location.tenant_id where location.tenant_id=p_tenant and location.id=v_invoice.location_id;
  insert into app.wholesale_invoice_charges(tenant_id,invoice_id,customer_id,sales_order_id,amount,payment_term,due_date)
    values(p_tenant,v_invoice.id,v_invoice.customer_id,p_order,v_invoice.total,v_snapshot.payment_term,v_due);
  select credit_limit into v_limit from app.wholesale_customer_credit_settings where tenant_id=p_tenant and customer_id=v_order.customer_id order by revision desc limit 1;
  perform app.consume_wholesale_credit_override(p_actor,p_tenant,p_order,v_order.customer_id,'fulfill',p_override,v_limit,p_key,p_hash,p_request_id);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
    values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_receivable.charged','invoice',v_invoice.id,
      jsonb_build_object('amountMinor',(v_invoice.total*100)::bigint,'dueDate',v_due,'paymentTerm',v_snapshot.payment_term,'overrideId',p_override));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
    values(p_tenant,'wholesale_receivable.charged','invoice',v_invoice.id,jsonb_build_object('amountMinor',(v_invoice.total*100)::bigint,'dueDate',v_due,'overrideId',p_override));
  return v_response;
end;
$$;
revoke all on function app.confirm_wholesale_order_with_credit_override(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function app.fulfill_wholesale_order_with_credit_override(uuid,uuid,uuid,jsonb,text,text,text,uuid) from public,anon,authenticated;
grant execute on function app.confirm_wholesale_order_with_credit_override(uuid,uuid,uuid,text,text,text,uuid) to hcs_hyperdrive;
grant execute on function app.fulfill_wholesale_order_with_credit_override(uuid,uuid,uuid,jsonb,text,text,text,uuid) to hcs_hyperdrive;
commit;
