begin;

create table app.wholesale_payment_references (
  tenant_id uuid not null,
  payment_id uuid not null,
  reference_last_four text not null check (reference_last_four ~ '^[0-9]{4}$'),
  method_name_snapshot text not null,
  method_type_snapshot text not null check (method_type_snapshot in ('e_wallet','bank_transfer')),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,payment_id),
  foreign key (tenant_id,payment_id) references app.wholesale_payments(tenant_id,id) on delete restrict
);
alter table app.wholesale_payment_references enable row level security;
revoke all on app.wholesale_payment_references from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_payment_references_immutable before update or delete on app.wholesale_payment_references
  for each row execute function app.reject_invoice_mutation();

alter function app.load_wholesale_payments(uuid,uuid) rename to wholesale_payments_reference_core;
revoke all on function app.wholesale_payments_reference_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.load_wholesale_payments(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  -- Preserve the existing permission, entitlement and whole-receipt branch checks.
  v_result:=app.wholesale_payments_reference_core(p_actor,p_tenant);
  return v_result || jsonb_build_object('paymentMethods',coalesce((
    select jsonb_agg(item.value || jsonb_build_object('methodType',method.method_type) order by item.ordinality)
    from jsonb_array_elements(v_result->'paymentMethods') with ordinality item(value,ordinality)
    join app.payment_methods method on method.tenant_id=p_tenant and method.id=(item.value->>'id')::uuid
  ),'[]'::jsonb));
end;
$$;
revoke all on function app.load_wholesale_payments(uuid,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_payments(uuid,uuid) to hcs_hyperdrive;

-- The payment command retains its customer-before-idempotency-key lock order.
create or replace function app.record_wholesale_payment(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_customer uuid; v_method uuid; v_amount numeric; v_total numeric:=0; v_item jsonb; v_invoice app.invoices%rowtype;
 v_invoice_id uuid; v_allocated numeric; v_balance numeric; v_id uuid; v_existing app.idempotency_records%rowtype;
 v_response jsonb; v_owner boolean; v_online_method app.payment_methods%rowtype;
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
 select * into v_online_method from app.payment_methods where tenant_id=p_tenant and id=v_method and is_active for share;
 if not found then raise exception using errcode='HCAP3',message='Payment scope is unavailable'; end if;
 if v_online_method.method_type in ('e_wallet','bank_transfer') and btrim(p_payload->>'reference') !~ '^[0-9]{4}$' then
   raise exception using errcode='HCAP6',message='Enter exactly four transaction reference digits for online payments';
 end if;
 v_id:=gen_random_uuid();
 insert into app.wholesale_payments(id,tenant_id,customer_id,payment_method_id,amount,reference,recorded_by)
   values(v_id,p_tenant,v_customer,v_method,v_amount/100,btrim(p_payload->>'reference'),p_actor);
 if v_online_method.method_type in ('e_wallet','bank_transfer') then
   insert into app.wholesale_payment_references(tenant_id,payment_id,reference_last_four,method_name_snapshot,method_type_snapshot)
   values(p_tenant,v_id,btrim(p_payload->>'reference'),v_online_method.name,v_online_method.method_type);
 end if;
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

create index wholesale_payments_reference_report_idx on app.wholesale_payments(tenant_id,recorded_at desc,id);
create function app.load_wholesale_payment_reference_report(p_actor uuid,p_tenant uuid,p_from date,p_to date,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_timezone text; v_rows jsonb; v_owner boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor
    and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr
      join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
      where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='reports.read'))) then
    raise exception using errcode='HCSD0',message='Reporting access is not allowed';
  end if;
  perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then
    raise exception using errcode='HCSD1',message='Choose a report range of at most 32 days';
  end if;
  if p_location is not null and not app.can_read_wholesale_location(p_actor,p_tenant,p_location) then
    raise exception using errcode='HCSD0',message='Reporting location is not allowed';
  end if;
  select timezone into v_timezone from app.tenants where id=p_tenant;
  select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active';
  -- Whole receipt amounts are never duplicated per invoice or partially disclosed across branches.
  with permitted as (
    select payment.*,coalesce(ref.method_name_snapshot,method.name) method_name,
      coalesce(ref.method_type_snapshot,method.method_type) method_type,ref.reference_last_four,
      customer.full_name customer_name,coalesce(actor.email::text,'Business user') actor_name,
      allocation_scope.branch_count,allocation_scope.first_branch
    from app.wholesale_payments payment
    join app.payment_methods method on method.tenant_id=payment.tenant_id and method.id=payment.payment_method_id
    join app.customers customer on customer.tenant_id=payment.tenant_id and customer.id=payment.customer_id
    left join auth.users actor on actor.id=payment.recorded_by
    left join app.wholesale_payment_references ref on ref.tenant_id=payment.tenant_id and ref.payment_id=payment.id
    cross join lateral (
      select count(distinct invoice.location_id) branch_count,(array_agg(invoice.location_id order by invoice.location_id))[1] first_branch,
        bool_and(app.can_read_wholesale_location(p_actor,p_tenant,invoice.location_id)) all_allowed,
        bool_and(invoice.location_id=p_location) selected_branch
      from app.wholesale_payment_allocations allocation join app.invoices invoice
        on invoice.tenant_id=allocation.tenant_id and invoice.id=allocation.invoice_id
      where allocation.tenant_id=p_tenant and allocation.payment_id=payment.id
    ) allocation_scope
    where payment.tenant_id=p_tenant and coalesce(ref.method_type_snapshot,method.method_type) in ('e_wallet','bank_transfer')
      and payment.recorded_at>=(p_from::timestamp at time zone v_timezone)
      and payment.recorded_at<((p_to+1)::timestamp at time zone v_timezone)
      and (v_owner or allocation_scope.all_allowed)
      and (p_location is null or allocation_scope.selected_branch)
    order by payment.recorded_at desc,payment.id limit 10001
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'paymentId',id,'saleId',null,'receiptNumber',id::text,'channel','wholesale','completedAt',recorded_at,
    'locationId',case when branch_count=1 then first_branch else null end,
    'locationName',case when branch_count=0 then 'Unallocated' when branch_count>1 then 'Multiple branches'
      else (select name from app.locations where tenant_id=p_tenant and id=first_branch) end,
    'cashierName',actor_name,'customerName',customer_name,'paymentMethodId',payment_method_id,
    'methodName',method_name,'methodType',method_type,'amountMinor',(amount*100)::bigint,
    'reversedMinor',0,'referenceLastFour',reference_last_four
  ) order by recorded_at desc,id),'[]'::jsonb) into v_rows from permitted;
  if jsonb_array_length(v_rows)>10000 then raise exception using errcode='HCSD1',message='Narrow the report date range'; end if;
  return jsonb_build_object('timezone',v_timezone,'rows',v_rows,'locations',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from app.locations
    where tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,id)
  ),'[]'::jsonb));
end;
$$;
revoke all on function app.load_wholesale_payment_reference_report(uuid,uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_payment_reference_report(uuid,uuid,date,date,uuid) to hcs_hyperdrive;

commit;
