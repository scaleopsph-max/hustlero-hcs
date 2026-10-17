begin;

alter function app.list_workforce_context(uuid,uuid) rename to workforce_context_scope_core;
revoke all on function app.workforce_context_scope_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.list_workforce_context(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_employees jsonb;
begin
 v_result:=app.workforce_context_scope_core(p_actor_user_id,p_tenant_id);
 if exists(select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id
  and status='active' and is_owner) then return v_result; end if;

 select coalesce(jsonb_agg(item.value || jsonb_build_object('locationIds',allowed.ids) order by item.ordinality),'[]'::jsonb)
 into v_employees
 from jsonb_array_elements(v_result->'employees') with ordinality item(value,ordinality)
 cross join lateral (
  select coalesce(jsonb_agg(location.value order by location.value),'[]'::jsonb) ids
  from jsonb_array_elements_text(item.value->'locationIds') location(value)
  where app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location.value::uuid)
 ) allowed
 where jsonb_array_length(allowed.ids)>0;

 return v_result || jsonb_build_object(
  'locations',app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'locations','id'),
  'employees',v_employees,
  'registers',app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'registers','locationId'));
end;
$$;
revoke all on function app.list_workforce_context(uuid,uuid) from public,anon,authenticated;
grant execute on function app.list_workforce_context(uuid,uuid) to hcs_hyperdrive;

commit;
