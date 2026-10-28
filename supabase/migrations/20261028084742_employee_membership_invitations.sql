begin;

-- Invitations never contain bearer tokens and never send email. Only a signed-in,
-- email-verified user matching the invitation can accept it.
create table app.employee_membership_invitations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references app.tenants(id) on delete restrict,
 employee_id uuid not null,
 email extensions.citext not null,
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 created_by uuid not null,
 accepted_by uuid references auth.users(id) on delete restrict,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,employee_id) references app.employees(tenant_id,id) on delete restrict,
 foreign key(tenant_id,created_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict,
 check(length(btrim(email::text)) between 3 and 254),
 check((status='accepted')=(accepted_by is not null))
);
create unique index employee_invitation_pending_employee on app.employee_membership_invitations(tenant_id,employee_id) where status='pending';
create index employee_invitation_email_lookup on app.employee_membership_invitations(email) where status='pending';
alter table app.employee_membership_invitations enable row level security;
revoke all on app.employee_membership_invitations from public,anon,authenticated,hcs_hyperdrive;

create function app.create_employee_membership_invitation(p_actor uuid,p_tenant uuid,p_employee uuid,p_email text,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(btrim(p_email));v_old app.idempotency_records%rowtype;v_hash text;v_id uuid;v_result jsonb;v_time timestamptz;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCPC0',message='Access denied'; end if;
 perform 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner for share;
 if not found then raise exception using errcode='HCPC0',message='Access denied'; end if;
 if p_employee is null or v_email is null or length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='HCPC2',message='Invalid invitation'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'employee',p_employee,'email',v_email)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':employee.invitation:'||p_key,0));
 select * into v_old from app.idempotency_records where tenant_id=p_tenant and operation='employee.invitation' and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_old.completed_at is not null then return v_old.response_body; end if;
 end if;
 perform 1 from app.employees where tenant_id=p_tenant and id=p_employee and status='active' and user_id is null for update;
 if not found then raise exception using errcode='HCPC1',message='Active unlinked employee required'; end if;
 -- Expired requests are retained and closed before a replacement can be issued.
 update app.employee_membership_invitations set status='revoked',updated_at=clock_timestamp() where tenant_id=p_tenant and employee_id=p_employee and status='pending' and expires_at<=clock_timestamp();
 v_time:=clock_timestamp();
 insert into app.employee_membership_invitations(tenant_id,employee_id,email,created_by,expires_at,created_at,updated_at)
 values(p_tenant,p_employee,v_email,p_actor,v_time+interval '7 days',v_time,v_time) returning id into v_id;
 v_result:=jsonb_build_object('invitationId',v_id,'employeeId',p_employee,'email',v_email,'expiresAt',v_time+interval '7 days');
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'employee.invitation_created','employee',p_employee,jsonb_build_object('invitationId',v_id),v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'employee.invitation',p_key,v_hash,201,v_result,v_time,v_time+interval '24 hours');
 return v_result;
exception when unique_violation then raise exception using errcode='HCPC3',message='A pending invitation already exists';
end; $$;

create function app.accept_employee_membership_invitation(p_actor uuid,p_invitation uuid,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_inv app.employee_membership_invitations%rowtype;v_email text;v_result jsonb;v_time timestamptz;v_old app.idempotency_records%rowtype;v_hash text;
begin
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='HCPC2',message='Invalid request key'; end if;
 select lower(btrim(email::text)) into v_email from auth.users where id=p_actor and email_confirmed_at is not null for share;
 if not found then raise exception using errcode='HCPC0',message='Verified email required'; end if;
 select * into v_inv from app.employee_membership_invitations where id=p_invitation and email=v_email::extensions.citext;
 if not found then raise exception using errcode='HCPC1',message='Invitation not found'; end if;
 perform 1 from app.tenants where id=v_inv.tenant_id and status='active' for share;
 if not found then raise exception using errcode='HCPC0',message='Access denied'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'invitation',p_invitation)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_inv.tenant_id::text||':employee.accept_invitation:'||p_key,0));
 select * into v_old from app.idempotency_records where tenant_id=v_inv.tenant_id and operation='employee.accept_invitation' and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_old.completed_at is not null then return v_old.response_body; end if;
 end if;
 select * into v_inv from app.employee_membership_invitations where id=p_invitation for update;
 if v_inv.status<>'pending' or v_inv.expires_at<=clock_timestamp() or v_inv.email<>v_email::extensions.citext then raise exception using errcode='HCPC3',message='Invitation expired or unavailable'; end if;
 perform 1 from app.employees where tenant_id=v_inv.tenant_id and id=v_inv.employee_id and status='active' and user_id is null for update;
 if not found then raise exception using errcode='HCPC3',message='Employee is unavailable'; end if;
 if exists(select 1 from app.tenant_memberships where tenant_id=v_inv.tenant_id and user_id=p_actor) then raise exception using errcode='HCPC3',message='Existing business member needs owner linking'; end if;
 v_time:=clock_timestamp();
 insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values(v_inv.tenant_id,p_actor,'active',false);
 update app.employees set user_id=p_actor,updated_at=v_time where tenant_id=v_inv.tenant_id and id=v_inv.employee_id;
 update app.employee_membership_invitations set status='accepted',accepted_by=p_actor,updated_at=v_time where id=v_inv.id;
 v_result:=jsonb_build_object('invitationId',v_inv.id,'tenantId',v_inv.tenant_id,'employeeId',v_inv.employee_id);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata,occurred_at)
 values(v_inv.tenant_id,p_request_id,'tenant_user',p_actor,'employee.invitation_accepted','employee',v_inv.employee_id,jsonb_build_object('invitationId',v_inv.id),v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(v_inv.tenant_id,'employee.accept_invitation',p_key,v_hash,200,v_result,v_time,v_time+interval '24 hours');
 return v_result;
exception when unique_violation then raise exception using errcode='HCPC3',message='Membership or employee already linked';
end; $$;
revoke all on function app.create_employee_membership_invitation(uuid,uuid,uuid,text,text,text),app.accept_employee_membership_invitation(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function app.create_employee_membership_invitation(uuid,uuid,uuid,text,text,text),app.accept_employee_membership_invitation(uuid,uuid,text,text) to hcs_hyperdrive;
commit;
