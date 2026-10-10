-- Dedicated approvals only. Credit enforcement still fails closed until consumption is wired.
begin;
create table app.wholesale_credit_overrides (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  sales_order_id uuid not null, customer_id uuid not null,
  action text not null check(action in ('confirm','fulfill')),
  approved_excess numeric(18,2) not null check(approved_excess>0 and approved_excess<=90071992547409.91),
  expires_at timestamptz not null, reason text not null check(length(btrim(reason)) between 2 and 500),
  approved_by uuid not null, approved_at timestamptz not null default now(),
  unique(tenant_id,id), check(expires_at>approved_at),
  foreign key(tenant_id,sales_order_id) references app.sales_orders(tenant_id,id) on delete restrict,
  foreign key(tenant_id,customer_id) references app.customers(tenant_id,id) on delete restrict,
  foreign key(tenant_id,approved_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_credit_overrides_scope_idx on app.wholesale_credit_overrides(tenant_id,sales_order_id,action,expires_at);
create index wholesale_credit_overrides_customer_idx on app.wholesale_credit_overrides(tenant_id,customer_id);
create index wholesale_credit_overrides_actor_idx on app.wholesale_credit_overrides(tenant_id,approved_by);
create table app.wholesale_credit_override_revocations (
  tenant_id uuid not null, override_id uuid not null, revoked_by uuid not null,
  reason text not null check(length(btrim(reason)) between 2 and 500), revoked_at timestamptz not null default now(),
  primary key(tenant_id,override_id),
  foreign key(tenant_id,override_id) references app.wholesale_credit_overrides(tenant_id,id) on delete restrict,
  foreign key(tenant_id,revoked_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_credit_override_revocations_actor_idx on app.wholesale_credit_override_revocations(tenant_id,revoked_by);
alter table app.wholesale_credit_overrides enable row level security;
alter table app.wholesale_credit_override_revocations enable row level security;
revoke all on app.wholesale_credit_overrides,app.wholesale_credit_override_revocations from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_credit_overrides_immutable before update or delete on app.wholesale_credit_overrides for each row execute function app.reject_invoice_mutation();
create trigger wholesale_credit_override_revocations_immutable before update or delete on app.wholesale_credit_override_revocations for each row execute function app.reject_invoice_mutation();

create function app.can_approve_wholesale_credit(p_actor uuid,p_tenant uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app.tenant_memberships membership where membership.tenant_id=p_tenant and membership.user_id=p_actor and membership.status='active'
    and (membership.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
      where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='approvals.manage')));
$$;
revoke all on function app.can_approve_wholesale_credit(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.command_wholesale_credit_override(p_actor uuid,p_tenant uuid,p_operation text,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order app.sales_orders%rowtype; v_override app.wholesale_credit_overrides%rowtype;
  v_existing app.idempotency_records%rowtype; v_amount numeric; v_expiry timestamptz; v_id uuid; v_response jsonb; v_operation text;
begin
  perform app.assert_wholesale_order_credit_access(p_actor,p_tenant);
  if not app.can_approve_wholesale_credit(p_actor,p_tenant) then raise exception using errcode='HCCO1',message='Credit approval permission is required'; end if;
  if p_operation not in ('approve','revoke') or p_operation is null or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 2 and 500
    or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null then
    raise exception using errcode='HCCO2',message='Invalid credit approval command';
  end if;
  if p_operation='approve' then
    if not(p_payload ?& array['salesOrderId','action','approvedExcessMinor','expiresAt','reason'])
      or exists(select 1 from jsonb_object_keys(p_payload) key where key not in ('salesOrderId','action','approvedExcessMinor','expiresAt','reason'))
      or jsonb_typeof(p_payload->'salesOrderId') is distinct from 'string' or jsonb_typeof(p_payload->'approvedExcessMinor') is distinct from 'number'
      or coalesce(p_payload->>'action','') not in ('confirm','fulfill') or coalesce(p_payload->>'expiresAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode='HCCO2',message='Invalid credit approval command'; end if;
    begin
      v_id:=(p_payload->>'salesOrderId')::uuid; v_amount:=(p_payload->>'approvedExcessMinor')::numeric; v_expiry:=(p_payload->>'expiresAt')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode='HCCO2',message='Invalid credit approval command'; end;
    if v_amount<=0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception using errcode='HCCO2',message='Invalid credit approval command'; end if;
  else
    if not(p_payload ?& array['overrideId','reason']) or exists(select 1 from jsonb_object_keys(p_payload) key where key not in ('overrideId','reason'))
      or jsonb_typeof(p_payload->'overrideId') is distinct from 'string' then raise exception using errcode='HCCO2',message='Invalid credit approval command'; end if;
    begin v_id:=(p_payload->>'overrideId')::uuid;
    exception when invalid_text_representation then raise exception using errcode='HCCO2',message='Invalid credit approval command'; end;
  end if;
  v_operation:='wholesale_credit_override.'||p_operation;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':credit-override-key:'||p_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation=v_operation and idempotency_key=p_key;
  if found then
    if v_existing.request_hash<>p_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  if p_operation='approve' then
    if v_expiry<=clock_timestamp() then raise exception using errcode='HCCO5',message='Credit approval expiry must be in the future'; end if;
    select * into v_order from app.sales_orders where tenant_id=p_tenant and id=v_id for update;
    if not found then raise exception using errcode='HCCO3',message='Credit approval scope not found'; end if;
    if (p_payload->>'action'='confirm' and v_order.status<>'draft') or (p_payload->>'action'='fulfill' and v_order.status not in ('confirmed','partially_fulfilled')) then
      raise exception using errcode='HCCO4',message='Credit approval scope is unavailable'; end if;
    perform 1 from app.customers where tenant_id=p_tenant and id=v_order.customer_id and status='active' and customer_type='reseller' for update;
    if not found then raise exception using errcode='HCCO3',message='Credit approval scope not found'; end if;
    if v_expiry<=clock_timestamp() then raise exception using errcode='HCCO5',message='Credit approval expiry must be in the future'; end if;
    insert into app.wholesale_credit_overrides(tenant_id,sales_order_id,customer_id,action,approved_excess,expires_at,reason,approved_by)
      values(p_tenant,v_order.id,v_order.customer_id,p_payload->>'action',v_amount/100,v_expiry,btrim(p_payload->>'reason'),p_actor) returning * into v_override;
  else
    select * into v_override from app.wholesale_credit_overrides where tenant_id=p_tenant and id=v_id;
    if not found then raise exception using errcode='HCCO3',message='Credit approval scope not found'; end if;
    perform 1 from app.sales_orders where tenant_id=p_tenant and id=v_override.sales_order_id for update;
    perform 1 from app.customers where tenant_id=p_tenant and id=v_override.customer_id for update;
    if exists(select 1 from app.wholesale_credit_override_revocations where tenant_id=p_tenant and override_id=v_id) then
      raise exception using errcode='HCCO4',message='Credit approval scope is unavailable'; end if;
    insert into app.wholesale_credit_override_revocations(tenant_id,override_id,revoked_by,reason) values(p_tenant,v_id,p_actor,btrim(p_payload->>'reason'));
  end if;
  v_response:=jsonb_build_object('overrideId',v_override.id,'status',case p_operation when 'approve' then 'approved' else 'revoked' end);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
    values(p_tenant,p_request_id,'tenant_user',p_actor,v_operation,'wholesale_credit_override',v_override.id,btrim(p_payload->>'reason'),
      v_response||jsonb_build_object('salesOrderId',v_override.sales_order_id,'action',v_override.action,'approvedExcessMinor',(v_override.approved_excess*100)::bigint,'expiresAt',v_override.expires_at));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant,v_operation,'wholesale_credit_override',v_override.id,v_response);
  insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
    values(p_tenant,v_operation,p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
  return v_response;
end;
$$;
create function app.load_wholesale_credit_overrides(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_response jsonb;
begin
  perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
  select jsonb_build_object('canApprove',app.can_approve_wholesale_credit(p_actor,p_tenant) and app.can_manage_wholesale_credit_settings(p_actor,p_tenant),
    'overrides',coalesce(jsonb_agg(jsonb_build_object('overrideId',approval.id,'salesOrderId',approval.sales_order_id,'customerId',approval.customer_id,
      'action',approval.action,'approvedExcessMinor',(approval.approved_excess*100)::bigint,'expiresAt',approval.expires_at,'reason',approval.reason,
      'approvedBy',approval.approved_by,'approvedAt',approval.approved_at,'revokedBy',revocation.revoked_by,'revokedAt',revocation.revoked_at,'revokeReason',revocation.reason)
      order by approval.approved_at desc,approval.id),'[]'::jsonb)) into v_response
    from app.wholesale_credit_overrides approval left join app.wholesale_credit_override_revocations revocation on revocation.tenant_id=approval.tenant_id and revocation.override_id=approval.id
    where approval.tenant_id=p_tenant;
  return v_response;
end;
$$;
revoke all on function app.command_wholesale_credit_override(uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function app.load_wholesale_credit_overrides(uuid,uuid) from public,anon,authenticated;
grant execute on function app.command_wholesale_credit_override(uuid,uuid,text,jsonb,text,text,text) to hcs_hyperdrive;
grant execute on function app.load_wholesale_credit_overrides(uuid,uuid) to hcs_hyperdrive;
commit;
