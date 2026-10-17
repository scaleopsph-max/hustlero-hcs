begin;

alter function app.list_approval_center(uuid,uuid) rename to approval_center_scope_core;
alter function app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text) rename to approval_decision_scope_core;
revoke all on function app.approval_center_scope_core(uuid,uuid),
 app.approval_decision_scope_core(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.list_approval_center(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 v_result:=app.approval_center_scope_core(p_actor_user_id,p_tenant_id);
 return jsonb_set(v_result,'{requests}',app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'requests','locationId'));
end;
$$;

create function app.decide_approval_request(p_actor_user_id uuid,p_tenant_id uuid,p_approval_request_id uuid,
 p_decision text,p_note text,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_result jsonb;
begin
 if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id
  and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr
   join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='approvals.manage')))
 then raise exception using errcode='HCS23',message='Approval management is not allowed'; end if;
 select location_id into v_location from app.approval_requests where tenant_id=p_tenant_id and id=p_approval_request_id;
 if not app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,v_location) then
  raise exception using errcode='HCS25',message='Approval request was not found';
 end if;
 v_result:=app.approval_decision_scope_core(p_actor_user_id,p_tenant_id,p_approval_request_id,p_decision,p_note,
  p_idempotency_key,p_request_hash,p_request_id);
 if v_result->>'approvalRequestId' is distinct from p_approval_request_id::text then
  raise exception using errcode='HCS08',message='Idempotency key conflict';
 end if;
 return v_result;
end;
$$;
revoke all on function app.list_approval_center(uuid,uuid),app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function app.list_approval_center(uuid,uuid),app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text)
 to hcs_hyperdrive;

commit;
