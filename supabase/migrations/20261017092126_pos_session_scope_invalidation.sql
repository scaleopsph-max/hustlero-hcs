begin;

-- Session credentials are mutable security state, not the append-only commerce ledger.
create function app.pos_session_scope_is_active(p_session app.pos_employee_sessions)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists (
    select 1 from app.tenants tenant
    join app.employees employee on employee.tenant_id=tenant.id and employee.id=(p_session).employee_id and employee.status='active'
    join app.employee_locations assignment on assignment.tenant_id=employee.tenant_id
      and assignment.employee_id=employee.id and assignment.location_id=(p_session).location_id
    join app.locations location on location.tenant_id=tenant.id and location.id=(p_session).location_id and location.is_active
    join app.registers register on register.tenant_id=tenant.id and register.id=(p_session).register_id
      and register.location_id=location.id and register.status='active'
    join app.pos_devices device on device.tenant_id=tenant.id and device.id=(p_session).device_id
      and device.register_id=register.id and device.location_id=location.id and device.status='active'
    where tenant.id=(p_session).tenant_id and tenant.status='active'
  );
$$;
revoke all on function app.pos_session_scope_is_active(app.pos_employee_sessions) from public,anon,authenticated,hcs_hyperdrive;

create function app.guard_pos_session_scope() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.revoked_at is null and new.expires_at>statement_timestamp() and not app.pos_session_scope_is_active(new) then
    raise exception using errcode='HCS90',message='POS session is invalid or expired';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_pos_session_scope() from public,anon,authenticated,hcs_hyperdrive;
create trigger pos_employee_sessions_scope_guard before insert or update on app.pos_employee_sessions
  for each row execute function app.guard_pos_session_scope();

create index pos_employee_sessions_unrevoked_tenant_expiry_idx on app.pos_employee_sessions(tenant_id,expires_at)
  where revoked_at is null;

create function app.invalidate_out_of_scope_pos_sessions() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_old jsonb; v_new jsonb; v_tenant uuid;
begin
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  for v_tenant in select distinct value::uuid from unnest(array[
    case when tg_table_name='tenants' then v_old->>'id' else v_old->>'tenant_id' end,
    case when tg_table_name='tenants' then v_new->>'id' else v_new->>'tenant_id' end
  ]) value where value is not null order by value::uuid loop
    update app.pos_employee_sessions session set revoked_at=clock_timestamp()
    where session.tenant_id=v_tenant and session.revoked_at is null and session.expires_at>statement_timestamp()
      and not app.pos_session_scope_is_active(session);
  end loop;
  return null;
end;
$$;
revoke all on function app.invalidate_out_of_scope_pos_sessions() from public,anon,authenticated,hcs_hyperdrive;

create trigger employees_invalidate_pos_scope after update of status,tenant_id on app.employees
  for each row execute function app.invalidate_out_of_scope_pos_sessions();
create trigger employee_locations_invalidate_pos_scope after delete or update on app.employee_locations
  for each row execute function app.invalidate_out_of_scope_pos_sessions();
create trigger locations_invalidate_pos_scope after update of is_active,tenant_id on app.locations
  for each row execute function app.invalidate_out_of_scope_pos_sessions();
create trigger registers_invalidate_pos_scope after update of status,location_id,tenant_id on app.registers
  for each row execute function app.invalidate_out_of_scope_pos_sessions();
create trigger pos_devices_invalidate_pos_scope after update of status,register_id,location_id,tenant_id on app.pos_devices
  for each row execute function app.invalidate_out_of_scope_pos_sessions();
create trigger tenants_invalidate_pos_scope after update of status on app.tenants
  for each row execute function app.invalidate_out_of_scope_pos_sessions();

-- Existing out-of-scope credentials must not survive migration merely because no new edit occurs.
update app.pos_employee_sessions session set revoked_at=clock_timestamp()
where session.revoked_at is null and session.expires_at>statement_timestamp()
  and not app.pos_session_scope_is_active(session);

alter function app.authenticate_pos_employee(text,text,text,text,text) rename to authenticate_pos_employee_scope_core;
revoke all on function app.authenticate_pos_employee_scope_core(text,text,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
create function app.authenticate_pos_employee(p_device_token_hash text,p_employee_code text,p_pin text,p_session_token_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return app.authenticate_pos_employee_scope_core(p_device_token_hash,p_employee_code,p_pin,p_session_token_hash,p_request_id);
exception when sqlstate 'HCS90' then
  -- A newly invalid scope is an ordinary opaque login denial, never a minted credential or a 500.
  return jsonb_build_object('status','invalid');
end;
$$;
revoke all on function app.authenticate_pos_employee(text,text,text,text,text) from public,anon,authenticated;
grant execute on function app.authenticate_pos_employee(text,text,text,text,text) to hcs_hyperdrive;

commit;
