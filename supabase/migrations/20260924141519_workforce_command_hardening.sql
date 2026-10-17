begin;

create function app.initialize_tenant_staff_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into app.roles(tenant_id,code,name,is_system_template) values(new.id,'admin','Admin',true),(new.id,'manager','Manager',true),(new.id,'cashier','Cashier',true),(new.id,'inventory_staff','Inventory Staff',true) on conflict do nothing;
 return new;
end; $$;
revoke all on function app.initialize_tenant_staff_roles() from public,anon,authenticated;
create trigger tenants_initialize_staff_roles after insert on app.tenants for each row execute function app.initialize_tenant_staff_roles();

alter function app.create_location(uuid,uuid,text,text,text,text,text,text,text) rename to create_location_impl;
alter function app.create_employee(uuid,uuid,text,text,uuid,jsonb,text,text,text,text) rename to create_employee_impl;
alter function app.create_register(uuid,uuid,uuid,text,text,text,text,text) rename to create_register_impl;
revoke all on function app.create_location_impl(uuid,uuid,text,text,text,text,text,text,text),app.create_employee_impl(uuid,uuid,text,text,uuid,jsonb,text,text,text,text),app.create_register_impl(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.create_location(p_actor_user_id uuid,p_tenant_id uuid,p_code text,p_name text,p_kind text,p_timezone text,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing app.idempotency_records%rowtype;v_response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':location.create:'||p_idempotency_key,0)); select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='location.create' and idempotency_key=p_idempotency_key;
 if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;if v_existing.completed_at is not null then return v_existing.response_body;end if;else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'location.create',p_idempotency_key,p_request_hash,now()+interval '24 hours');end if;
 v_response:=app.create_location_impl(p_actor_user_id,p_tenant_id,p_code,p_name,p_kind,p_timezone,p_idempotency_key,p_request_hash,p_request_id);update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='location.create' and idempotency_key=p_idempotency_key;return v_response;end;$$;

create function app.create_employee(p_actor_user_id uuid,p_tenant_id uuid,p_employee_code text,p_display_name text,p_role_id uuid,p_location_ids jsonb,p_pin text,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing app.idempotency_records%rowtype;v_response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':employee.create:'||p_idempotency_key,0));select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='employee.create' and idempotency_key=p_idempotency_key;
 if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict';end if;if v_existing.completed_at is not null then return v_existing.response_body;end if;else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'employee.create',p_idempotency_key,p_request_hash,now()+interval '24 hours');end if;
 v_response:=app.create_employee_impl(p_actor_user_id,p_tenant_id,p_employee_code,p_display_name,p_role_id,p_location_ids,p_pin,p_idempotency_key,p_request_hash,p_request_id);update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='employee.create' and idempotency_key=p_idempotency_key;return v_response;end;$$;

create function app.create_register(p_actor_user_id uuid,p_tenant_id uuid,p_location_id uuid,p_code text,p_name text,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing app.idempotency_records%rowtype;v_response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':register.create:'||p_idempotency_key,0));select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='register.create' and idempotency_key=p_idempotency_key;
 if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict';end if;if v_existing.completed_at is not null then return v_existing.response_body;end if;else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'register.create',p_idempotency_key,p_request_hash,now()+interval '24 hours');end if;
 v_response:=app.create_register_impl(p_actor_user_id,p_tenant_id,p_location_id,p_code,p_name,p_idempotency_key,p_request_hash,p_request_id);update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='register.create' and idempotency_key=p_idempotency_key;return v_response;end;$$;

revoke all on function app.create_location(uuid,uuid,text,text,text,text,text,text,text),app.create_employee(uuid,uuid,text,text,uuid,jsonb,text,text,text,text),app.create_register(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function app.create_location(uuid,uuid,text,text,text,text,text,text,text),app.create_employee(uuid,uuid,text,text,uuid,jsonb,text,text,text,text),app.create_register(uuid,uuid,uuid,text,text,text,text,text) to hcs_hyperdrive;
commit;
