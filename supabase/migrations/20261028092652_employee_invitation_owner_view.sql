begin;
alter function app.list_workforce_context(uuid,uuid) rename to workforce_invitation_view_core;
revoke all on function app.workforce_invitation_view_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.list_workforce_context(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 v_result:=app.workforce_invitation_view_core(p_actor,p_tenant);
 if not exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner) then return v_result; end if;
 return v_result || jsonb_build_object('pendingEmployeeInvitations',coalesce((
  select jsonb_agg(jsonb_build_object('invitationId',q.id,'employeeId',q.employee_id,'email',q.email,'expiresAt',q.expires_at) order by q.created_at desc,q.id)
  from (select id,employee_id,email,expires_at,created_at from app.employee_membership_invitations where tenant_id=p_tenant and status='pending' order by created_at desc,id limit 100) q
 ),'[]'::jsonb));
end; $$;
revoke all on function app.list_workforce_context(uuid,uuid) from public,anon,authenticated;
grant execute on function app.list_workforce_context(uuid,uuid) to hcs_hyperdrive;
commit;
