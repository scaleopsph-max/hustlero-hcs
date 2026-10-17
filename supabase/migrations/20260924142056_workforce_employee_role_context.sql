begin;

create or replace function app.list_workforce_context(
  p_actor_user_id uuid,
  p_tenant_id uuid
) returns jsonb
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
            and rp.permission_code in ('workforce.read', 'workforce.manage')
        )
      )
  ) then
    raise exception using errcode = 'HCS60', message = 'Workforce access is not allowed';
  end if;

  return jsonb_build_object(
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'code', l.code::text,
        'name', l.name,
        'kind', l.kind,
        'timezone', l.timezone,
        'isActive', l.is_active
      ) order by l.name)
      from app.locations l
      where l.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'code', r.code::text,
        'name', r.name,
        'isSystemTemplate', r.is_system_template,
        'permissions', (
          select coalesce(jsonb_agg(rp.permission_code order by rp.permission_code), '[]'::jsonb)
          from app.role_permissions rp
          where rp.tenant_id = r.tenant_id
            and rp.role_id = r.id
        )
      ) order by r.name)
      from app.roles r
      where r.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'employeeCode', e.employee_code::text,
        'displayName', e.display_name,
        'status', e.status,
        'hasPosPin', c.employee_id is not null,
        'roleIds', (
          select coalesce(jsonb_agg(er.role_id order by er.role_id), '[]'::jsonb)
          from app.employee_roles er
          where er.tenant_id = e.tenant_id
            and er.employee_id = e.id
        ),
        'locationIds', (
          select coalesce(jsonb_agg(el.location_id order by el.location_id), '[]'::jsonb)
          from app.employee_locations el
          where el.tenant_id = e.tenant_id
            and el.employee_id = e.id
        )
      ) order by e.display_name)
      from app.employees e
      left join app.employee_pos_credentials c
        on c.tenant_id = e.tenant_id
       and c.employee_id = e.id
      where e.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'registers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'locationId', r.location_id,
        'locationName', l.name,
        'code', r.code::text,
        'name', r.name,
        'status', r.status
      ) order by l.name, r.name)
      from app.registers r
      join app.locations l
        on l.tenant_id = r.tenant_id
       and l.id = r.location_id
      where r.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app.list_workforce_context(uuid, uuid) from public, anon, authenticated;
grant execute on function app.list_workforce_context(uuid, uuid) to hcs_hyperdrive;

commit;
