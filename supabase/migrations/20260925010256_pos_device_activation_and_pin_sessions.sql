begin;

insert into app.permissions (code, description)
values
  ('devices.read', 'View POS devices and activation status'),
  ('devices.manage', 'Create and revoke POS device activations')
on conflict (code) do update set description = excluded.description;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r
join app.permissions p on p.code = any (
  case lower(r.code::text)
    when 'owner' then array['devices.read', 'devices.manage']
    when 'admin' then array['devices.read', 'devices.manage']
    when 'manager' then array['devices.read']
    else array[]::text[]
  end
)
where lower(r.code::text) in ('owner', 'admin', 'manager')
on conflict do nothing;

create table app.pos_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  register_id uuid not null,
  location_id uuid not null,
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  activation_code_hash text unique,
  activation_expires_at timestamptz,
  token_hash text unique,
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, register_id) references app.registers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  constraint pos_devices_name_not_blank check (btrim(name) <> ''),
  constraint pos_devices_activation_hash_format check (
    activation_code_hash is null or activation_code_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint pos_devices_token_hash_format check (token_hash is null or token_hash ~ '^[a-f0-9]{64}$')
);

create table app.pos_employee_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  device_id uuid not null,
  register_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, device_id) references app.pos_devices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, register_id) references app.registers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references app.employees (tenant_id, id) on delete restrict,
  constraint pos_employee_sessions_expiry_after_creation check (expires_at > created_at)
);

create trigger pos_devices_set_updated_at
before update on app.pos_devices
for each row execute function app.set_updated_at();

create index pos_devices_tenant_register_idx on app.pos_devices (tenant_id, register_id, status);
create index pos_employee_sessions_device_idx on app.pos_employee_sessions (tenant_id, device_id, revoked_at, expires_at);
create index pos_employee_sessions_employee_idx on app.pos_employee_sessions (tenant_id, employee_id, created_at desc);

alter table app.pos_devices enable row level security;
alter table app.pos_employee_sessions enable row level security;
revoke all on table app.pos_devices, app.pos_employee_sessions from public, anon, authenticated, hcs_hyperdrive;

create function app.list_pos_devices(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.tenant_memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and (
        m.is_owner
        or exists (
          select 1
          from app.membership_roles mr
          join app.role_permissions rp
            on rp.tenant_id = mr.tenant_id
           and rp.role_id = mr.role_id
          where mr.tenant_id = m.tenant_id
            and mr.user_id = m.user_id
            and rp.permission_code in ('devices.read', 'devices.manage')
        )
      )
  ) then
    raise exception using errcode = 'HCS80', message = 'POS device access is not allowed';
  end if;

  return jsonb_build_object(
    'registers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'code', r.code::text,
        'name', r.name,
        'locationId', r.location_id,
        'locationName', l.name,
        'status', r.status
      ) order by l.name, r.name)
      from app.registers r
      join app.locations l on l.tenant_id = r.tenant_id and l.id = r.location_id
      where r.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'registerId', d.register_id,
        'registerName', r.name,
        'locationId', d.location_id,
        'locationName', l.name,
        'status', d.status,
        'activationExpiresAt', d.activation_expires_at,
        'activatedAt', d.activated_at,
        'lastSeenAt', d.last_seen_at,
        'createdAt', d.created_at
      ) order by d.created_at desc)
      from app.pos_devices d
      join app.registers r on r.tenant_id = d.tenant_id and r.id = d.register_id
      join app.locations l on l.tenant_id = d.tenant_id and l.id = d.location_id
      where d.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

create function app.create_pos_device_activation(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_register_id uuid,
  p_name text,
  p_activation_hash text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_location_id uuid;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if not exists (
    select 1 from app.tenant_memberships
    where tenant_id = p_tenant_id and user_id = p_actor_user_id and status = 'active' and is_owner
  ) then
    raise exception using errcode = 'HCS80', message = 'Owner access is required';
  end if;
  if p_activation_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'HCS81', message = 'Activation hash is invalid';
  end if;

  select r.location_id into v_location_id
  from app.registers r
  join app.locations l on l.tenant_id = r.tenant_id and l.id = r.location_id
  where r.tenant_id = p_tenant_id and r.id = p_register_id and r.status = 'active' and l.is_active
  for update of r;
  if v_location_id is null then
    raise exception using errcode = 'HCS82', message = 'Register is unavailable';
  end if;

  insert into app.pos_devices (
    tenant_id, register_id, location_id, name, activation_code_hash, activation_expires_at, created_by_user_id
  ) values (
    p_tenant_id, p_register_id, v_location_id, btrim(p_name), p_activation_hash, v_expires_at, p_actor_user_id
  ) returning id into v_device_id;

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'pos_device.activation_created', 'pos_device', v_device_id, v_location_id
  );

  return jsonb_build_object(
    'deviceId', v_device_id,
    'activationExpiresAt', v_expires_at,
    'status', 'pending'
  );
end;
$$;

create function app.activate_pos_device(
  p_activation_hash text,
  p_device_token_hash text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device app.pos_devices%rowtype;
  v_response jsonb;
begin
  if p_activation_hash !~ '^[a-f0-9]{64}$' or p_device_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_device
  from app.pos_devices
  where activation_code_hash = p_activation_hash
  for update;

  if v_device.id is null
    or v_device.status <> 'pending'
    or v_device.activation_expires_at <= now()
  then
    return jsonb_build_object('status', 'invalid');
  end if;

  update app.pos_devices
  set status = 'active',
      token_hash = p_device_token_hash,
      activation_code_hash = null,
      activation_expires_at = null,
      activated_at = now(),
      last_seen_at = now()
  where id = v_device.id;

  select jsonb_build_object(
    'status', 'active',
    'device', jsonb_build_object(
      'id', v_device.id,
      'name', v_device.name,
      'tenantName', t.name,
      'locationId', v_device.location_id,
      'locationName', l.name,
      'registerId', v_device.register_id,
      'registerName', r.name
    )
  ) into v_response
  from app.tenants t
  join app.locations l on l.tenant_id = t.id and l.id = v_device.location_id
  join app.registers r on r.tenant_id = t.id and r.id = v_device.register_id
  where t.id = v_device.tenant_id;

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, action, entity_type, entity_id, location_id
  ) values (
    v_device.tenant_id, p_request_id, 'system', 'pos_device.activated',
    'pos_device', v_device.id, v_device.location_id
  );

  return v_response;
end;
$$;

create function app.authenticate_pos_employee(
  p_device_token_hash text,
  p_employee_code text,
  p_pin text,
  p_session_token_hash text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device app.pos_devices%rowtype;
  v_employee app.employees%rowtype;
  v_credential app.employee_pos_credentials%rowtype;
  v_expires_at timestamptz := now() + interval '12 hours';
  v_locked_until timestamptz;
  v_response jsonb;
begin
  if p_device_token_hash !~ '^[a-f0-9]{64}$'
    or p_session_token_hash !~ '^[a-f0-9]{64}$'
    or p_pin !~ '^[0-9]{4,6}$'
  then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_device
  from app.pos_devices
  where token_hash = p_device_token_hash and status = 'active'
  for update;
  if v_device.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select e.* into v_employee
  from app.employees e
  join app.employee_locations el
    on el.tenant_id = e.tenant_id and el.employee_id = e.id and el.location_id = v_device.location_id
  where e.tenant_id = v_device.tenant_id
    and e.employee_code = btrim(p_employee_code)
    and e.status = 'active';
  if v_employee.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_credential
  from app.employee_pos_credentials
  where tenant_id = v_device.tenant_id and employee_id = v_employee.id
  for update;
  if v_credential.employee_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_credential.locked_until is not null and v_credential.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'lockedUntil', v_credential.locked_until);
  end if;

  if v_credential.pin_hash <> extensions.crypt(p_pin, v_credential.pin_hash) then
    v_locked_until := case when v_credential.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end;
    update app.employee_pos_credentials
    set failed_attempts = case when v_locked_until is null then failed_attempts + 1 else 0 end,
        locked_until = v_locked_until
    where tenant_id = v_device.tenant_id and employee_id = v_employee.id;
    if v_locked_until is not null then
      return jsonb_build_object('status', 'locked', 'lockedUntil', v_locked_until);
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;

  update app.employee_pos_credentials
  set failed_attempts = 0, locked_until = null
  where tenant_id = v_device.tenant_id and employee_id = v_employee.id;
  update app.pos_employee_sessions
  set revoked_at = now()
  where tenant_id = v_device.tenant_id and device_id = v_device.id and revoked_at is null;
  insert into app.pos_employee_sessions (
    tenant_id, device_id, register_id, location_id, employee_id, token_hash, expires_at
  ) values (
    v_device.tenant_id, v_device.id, v_device.register_id, v_device.location_id,
    v_employee.id, p_session_token_hash, v_expires_at
  );
  update app.pos_devices set last_seen_at = now() where id = v_device.id;

  select jsonb_build_object(
    'status', 'authenticated',
    'expiresAt', v_expires_at,
    'employee', jsonb_build_object(
      'id', v_employee.id,
      'employeeCode', v_employee.employee_code::text,
      'displayName', v_employee.display_name
    ),
    'device', jsonb_build_object(
      'id', v_device.id,
      'name', v_device.name,
      'tenantId', v_device.tenant_id,
      'tenantName', t.name,
      'locationId', v_device.location_id,
      'locationName', l.name,
      'registerId', v_device.register_id,
      'registerName', r.name
    )
  ) into v_response
  from app.tenants t
  join app.locations l on l.tenant_id = t.id and l.id = v_device.location_id
  join app.registers r on r.tenant_id = t.id and r.id = v_device.register_id
  where t.id = v_device.tenant_id;

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id
  ) values (
    v_device.tenant_id, p_request_id, 'pos_employee', v_employee.id,
    'pos_session.started', 'pos_device', v_device.id, v_device.location_id
  );

  return v_response;
end;
$$;

revoke all on function app.list_pos_devices(uuid, uuid) from public, anon, authenticated;
revoke all on function app.create_pos_device_activation(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function app.activate_pos_device(text, text, text) from public, anon, authenticated;
revoke all on function app.authenticate_pos_employee(text, text, text, text, text) from public, anon, authenticated;
grant execute on function app.list_pos_devices(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.create_pos_device_activation(uuid, uuid, uuid, text, text, text) to hcs_hyperdrive;
grant execute on function app.activate_pos_device(text, text, text) to hcs_hyperdrive;
grant execute on function app.authenticate_pos_employee(text, text, text, text, text) to hcs_hyperdrive;

commit;
