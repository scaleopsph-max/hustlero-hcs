begin;

insert into app.permissions(code,description) values('registers.read_own','View own employee register sessions') on conflict(code) do nothing;
-- Correct only the locked system cashier template; custom role permissions stay explicit.
insert into app.role_permissions(tenant_id,role_id,permission_code)
select tenant_id,id,'registers.read_own' from app.roles where is_system_template and lower(code::text)='cashier'
on conflict do nothing;
delete from app.role_permissions rp using app.roles r where rp.tenant_id=r.tenant_id and rp.role_id=r.id
 and r.is_system_template and lower(r.code::text)='cashier' and rp.permission_code='registers.read';

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
    when 'cashier' then array['inventory.read','payments.read','registers.read_own','registers.operate']
    when 'inventory_staff' then array['inventory.read','inventory.manage','purchasing.read','transfers.read','transfers.manage']
    else array[]::text[] end)
  where role.tenant_id = new.id and lower(role.code::text) in ('admin','manager','cashier','inventory_staff')
  on conflict do nothing;
  return new;
end;
$$;

create or replace function app.list_register_operations(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_rows jsonb; v_employees jsonb; v_history jsonb; v_register_access boolean; v_branch_read boolean; v_employee uuid;
begin
  v_result:=app.register_operations_scope_core(p_actor_user_id,p_tenant_id);
  if exists(select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id
    and status='active' and is_owner) then return v_result; end if;

  select exists(select 1 from app.membership_roles mr join app.role_permissions rp
    on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=p_tenant_id and mr.user_id=p_actor_user_id
      and rp.permission_code in ('registers.read','registers.read_own','registers.operate')) into v_register_access;
  -- Payment-method access alone does not authorize employee details or register cash totals.
  if not v_register_access then
    return v_result || jsonb_build_object('employees','[]'::jsonb,'registers','[]'::jsonb,'recentSessions','[]'::jsonb);
  end if;

  select exists(select 1 from app.membership_roles mr join app.role_permissions rp
   on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant_id and mr.user_id=p_actor_user_id and rp.permission_code='registers.read') into v_branch_read;
  select id into v_employee from app.employees where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active';

  select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into v_rows
  from jsonb_array_elements(v_result->'registers') with ordinality item(value,ordinality)
  where app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,(item.value->>'locationId')::uuid)
    and (v_branch_read or item.value->'currentSession'->>'employeeId'=v_employee::text);

  select coalesce(jsonb_agg(item.value || jsonb_build_object('locationIds',allowed.ids) order by item.ordinality),'[]'::jsonb)
  into v_employees
  from jsonb_array_elements(v_result->'employees') with ordinality item(value,ordinality)
  cross join lateral (
    select coalesce(jsonb_agg(location.value order by location.value),'[]'::jsonb) ids
    from jsonb_array_elements_text(item.value->'locationIds') location(value)
    where app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location.value::uuid)
  ) allowed
  where jsonb_array_length(allowed.ids)>0 and (v_branch_read or item.value->>'id'=v_employee::text);

  -- Rebuild history with authorization before LIMIT, not by filtering the old tenant-wide page.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'registerId',s.register_id,'registerName',r.name,'locationName',l.name,
    'employeeName',e.display_name,'status',s.status,'openingCashCentavos',round(s.opening_cash*100)::bigint,
    'expectedCashCentavos',case when s.expected_cash is null then null else round(s.expected_cash*100)::bigint end,
    'countedCashCentavos',case when s.counted_cash is null then null else round(s.counted_cash*100)::bigint end,
    'varianceCentavos',case when s.variance is null then null else round(s.variance*100)::bigint end,
    'openedAt',s.opened_at,'closedAt',s.closed_at) order by s.opened_at desc,s.id),'[]'::jsonb) into v_history
  from (
    select * from app.register_sessions session where session.tenant_id=p_tenant_id
      and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,session.location_id)
      and (v_branch_read or session.employee_id=v_employee)
    order by session.opened_at desc,session.id limit 50
  ) s join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id
    join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id
    join app.employees e on e.tenant_id=s.tenant_id and e.id=s.employee_id;

  return v_result || jsonb_build_object('employees',v_employees,'registers',v_rows,'recentSessions',v_history);
end;
$$;

create or replace function app.register_operations_scope_core(p_actor_user_id uuid, p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_actor_user_id
      and m.status = 'active' and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = m.tenant_id and mr.user_id = m.user_id and rp.permission_code in ('payments.read','payments.manage','registers.read','registers.read_own','registers.operate')
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

commit;
