begin;
alter table app.suppliers add column revision integer not null default 1 check(revision>0);
alter table app.purchase_orders add column supplier_name_snapshot text, add column supplier_snapshot_source text;
-- Older orders had no recorded supplier snapshot. Record today's value as a
-- migration baseline, explicitly distinguished from an original snapshot.
update app.purchase_orders po set supplier_name_snapshot=s.name,supplier_snapshot_source='migration_baseline'
from app.suppliers s where s.tenant_id=po.tenant_id and s.id=po.supplier_id;
alter table app.purchase_orders alter column supplier_name_snapshot set not null, alter column supplier_snapshot_source set not null;
alter table app.purchase_orders add constraint purchase_supplier_snapshot_source_check check(supplier_snapshot_source in ('order_created','migration_baseline'));

create function app.purchase_order_supplier_snapshot_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
 if tg_op='UPDATE' then
  if new.tenant_id is distinct from old.tenant_id or new.supplier_id is distinct from old.supplier_id or new.supplier_name_snapshot is distinct from old.supplier_name_snapshot or new.supplier_snapshot_source is distinct from old.supplier_snapshot_source then raise exception using errcode='HCS34',message='Purchase supplier snapshot is immutable'; end if;
  return new;
 end if;
 select name into v_name from app.suppliers where tenant_id=new.tenant_id and id=new.supplier_id and status='active' for share;
 if not found then raise exception using errcode='HCS34',message='Active supplier required'; end if;
 new.supplier_name_snapshot:=v_name;new.supplier_snapshot_source:='order_created';return new;
end; $$;
revoke all on function app.purchase_order_supplier_snapshot_guard() from public,anon,authenticated,hcs_hyperdrive;
create trigger purchase_supplier_snapshot_before_insert before insert on app.purchase_orders for each row execute function app.purchase_order_supplier_snapshot_guard();
create trigger purchase_supplier_snapshot_before_update before update on app.purchase_orders for each row execute function app.purchase_order_supplier_snapshot_guard();

create function app.lock_supplier_manager(p_actor uuid,p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_owner boolean;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCS30',message='Purchasing management is not allowed'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception using errcode='HCS30',message='Purchasing management is not allowed'; end if;
 if not v_owner then
  perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='purchasing.manage' order by mr.role_id for share of mr,rp;
  if not found then raise exception using errcode='HCS30',message='Purchasing management is not allowed'; end if;
 end if;
end; $$;
revoke all on function app.lock_supplier_manager(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.update_supplier(p_actor uuid,p_tenant uuid,p_supplier uuid,p_revision integer,p_name text,p_contact_name text,p_contact_phone text,p_contact_email text,p_archive boolean,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.suppliers%rowtype;old app.idempotency_records%rowtype;h text;v_result jsonb;v_time timestamptz;
begin
 perform app.lock_supplier_manager(p_actor,p_tenant);
 if p_supplier is null or p_revision is null or p_revision<1 or p_archive is null or p_name is null or length(btrim(p_name)) not between 2 and 160 or length(coalesce(p_contact_name,''))>160 or length(coalesce(p_contact_phone,''))>40 or length(coalesce(p_contact_email,''))>254 or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='HCS31',message='Supplier details are invalid'; end if;
 h:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'supplier',p_supplier,'revision',p_revision,'name',btrim(p_name),'contactName',nullif(btrim(p_contact_name),''),'contactPhone',nullif(btrim(p_contact_phone),''),'contactEmail',nullif(btrim(p_contact_email),''),'archive',p_archive)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':supplier.update:'||p_key,0));
 select * into old from app.idempotency_records where tenant_id=p_tenant and operation='supplier.update' and idempotency_key=p_key;
 if found then if old.request_hash<>h then raise exception using errcode='HCS08',message='Request key conflict'; end if; if old.completed_at is not null then perform app.lock_supplier_manager(p_actor,p_tenant);return old.response_body; end if; end if;
 select * into s from app.suppliers where tenant_id=p_tenant and id=p_supplier for update;
 if not found then raise exception using errcode='HCS34',message='Supplier not found'; end if;
 if s.status<>'active' or s.revision<>p_revision then raise exception using errcode='HCS35',message='Supplier changed or archived'; end if;
 if p_archive and (s.name is distinct from btrim(p_name) or s.contact_name is distinct from nullif(btrim(p_contact_name),'') or s.contact_phone is distinct from nullif(btrim(p_contact_phone),'') or s.contact_email is distinct from nullif(btrim(p_contact_email),'')) then raise exception using errcode='HCS31',message='Save changes before archiving'; end if;
 perform app.lock_supplier_manager(p_actor,p_tenant);v_time:=clock_timestamp();
 update app.suppliers set name=btrim(p_name),contact_name=nullif(btrim(p_contact_name),''),contact_phone=nullif(btrim(p_contact_phone),''),contact_email=nullif(btrim(p_contact_email),''),status=case when p_archive then 'archived' else 'active' end,revision=revision+1 where tenant_id=p_tenant and id=p_supplier returning * into s;
 v_result:=jsonb_build_object('supplierId',s.id,'revision',s.revision,'name',s.name,'contactName',s.contact_name,'contactPhone',s.contact_phone,'contactEmail',s.contact_email,'status',s.status);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata,occurred_at) values(p_tenant,p_request_id,'tenant_user',p_actor,case when p_archive then 'supplier.archived' else 'supplier.updated' end,'supplier',p_supplier,jsonb_build_object('revision',s.revision),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,case when p_archive then 'supplier.archived' else 'supplier.updated' end,'supplier',p_supplier,jsonb_build_object('supplierId',p_supplier,'revision',s.revision),v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at) values(p_tenant,'supplier.update',p_key,h,200,v_result,v_time,v_time+interval '24 hours');
 perform app.lock_supplier_manager(p_actor,p_tenant);return v_result;
exception when unique_violation then raise exception using errcode='HCS32',message='An active supplier with this name already exists';
end; $$;
revoke all on function app.update_supplier(uuid,uuid,uuid,integer,text,text,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function app.update_supplier(uuid,uuid,uuid,integer,text,text,text,text,boolean,text,text) to hcs_hyperdrive;

alter function app.list_purchasing_context(uuid,uuid) rename to purchasing_supplier_management_core;
revoke all on function app.purchasing_supplier_management_core(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.list_purchasing_context(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;v_suppliers jsonb;v_orders jsonb;
begin
 v_result:=app.purchasing_supplier_management_core(p_actor,p_tenant);
 select coalesce(jsonb_agg(item.value||jsonb_build_object('revision',s.revision) order by item.ordinality),'[]'::jsonb) into v_suppliers from jsonb_array_elements(v_result->'suppliers') with ordinality item(value,ordinality) join app.suppliers s on s.tenant_id=p_tenant and s.id=(item.value->>'id')::uuid;
 select coalesce(jsonb_agg(item.value||jsonb_build_object('supplierName',po.supplier_name_snapshot,'supplierSnapshotSource',po.supplier_snapshot_source) order by item.ordinality),'[]'::jsonb) into v_orders from jsonb_array_elements(v_result->'orders') with ordinality item(value,ordinality) join app.purchase_orders po on po.tenant_id=p_tenant and po.id=(item.value->>'id')::uuid;
 return v_result||jsonb_build_object('suppliers',v_suppliers,'orders',v_orders);
end; $$;
revoke all on function app.list_purchasing_context(uuid,uuid) from public,anon,authenticated;
grant execute on function app.list_purchasing_context(uuid,uuid) to hcs_hyperdrive;
commit;
