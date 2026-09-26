begin;

create table platform.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  admin_user_id uuid not null references platform.admins (user_id) on delete restrict,
  granted_by uuid not null references platform.admins (user_id) on delete restrict,
  ticket_reference text not null,
  reason text not null,
  access_level text not null default 'read_only' check (access_level = 'read_only'),
  scope text[] not null default array['tenant_overview']::text[],
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references platform.admins (user_id) on delete restrict,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint support_access_ticket_not_blank check (char_length(btrim(ticket_reference)) between 3 and 120),
  constraint support_access_reason_not_blank check (char_length(btrim(reason)) between 3 and 240),
  constraint support_access_scope_overview_only check (scope = array['tenant_overview']::text[]),
  constraint support_access_expiry_after_start check (expires_at > starts_at),
  constraint support_access_revocation_complete check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by is not null and char_length(btrim(revocation_reason)) between 3 and 240)
  )
);
create index platform_support_access_actor_history_idx
  on platform.support_access_grants (admin_user_id, created_at desc, id);
create index platform_support_access_tenant_history_idx
  on platform.support_access_grants (tenant_id, created_at desc, id);
create index platform_support_access_expiry_idx
  on platform.support_access_grants (expires_at) where revoked_at is null;
alter table platform.support_access_grants enable row level security;
revoke all on table platform.support_access_grants from public, anon, authenticated, hcs_hyperdrive;

create function platform.reject_support_access_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'support access grants cannot be deleted';
end;
$$;
revoke all on function platform.reject_support_access_delete() from public, anon, authenticated;
create trigger support_access_grants_reject_delete before delete on platform.support_access_grants
for each row execute function platform.reject_support_access_delete();

create function platform.support_grant_json(p_grant platform.support_access_grants) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_grant.id, 'tenantId', p_grant.tenant_id,
    'tenantName', (select t.name from app.tenants t where t.id=p_grant.tenant_id),
    'adminUserId', p_grant.admin_user_id, 'ticketReference', p_grant.ticket_reference,
    'reason', p_grant.reason, 'accessLevel', p_grant.access_level, 'scope', p_grant.scope,
    'startsAt', p_grant.starts_at, 'expiresAt', p_grant.expires_at,
    'revokedAt', p_grant.revoked_at, 'revocationReason', p_grant.revocation_reason,
    'createdAt', p_grant.created_at
  );
$$;
revoke all on function platform.support_grant_json(platform.support_access_grants) from public, anon, authenticated;

create function platform.load_support_access(p_actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin platform.admins%rowtype;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active';
  if not found then raise exception using errcode='HCSP0', message='Platform access is not allowed'; end if;
  return pg_catalog.jsonb_build_object(
    'canGrant', v_admin.role in ('super_admin','operations'),
    'grants', coalesce((select pg_catalog.jsonb_agg(platform.support_grant_json(g) order by g.created_at desc, g.id)
      from platform.support_access_grants g where g.admin_user_id=p_actor_user_id
        and g.id in (select recent.id from platform.support_access_grants recent where recent.admin_user_id=p_actor_user_id order by recent.created_at desc,recent.id limit 100)), '[]'::jsonb)
  );
end;
$$;

create function platform.create_support_access(
  p_actor_user_id uuid, p_tenant_id uuid, p_ticket_reference text, p_reason text,
  p_duration_minutes integer, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_grant platform.support_access_grants%rowtype;
  v_response jsonb;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active' and role in ('super_admin','operations');
  if not found then raise exception using errcode='HCSP0', message='Support access creation is not allowed'; end if;
  if p_ticket_reference is null or char_length(btrim(p_ticket_reference)) not between 3 and 120
    or p_reason is null or char_length(btrim(p_reason)) not between 3 and 240
    or p_duration_minutes not between 15 and 120 then
    raise exception using errcode='HCSP1', message='Support access request is invalid';
  end if;
  if not exists(select 1 from app.tenants where id=p_tenant_id and status in ('active','suspended')) then
    raise exception using errcode='HCSP2', message='Tenant was not found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_user_id::text||':support:'||p_idempotency_key,0));
  select * into v_existing from platform.operation_requests
    where actor_user_id=p_actor_user_id and operation='support_access.create' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different support access request'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'support_access.create',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;
  if exists(select 1 from platform.support_access_grants where admin_user_id=p_actor_user_id and tenant_id=p_tenant_id and revoked_at is null and expires_at>now()) then
    raise exception using errcode='HCSP3', message='An active support access grant already exists';
  end if;
  insert into platform.support_access_grants(tenant_id,admin_user_id,granted_by,ticket_reference,reason,expires_at)
  values(p_tenant_id,p_actor_user_id,p_actor_user_id,btrim(p_ticket_reference),btrim(p_reason),now()+pg_catalog.make_interval(mins=>p_duration_minutes))
  returning * into v_grant;
  v_response:=platform.support_grant_json(v_grant);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
  values(p_tenant_id,p_request_id,'platform_admin',p_actor_user_id,'platform.support_access.granted','support_access_grant',v_grant.id,btrim(p_reason),
    pg_catalog.jsonb_build_object('ticketReference',btrim(p_ticket_reference),'accessLevel','read_only','scope',v_grant.scope,'expiresAt',v_grant.expires_at));
  update platform.operation_requests set response_body=v_response,completed_at=now()
    where actor_user_id=p_actor_user_id and operation='support_access.create' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function platform.revoke_support_access(
  p_actor_user_id uuid, p_grant_id uuid, p_reason text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_grant platform.support_access_grants%rowtype;
  v_response jsonb;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active';
  if not found then raise exception using errcode='HCSP0', message='Platform access is not allowed'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 240 then raise exception using errcode='HCSP1', message='Support access revocation is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_user_id::text||':support-revoke:'||p_idempotency_key,0));
  select * into v_existing from platform.operation_requests where actor_user_id=p_actor_user_id and operation='support_access.revoke' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different support access revocation'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'support_access.revoke',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;
  select * into v_grant from platform.support_access_grants where id=p_grant_id for update;
  if not found then raise exception using errcode='HCSP2', message='Support access grant was not found'; end if;
  if v_grant.admin_user_id<>p_actor_user_id and v_admin.role<>'super_admin' then raise exception using errcode='HCSP0', message='Support access revocation is not allowed'; end if;
  if v_grant.revoked_at is null then
    update platform.support_access_grants set revoked_at=now(),revoked_by=p_actor_user_id,revocation_reason=btrim(p_reason) where id=p_grant_id returning * into v_grant;
    insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
    values(v_grant.tenant_id,p_request_id,'platform_admin',p_actor_user_id,'platform.support_access.revoked','support_access_grant',v_grant.id,btrim(p_reason),
      pg_catalog.jsonb_build_object('ticketReference',v_grant.ticket_reference));
  end if;
  v_response:=platform.support_grant_json(v_grant);
  update platform.operation_requests set response_body=v_response,completed_at=now()
    where actor_user_id=p_actor_user_id and operation='support_access.revoke' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function platform.load_support_overview(p_actor_user_id uuid,p_grant_id uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin platform.admins%rowtype; v_grant platform.support_access_grants%rowtype; v_tenant app.tenants%rowtype;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active';
  if not found then raise exception using errcode='HCSP0', message='Platform access is not allowed'; end if;
  select * into v_grant from platform.support_access_grants where id=p_grant_id and admin_user_id=p_actor_user_id;
  if not found then raise exception using errcode='HCSP2', message='Support access grant was not found'; end if;
  if v_grant.revoked_at is not null or v_grant.starts_at>now() or v_grant.expires_at<=now() then raise exception using errcode='HCSP4', message='Support access grant is not active'; end if;
  select * into v_tenant from app.tenants where id=v_grant.tenant_id and status in ('active','suspended');
  if not found then raise exception using errcode='HCSP2', message='Tenant was not found'; end if;
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
  values(v_tenant.id,p_request_id,'platform_admin',p_actor_user_id,'platform.support_access.viewed','support_access_grant',v_grant.id,v_grant.reason,
    pg_catalog.jsonb_build_object('ticketReference',v_grant.ticket_reference,'accessLevel',v_grant.access_level,'scope',v_grant.scope));
  return pg_catalog.jsonb_build_object(
    'access',platform.support_grant_json(v_grant),
    'tenant',pg_catalog.jsonb_build_object('id',v_tenant.id,'slug',v_tenant.slug::text,'name',v_tenant.name,'status',v_tenant.status,'baseCurrency',v_tenant.base_currency,'timezone',v_tenant.timezone),
    'metrics',pg_catalog.jsonb_build_object(
      'locationCount',(select count(*)::integer from app.locations where tenant_id=v_tenant.id),
      'activeMemberCount',(select count(*)::integer from app.tenant_memberships where tenant_id=v_tenant.id and status='active'),
      'activeEmployeeCount',(select count(*)::integer from app.employees where tenant_id=v_tenant.id and status='active'),
      'activeProductCount',(select count(*)::integer from app.products where tenant_id=v_tenant.id and status='active'),
      'activeVariantCount',(select count(*)::integer from app.product_variants where tenant_id=v_tenant.id and is_active),
      'inventoryPositionCount',(select count(*)::integer from app.inventory_balances where tenant_id=v_tenant.id),
      'registerCount',(select count(*)::integer from app.registers where tenant_id=v_tenant.id),
      'openRegisterSessionCount',(select count(*)::integer from app.register_sessions where tenant_id=v_tenant.id and status='open'),
      'completedSaleCount',(select count(*)::integer from app.sales where tenant_id=v_tenant.id and status in ('completed','partially_refunded','refunded'))
    ),
    'locations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',l.id,'code',l.code::text,'name',l.name,'kind',l.kind,'isActive',l.is_active) order by l.name,l.id) from app.locations l where l.tenant_id=v_tenant.id),'[]'::jsonb)
  );
end;
$$;

revoke all on function platform.load_support_access(uuid) from public, anon, authenticated;
revoke all on function platform.create_support_access(uuid,uuid,text,text,integer,text,text,text) from public, anon, authenticated;
revoke all on function platform.revoke_support_access(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function platform.load_support_overview(uuid,uuid,text) from public, anon, authenticated;
grant execute on function platform.load_support_access(uuid) to hcs_hyperdrive;
grant execute on function platform.create_support_access(uuid,uuid,text,text,integer,text,text,text) to hcs_hyperdrive;
grant execute on function platform.revoke_support_access(uuid,uuid,text,text,text,text) to hcs_hyperdrive;
grant execute on function platform.load_support_overview(uuid,uuid,text) to hcs_hyperdrive;

commit;
