begin;

create table app.pos_payment_references (
  tenant_id uuid not null,
  sale_payment_id uuid not null,
  reference_last_four text not null check (reference_last_four ~ '^[0-9]{4}$'),
  method_name_snapshot text not null,
  method_type_snapshot text not null check (method_type_snapshot in ('e_wallet','bank_transfer')),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, sale_payment_id),
  foreign key (tenant_id, sale_payment_id) references app.sale_payments(tenant_id,id) on delete restrict
);
alter table app.pos_payment_references enable row level security;
revoke all on app.pos_payment_references from public,anon,authenticated,hcs_hyperdrive;
create trigger pos_payment_references_immutable before update or delete on app.pos_payment_references
for each row execute function app.reject_invoice_mutation();

alter function app.complete_pos_priced_sale(text,jsonb,jsonb,uuid,text,text,text,text)
rename to complete_pos_priced_sale_reference_core;
revoke all on function app.complete_pos_priced_sale_reference_core(text,jsonb,jsonb,uuid,text,text,text,text)
from public,anon,authenticated,hcs_hyperdrive;

create function app.complete_pos_priced_sale(
 p_session_token_hash text,p_lines jsonb,p_payments jsonb,p_customer_id uuid,p_pricing_type text,
 p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tenant uuid; v_replay boolean; v_response jsonb; v_payment jsonb; v_method app.payment_methods%rowtype;
begin
 select session.tenant_id into v_tenant from app.pos_employee_sessions session
 join app.pos_devices device on device.tenant_id=session.tenant_id and device.id=session.device_id and device.status='active'
 where session.token_hash=p_session_token_hash and session.revoked_at is null and session.expires_at>now();
 if v_tenant is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':pos-sale.complete:'||p_idempotency_key,0));
 select exists(select 1 from app.idempotency_records where tenant_id=v_tenant and operation='pos-sale.complete'
  and idempotency_key=p_idempotency_key and completed_at is not null) into v_replay;
 if not v_replay then
  if jsonb_typeof(p_payments) is distinct from 'array' then
   raise exception using errcode='HCS94',message='Sale payments are invalid';
  end if;
  for v_payment in select value from jsonb_array_elements(p_payments) loop
   select * into v_method from app.payment_methods
    where tenant_id=v_tenant and id::text=v_payment->>'paymentMethodId' and is_active for share;
   if v_method.method_type in ('e_wallet','bank_transfer') and
    (jsonb_typeof(v_payment->'referenceLastFour') is distinct from 'string' or
     coalesce(v_payment->>'referenceLastFour','') !~ '^[0-9]{4}$') then
    raise exception using errcode='HCS94',message='Enter exactly four transaction reference digits for online payments';
   end if;
  end loop;
 end if;
 -- Core retains session/device/permission checks and validates original hash on every replay.
 v_response:=app.complete_pos_priced_sale_reference_core(p_session_token_hash,p_lines,p_payments,p_customer_id,
  p_pricing_type,p_idempotency_key,p_request_hash,p_request_id);
 if not v_replay then
  insert into app.pos_payment_references(tenant_id,sale_payment_id,reference_last_four,method_name_snapshot,method_type_snapshot)
  select p.tenant_id,p.id,entry.value->>'referenceLastFour',method.name,method.method_type
  from app.sale_payments p
  join app.payment_methods method on method.tenant_id=p.tenant_id and method.id=p.payment_method_id
  join jsonb_array_elements(p_payments) entry on entry.value->>'paymentMethodId'=p.payment_method_id::text
  where p.tenant_id=v_tenant and p.sale_id=(v_response->>'saleId')::uuid
   and method.method_type in ('e_wallet','bank_transfer');
 end if;
 return v_response;
end;
$$;
revoke all on function app.complete_pos_priced_sale(text,jsonb,jsonb,uuid,text,text,text,text)
from public,anon,authenticated;
grant execute on function app.complete_pos_priced_sale(text,jsonb,jsonb,uuid,text,text,text,text) to hcs_hyperdrive;

create function app.load_pos_payment_reference_report(p_actor uuid,p_tenant uuid,p_from date,p_to date,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_timezone text; v_rows jsonb;
begin
 if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor
  and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr
   join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='reports.read'))) then
  raise exception using errcode='HCSD0',message='Reporting access is not allowed';
 end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then
  raise exception using errcode='HCSD1',message='Choose a report range of at most 32 days';
 end if;
 if p_location is not null and not app.can_read_wholesale_location(p_actor,p_tenant,p_location) then
  raise exception using errcode='HCSD0',message='Reporting location is not allowed';
 end if;
 select timezone into v_timezone from app.tenants where id=p_tenant;
 select coalesce(jsonb_agg(jsonb_build_object(
  'paymentId',p.id,'saleId',s.id,'receiptNumber',s.receipt_number,'completedAt',s.completed_at,
  'locationId',l.id,'locationName',l.name,'cashierName',e.display_name,'customerName',c.full_name,
  'paymentMethodId',method.id,'methodName',coalesce(ref.method_name_snapshot,method.name),
  'methodType',coalesce(ref.method_type_snapshot,method.method_type),'amountMinor',(p.amount*100)::bigint,
  'reversedMinor',(coalesce((select sum(r.amount) from app.payment_reversals r
    where r.tenant_id=p_tenant and r.sale_payment_id=p.id),0)*100)::bigint,
  'referenceLastFour',ref.reference_last_four
 ) order by s.completed_at desc,p.id),'[]'::jsonb) into v_rows
 from app.sale_payments p join app.sales s on s.tenant_id=p.tenant_id and s.id=p.sale_id
 join app.payment_methods method on method.tenant_id=p.tenant_id and method.id=p.payment_method_id
 join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id
 join app.employees e on e.tenant_id=s.tenant_id and e.id=s.employee_id
 left join app.customers c on c.tenant_id=s.tenant_id and c.id=s.customer_id
 left join app.pos_payment_references ref on ref.tenant_id=p.tenant_id and ref.sale_payment_id=p.id
 where p.tenant_id=p_tenant and s.channel='pos' and coalesce(ref.method_type_snapshot,method.method_type) in ('e_wallet','bank_transfer')
  and app.can_read_wholesale_location(p_actor,p_tenant,s.location_id)
  and (p_location is null or s.location_id=p_location)
  and s.completed_at>=(p_from::timestamp at time zone v_timezone)
  and s.completed_at<((p_to+1)::timestamp at time zone v_timezone);
 if jsonb_array_length(v_rows)>10000 then
  raise exception using errcode='HCSD1',message='Narrow the report date range';
 end if;
 return jsonb_build_object('timezone',v_timezone,'rows',v_rows,'locations',
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
  from app.locations where tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,id)),'[]'::jsonb));
end;
$$;
revoke all on function app.load_pos_payment_reference_report(uuid,uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function app.load_pos_payment_reference_report(uuid,uuid,date,date,uuid) to hcs_hyperdrive;
commit;
