begin;
create table app.wholesale_fund_allocations (
 tenant_id uuid not null, payment_id uuid not null, capital_amount numeric(18,2) not null check(capital_amount>=0),
 operating_amount numeric(18,2) not null check(operating_amount>=0),
 settlement_reference text not null check(length(btrim(settlement_reference)) between 3 and 100),
 reason text not null check(length(btrim(reason)) between 3 and 240), confirmed_by uuid not null,
 recorded_at timestamptz not null default clock_timestamp(), primary key(tenant_id,payment_id),
 check(capital_amount+operating_amount>0),
 foreign key(tenant_id,payment_id) references app.wholesale_payments(tenant_id,id) on delete restrict,
 foreign key(tenant_id,confirmed_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_fund_allocations_actor_idx on app.wholesale_fund_allocations(tenant_id,confirmed_by);
alter table app.wholesale_fund_allocations enable row level security;
revoke all on app.wholesale_fund_allocations from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_fund_allocations_immutable before update or delete on app.wholesale_fund_allocations
 for each row execute function app.reject_fund_ledger_mutation();

create function app.has_wholesale_fund_access(p_actor uuid,p_tenant uuid,p_manage boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.tenant_memberships m join app.tenants t on t.id=m.tenant_id
 where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active' and t.status='active'
 and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp
 on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor
 and rp.permission_code=case when p_manage then 'funds.manage' else 'funds.read' end)));
$$;
revoke all on function app.has_wholesale_fund_access(uuid,uuid,boolean) from public,anon,authenticated,hcs_hyperdrive;

create function app.allocate_wholesale_payment_funds(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payment uuid; v_capital numeric; v_operating numeric; v_receipt app.wholesale_payments%rowtype;
 v_existing app.idempotency_records%rowtype; v_capital_id uuid; v_operating_id uuid; v_response jsonb; v_time timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if not app.has_wholesale_fund_access(p_actor,p_tenant,true) then raise exception using errcode='HCFD1',message='Fund permission required'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCFD2',message='Invalid fund allocation'; end if;
 if not(p_payload ?& array['paymentId','capitalMinor','operatingMinor','settledConfirmed','settlementReference','reason'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('paymentId','capitalMinor','operatingMinor','settledConfirmed','settlementReference','reason'))
 or p_payload->'settledConfirmed' is distinct from 'true'::jsonb
 or jsonb_typeof(p_payload->'capitalMinor') is distinct from 'number' or jsonb_typeof(p_payload->'operatingMinor') is distinct from 'number'
 or jsonb_typeof(p_payload->'settlementReference') is distinct from 'string' or length(btrim(p_payload->>'settlementReference')) not between 3 and 100
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or jsonb_typeof(p_payload->'paymentId') is distinct from 'string'
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCFD2',message='Invalid fund allocation'; end if;
 begin v_payment:=(p_payload->>'paymentId')::uuid; v_capital:=(p_payload->>'capitalMinor')::numeric; v_operating:=(p_payload->>'operatingMinor')::numeric;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCFD2',message='Invalid fund allocation'; end;
 if v_capital<0 or v_operating<0 or trunc(v_capital)<>v_capital or trunc(v_operating)<>v_operating
 or v_capital+v_operating<=0 or v_capital+v_operating>9007199254740991 then raise exception using errcode='HCFD2',message='Invalid fund allocation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':wholesale.funds:'||p_key,0));
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if not app.has_wholesale_fund_access(p_actor,p_tenant,true) then raise exception using errcode='HCFD1',message='Fund permission required'; end if;
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='wholesale.funds' and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
   if v_existing.completed_at is not null then return v_existing.response_body; end if;
 else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at)
 values(p_tenant,'wholesale.funds',p_key,p_hash,now()+interval '24 hours'); end if;
 select * into v_receipt from app.wholesale_payments where tenant_id=p_tenant and id=v_payment for update;
 if not found then raise exception using errcode='HCFD3',message='Receipt not found'; end if;
 if exists(select 1 from app.wholesale_fund_allocations where tenant_id=p_tenant and payment_id=v_payment)
 then raise exception using errcode='HCFD4',message='Receipt already allocated'; end if;
 if (v_capital+v_operating)/100<>v_receipt.amount then raise exception using errcode='HCFD2',message='Invalid fund allocation'; end if;
 perform 1 from app.fund_accounts where tenant_id=p_tenant order by id for share;
 select id into v_capital_id from app.fund_accounts where tenant_id=p_tenant and fund_type='capital_cogs' and status='active';
 select id into v_operating_id from app.fund_accounts where tenant_id=p_tenant and fund_type='operating' and status='active';
 if v_capital_id is null or v_operating_id is null then raise exception using errcode='HCFD5',message='Basic funds required'; end if;
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if not app.has_wholesale_fund_access(p_actor,p_tenant,true) then raise exception using errcode='HCFD1',message='Fund permission required'; end if;
 insert into app.wholesale_fund_allocations(tenant_id,payment_id,capital_amount,operating_amount,settlement_reference,reason,confirmed_by)
 values(p_tenant,v_payment,v_capital/100,v_operating/100,btrim(p_payload->>'settlementReference'),btrim(p_payload->>'reason'),p_actor) returning recorded_at into v_time;
 insert into app.fund_ledger_entries(tenant_id,fund_account_id,entry_type,amount,source_type,source_id,reason,actor_user_id,occurred_at)
 select p_tenant,fund_id,'allocation',amount/100,'wholesale_payment',v_payment,btrim(p_payload->>'reason'),p_actor,v_time
 from (values(v_capital_id,v_capital),(v_operating_id,v_operating)) split(fund_id,amount) where amount>0;
 v_response:=jsonb_build_object('paymentId',v_payment,'capitalMinor',v_capital::bigint,'operatingMinor',v_operating::bigint,'recordedAt',v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_funds.allocated','wholesale_payment',v_payment,v_response);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'wholesale_funds.allocated','wholesale_payment',v_payment,v_response);
 update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now()
 where tenant_id=p_tenant and operation='wholesale.funds' and idempotency_key=p_key;
 return v_response;
end;
$$;
create function app.load_wholesale_funds(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if not app.has_wholesale_fund_access(p_actor,p_tenant,false) then raise exception using errcode='HCFD1',message='Fund permission required'; end if;
 return jsonb_build_object('canManage',app.has_wholesale_fund_access(p_actor,p_tenant,true),
 'funds',(select coalesce(jsonb_agg(jsonb_build_object('fundType',f.fund_type,'name',f.name,'balanceMinor',
   (coalesce((select sum(amount) from app.fund_ledger_entries where tenant_id=p_tenant and fund_account_id=f.id),0)*100)::bigint) order by f.fund_type),'[]'::jsonb) from app.fund_accounts f where f.tenant_id=p_tenant and f.status='active'),
 'payments',(select coalesce(jsonb_agg(jsonb_build_object('paymentId',p.id,'reference',p.reference,'amountMinor',(p.amount*100)::bigint,
 'allocation',case when a.payment_id is null then null else jsonb_build_object('paymentId',a.payment_id,'capitalMinor',(a.capital_amount*100)::bigint,'operatingMinor',(a.operating_amount*100)::bigint,'recordedAt',a.recorded_at) end) order by p.recorded_at desc,p.id),'[]'::jsonb)
 from app.wholesale_payments p left join app.wholesale_fund_allocations a on a.tenant_id=p.tenant_id and a.payment_id=p.id where p.tenant_id=p_tenant));
end;
$$;
revoke all on function app.allocate_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text),app.load_wholesale_funds(uuid,uuid) from public,anon,authenticated;
grant execute on function app.allocate_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text),app.load_wholesale_funds(uuid,uuid) to hcs_hyperdrive;
commit;
