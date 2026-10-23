-- Local AW4 extension. Original allocations and collections remain immutable.
begin;
insert into app.permissions(code,description) values
 ('funds.reverse','Reverse a complete original wholesale fund allocation') on conflict do nothing;

create table app.wholesale_fund_reversals (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, payment_id uuid not null,
 capital_amount numeric(18,2) not null check(capital_amount>=0),
 operating_amount numeric(18,2) not null check(operating_amount>=0),
 reason text not null check(length(btrim(reason)) between 3 and 240),
 request_body jsonb not null, recorded_by uuid not null, recorded_at timestamptz not null,
 unique(tenant_id,id), unique(tenant_id,payment_id), check(capital_amount+operating_amount>0),
 foreign key(tenant_id,payment_id) references app.wholesale_fund_allocations(tenant_id,payment_id) on delete restrict,
 foreign key(tenant_id,recorded_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_fund_reversals_actor_idx on app.wholesale_fund_reversals(tenant_id,recorded_by,recorded_at);
alter table app.wholesale_fund_reversals enable row level security;
revoke all on app.wholesale_fund_reversals from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_fund_reversals_immutable before update or delete on app.wholesale_fund_reversals
for each row execute function app.reject_fund_ledger_mutation();

create function app.wholesale_invoice_has_funded_receipts(p_tenant uuid,p_invoice uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.wholesale_payment_allocations a
 join app.wholesale_fund_allocations f on f.tenant_id=a.tenant_id and f.payment_id=a.payment_id
 where a.tenant_id=p_tenant and a.invoice_id=p_invoice and not exists(
 select 1 from app.wholesale_fund_reversals r where r.tenant_id=f.tenant_id and r.payment_id=f.payment_id));
$$;
revoke all on function app.wholesale_invoice_has_funded_receipts(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.reverse_wholesale_payment_funds(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payment uuid; v_customer uuid; v_location uuid; v_original app.wholesale_fund_allocations%rowtype;
 v_existing app.idempotency_records%rowtype; v_entry record; v_id uuid:=gen_random_uuid();
 v_time timestamptz; v_response jsonb; v_capital numeric; v_operating numeric; v_count integer; v_entry_ids uuid[];
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 perform app.lock_wholesale_fund_reversal_access(p_actor,p_tenant);
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCFD2',message='Invalid reversal'; end if;
 if not(p_payload ?& array['paymentId','reason','reversalConfirmed'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('paymentId','reason','reversalConfirmed'))
 or jsonb_typeof(p_payload->'paymentId') is distinct from 'string'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string'
 or length(btrim(p_payload->>'reason')) not between 3 and 240
 or p_payload->'reversalConfirmed' is distinct from 'true'::jsonb
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCFD2',message='Invalid reversal'; end if;
 begin v_payment:=(p_payload->>'paymentId')::uuid;
 exception when invalid_text_representation then raise exception using errcode='HCFD2',message='Invalid reversal'; end;
 select customer_id into v_customer from app.wholesale_payments where tenant_id=p_tenant and id=v_payment;
 if not found then raise exception using errcode='HCFD3',message='Receipt unavailable'; end if;
 -- All receipt, return and payout commands serialize around the same customer first.
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 perform 1 from app.wholesale_payments where tenant_id=p_tenant and id=v_payment for update;
 for v_location in select distinct i.location_id from app.wholesale_payment_allocations a
 join app.invoices i on i.tenant_id=a.tenant_id and i.id=a.invoice_id
 where a.tenant_id=p_tenant and a.payment_id=v_payment order by i.location_id loop
   perform app.lock_wholesale_return_location(p_actor,p_tenant,v_location);
 end loop;
 if not found then raise exception using errcode='HCFD3',message='Allocated invoice unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':wholesale.funds.reverse:'||p_key,0));
 perform app.lock_wholesale_fund_reversal_access(p_actor,p_tenant);
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='wholesale.funds.reverse' and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null or not exists(
     select 1 from app.wholesale_fund_reversals where tenant_id=p_tenant and id=(v_existing.response_body->>'reversalId')::uuid
     and payment_id=v_payment and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 select * into v_original from app.wholesale_fund_allocations where tenant_id=p_tenant and payment_id=v_payment;
 if not found then raise exception using errcode='HCFD3',message='Original allocation unavailable'; end if;
 if exists(select 1 from app.wholesale_fund_reversals where tenant_id=p_tenant and payment_id=v_payment)
 then raise exception using errcode='HCFD6',message='Allocation already reversed'; end if;
 -- Lock fund accounts in stable order before reading balances or appending debits.
 perform 1 from app.fund_accounts where tenant_id=p_tenant order by id for update;
 if exists(select 1 from app.fund_ledger_entries e where e.tenant_id=p_tenant and e.source_type='wholesale_payment' and e.source_id=v_payment
 and (e.entry_type<>'allocation' or e.amount<=0 or exists(select 1 from app.fund_ledger_entries r where r.tenant_id=e.tenant_id and r.reversal_of=e.id)))
 then raise exception using errcode='HCFD8',message='Original fund ledger requires reconciliation'; end if;
 select coalesce(sum(e.amount) filter(where f.fund_type='capital_cogs'),0),
 coalesce(sum(e.amount) filter(where f.fund_type='operating'),0),count(*),array_agg(e.id order by e.id) into v_capital,v_operating,v_count,v_entry_ids
 from app.fund_ledger_entries e join app.fund_accounts f on f.tenant_id=e.tenant_id and f.id=e.fund_account_id
 where e.tenant_id=p_tenant and e.source_type='wholesale_payment' and e.source_id=v_payment
 and e.entry_type='allocation' and e.amount>0
 and not exists(select 1 from app.fund_ledger_entries r where r.tenant_id=e.tenant_id and r.reversal_of=e.id);
 if v_capital<>v_original.capital_amount or v_operating<>v_original.operating_amount
 or v_count<>((v_original.capital_amount>0)::integer+(v_original.operating_amount>0)::integer)
 or exists(select 1 from app.fund_ledger_entries e join app.fund_accounts f on f.tenant_id=e.tenant_id and f.id=e.fund_account_id
 where e.tenant_id=p_tenant and e.id=any(v_entry_ids) and f.status<>'active')
 then raise exception using errcode='HCFD8',message='Original fund ledger requires reconciliation'; end if;
 for v_entry in select e.* from app.fund_ledger_entries e where e.tenant_id=p_tenant
 and e.id=any(v_entry_ids) order by e.fund_account_id loop
   if (select coalesce(sum(amount),0) from app.fund_ledger_entries where tenant_id=p_tenant and fund_account_id=v_entry.fund_account_id)<v_entry.amount
   then raise exception using errcode='HCFD7',message='Original fund balance is insufficient'; end if;
 end loop;
 perform app.lock_wholesale_fund_reversal_access(p_actor,p_tenant);
 v_time:=clock_timestamp();
 insert into app.wholesale_fund_reversals(id,tenant_id,payment_id,capital_amount,operating_amount,reason,request_body,recorded_by,recorded_at)
 values(v_id,p_tenant,v_payment,v_original.capital_amount,v_original.operating_amount,btrim(p_payload->>'reason'),p_payload,p_actor,v_time);
 insert into app.fund_ledger_entries(tenant_id,fund_account_id,entry_type,amount,source_type,source_id,reason,actor_user_id,reversal_of,occurred_at,created_at)
 select p_tenant,e.fund_account_id,'reversal',-e.amount,'wholesale_fund_reversal',v_id,btrim(p_payload->>'reason'),p_actor,e.id,v_time,v_time
 from app.fund_ledger_entries e where e.tenant_id=p_tenant and e.id=any(v_entry_ids);
 v_response:=jsonb_build_object('reversalId',v_id,'paymentId',v_payment,'capitalMinor',(v_original.capital_amount*100)::bigint,
 'operatingMinor',(v_original.operating_amount*100)::bigint,'recordedAt',v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_funds.reversed','wholesale_fund_reversal',v_id,btrim(p_payload->>'reason'),v_response,v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at)
 values(p_tenant,'wholesale_funds.reversed','wholesale_fund_reversal',v_id,v_response,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'wholesale.funds.reverse',p_key,p_hash,201,v_response,v_time,v_time+interval '24 hours');
 return v_response;
end;
$$;
revoke all on function app.reverse_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.reverse_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;

alter function app.load_wholesale_funds(uuid,uuid) rename to wholesale_funds_before_reversals;
revoke all on function app.wholesale_funds_before_reversals(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.load_wholesale_funds(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_payments jsonb; v_can_reverse boolean;
begin
 v_result:=app.wholesale_funds_before_reversals(p_actor,p_tenant);
 select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active'
 and(m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
 where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='funds.reverse'))) into v_can_reverse;
 select coalesce(jsonb_agg(item.value||jsonb_build_object('reversal',case when r.id is null then null else
 jsonb_build_object('reversalId',r.id,'paymentId',r.payment_id,'capitalMinor',(r.capital_amount*100)::bigint,
 'operatingMinor',(r.operating_amount*100)::bigint,'recordedAt',r.recorded_at) end) order by item.ordinality),'[]'::jsonb)
 into v_payments from jsonb_array_elements(v_result->'payments') with ordinality item(value,ordinality)
 left join app.wholesale_fund_reversals r on r.tenant_id=p_tenant and r.payment_id=(item.value->>'paymentId')::uuid;
 return v_result||jsonb_build_object('canReverse',v_can_reverse,'payments',v_payments);
end;
$$;
revoke all on function app.load_wholesale_funds(uuid,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_funds(uuid,uuid) to hcs_hyperdrive;

create function app.lock_wholesale_fund_reversal_access(p_actor uuid,p_tenant uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean; v_permission text; p_permission text:='funds.reverse'; v_entitlement app.tenant_entitlements%rowtype;
 v_denial text:=case when p_permission='wholesale_returns.post' then 'Return access denied' else 'Credit action access denied' end;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCFD1',message=v_denial; end if;
 perform 1 from app.features where code='advanced_wholesale' and platform_available for share;
 if not found then raise exception using errcode='HCSQ0',message='Advanced wholesale is not enabled'; end if;
 select * into v_entitlement from app.tenant_entitlements where tenant_id=p_tenant and feature_code='advanced_wholesale' for share;
 if not found or not v_entitlement.entitled or not v_entitlement.enabled
 or (v_entitlement.starts_at is not null and v_entitlement.starts_at>clock_timestamp())
 or (v_entitlement.ends_at is not null and v_entitlement.ends_at<=clock_timestamp())
 then raise exception using errcode='HCSQ0',message='Advanced wholesale is not enabled'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception using errcode='HCAR1',message='Wholesale receivable access denied'; end if;
 if p_permission is null or p_permission not in ('funds.reverse')
 then raise exception using errcode='HCFD1',message=v_denial; end if;
 if not v_owner then
   for v_permission in select unnest(array['wholesale_orders.read',p_permission]) order by 1 loop
     perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
     where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code=v_permission
     order by mr.role_id for share of mr,rp;
     if not found then
       if v_permission='wholesale_orders.read' then raise exception using errcode='HCAR1',message='Wholesale receivable access denied'; end if;
       raise exception using errcode='HCFD1',message=v_denial;
     end if;
   end loop;
 end if;
end;
$$;

revoke all on function app.lock_wholesale_fund_reversal_access(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create or replace function app.command_wholesale_credit(p_actor uuid,p_tenant uuid,p_operation text,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_note app.wholesale_credit_notes%rowtype; v_source app.invoices%rowtype; v_target app.invoices%rowtype;
 v_existing app.idempotency_records%rowtype; v_method app.payment_methods%rowtype; v_session app.register_sessions%rowtype;
 v_amount numeric; v_id uuid:=gen_random_uuid(); v_response jsonb; v_operation text; v_customer uuid; v_note_id uuid; v_target_id uuid; v_method_id uuid; v_session_id uuid;
 v_permission text; v_effective_at timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if p_operation is null or p_operation not in ('apply','refund') then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 v_operation:='wholesale_credit.'||p_operation;
 v_permission:=case when p_operation='apply' then 'wholesale_credits.apply' else 'wholesale_credits.refund' end;
 perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 if not(p_payload ?& array['creditNoteId','amountMinor','reason'])
 or jsonb_typeof(p_payload->'creditNoteId') is distinct from 'string' or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 if p_operation='apply' and (not(p_payload ? 'invoiceId') or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('creditNoteId','invoiceId','amountMinor','reason')))
 then raise exception using errcode='HCWR1',message='Invalid credit application'; end if;
 if p_operation='refund' and (not(p_payload ?& array['paymentMethodId','registerSessionId','referenceLastFour','payoutConfirmed'])
 or jsonb_typeof(p_payload->'paymentMethodId') is distinct from 'string' or p_payload->'payoutConfirmed' is distinct from 'true'::jsonb
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('creditNoteId','paymentMethodId','registerSessionId','referenceLastFour','payoutConfirmed','amountMinor','reason')))
 then raise exception using errcode='HCWR1',message='Invalid confirmed refund'; end if;
 begin
 v_note_id:=(p_payload->>'creditNoteId')::uuid; v_amount:=(p_payload->>'amountMinor')::numeric;
 v_target_id:=(p_payload->>'invoiceId')::uuid; v_method_id:=(p_payload->>'paymentMethodId')::uuid; v_session_id:=(p_payload->>'registerSessionId')::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCWR1',message='Invalid credit action'; end;
 if v_amount<=0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception using errcode='HCWR1',message='Invalid credit amount'; end if;
 v_amount:=v_amount/100;
 select customer_id into v_customer from app.wholesale_credit_notes where tenant_id=p_tenant and id=v_note_id;
 if not found then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 select * into v_note from app.wholesale_credit_notes where tenant_id=p_tenant and id=v_note_id;
 select * into v_source from app.invoices where tenant_id=p_tenant and id=v_note.invoice_id;
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_source.location_id) then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 perform app.lock_wholesale_return_location(p_actor,p_tenant,v_source.location_id);
 if p_operation='apply' then
   select * into v_target from app.invoices where tenant_id=p_tenant and id=v_target_id and customer_id=v_customer and location_id=v_source.location_id for update;
   if not found or not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_target.location_id) then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||v_operation||':'||p_key,0));
 perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation=v_operation and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   if p_operation='apply' and not exists(select 1 from app.wholesale_credit_applications where tenant_id=p_tenant and id=(v_existing.response_body->>'applicationId')::uuid and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   if p_operation='refund' and not exists(select 1 from app.wholesale_credit_payouts where tenant_id=p_tenant and id=(v_existing.response_body->>'payoutId')::uuid and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 if v_amount>app.wholesale_credit_available(p_tenant,v_note.id) then raise exception using errcode='HCWR4',message='Credit exceeds available balance'; end if;
 if p_operation='apply' then
   if app.wholesale_invoice_open_balance(p_tenant,v_target.id) is null or v_amount>app.wholesale_invoice_open_balance(p_tenant,v_target.id)
   then raise exception using errcode='HCWR4',message='Credit exceeds open invoice balance'; end if;
   perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
   v_effective_at:=clock_timestamp();
   insert into app.wholesale_credit_applications(id,tenant_id,credit_note_id,invoice_id,amount,request_body,recorded_by,recorded_at)
   values(v_id,p_tenant,v_note.id,v_target.id,v_amount,p_payload,p_actor,v_effective_at);
   v_response:=jsonb_build_object('applicationId',v_id,'creditNoteId',v_note.id,'invoiceId',v_target.id,'amountMinor',(v_amount*100)::bigint);
 else
   -- Allocated receipts require a separate approved, audited fund-reversal workflow.
   if app.wholesale_invoice_has_funded_receipts(p_tenant,v_source.id)
   then raise exception using errcode='HCWR5',message='Funded receipt requires audited reversal before payout'; end if;
   select * into v_method from app.payment_methods where tenant_id=p_tenant and id=v_method_id and is_active for share;
   -- These availability denials happen only after the original-key replay check.
   if not found or v_method.method_type not in ('cash','e_wallet','bank_transfer') then raise exception using errcode='HCWR6',message='Refund method unavailable'; end if;
   if v_amount+coalesce((select sum(p.amount) from app.wholesale_credit_payouts p join app.wholesale_credit_notes n on n.tenant_id=p.tenant_id and n.id=p.credit_note_id where p.tenant_id=p_tenant and n.invoice_id=v_source.id and p.payment_method_id=v_method.id),0)
     >coalesce((select sum(a.amount) from app.wholesale_payment_allocations a join app.wholesale_payments p on p.tenant_id=a.tenant_id and p.id=a.payment_id where a.tenant_id=p_tenant and a.invoice_id=v_source.id and p.payment_method_id=v_method.id),0)
   then raise exception using errcode='HCWR4',message='Refund exceeds original method collection'; end if;
   if v_method.method_type='cash' then
     if v_session_id is null or p_payload->'referenceLastFour' is distinct from 'null'::jsonb then raise exception using errcode='HCWR1',message='Cash refund requires a register session and no external reference'; end if;
     select * into v_session from app.register_sessions where tenant_id=p_tenant and id=v_session_id and location_id=v_source.location_id and status='open' for update;
     if not found or not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active' and(m.is_owner or (
       exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='registers.operate')
       and exists(select 1 from app.employees e where e.tenant_id=p_tenant and e.id=v_session.employee_id and e.user_id=p_actor and e.status='active'))))
     then raise exception using errcode='HCWR6',message='Authorized open cash session required'; end if;
     if coalesce((select sum(amount) from app.cash_movements where tenant_id=p_tenant and register_session_id=v_session.id),0)<v_amount
     then raise exception using errcode='HCWR4',message='Register cash is insufficient'; end if;
   else
     if p_payload->'registerSessionId' is distinct from 'null'::jsonb or jsonb_typeof(p_payload->'referenceLastFour') is distinct from 'string' or (p_payload->>'referenceLastFour') !~ '^[0-9]{4}$'
     then raise exception using errcode='HCWR1',message='External refund requires exactly four reference digits'; end if;
   end if;
   perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
   v_effective_at:=clock_timestamp();
   insert into app.wholesale_credit_payouts(id,tenant_id,credit_note_id,payment_method_id,register_session_id,amount,reference_last_four,request_body,recorded_by,recorded_at)
   values(v_id,p_tenant,v_note.id,v_method.id,v_session_id,v_amount,p_payload->>'referenceLastFour',p_payload,p_actor,v_effective_at);
   if v_method.method_type='cash' then
     insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,reason,actor_user_id,occurred_at)
     values(p_tenant,v_session.id,v_source.location_id,'cash_refund',-v_amount,'wholesale_credit_payout',v_id,btrim(p_payload->>'reason'),p_actor,v_effective_at);
   end if;
   v_response:=jsonb_build_object('payoutId',v_id,'creditNoteId',v_note.id,'paymentMethodId',v_method.id,'registerSessionId',v_session_id,'amountMinor',(v_amount*100)::bigint,'referenceLastFour',p_payload->>'referenceLastFour');
 end if;
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,v_operation,'wholesale_credit',v_id,v_source.location_id,btrim(p_payload->>'reason'),v_response,v_effective_at);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,v_operation,'wholesale_credit',v_id,v_response,v_effective_at,v_effective_at);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,v_operation,p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
end;
$$;

create or replace function app.load_wholesale_returns(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_post boolean; v_apply boolean; v_refund boolean;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_returns.post'),
 m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_credits.apply'),
 m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_credits.refund')
 into v_post,v_apply,v_refund from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active';
 return jsonb_build_object('canPost',coalesce(v_post,false),'canApply',coalesce(v_apply,false),'canRefund',coalesce(v_refund,false),
 'invoices',(select coalesce(jsonb_agg(jsonb_build_object('invoiceId',i.id,'invoiceNumber',i.invoice_number::text,'customerId',i.customer_id,'customerName',i.customer_name_snapshot,'locationId',i.location_id,'locationName',i.location_name_snapshot,
 'totalMinor',(i.total*100)::bigint,'creditedMinor',(coalesce((select sum(amount) from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=i.id),0)*100)::bigint,'settledMinor',((coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=i.id),0)+coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=i.id),0))*100)::bigint,'openDebtMinor',(app.wholesale_invoice_open_balance(p_tenant,i.id)*100)::bigint,'valuationSupported',i.discount_total=0 and i.tax_total=0,
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('invoiceLineId',l.id,'name',l.product_name||' / '||l.variant_name,'quantityMilli',(l.quantity*1000)::bigint,'returnedQuantityMilli',(coalesce((select sum(quantity) from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=l.id),0)*1000)::bigint,'unitPriceMinor',(l.unit_price*100)::bigint,'originalTotalMinor',(l.line_total*100)::bigint,'priorCreditMinor',(coalesce((select sum(amount) from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=l.id),0)*100)::bigint) order by l.id),'[]'::jsonb) from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=i.id)) order by i.issued_at desc,i.id),'[]'::jsonb) from app.invoices i where i.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'notes',(select coalesce(jsonb_agg(jsonb_build_object(
   'creditNoteId',n.id,'invoiceId',n.invoice_id,'refundId',n.refund_id,
   'customerId',n.customer_id,'locationId',i.location_id,'reason',n.reason,
   'amountMinor',(n.amount*100)::bigint,'debtReductionMinor',(n.debt_reduction*100)::bigint,
   'issuedCreditMinor',(n.customer_credit*100)::bigint,
   'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=n.tenant_id and k.operation='wholesale_return.post' and k.response_body->>'creditNoteId'=n.id::text),
   'payoutBlocked',app.wholesale_invoice_has_funded_receipts(n.tenant_id,n.invoice_id),
   'availableCreditMinor',(app.wholesale_credit_available(p_tenant,n.id)*100)::bigint,'recordedAt',n.recorded_at,
   'lines',(select coalesce(jsonb_agg(jsonb_build_object(
     'invoiceLineId',line.invoice_line_id,'name',original.product_name||' / '||original.variant_name,
     'quantityMilli',(line.quantity*1000)::bigint,'amountMinor',(line.amount*100)::bigint,
     'returnToStock',line.return_to_stock) order by line.invoice_line_id),'[]'::jsonb)
     from app.wholesale_credit_note_lines line join app.invoice_lines original
       on original.tenant_id=line.tenant_id and original.id=line.invoice_line_id and original.invoice_id=n.invoice_id
     where line.tenant_id=n.tenant_id and line.credit_note_id=n.id)
 ) order by n.recorded_at desc,n.id),'[]'::jsonb)
 from app.wholesale_credit_notes n join app.invoices i on i.tenant_id=n.tenant_id and i.id=n.invoice_id
 where n.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'applications',(select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=a.tenant_id and k.operation='wholesale_credit.apply' and k.response_body->>'applicationId'=a.id::text),'creditNoteId',a.credit_note_id,'invoiceId',a.invoice_id,'amountMinor',(a.amount*100)::bigint) order by a.recorded_at,a.id),'[]'::jsonb) from app.wholesale_credit_applications a join app.invoices i on i.tenant_id=a.tenant_id and i.id=a.invoice_id where a.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'payouts',(select coalesce(jsonb_agg(jsonb_build_object('payoutId',p.id,'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=p.tenant_id and k.operation='wholesale_credit.refund' and k.response_body->>'payoutId'=p.id::text),'creditNoteId',p.credit_note_id,'paymentMethodId',p.payment_method_id,'registerSessionId',p.register_session_id,'amountMinor',(p.amount*100)::bigint,'referenceLastFour',p.reference_last_four) order by p.recorded_at,p.id),'[]'::jsonb) from app.wholesale_credit_payouts p join app.wholesale_credit_notes n on n.tenant_id=p.tenant_id and n.id=p.credit_note_id join app.invoices i on i.tenant_id=n.tenant_id and i.id=n.invoice_id where p.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'methods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',method_type) order by name,id),'[]'::jsonb) from app.payment_methods where tenant_id=p_tenant and is_active and method_type in ('cash','e_wallet','bank_transfer') and v_refund),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'locationId',s.location_id,'name',r.name) order by r.name,s.id),'[]'::jsonb) from app.register_sessions s join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id where s.tenant_id=p_tenant and s.status='open' and v_refund and app.can_record_wholesale_payment_at_location(p_actor,p_tenant,s.location_id)));
end;
$$;
commit;
