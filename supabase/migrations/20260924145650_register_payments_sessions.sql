begin;

insert into app.permissions (code, description) values
  ('payments.read', 'View tenant payment methods'),
  ('payments.manage', 'Manage tenant payment methods'),
  ('registers.read', 'View register sessions and cash totals'),
  ('registers.operate', 'Open and close register sessions')
on conflict (code) do update set description = excluded.description;

create table app.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  method_type text not null check (method_type in ('cash', 'e_wallet', 'bank_transfer', 'card_terminal', 'other')),
  is_active boolean not null default true,
  is_system_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  constraint payment_methods_code_not_blank check (btrim(code::text) <> ''),
  constraint payment_methods_name_not_blank check (btrim(name) <> '')
);

create table app.register_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  register_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed', 'exception')),
  opening_cash numeric(18,2) not null check (opening_cash >= 0),
  expected_cash numeric(18,2),
  counted_cash numeric(18,2),
  variance numeric(18,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by_user_id uuid,
  closed_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, register_id) references app.registers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, employee_id) references app.employees (tenant_id, id) on delete restrict,
  foreign key (tenant_id, opened_by_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, closed_by_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint register_sessions_closed_values check (
    (status = 'open' and expected_cash is null and counted_cash is null and variance is null and closed_at is null)
    or (status in ('closed', 'exception') and expected_cash is not null and counted_cash is not null and variance is not null and closed_at is not null)
  )
);
create unique index register_sessions_one_open_per_register_idx
  on app.register_sessions (tenant_id, register_id) where status = 'open';
create index register_sessions_tenant_opened_idx on app.register_sessions (tenant_id, opened_at desc);

create table app.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  register_session_id uuid not null,
  location_id uuid not null,
  movement_type text not null check (movement_type in ('opening_cash', 'cash_sale', 'cash_refund', 'cash_in', 'cash_out', 'shift_expense', 'adjustment', 'close_variance')),
  amount numeric(18,2) not null,
  source_type text not null,
  source_id uuid,
  reason text,
  actor_user_id uuid,
  actor_employee_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, register_session_id) references app.register_sessions (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, actor_employee_id) references app.employees (tenant_id, id) on delete restrict,
  constraint cash_movement_amount_direction check (
    (movement_type = 'opening_cash' and amount >= 0)
    or (movement_type in ('cash_sale', 'cash_in') and amount > 0)
    or (movement_type in ('cash_refund', 'cash_out', 'shift_expense') and amount < 0)
    or (movement_type in ('adjustment', 'close_variance') and amount <> 0)
  ),
  constraint cash_movement_source_not_blank check (btrim(source_type) <> '')
);
create index cash_movements_session_occurred_idx on app.cash_movements (tenant_id, register_session_id, occurred_at);

create trigger payment_methods_set_updated_at before update on app.payment_methods
for each row execute function app.set_updated_at();
create trigger register_sessions_set_updated_at before update on app.register_sessions
for each row execute function app.set_updated_at();

create function app.reject_cash_movement_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'HCS70', message = 'Cash movements are append-only';
end;
$$;
create trigger cash_movements_append_only before update or delete on app.cash_movements
for each row execute function app.reject_cash_movement_mutation();

alter table app.payment_methods enable row level security;
alter table app.register_sessions enable row level security;
alter table app.cash_movements enable row level security;
revoke all on table app.payment_methods, app.register_sessions, app.cash_movements from public, anon, authenticated, hcs_hyperdrive;
revoke all on function app.reject_cash_movement_mutation() from public, anon, authenticated, hcs_hyperdrive;

insert into app.payment_methods (tenant_id, code, name, method_type, is_system_default)
select t.id, defaults.code, defaults.name, defaults.method_type, true
from app.tenants t
cross join (values
  ('cash', 'Cash', 'cash'),
  ('e_wallet', 'E-wallet', 'e_wallet'),
  ('bank_transfer', 'Bank Transfer', 'bank_transfer'),
  ('card_terminal', 'Card Terminal', 'card_terminal')
) defaults(code, name, method_type)
on conflict (tenant_id, code) do nothing;

create function app.initialize_tenant_payment_methods() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.payment_methods (tenant_id, code, name, method_type, is_system_default) values
    (new.id, 'cash', 'Cash', 'cash', true),
    (new.id, 'e_wallet', 'E-wallet', 'e_wallet', true),
    (new.id, 'bank_transfer', 'Bank Transfer', 'bank_transfer', true),
    (new.id, 'card_terminal', 'Card Terminal', 'card_terminal', true)
  on conflict (tenant_id, code) do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_tenant_payment_methods() from public, anon, authenticated;
create trigger tenants_initialize_payment_methods after insert on app.tenants
for each row execute function app.initialize_tenant_payment_methods();

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r
join app.permissions p on p.code = any(case lower(r.code::text)
  when 'admin' then array['payments.read','payments.manage','registers.read','registers.operate']
  when 'manager' then array['payments.read','registers.read','registers.operate']
  when 'cashier' then array['payments.read','registers.read','registers.operate']
  else array[]::text[] end)
where lower(r.code::text) in ('admin','manager','cashier')
on conflict do nothing;
insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code from app.roles r cross join app.permissions p
where lower(r.code::text) = 'owner' and p.code in ('payments.read','payments.manage','registers.read','registers.operate')
on conflict do nothing;

create or replace function app.initialize_tenant_staff_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.roles (tenant_id, code, name, is_system_template) values
    (new.id, 'admin', 'Admin', true),
    (new.id, 'manager', 'Manager', true),
    (new.id, 'cashier', 'Cashier', true),
    (new.id, 'inventory_staff', 'Inventory Staff', true)
  on conflict do nothing;
  insert into app.role_permissions (tenant_id, role_id, permission_code)
  select role.tenant_id, role.id, permission.code
  from app.roles role
  join app.permissions permission on permission.code = any(case lower(role.code::text)
    when 'admin' then array['workforce.read','workforce.manage','locations.manage','inventory.read','inventory.manage','purchasing.read','purchasing.manage','transfers.read','transfers.manage','payments.read','payments.manage','registers.read','registers.operate']
    when 'manager' then array['workforce.read','inventory.read','inventory.manage','purchasing.read','purchasing.manage','transfers.read','transfers.manage','payments.read','registers.read','registers.operate']
    when 'cashier' then array['inventory.read','payments.read','registers.read','registers.operate']
    when 'inventory_staff' then array['inventory.read','inventory.manage','purchasing.read','transfers.read','transfers.manage']
    else array[]::text[] end)
  where role.tenant_id = new.id and lower(role.code::text) in ('admin','manager','cashier','inventory_staff')
  on conflict do nothing;
  return new;
end;
$$;

create function app.list_register_operations(p_actor_user_id uuid, p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_actor_user_id
      and m.status = 'active' and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = m.tenant_id and mr.user_id = m.user_id and rp.permission_code in ('payments.read','payments.manage','registers.read','registers.operate')
      ))
  ) then raise exception using errcode = 'HCS71', message = 'Register operations access is not allowed'; end if;

  return jsonb_build_object(
    'paymentMethods', coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'code', pm.code::text, 'name', pm.name, 'methodType', pm.method_type, 'isActive', pm.is_active, 'isSystemDefault', pm.is_system_default) order by pm.name) from app.payment_methods pm where pm.tenant_id = p_tenant_id), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'employeeCode', e.employee_code::text, 'displayName', e.display_name, 'locationIds', (select coalesce(jsonb_agg(el.location_id order by el.location_id), '[]'::jsonb) from app.employee_locations el where el.tenant_id = e.tenant_id and el.employee_id = e.id)) order by e.display_name) from app.employees e where e.tenant_id = p_tenant_id and e.status = 'active'), '[]'::jsonb),
    'registers', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code::text, 'name', r.name, 'locationId', r.location_id, 'locationName', l.name, 'status', r.status, 'currentSession', case when s.id is null then null else jsonb_build_object('id', s.id, 'employeeId', s.employee_id, 'employeeName', e.display_name, 'openingCashCentavos', round(s.opening_cash * 100)::bigint, 'openedAt', s.opened_at) end) order by l.name, r.name) from app.registers r join app.locations l on l.tenant_id = r.tenant_id and l.id = r.location_id left join app.register_sessions s on s.tenant_id = r.tenant_id and s.register_id = r.id and s.status = 'open' left join app.employees e on e.tenant_id = s.tenant_id and e.id = s.employee_id where r.tenant_id = p_tenant_id), '[]'::jsonb),
    'recentSessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'registerId', s.register_id, 'registerName', r.name, 'locationName', l.name, 'employeeName', e.display_name, 'status', s.status, 'openingCashCentavos', round(s.opening_cash * 100)::bigint, 'expectedCashCentavos', case when s.expected_cash is null then null else round(s.expected_cash * 100)::bigint end, 'countedCashCentavos', case when s.counted_cash is null then null else round(s.counted_cash * 100)::bigint end, 'varianceCentavos', case when s.variance is null then null else round(s.variance * 100)::bigint end, 'openedAt', s.opened_at, 'closedAt', s.closed_at) order by s.opened_at desc) from (select * from app.register_sessions where tenant_id = p_tenant_id order by opened_at desc limit 50) s join app.registers r on r.tenant_id = s.tenant_id and r.id = s.register_id join app.locations l on l.tenant_id = s.tenant_id and l.id = s.location_id join app.employees e on e.tenant_id = s.tenant_id and e.id = s.employee_id), '[]'::jsonb)
  );
end;
$$;

create function app.create_payment_method(p_actor_user_id uuid, p_tenant_id uuid, p_code text, p_name text, p_method_type text, p_idempotency_key text, p_request_hash text, p_request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_id uuid; v_response jsonb;
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant_id and user_id = p_actor_user_id and status = 'active' and is_owner) then raise exception using errcode = 'HCS71', message = 'Owner access is required'; end if;
  if p_method_type not in ('cash','e_wallet','bank_transfer','card_terminal','other') then raise exception using errcode = 'HCS72', message = 'Payment method type is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':payment-method.create:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id and operation = 'payment-method.create' and idempotency_key = p_idempotency_key;
  if found then if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at) values (p_tenant_id, 'payment-method.create', p_idempotency_key, p_request_hash, now() + interval '24 hours'); end if;
  insert into app.payment_methods (tenant_id, code, name, method_type) values (p_tenant_id, btrim(p_code), btrim(p_name), p_method_type) returning id into v_id;
  v_response := jsonb_build_object('paymentMethodId', v_id, 'status', 'created');
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id) values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'payment_method.created', 'payment_method', v_id);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload) values (p_tenant_id, 'payment_method.created', 'payment_method', v_id, v_response);
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now() where tenant_id = p_tenant_id and operation = 'payment-method.create' and idempotency_key = p_idempotency_key;
  return v_response;
exception when unique_violation then raise exception using errcode = 'HCS73', message = 'Payment method code already exists'; end;
$$;

create function app.open_register_session(p_actor_user_id uuid, p_tenant_id uuid, p_register_id uuid, p_employee_id uuid, p_opening_cash_centavos bigint, p_idempotency_key text, p_request_hash text, p_request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_location_id uuid; v_session_id uuid; v_response jsonb; v_opening numeric(18,2);
begin
  if p_opening_cash_centavos < 0 then raise exception using errcode = 'HCS74', message = 'Opening cash cannot be negative'; end if;
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant_id and user_id = p_actor_user_id and status = 'active' and is_owner) then raise exception using errcode = 'HCS71', message = 'Owner access is required'; end if;
  select location_id into v_location_id from app.registers where tenant_id = p_tenant_id and id = p_register_id and status = 'active' for update;
  if not found then raise exception using errcode = 'HCS75', message = 'Active register was not found'; end if;
  if not exists (select 1 from app.employees e join app.employee_locations el on el.tenant_id = e.tenant_id and el.employee_id = e.id where e.tenant_id = p_tenant_id and e.id = p_employee_id and e.status = 'active' and el.location_id = v_location_id) then raise exception using errcode = 'HCS76', message = 'Employee is not active at this location'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':register-session.open:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id and operation = 'register-session.open' and idempotency_key = p_idempotency_key;
  if found then if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at) values (p_tenant_id, 'register-session.open', p_idempotency_key, p_request_hash, now() + interval '24 hours'); end if;
  if exists (select 1 from app.register_sessions where tenant_id = p_tenant_id and register_id = p_register_id and status = 'open') then raise exception using errcode = 'HCS77', message = 'Register already has an open session'; end if;
  v_opening := p_opening_cash_centavos::numeric / 100;
  insert into app.register_sessions (tenant_id, register_id, location_id, employee_id, opening_cash, opened_by_user_id) values (p_tenant_id, p_register_id, v_location_id, p_employee_id, v_opening, p_actor_user_id) returning id into v_session_id;
  insert into app.cash_movements (tenant_id, register_session_id, location_id, movement_type, amount, source_type, source_id, actor_user_id, actor_employee_id) values (p_tenant_id, v_session_id, v_location_id, 'opening_cash', v_opening, 'register_session', v_session_id, p_actor_user_id, p_employee_id);
  v_response := jsonb_build_object('registerSessionId', v_session_id, 'status', 'open');
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata) values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'register.opened', 'register_session', v_session_id, v_location_id, jsonb_build_object('registerId', p_register_id, 'employeeId', p_employee_id, 'openingCashCentavos', p_opening_cash_centavos));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload) values (p_tenant_id, 'register.opened', 'register_session', v_session_id, v_response);
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now() where tenant_id = p_tenant_id and operation = 'register-session.open' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.close_register_session(p_actor_user_id uuid, p_tenant_id uuid, p_session_id uuid, p_counted_cash_centavos bigint, p_idempotency_key text, p_request_hash text, p_request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_session app.register_sessions%rowtype; v_expected numeric(18,2); v_counted numeric(18,2); v_variance numeric(18,2); v_response jsonb;
begin
  if p_counted_cash_centavos < 0 then raise exception using errcode = 'HCS74', message = 'Counted cash cannot be negative'; end if;
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant_id and user_id = p_actor_user_id and status = 'active' and is_owner) then raise exception using errcode = 'HCS71', message = 'Owner access is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':register-session.close:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id and operation = 'register-session.close' and idempotency_key = p_idempotency_key;
  if found then if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at) values (p_tenant_id, 'register-session.close', p_idempotency_key, p_request_hash, now() + interval '24 hours'); end if;
  select * into v_session from app.register_sessions where tenant_id = p_tenant_id and id = p_session_id for update;
  if not found or v_session.status <> 'open' then raise exception using errcode = 'HCS78', message = 'Open register session was not found'; end if;
  select coalesce(sum(amount), 0) into v_expected from app.cash_movements where tenant_id = p_tenant_id and register_session_id = p_session_id and movement_type <> 'close_variance';
  v_counted := p_counted_cash_centavos::numeric / 100; v_variance := v_counted - v_expected;
  update app.register_sessions set status = case when v_variance = 0 then 'closed' else 'exception' end, expected_cash = v_expected, counted_cash = v_counted, variance = v_variance, closed_at = now(), closed_by_user_id = p_actor_user_id where tenant_id = p_tenant_id and id = p_session_id;
  if v_variance <> 0 then insert into app.cash_movements (tenant_id, register_session_id, location_id, movement_type, amount, source_type, source_id, reason, actor_user_id, actor_employee_id) values (p_tenant_id, p_session_id, v_session.location_id, 'close_variance', v_variance, 'register_session', p_session_id, 'Counted cash variance at register close', p_actor_user_id, v_session.employee_id); end if;
  v_response := jsonb_build_object('registerSessionId', p_session_id, 'status', case when v_variance = 0 then 'closed' else 'exception' end, 'expectedCashCentavos', round(v_expected * 100)::bigint, 'countedCashCentavos', p_counted_cash_centavos, 'varianceCentavos', round(v_variance * 100)::bigint);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata) values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'register.closed', 'register_session', p_session_id, v_session.location_id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload) values (p_tenant_id, 'register.closed', 'register_session', p_session_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now() where tenant_id = p_tenant_id and operation = 'register-session.close' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function app.list_register_operations(uuid,uuid), app.create_payment_method(uuid,uuid,text,text,text,text,text,text), app.open_register_session(uuid,uuid,uuid,uuid,bigint,text,text,text), app.close_register_session(uuid,uuid,uuid,bigint,text,text,text) from public, anon, authenticated;
grant execute on function app.list_register_operations(uuid,uuid), app.create_payment_method(uuid,uuid,text,text,text,text,text,text), app.open_register_session(uuid,uuid,uuid,uuid,bigint,text,text,text), app.close_register_session(uuid,uuid,uuid,bigint,text,text,text) to hcs_hyperdrive;

commit;
