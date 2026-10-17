begin;

create schema if not exists platform;
revoke all on schema platform from public, anon, authenticated;
alter default privileges in schema platform revoke all on tables from public, anon, authenticated;

create table platform.admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null,
  role text not null check (role in ('super_admin', 'operations', 'support')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_admins_display_name_not_blank check (btrim(display_name) <> '')
);
create index platform_admins_role_status_idx on platform.admins (role, status, user_id);
alter table platform.admins enable row level security;
revoke all on table platform.admins from public, anon, authenticated, hcs_hyperdrive;
create trigger platform_admins_set_updated_at before update on platform.admins
for each row execute function app.set_updated_at();

create table platform.operation_requests (
  actor_user_id uuid not null references platform.admins (user_id) on delete restrict,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (actor_user_id, operation, idempotency_key),
  constraint platform_operation_not_blank check (btrim(operation) <> ''),
  constraint platform_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint platform_operation_expiry_after_creation check (expires_at > created_at)
);
create index platform_operation_requests_expiry_idx on platform.operation_requests (expires_at);
alter table platform.operation_requests enable row level security;
revoke all on table platform.operation_requests from public, anon, authenticated, hcs_hyperdrive;

create function platform.load_context(p_actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin platform.admins%rowtype;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active';
  if not found then raise exception using errcode='HCSP0', message='Platform access is not allowed'; end if;

  return pg_catalog.jsonb_build_object(
    'admin', pg_catalog.jsonb_build_object(
      'userId', v_admin.user_id, 'displayName', v_admin.display_name, 'role', v_admin.role,
      'canManage', v_admin.role in ('super_admin','operations')
    ),
    'metrics', pg_catalog.jsonb_build_object(
      'tenantCount', (select count(*)::integer from app.tenants),
      'activeTenantCount', (select count(*)::integer from app.tenants where status='active'),
      'suspendedTenantCount', (select count(*)::integer from app.tenants where status='suspended'),
      'availableFeatureCount', (select count(*)::integer from app.features where platform_available)
    ),
    'features', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', f.code, 'name', f.name, 'platformAvailable', f.platform_available
      ) order by f.name, f.code) from app.features f
    ), '[]'::jsonb),
    'tenants', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id, 'slug', t.slug::text, 'name', t.name, 'status', t.status,
        'baseCurrency', t.base_currency, 'timezone', t.timezone, 'createdAt', t.created_at,
        'locationCount', (select count(*)::integer from app.locations l where l.tenant_id=t.id),
        'memberCount', (select count(*)::integer from app.tenant_memberships m where m.tenant_id=t.id and m.status='active'),
        'entitlements', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'featureCode', f.code, 'featureName', f.name, 'platformAvailable', f.platform_available,
          'entitled', coalesce(e.entitled,false), 'enabled', coalesce(e.enabled,false),
          'startsAt', e.starts_at, 'endsAt', e.ends_at
        ) order by f.name, f.code)
        from app.features f left join app.tenant_entitlements e on e.tenant_id=t.id and e.feature_code=f.code), '[]'::jsonb)
      ) order by case t.status when 'suspended' then 0 when 'active' then 1 else 2 end, t.name, t.id)
      from app.tenants t where t.status in ('active','suspended')
    ), '[]'::jsonb)
  );
end;
$$;

create function platform.update_tenant_entitlement(
  p_actor_user_id uuid, p_tenant_id uuid, p_feature_code text, p_entitled boolean,
  p_ends_at timestamptz, p_reason text, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_before app.tenant_entitlements%rowtype;
  v_response jsonb;
begin
  select * into v_admin from platform.admins
  where user_id=p_actor_user_id and status='active' and role in ('super_admin','operations');
  if not found then raise exception using errcode='HCSP0', message='Platform entitlement management is not allowed'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 240
    or p_feature_code is null or btrim(p_feature_code)=''
    or (p_entitled and p_ends_at is not null and p_ends_at <= now()) then
    raise exception using errcode='HCSP1', message='Platform entitlement request is invalid'; end if;
  if not exists(select 1 from app.tenants where id=p_tenant_id and status in ('active','suspended'))
    or not exists(select 1 from app.features where code=p_feature_code) then
    raise exception using errcode='HCSP2', message='Tenant or feature was not found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_user_id::text || ':platform.entitlement:' || p_idempotency_key, 0
  ));
  select * into v_existing from platform.operation_requests
  where actor_user_id=p_actor_user_id and operation='tenant.entitlement.update' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then
      raise exception using errcode='HCS08', message='Idempotency key was reused with a different platform entitlement request';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'tenant.entitlement.update',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;

  select * into v_before from app.tenant_entitlements
  where tenant_id=p_tenant_id and feature_code=p_feature_code for update;
  insert into app.tenant_entitlements(tenant_id,feature_code,entitled,enabled,starts_at,ends_at)
  values(p_tenant_id,p_feature_code,p_entitled,false,case when p_entitled then now() else null end,case when p_entitled then p_ends_at else null end)
  on conflict(tenant_id,feature_code) do update set
    entitled=excluded.entitled,
    enabled=case when excluded.entitled then app.tenant_entitlements.enabled else false end,
    starts_at=case when excluded.entitled and not app.tenant_entitlements.entitled then now() else app.tenant_entitlements.starts_at end,
    ends_at=case when excluded.entitled then excluded.ends_at else null end,
    updated_at=now();

  select pg_catalog.jsonb_build_object(
    'tenantId', e.tenant_id, 'featureCode', e.feature_code, 'entitled', e.entitled,
    'enabled', e.enabled, 'startsAt', e.starts_at, 'endsAt', e.ends_at
  ) into v_response from app.tenant_entitlements e
  where e.tenant_id=p_tenant_id and e.feature_code=p_feature_code;

  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
  values(
    p_tenant_id,p_request_id,'platform_admin',p_actor_user_id,
    case when p_entitled then 'platform.entitlement.granted' else 'platform.entitlement.revoked' end,
    'tenant_entitlement',p_tenant_id,btrim(p_reason),
    pg_catalog.jsonb_build_object(
      'featureCode',p_feature_code,'beforeEntitled',coalesce(v_before.entitled,false),
      'beforeEnabled',coalesce(v_before.enabled,false),'afterEntitled',p_entitled,
      'afterEnabled',(v_response->>'enabled')::boolean,'endsAt',p_ends_at
    )
  );
  update platform.operation_requests set response_body=v_response,completed_at=now()
  where actor_user_id=p_actor_user_id and operation='tenant.entitlement.update' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function platform.update_tenant_status(
  p_actor_user_id uuid, p_tenant_id uuid, p_status text, p_reason text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_tenant app.tenants%rowtype;
  v_response jsonb;
begin
  select * into v_admin from platform.admins
  where user_id=p_actor_user_id and status='active' and role='super_admin';
  if not found then raise exception using errcode='HCSP0', message='Platform tenant status management is not allowed'; end if;
  if p_status not in ('active','suspended') or p_reason is null or char_length(btrim(p_reason)) not between 3 and 240 then
    raise exception using errcode='HCSP1', message='Platform tenant status request is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_user_id::text || ':platform.tenant.status:' || p_idempotency_key, 0
  ));
  select * into v_existing from platform.operation_requests
  where actor_user_id=p_actor_user_id and operation='tenant.status.update' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then
      raise exception using errcode='HCS08', message='Idempotency key was reused with a different tenant status request';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'tenant.status.update',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;

  select * into v_tenant from app.tenants where id=p_tenant_id and status in ('active','suspended') for update;
  if not found then raise exception using errcode='HCSP2', message='Tenant was not found'; end if;
  if v_tenant.status<>p_status then
    update app.tenants set status=p_status where id=p_tenant_id;
    insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
    values(
      p_tenant_id,p_request_id,'platform_admin',p_actor_user_id,'platform.tenant.'||p_status,
      'tenant',p_tenant_id,btrim(p_reason),
      pg_catalog.jsonb_build_object('fromStatus',v_tenant.status,'toStatus',p_status)
    );
  end if;
  v_response:=pg_catalog.jsonb_build_object('tenantId',p_tenant_id,'status',p_status);
  update platform.operation_requests set response_body=v_response,completed_at=now()
  where actor_user_id=p_actor_user_id and operation='tenant.status.update' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function platform.load_context(uuid) from public, anon, authenticated;
revoke all on function platform.update_tenant_entitlement(uuid,uuid,text,boolean,timestamptz,text,text,text,text) from public, anon, authenticated;
revoke all on function platform.update_tenant_status(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant usage on schema platform to hcs_hyperdrive;
grant execute on function platform.load_context(uuid) to hcs_hyperdrive;
grant execute on function platform.update_tenant_entitlement(uuid,uuid,text,boolean,timestamptz,text,text,text,text) to hcs_hyperdrive;
grant execute on function platform.update_tenant_status(uuid,uuid,text,text,text,text,text) to hcs_hyperdrive;

commit;
