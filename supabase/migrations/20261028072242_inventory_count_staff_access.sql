begin;

-- An explicit assignment applies only to one employee, linked account and branch.
create table app.inventory_count_staff_access (
 tenant_id uuid not null,
 employee_id uuid not null,
 location_id uuid not null,
 user_id uuid not null,
 enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,employee_id,location_id),
 foreign key(tenant_id,employee_id) references app.employees(tenant_id,id) on delete restrict,
 foreign key(tenant_id,location_id) references app.locations(tenant_id,id) on delete restrict,
 foreign key(tenant_id,user_id) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
alter table app.inventory_count_staff_access enable row level security;
revoke all on app.inventory_count_staff_access from public,anon,authenticated,hcs_hyperdrive;

-- Private owner-only command. The grant cannot create an account or link an employee.
create function app.set_inventory_count_staff_access(p_actor uuid,p_tenant uuid,p_employee uuid,p_location uuid,p_enabled boolean,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid;v_old app.idempotency_records%rowtype;v_hash text;v_result jsonb;v_time timestamptz;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 perform 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner for share;
 if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 if p_enabled is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='HCPC2',message='Invalid access assignment'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'employee',p_employee,'location',p_location,'enabled',p_enabled)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.staff_access:'||p_key,0));
 select * into v_old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.staff_access' and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_old.completed_at is not null then return v_old.response_body; end if;
 end if;
 if p_enabled then
 select e.user_id into v_user from app.employees e
 join app.tenant_memberships m on m.tenant_id=e.tenant_id and m.user_id=e.user_id and m.status='active' and not m.is_owner
 join app.employee_locations el on el.tenant_id=e.tenant_id and el.employee_id=e.id and el.location_id=p_location
 join app.locations l on l.tenant_id=el.tenant_id and l.id=el.location_id and l.is_active
 where e.tenant_id=p_tenant and e.id=p_employee and e.status='active' for update of e for share of m,el,l;
 if not found then raise exception using errcode='HCPC1',message='Active linked employee and assigned branch required'; end if;
 else
 select g.user_id into v_user from app.inventory_count_staff_access g
 where g.tenant_id=p_tenant and g.employee_id=p_employee and g.location_id=p_location for update;
 if not found then raise exception using errcode='HCPC1',message='Access assignment not found'; end if;
 end if;
 v_time:=clock_timestamp();
 insert into app.inventory_count_staff_access(tenant_id,employee_id,location_id,user_id,enabled,updated_at)
 values(p_tenant,p_employee,p_location,v_user,p_enabled,v_time)
 on conflict(tenant_id,employee_id,location_id) do update set user_id=excluded.user_id,enabled=excluded.enabled,updated_at=excluded.updated_at;
 v_result:=jsonb_build_object('employeeId',p_employee,'locationId',p_location,'enabled',p_enabled);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.staff_access_changed','employee',p_employee,p_location,jsonb_build_object('enabled',p_enabled),v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.staff_access',p_key,v_hash,200,v_result,v_time,v_time+interval '24 hours');
 return v_result;
end; $$;
revoke all on function app.set_inventory_count_staff_access(uuid,uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function app.set_inventory_count_staff_access(uuid,uuid,uuid,uuid,boolean,text,text) to hcs_hyperdrive;

create or replace function app.lock_inventory_count_access(p_actor uuid,p_tenant uuid,p_location uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean;v_manager boolean:=false;v_granted boolean:=false;v_ent app.tenant_entitlements%rowtype;
begin
 if p_action is null or p_action not in ('create','enter','read','submit','approve','post','cancel') then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 perform 1 from app.features where code='inventory' and platform_available for share;
 if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 select * into v_ent from app.tenant_entitlements where tenant_id=p_tenant and feature_code='inventory' for share;
 if not found or not v_ent.entitled or not v_ent.enabled or v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp()
 then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 perform 1 from app.locations where tenant_id=p_tenant and id=p_location and is_active for share;
 if not found then raise exception using errcode='HCPC1',message='Inventory count location not found'; end if;
 if not v_owner then
  perform 1 from app.employees e join app.employee_locations el on el.tenant_id=e.tenant_id and el.employee_id=e.id
  where e.tenant_id=p_tenant and e.user_id=p_actor and e.status='active' and el.location_id=p_location order by e.id for share of e,el;
  if not found then raise exception using errcode='HCPC1',message='Inventory count location not found'; end if;
  perform 1 from app.membership_roles mr join app.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id
  where mr.tenant_id=p_tenant and mr.user_id=p_actor and lower(r.code::text)='manager' order by r.id for share of mr,r;
  v_manager:=found;
  if p_action in ('create','post','cancel') and not v_manager then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
  if p_action='approve' or p_action='post' then
   perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code=case when p_action='approve' then 'approvals.manage' else 'inventory.manage' end
   order by mr.role_id for share of mr,rp;
   if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
  elsif not v_manager and p_action in ('enter','submit','read') then
   perform 1 from app.inventory_count_staff_access g join app.employees e on e.tenant_id=g.tenant_id and e.id=g.employee_id and e.user_id=g.user_id and e.status='active' where g.tenant_id=p_tenant and g.user_id=p_actor and g.location_id=p_location and g.enabled for share of g,e;
   v_granted:=found;
   perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and p_action='read' and rp.permission_code='approvals.manage'
   order by mr.role_id for share of mr,rp;
   if not found and not v_granted then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
  end if;
 end if;
 if v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp() then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
end; $$;

-- Preserve existing branch filtering; only the Owner receives access-management details.
alter function app.list_workforce_context(uuid,uuid) rename to workforce_count_access_core;
revoke all on function app.workforce_count_access_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.list_workforce_context(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;v_employees jsonb;
begin
 v_result:=app.workforce_count_access_core(p_actor,p_tenant);
 if not exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner) then return v_result; end if;
 select coalesce(jsonb_agg(item.value || jsonb_build_object(
  'hasBackOfficeAccount',exists(select 1 from app.employees e join app.tenant_memberships m on m.tenant_id=e.tenant_id and m.user_id=e.user_id and m.status='active' and not m.is_owner where e.tenant_id=p_tenant and e.id=(item.value->>'id')::uuid and e.status='active'),
  'countAccessLocationIds',coalesce((select jsonb_agg(g.location_id order by g.location_id) from app.inventory_count_staff_access g where g.tenant_id=p_tenant and g.employee_id=(item.value->>'id')::uuid and g.enabled),'[]'::jsonb)
 ) order by item.ordinality),'[]'::jsonb) into v_employees from jsonb_array_elements(v_result->'employees') with ordinality item(value,ordinality);
 return v_result || jsonb_build_object('employees',v_employees,'canManageCountAccess',true);
end; $$;
revoke all on function app.list_workforce_context(uuid,uuid) from public,anon,authenticated;
grant execute on function app.list_workforce_context(uuid,uuid) to hcs_hyperdrive;

commit;
