begin;

insert into app.permissions (code, description) values
  ('tenant.manage', 'Manage business identity and settings'),
  ('locations.manage', 'Manage business locations'),
  ('onboarding.manage', 'Complete business setup')
on conflict (code) do nothing;

create table app.onboarding_requests (
  actor_user_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key),
  constraint onboarding_requests_key_format check (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  constraint onboarding_requests_hash_format check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint onboarding_requests_response_object check (jsonb_typeof(response_body) = 'object')
);
create index onboarding_requests_tenant_created_idx
  on app.onboarding_requests (tenant_id, created_at desc);
alter table app.onboarding_requests enable row level security;

create function app.bootstrap_tenant(
  p_actor_user_id uuid,
  p_slug text,
  p_name text,
  p_base_currency text,
  p_timezone text,
  p_location_code text,
  p_location_name text,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_hash text;
  v_existing_response jsonb;
  v_tenant_id uuid;
  v_location_id uuid;
  v_owner_role_id uuid;
  v_response jsonb;
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users where id = p_actor_user_id
  ) then
    raise exception using errcode = 'HCS02', message = 'Authenticated account no longer exists';
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'HCS03', message = 'Invalid onboarding request key';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key, 0)
  );

  select request_hash, response_body
    into v_existing_hash, v_existing_response
    from app.onboarding_requests
   where actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_hash <> p_request_hash then
      raise exception using errcode = 'HCS01', message = 'Idempotency key reused with different business details';
    end if;

    return v_existing_response;
  end if;

  insert into app.tenants (slug, name, base_currency, timezone)
  values (p_slug, p_name, p_base_currency, p_timezone)
  returning id into v_tenant_id;

  insert into app.locations (tenant_id, code, name, kind, timezone)
  values (v_tenant_id, p_location_code, p_location_name, 'store', p_timezone)
  returning id into v_location_id;

  insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at)
  values (v_tenant_id, p_actor_user_id, 'active', true, now());

  insert into app.roles (tenant_id, code, name, is_system_template)
  values (v_tenant_id, 'owner', 'Owner', true)
  returning id into v_owner_role_id;

  insert into app.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_owner_role_id, code
    from app.permissions
   where code in ('tenant.manage', 'locations.manage', 'onboarding.manage');

  insert into app.membership_roles (tenant_id, user_id, role_id)
  values (v_tenant_id, p_actor_user_id, v_owner_role_id);

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id
  ) values (
    v_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'tenant.created', 'tenant', v_tenant_id, v_location_id
  );

  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (
    v_tenant_id, 'tenant.created', 'tenant', v_tenant_id,
    pg_catalog.jsonb_build_object('tenantId', v_tenant_id, 'mainLocationId', v_location_id)
  );

  v_response := pg_catalog.jsonb_build_object(
    'tenantId', v_tenant_id,
    'mainLocationId', v_location_id,
    'status', 'setup'
  );

  insert into app.onboarding_requests (
    actor_user_id, idempotency_key, request_hash, tenant_id, response_body
  ) values (
    p_actor_user_id, p_idempotency_key, p_request_hash, v_tenant_id, v_response
  );

  return v_response;
end;
$$;

revoke all on function app.bootstrap_tenant(
  uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function app.bootstrap_tenant(
  uuid, text, text, text, text, text, text, text, text, text
) to hcs_hyperdrive;

commit;
