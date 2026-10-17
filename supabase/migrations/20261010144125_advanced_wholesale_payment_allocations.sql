begin;
insert into app.permissions(code,description) values('wholesale_payments.record','Record received wholesale payments and explicit invoice allocations') on conflict do nothing;
create table app.wholesale_payments (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid not null, payment_method_id uuid not null,
 amount numeric(18,2) not null check(amount>0 and amount<=90071992547409.91), reference text not null check(length(btrim(reference)) between 1 and 100),
 recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(), unique(tenant_id,id),
 foreign key(tenant_id,customer_id) references app.customers(tenant_id,id) on delete restrict,
 foreign key(tenant_id,payment_method_id) references app.payment_methods(tenant_id,id) on delete restrict,
 foreign key(tenant_id,recorded_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create table app.wholesale_payment_allocations (
 tenant_id uuid not null, payment_id uuid not null, invoice_id uuid not null,
 amount numeric(18,2) not null check(amount>0 and amount<=90071992547409.91), recorded_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,payment_id,invoice_id),
 foreign key(tenant_id,payment_id) references app.wholesale_payments(tenant_id,id) on delete restrict,
 foreign key(tenant_id,invoice_id) references app.invoices(tenant_id,id) on delete restrict
);
create index wholesale_payments_customer_idx on app.wholesale_payments(tenant_id,customer_id,recorded_at,id);
create index wholesale_payments_method_idx on app.wholesale_payments(tenant_id,payment_method_id);
create index wholesale_payments_actor_idx on app.wholesale_payments(tenant_id,recorded_by);
create index wholesale_payment_allocations_invoice_idx on app.wholesale_payment_allocations(tenant_id,invoice_id);
alter table app.wholesale_payments enable row level security;
alter table app.wholesale_payment_allocations enable row level security;
revoke all on app.wholesale_payments,app.wholesale_payment_allocations from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_payments_immutable before update or delete on app.wholesale_payments for each row execute function app.reject_invoice_mutation();
create trigger wholesale_payment_allocations_immutable before update or delete on app.wholesale_payment_allocations for each row execute function app.reject_invoice_mutation();

create function app.wholesale_invoice_open_balance(p_tenant uuid,p_invoice uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select amount from app.wholesale_receivable_charges where tenant_id=p_tenant and invoice_id=p_invoice),
   (select amount from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=p_invoice))
  -coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=p_invoice),0);
$$;
revoke all on function app.wholesale_invoice_open_balance(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.can_record_wholesale_payment_at_location(p_actor uuid,p_tenant uuid,p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.locations location join app.tenant_memberships member on member.tenant_id=location.tenant_id
  where location.tenant_id=p_tenant and location.id=p_location and location.is_active and member.user_id=p_actor and member.status='active'
   and (member.is_owner or exists(select 1 from app.employees employee join app.employee_locations assigned
    on assigned.tenant_id=employee.tenant_id and assigned.employee_id=employee.id
    where employee.tenant_id=p_tenant and employee.user_id=p_actor and employee.status='active' and assigned.location_id=p_location)));
$$;
revoke all on function app.can_record_wholesale_payment_at_location(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.record_wholesale_payment(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_customer uuid; v_method uuid; v_amount numeric; v_total numeric:=0; v_item jsonb; v_invoice app.invoices%rowtype;
 v_invoice_id uuid; v_allocated numeric; v_balance numeric; v_id uuid; v_existing app.idempotency_records%rowtype;
 v_response jsonb; v_owner boolean;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active';
 if not exists(select 1 from app.tenants where id=p_tenant and status='active') or not (v_owner or exists(
   select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_payments.record')) then
   raise exception using errcode='HCAP1',message='Wholesale payment permission is required'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
 if not(p_payload ?& array['customerId','paymentMethodId','amountMinor','reference','allocations'])
   or exists(select 1 from jsonb_object_keys(p_payload) key where key not in ('customerId','paymentMethodId','amountMinor','reference','allocations'))
   or jsonb_typeof(p_payload->'reference') is distinct from 'string' or length(btrim(p_payload->>'reference')) not between 1 and 100
   or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number' or jsonb_typeof(p_payload->'allocations') is distinct from 'array'
   or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null then
   raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
 if jsonb_array_length(p_payload->'allocations') not between 1 and 500 then raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
 begin
   v_customer:=(p_payload->>'customerId')::uuid; v_method:=(p_payload->>'paymentMethodId')::uuid; v_amount:=(p_payload->>'amountMinor')::numeric;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end;
 if v_customer is null or v_method is null or v_amount<=0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then
   raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
 for v_item in select value from jsonb_array_elements(p_payload->'allocations') loop
   if jsonb_typeof(v_item) is distinct from 'object' then raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
   if not(v_item ?& array['invoiceId','amountMinor'])
     or exists(select 1 from jsonb_object_keys(v_item) key where key not in ('invoiceId','amountMinor'))
     or jsonb_typeof(v_item->'invoiceId') is distinct from 'string' or jsonb_typeof(v_item->'amountMinor') is distinct from 'number' then
     raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
   begin v_invoice_id:=(v_item->>'invoiceId')::uuid; v_allocated:=(v_item->>'amountMinor')::numeric;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end;
   if v_allocated<=0 or v_allocated>9007199254740991 or trunc(v_allocated)<>v_allocated then raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
   v_total:=v_total+v_allocated;
 end loop;
 if v_total<>v_amount or (select count(distinct (value->>'invoiceId')::uuid) from jsonb_array_elements(p_payload->'allocations'))<>jsonb_array_length(p_payload->'allocations') then
   raise exception using errcode='HCAP2',message='Invalid wholesale payment'; end if;
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer and status='active' and customer_type='reseller' for update;
 if not found then raise exception using errcode='HCAP3',message='Payment scope is unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':wholesale-payment:'||p_key,0));
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='wholesale_payment.record' and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
   if v_existing.completed_at is not null then
     if exists(select 1 from app.wholesale_payment_allocations allocation join app.invoices invoice
       on invoice.tenant_id=allocation.tenant_id and invoice.id=allocation.invoice_id
       where allocation.tenant_id=p_tenant and allocation.payment_id=(v_existing.response_body->>'paymentId')::uuid
       and not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,invoice.location_id)) then
       raise exception using errcode='HCAP3',message='Payment scope is unavailable'; end if;
     return v_existing.response_body;
   end if;
 end if;
 perform 1 from app.payment_methods where tenant_id=p_tenant and id=v_method and is_active for share;
 if not found then raise exception using errcode='HCAP3',message='Payment scope is unavailable'; end if;
 v_id:=gen_random_uuid();
 insert into app.wholesale_payments(id,tenant_id,customer_id,payment_method_id,amount,reference,recorded_by)
   values(v_id,p_tenant,v_customer,v_method,v_amount/100,btrim(p_payload->>'reference'),p_actor);
 -- The customer credit lock precedes invoices; UUID ordering avoids allocation-order deadlocks.
 for v_item in select value from jsonb_array_elements(p_payload->'allocations') order by (value->>'invoiceId')::uuid loop
   select * into v_invoice from app.invoices where tenant_id=p_tenant and id=(v_item->>'invoiceId')::uuid and customer_id=v_customer for update;
   if not found then raise exception using errcode='HCAP3',message='Payment scope is unavailable'; end if;
   if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_invoice.location_id) then
     raise exception using errcode='HCAP3',message='Payment scope is unavailable'; end if;
   v_balance:=app.wholesale_invoice_open_balance(p_tenant,v_invoice.id); v_allocated:=(v_item->>'amountMinor')::numeric/100;
   if v_balance is null then raise exception using errcode='HCAP4',message='Invoice classification is required'; end if;
   if v_allocated>v_balance then raise exception using errcode='HCAP5',message='Allocation exceeds open invoice balance'; end if;
   insert into app.wholesale_payment_allocations(tenant_id,payment_id,invoice_id,amount) values(p_tenant,v_id,v_invoice.id,v_allocated);
 end loop;
 v_response:=jsonb_build_object('paymentId',v_id,'customerId',v_customer,'amountMinor',v_amount::bigint,'allocationCount',jsonb_array_length(p_payload->'allocations'),
   'recordedAt',(select recorded_at from app.wholesale_payments where tenant_id=p_tenant and id=v_id));
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
   values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_payment.recorded','wholesale_payment',v_id,v_response||jsonb_build_object('reference',btrim(p_payload->>'reference'),'allocations',p_payload->'allocations'));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
   values(p_tenant,'wholesale_payment.recorded','wholesale_payment',v_id,v_response);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
   values(p_tenant,'wholesale_payment.record',p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
end;
$$;
revoke all on function app.record_wholesale_payment(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.record_wholesale_payment(uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;

create or replace function app.wholesale_credit_exposure(p_tenant uuid,p_customer uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_exposure numeric;
begin
 if exists(select 1 from app.invoices where tenant_id=p_tenant and customer_id=p_customer and app.wholesale_invoice_open_balance(p_tenant,id) is null) then
   raise exception using errcode='HCCR4',message='Historical invoice classification is required'; end if;
 select coalesce((select sum(app.wholesale_invoice_open_balance(p_tenant,id)) from app.invoices where tenant_id=p_tenant and customer_id=p_customer),0)
   +coalesce((select sum(round((line.ordered_quantity-line.fulfilled_quantity-line.cancelled_quantity)*line.unit_price,2))
   from app.sales_orders orders join app.sales_order_lines line on line.tenant_id=orders.tenant_id and line.sales_order_id=orders.id
   where orders.tenant_id=p_tenant and orders.customer_id=p_customer and orders.status in ('confirmed','partially_fulfilled')),0) into v_exposure;
 return v_exposure;
end;
$$;
create or replace function app.load_wholesale_receivables(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_response jsonb;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select jsonb_build_object('canRecordOpening',exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner),
   'invoices',coalesce(jsonb_agg(jsonb_build_object('invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number::text,
   'customerId',invoice.customer_id,'customerName',invoice.customer_name_snapshot,'locationId',invoice.location_id,'locationName',invoice.location_name_snapshot,
   'totalMinor',(invoice.total*100)::bigint,'classification',case when charge.id is not null then 'opening' when issued.id is not null then 'invoice' else 'unclassified' end,
   'eligibleForOpening',legacy.invoice_id is not null and charge.id is null and issued.id is null,
   'openBalanceMinor',(app.wholesale_invoice_open_balance(p_tenant,invoice.id)*100)::bigint,'dueDate',coalesce(charge.due_date,issued.due_date)) order by invoice.issued_at desc,invoice.id),'[]'::jsonb)) into v_response
   from app.invoices invoice left join app.wholesale_legacy_invoices legacy on legacy.tenant_id=invoice.tenant_id and legacy.invoice_id=invoice.id
   left join app.wholesale_receivable_charges charge on charge.tenant_id=invoice.tenant_id and charge.invoice_id=invoice.id
   left join app.wholesale_invoice_charges issued on issued.tenant_id=invoice.tenant_id and issued.invoice_id=invoice.id where invoice.tenant_id=p_tenant;
 return v_response;
end;
$$;
commit;
