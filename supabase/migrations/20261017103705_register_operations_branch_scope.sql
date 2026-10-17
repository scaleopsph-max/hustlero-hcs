begin;

alter function app.list_register_operations(uuid,uuid) rename to register_operations_scope_core;
revoke all on function app.register_operations_scope_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.list_register_operations(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_rows jsonb; v_employees jsonb; v_history jsonb; v_register_access boolean;
begin
  v_result:=app.register_operations_scope_core(p_actor_user_id,p_tenant_id);
  if exists(select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id
    and status='active' and is_owner) then return v_result; end if;

  select exists(select 1 from app.membership_roles mr join app.role_permissions rp
    on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=p_tenant_id and mr.user_id=p_actor_user_id
      and rp.permission_code in ('registers.read','registers.operate')) into v_register_access;
  -- Payment-method access alone does not authorize employee details or register cash totals.
  if not v_register_access then
    return v_result || jsonb_build_object('employees','[]'::jsonb,'registers','[]'::jsonb,'recentSessions','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into v_rows
  from jsonb_array_elements(v_result->'registers') with ordinality item(value,ordinality)
  where app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,(item.value->>'locationId')::uuid);

  select coalesce(jsonb_agg(item.value || jsonb_build_object('locationIds',allowed.ids) order by item.ordinality),'[]'::jsonb)
  into v_employees
  from jsonb_array_elements(v_result->'employees') with ordinality item(value,ordinality)
  cross join lateral (
    select coalesce(jsonb_agg(location.value order by location.value),'[]'::jsonb) ids
    from jsonb_array_elements_text(item.value->'locationIds') location(value)
    where app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location.value::uuid)
  ) allowed
  where jsonb_array_length(allowed.ids)>0;

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
    order by session.opened_at desc,session.id limit 50
  ) s join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id
    join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id
    join app.employees e on e.tenant_id=s.tenant_id and e.id=s.employee_id;

  return v_result || jsonb_build_object('employees',v_employees,'registers',v_rows,'recentSessions',v_history);
end;
$$;
revoke all on function app.list_register_operations(uuid,uuid) from public,anon,authenticated;
grant execute on function app.list_register_operations(uuid,uuid) to hcs_hyperdrive;

commit;
