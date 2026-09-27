begin;

create table platform.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique,
  name text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  default_trial_days integer not null default 0 check (default_trial_days between 0 and 365),
  created_by uuid not null references platform.admins (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_code_format check (code::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint subscription_plans_name_not_blank check (btrim(name) <> '')
);

create table platform.subscription_plan_features (
  plan_id uuid not null references platform.subscription_plans (id) on delete restrict,
  feature_code text not null references app.features (code) on delete restrict,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_code)
);
create index subscription_plan_features_feature_idx
  on platform.subscription_plan_features (feature_code, plan_id);

create table platform.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  plan_id uuid not null references platform.subscription_plans (id) on delete restrict,
  status text not null check (status in ('trialing', 'active', 'ended')),
  starts_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  ends_at timestamptz,
  assigned_by uuid not null references platform.admins (user_id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscriptions_reason_not_blank check (char_length(btrim(reason)) between 3 and 240),
  constraint tenant_subscriptions_trial_window check (trial_ends_at is null or trial_ends_at > starts_at),
  constraint tenant_subscriptions_end_window check (ends_at is null or ends_at > starts_at),
  constraint tenant_subscriptions_trial_status check (
    (status = 'trialing' and trial_ends_at is not null and ends_at = trial_ends_at)
    or status in ('active', 'ended')
  )
);
create unique index tenant_subscriptions_one_current_idx
  on platform.tenant_subscriptions (tenant_id) where status in ('trialing', 'active');
create index tenant_subscriptions_plan_history_idx
  on platform.tenant_subscriptions (plan_id, created_at desc, id);
create index tenant_subscriptions_tenant_history_idx
  on platform.tenant_subscriptions (tenant_id, created_at desc, id);
create index tenant_subscriptions_assigned_by_idx
  on platform.tenant_subscriptions (assigned_by, created_at desc, id);

create table platform.tenant_feature_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  feature_code text not null references app.features (code) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid not null references platform.admins (user_id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references platform.admins (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tenant_feature_overrides_window check (ends_at > starts_at),
  constraint tenant_feature_overrides_reason_not_blank check (char_length(btrim(reason)) between 3 and 240),
  constraint tenant_feature_overrides_revocation_complete check (
    (revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null)
  )
);
create index tenant_feature_overrides_tenant_history_idx
  on platform.tenant_feature_overrides (tenant_id, created_at desc, id);
create index tenant_feature_overrides_expiry_idx
  on platform.tenant_feature_overrides (ends_at) where revoked_at is null;
create index tenant_feature_overrides_feature_idx
  on platform.tenant_feature_overrides (feature_code, tenant_id, ends_at desc);
create index tenant_feature_overrides_created_by_idx
  on platform.tenant_feature_overrides (created_by, created_at desc, id);
create index tenant_feature_overrides_revoked_by_idx
  on platform.tenant_feature_overrides (revoked_by, revoked_at desc, id) where revoked_by is not null;

create trigger subscription_plans_set_updated_at before update on platform.subscription_plans
for each row execute function app.set_updated_at();
create trigger subscription_plan_features_set_updated_at before update on platform.subscription_plan_features
for each row execute function app.set_updated_at();
create trigger tenant_subscriptions_set_updated_at before update on platform.tenant_subscriptions
for each row execute function app.set_updated_at();

alter table platform.subscription_plans enable row level security;
alter table platform.subscription_plan_features enable row level security;
alter table platform.tenant_subscriptions enable row level security;
alter table platform.tenant_feature_overrides enable row level security;
revoke all on table
  platform.subscription_plans,
  platform.subscription_plan_features,
  platform.tenant_subscriptions,
  platform.tenant_feature_overrides
from public, anon, authenticated, hcs_hyperdrive;

create function platform.reject_subscription_history_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'HCSP5', message = 'Subscription history cannot be deleted';
end;
$$;
create trigger tenant_subscriptions_reject_delete before delete on platform.tenant_subscriptions
for each row execute function platform.reject_subscription_history_delete();
create trigger tenant_feature_overrides_reject_delete before delete on platform.tenant_feature_overrides
for each row execute function platform.reject_subscription_history_delete();

create function platform.subscription_plan_json(p_plan platform.subscription_plans) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_plan.id,
    'code', p_plan.code::text,
    'name', p_plan.name,
    'status', p_plan.status,
    'defaultTrialDays', p_plan.default_trial_days,
    'features', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'featureCode', pf.feature_code,
        'featureName', feature.name,
        'limitValue', pf.limit_value
      ) order by feature.name, pf.feature_code)
      from platform.subscription_plan_features pf
      join app.features feature on feature.code = pf.feature_code
      where pf.plan_id = p_plan.id
    ), '[]'::jsonb),
    'createdAt', p_plan.created_at
  )
$$;

create function platform.load_subscription_context(p_actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin platform.admins%rowtype;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active';
  if not found then raise exception using errcode='HCSP0', message='Platform access is not allowed'; end if;

  return pg_catalog.jsonb_build_object(
    'canManage', v_admin.role in ('super_admin','operations'),
    'features', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code', f.code, 'name', f.name
    ) order by f.name, f.code) from app.features f where f.platform_available), '[]'::jsonb),
    'plans', coalesce((select pg_catalog.jsonb_agg(platform.subscription_plan_json(p) order by p.name,p.id)
      from platform.subscription_plans p where p.status <> 'archived'), '[]'::jsonb),
    'tenants', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'tenantId', t.id,
      'tenantName', t.name,
      'tenantStatus', t.status,
      'subscription', case when s.id is null then null else pg_catalog.jsonb_build_object(
        'id', s.id, 'planId', s.plan_id, 'planName', p.name, 'status', s.status,
        'startsAt', s.starts_at, 'trialEndsAt', s.trial_ends_at, 'endsAt', s.ends_at
      ) end,
      'activeOverrides', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'featureCode', o.feature_code, 'featureName', f.name,
        'startsAt', o.starts_at, 'endsAt', o.ends_at, 'reason', o.reason
      ) order by o.ends_at,o.id)
      from platform.tenant_feature_overrides o join app.features f on f.code=o.feature_code
      where o.tenant_id=t.id and o.revoked_at is null and o.starts_at<=now() and o.ends_at>now()), '[]'::jsonb)
    ) order by t.name,t.id)
    from app.tenants t
    left join platform.tenant_subscriptions s on s.tenant_id=t.id and s.status in ('trialing','active')
      and s.starts_at<=now() and (s.ends_at is null or s.ends_at>now())
    left join platform.subscription_plans p on p.id=s.plan_id
    where t.status in ('active','suspended')), '[]'::jsonb)
  );
end;
$$;

create function platform.create_subscription_plan(
  p_actor_user_id uuid, p_code text, p_name text, p_default_trial_days integer, p_features jsonb,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_plan platform.subscription_plans%rowtype;
  v_item jsonb;
  v_response jsonb;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active' and role in ('super_admin','operations');
  if not found then raise exception using errcode='HCSP0', message='Subscription plan management is not allowed'; end if;
  if p_code is null or p_code !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(p_code)>60
    or p_name is null or char_length(btrim(p_name)) not between 2 and 120
    or p_default_trial_days not between 0 and 365 or jsonb_typeof(p_features)<>'array' then
    raise exception using errcode='HCSP1', message='Subscription plan request is invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(p_features) item
    where not (item ? 'featureCode')
      or not exists(select 1 from app.features f where f.code=item->>'featureCode' and f.platform_available)
      or ((item ? 'limitValue') and item->'limitValue' <> 'null'::jsonb and (item->>'limitValue')::bigint < 0)) then
    raise exception using errcode='HCSP1', message='Subscription plan feature is invalid';
  end if;
  if (select count(*) from jsonb_array_elements(p_features)) <>
     (select count(distinct item->>'featureCode') from jsonb_array_elements(p_features) item) then
    raise exception using errcode='HCSP1', message='Subscription plan features must be unique';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor_user_id::text || ':platform.subscription.plan.create:' || p_idempotency_key,0));
  select * into v_existing from platform.operation_requests
  where actor_user_id=p_actor_user_id and operation='subscription.plan.create' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different subscription plan request'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'subscription.plan.create',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;

  insert into platform.subscription_plans(code,name,default_trial_days,created_by)
  values(btrim(p_code),btrim(p_name),p_default_trial_days,p_actor_user_id) returning * into v_plan;
  insert into platform.subscription_plan_features(plan_id,feature_code,limit_value)
  select v_plan.id, feature_code, limit_value
  from (
    select item->>'featureCode' feature_code,
      case when item->'limitValue' is null or item->'limitValue'='null'::jsonb then null else (item->>'limitValue')::bigint end limit_value
    from jsonb_array_elements(p_features) item
    union all
    select core.code,null::bigint from (values('catalog'),('sales'),('reports')) core(code)
    where not exists(select 1 from jsonb_array_elements(p_features) item where item->>'featureCode'=core.code)
  ) requested;
  v_response:=platform.subscription_plan_json(v_plan);
  insert into audit.audit_events(request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
  values(p_request_id,'platform_admin',p_actor_user_id,'platform.subscription_plan.created','subscription_plan',v_plan.id,
    pg_catalog.jsonb_build_object('code',v_plan.code::text,'featureCount',jsonb_array_length(v_response->'features')));
  update platform.operation_requests set response_body=v_response,completed_at=now()
  where actor_user_id=p_actor_user_id and operation='subscription.plan.create' and idempotency_key=p_idempotency_key;
  return v_response;
exception when unique_violation then
  raise exception using errcode='HCSP6', message='Subscription plan code already exists';
end;
$$;

create function platform.assign_tenant_subscription(
  p_actor_user_id uuid, p_tenant_id uuid, p_plan_id uuid, p_trial_ends_at timestamptz, p_ends_at timestamptz,
  p_reason text, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_plan platform.subscription_plans%rowtype;
  v_subscription platform.tenant_subscriptions%rowtype;
  v_effective_end timestamptz;
  v_status text;
  v_response jsonb;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active' and role in ('super_admin','operations');
  if not found then raise exception using errcode='HCSP0', message='Subscription assignment is not allowed'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 240
    or (p_trial_ends_at is not null and p_trial_ends_at<=now())
    or (p_ends_at is not null and p_ends_at<=now())
    or (p_trial_ends_at is not null and p_ends_at is not null) then
    raise exception using errcode='HCSP1', message='Subscription assignment request is invalid';
  end if;
  select * into v_plan from platform.subscription_plans where id=p_plan_id and status='active';
  if not found or not exists(select 1 from app.tenants where id=p_tenant_id and status in ('active','suspended')) then
    raise exception using errcode='HCSP2', message='Tenant or subscription plan was not found';
  end if;
  v_status:=case when p_trial_ends_at is not null then 'trialing' else 'active' end;
  v_effective_end:=coalesce(p_trial_ends_at,p_ends_at);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':subscription.assign',0));
  select * into v_existing from platform.operation_requests
  where actor_user_id=p_actor_user_id and operation='tenant.subscription.assign' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different subscription assignment'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'tenant.subscription.assign',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;

  update platform.tenant_subscriptions set status='ended',ends_at=now()
  where tenant_id=p_tenant_id and status in ('trialing','active');
  insert into platform.tenant_subscriptions(tenant_id,plan_id,status,trial_ends_at,ends_at,assigned_by,reason)
  values(p_tenant_id,p_plan_id,v_status,p_trial_ends_at,v_effective_end,p_actor_user_id,btrim(p_reason)) returning * into v_subscription;

  insert into app.tenant_entitlements(tenant_id,feature_code,entitled,enabled,starts_at,ends_at)
  select p_tenant_id,f.code,
    (pf.feature_code is not null or o.feature_code is not null),
    false,
    case when pf.feature_code is not null or o.feature_code is not null then now() else null end,
    case when pf.feature_code is not null then v_effective_end else o.ends_at end
  from app.features f
  left join platform.subscription_plan_features pf on pf.plan_id=p_plan_id and pf.feature_code=f.code
  left join lateral (
    select feature_code,ends_at from platform.tenant_feature_overrides active_override
    where active_override.tenant_id=p_tenant_id and active_override.feature_code=f.code
      and active_override.revoked_at is null and active_override.starts_at<=now() and active_override.ends_at>now()
    order by active_override.ends_at desc limit 1
  ) o on true
  on conflict(tenant_id,feature_code) do update set
    entitled=excluded.entitled,
    enabled=case when excluded.entitled then app.tenant_entitlements.enabled else false end,
    starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,
    updated_at=now();

  v_response:=pg_catalog.jsonb_build_object(
    'tenantId',p_tenant_id,'subscriptionId',v_subscription.id,'planId',v_plan.id,'planName',v_plan.name,
    'status',v_subscription.status,'startsAt',v_subscription.starts_at,
    'trialEndsAt',v_subscription.trial_ends_at,'endsAt',v_subscription.ends_at
  );
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
  values(p_tenant_id,p_request_id,'platform_admin',p_actor_user_id,'platform.subscription.assigned','tenant_subscription',v_subscription.id,btrim(p_reason),
    pg_catalog.jsonb_build_object('planId',v_plan.id,'planCode',v_plan.code::text,'status',v_status,'endsAt',v_effective_end));
  update platform.operation_requests set response_body=v_response,completed_at=now()
  where actor_user_id=p_actor_user_id and operation='tenant.subscription.assign' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function platform.create_tenant_feature_override(
  p_actor_user_id uuid, p_tenant_id uuid, p_feature_code text, p_ends_at timestamptz, p_reason text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin platform.admins%rowtype;
  v_existing platform.operation_requests%rowtype;
  v_override platform.tenant_feature_overrides%rowtype;
  v_response jsonb;
begin
  select * into v_admin from platform.admins where user_id=p_actor_user_id and status='active' and role in ('super_admin','operations');
  if not found then raise exception using errcode='HCSP0', message='Add-on override management is not allowed'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 240 or p_ends_at is null or p_ends_at<=now() then
    raise exception using errcode='HCSP1', message='Add-on override request is invalid';
  end if;
  if not exists(select 1 from app.tenants where id=p_tenant_id and status in ('active','suspended'))
    or not exists(select 1 from app.features where code=p_feature_code and platform_available) then
    raise exception using errcode='HCSP2', message='Tenant or feature was not found';
  end if;
  if exists(
    select 1 from platform.tenant_subscriptions s
    join platform.subscription_plan_features pf on pf.plan_id=s.plan_id and pf.feature_code=p_feature_code
    where s.tenant_id=p_tenant_id and s.status in ('trialing','active') and s.starts_at<=now() and (s.ends_at is null or s.ends_at>now())
  ) then raise exception using errcode='HCSP7', message='Feature is already included in the current plan'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':feature.override:'||p_feature_code,0));
  select * into v_existing from platform.operation_requests
  where actor_user_id=p_actor_user_id and operation='tenant.feature_override.create' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with a different add-on override'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into platform.operation_requests(actor_user_id,operation,idempotency_key,request_hash,expires_at)
    values(p_actor_user_id,'tenant.feature_override.create',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;
  if exists(select 1 from platform.tenant_feature_overrides where tenant_id=p_tenant_id and feature_code=p_feature_code
    and revoked_at is null and starts_at<=now() and ends_at>now()) then
    raise exception using errcode='HCSP8', message='An active add-on override already exists';
  end if;

  insert into platform.tenant_feature_overrides(tenant_id,feature_code,ends_at,reason,created_by)
  values(p_tenant_id,p_feature_code,p_ends_at,btrim(p_reason),p_actor_user_id) returning * into v_override;
  insert into app.tenant_entitlements(tenant_id,feature_code,entitled,enabled,starts_at,ends_at)
  values(p_tenant_id,p_feature_code,true,false,now(),p_ends_at)
  on conflict(tenant_id,feature_code) do update set entitled=true,
    starts_at=now(),ends_at=excluded.ends_at,updated_at=now();
  v_response:=pg_catalog.jsonb_build_object(
    'id',v_override.id,'tenantId',v_override.tenant_id,'featureCode',v_override.feature_code,
    'startsAt',v_override.starts_at,'endsAt',v_override.ends_at,'reason',v_override.reason
  );
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
  values(p_tenant_id,p_request_id,'platform_admin',p_actor_user_id,'platform.feature_override.created','tenant_feature_override',v_override.id,btrim(p_reason),
    pg_catalog.jsonb_build_object('featureCode',p_feature_code,'endsAt',p_ends_at));
  update platform.operation_requests set response_body=v_response,completed_at=now()
  where actor_user_id=p_actor_user_id and operation='tenant.feature_override.create' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function platform.reject_subscription_history_delete() from public, anon, authenticated, hcs_hyperdrive;
revoke all on function platform.subscription_plan_json(platform.subscription_plans) from public, anon, authenticated, hcs_hyperdrive;
revoke all on function platform.load_subscription_context(uuid) from public, anon, authenticated;
revoke all on function platform.create_subscription_plan(uuid,text,text,integer,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function platform.assign_tenant_subscription(uuid,uuid,uuid,timestamptz,timestamptz,text,text,text,text) from public, anon, authenticated;
revoke all on function platform.create_tenant_feature_override(uuid,uuid,text,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function platform.load_subscription_context(uuid) to hcs_hyperdrive;
grant execute on function platform.create_subscription_plan(uuid,text,text,integer,jsonb,text,text,text) to hcs_hyperdrive;
grant execute on function platform.assign_tenant_subscription(uuid,uuid,uuid,timestamptz,timestamptz,text,text,text,text) to hcs_hyperdrive;
grant execute on function platform.create_tenant_feature_override(uuid,uuid,text,timestamptz,text,text,text,text) to hcs_hyperdrive;

commit;
