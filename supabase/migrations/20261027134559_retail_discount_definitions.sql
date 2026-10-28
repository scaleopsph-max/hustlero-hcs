begin;

insert into app.permissions(code,description) values
 ('discounts.manage','Manage predefined retail ticket discounts'),
 ('discounts.apply','Apply authorized predefined retail ticket discounts')
on conflict(code) do nothing;
insert into app.role_permissions(tenant_id,role_id,permission_code)
select r.tenant_id,r.id,p.code from app.roles r join app.permissions p on
 (lower(r.code::text) in ('owner','admin','manager') and p.code in ('discounts.manage','discounts.apply'))
 or (lower(r.code::text)='cashier' and p.code='discounts.apply') on conflict do nothing;
create function app.initialize_role_discount_permissions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into app.role_permissions(tenant_id,role_id,permission_code)
 select new.tenant_id,new.id,p.code from app.permissions p where
 (lower(new.code::text) in ('owner','admin','manager') and p.code in ('discounts.manage','discounts.apply'))
 or (lower(new.code::text)='cashier' and p.code='discounts.apply') on conflict do nothing;
 return new;
end; $$;
revoke all on function app.initialize_role_discount_permissions() from public,anon,authenticated,hcs_hyperdrive;
create trigger roles_initialize_discount_permissions after insert on app.roles for each row
execute function app.initialize_role_discount_permissions();

create table app.retail_discounts(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references app.tenants(id) on delete restrict,
 name text not null check(name=btrim(name) and char_length(name) between 1 and 80),
 kind text not null check(kind in ('fixed','percent')),
 amount_minor numeric(11,0), rate_bps integer,
 status text not null check(status in ('active','inactive','archived')),
 revision integer not null check(revision>0),
 created_by uuid not null, updated_by uuid not null, updated_at timestamptz not null,
 unique(tenant_id,id),
 foreign key(tenant_id,created_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict,
 foreign key(tenant_id,updated_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict,
 check((kind='fixed' and amount_minor is not null and amount_minor between 1 and 99999999999 and rate_bps is null)
 or (kind='percent' and rate_bps is not null and rate_bps between 1 and 9999 and amount_minor is null))
);
create unique index retail_discounts_name_idx on app.retail_discounts(tenant_id,lower(name));
create table app.retail_discount_versions(
 tenant_id uuid not null,discount_id uuid not null,revision integer not null,
 snapshot jsonb not null, primary key(tenant_id,discount_id,revision),
 foreign key(tenant_id,discount_id) references app.retail_discounts(tenant_id,id) on delete restrict
);
alter table app.retail_discounts enable row level security;
alter table app.retail_discount_versions enable row level security;
revoke all on app.retail_discounts,app.retail_discount_versions from public,anon,authenticated,hcs_hyperdrive;

create function app.retail_discount_json(p_row app.retail_discounts) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'name',p_row.name,'value',case when p_row.kind='fixed'
 then jsonb_build_object('kind','fixed','amountMinor',p_row.amount_minor)
 else jsonb_build_object('kind','percent','rateBps',p_row.rate_bps) end,
 'status',p_row.status,'revision',p_row.revision,'scope','retail_ticket','updatedAt',p_row.updated_at);
$$;
create function app.guard_retail_discount() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='HCDI3',message='Discount history is immutable'; end if;
 if tg_op='INSERT' then
  if new.revision<>1 then raise exception using errcode='HCDI4',message='Discount revision conflict'; end if;
 elsif old.status='archived' or new.id<>old.id or new.tenant_id<>old.tenant_id or new.created_by<>old.created_by then
  raise exception using errcode='HCDI3',message='Discount history is immutable';
 elsif new.revision::bigint<>old.revision::bigint+1 then
  raise exception using errcode='HCDI4',message='Discount revision conflict';
 end if;
 return new;
end; $$;
create function app.snapshot_retail_discount() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into app.retail_discount_versions values(new.tenant_id,new.id,new.revision,app.retail_discount_json(new));
 return new;
end; $$;
create function app.reject_retail_discount_version_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='HCDI3',message='Discount history is immutable'; end; $$;
create trigger retail_discounts_guard before insert or update or delete on app.retail_discounts
for each row execute function app.guard_retail_discount();
create trigger retail_discounts_snapshot after insert or update on app.retail_discounts
for each row execute function app.snapshot_retail_discount();
create trigger retail_discount_versions_immutable before update or delete on app.retail_discount_versions
for each row execute function app.reject_retail_discount_version_mutation();

create function app.lock_discount_management_access(p_actor uuid,p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_owner boolean; v_entitlement app.tenant_entitlements%rowtype;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCDI0',message='Discount management denied'; end if;
 perform 1 from app.features where code='sales' and platform_available for share;
 if not found then raise exception using errcode='HCDI1',message='Sales unavailable'; end if;
 select * into v_entitlement from app.tenant_entitlements where tenant_id=p_tenant and feature_code='sales' for share;
 if not found or not v_entitlement.entitled or not v_entitlement.enabled
 or v_entitlement.starts_at>clock_timestamp() or v_entitlement.ends_at<=clock_timestamp()
 then raise exception using errcode='HCDI1',message='Sales unavailable'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception using errcode='HCDI0',message='Discount management denied'; end if;
 if not v_owner then
  perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
  where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='discounts.manage'
  order by mr.role_id for share of mr,rp;
  if not found then raise exception using errcode='HCDI0',message='Discount management denied'; end if;
 end if;
 -- Time can advance while waiting on membership/role locks.
 if v_entitlement.starts_at>clock_timestamp() or v_entitlement.ends_at<=clock_timestamp()
 then raise exception using errcode='HCDI1',message='Sales unavailable'; end if;
end; $$;

create function app.load_retail_discounts(p_actor uuid,p_tenant uuid,p_id uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform app.lock_discount_management_access(p_actor,p_tenant);
 if p_id is null then
  if p_revision is not null then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
  select jsonb_build_object('discounts',coalesce(jsonb_agg(app.retail_discount_json(d) order by lower(d.name),d.id),'[]'))
  into v_result from app.retail_discounts d where tenant_id=p_tenant;
 else
  if p_revision is not null then
   select snapshot into v_result from app.retail_discount_versions where tenant_id=p_tenant and discount_id=p_id and revision=p_revision;
   if not found then raise exception using errcode='HCDI5',message='Discount not found'; end if;
  else
   select jsonb_build_object('discountId',p_id,'versions',jsonb_agg(v.snapshot order by v.revision desc)) into v_result
   from (select snapshot,revision from app.retail_discount_versions where tenant_id=p_tenant and discount_id=p_id order by revision desc limit 100) v;
   if v_result->'versions'='null'::jsonb then raise exception using errcode='HCDI5',message='Discount not found'; end if;
  end if;
 end if;
 perform app.lock_discount_management_access(p_actor,p_tenant);
 return v_result;
end; $$;

create function app.manage_retail_discount(p_actor uuid,p_tenant uuid,p_body jsonb,p_key text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_action text:=p_body->>'action';v_name text:=btrim(p_body->>'name');
 v_row app.retail_discounts%rowtype;v_existing app.idempotency_records%rowtype;
 v_result jsonb;v_hash text;v_now timestamptz;v_revision numeric;v_amount numeric;v_rate numeric;v_kind text;
begin
 perform app.lock_discount_management_access(p_actor,p_tenant);
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' or jsonb_typeof(p_body) is distinct from 'object'
 or v_action is null or v_action not in ('create','update','archive')
 then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
 if exists(select 1 from jsonb_object_keys(p_body) k where k<>all(case v_action
 when 'create' then array['action','name','value','status']
 when 'update' then array['action','discountId','expectedRevision','name','value','status']
 else array['action','discountId','expectedRevision'] end))
 then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
 if v_action<>'archive' then
  if jsonb_typeof(p_body->'name') is distinct from 'string' or length(v_name) not between 1 and 80
  or jsonb_typeof(p_body->'value') is distinct from 'object' or p_body->>'status' is null or p_body->>'status' not in ('active','inactive')
  then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
  v_kind:=p_body->'value'->>'kind';
  if v_kind is null or v_kind not in ('fixed','percent')
  or exists(select 1 from jsonb_object_keys(p_body->'value') k where k<>all(case v_kind when 'fixed' then array['kind','amountMinor'] else array['kind','rateBps'] end))
  then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
  if v_kind='fixed' then
   if jsonb_typeof(p_body->'value'->'amountMinor') is distinct from 'number' then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
   v_amount:=(p_body->'value'->>'amountMinor')::numeric;
   if v_amount<>trunc(v_amount) or v_amount not between 1 and 99999999999 then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
  else
   if jsonb_typeof(p_body->'value'->'rateBps') is distinct from 'number' then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
   v_rate:=(p_body->'value'->>'rateBps')::numeric;
   if v_rate<>trunc(v_rate) or v_rate not between 1 and 9999 then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
  end if;
 end if;
 if v_action<>'create' then
  if jsonb_typeof(p_body->'expectedRevision') is distinct from 'number' or jsonb_typeof(p_body->'discountId') is distinct from 'string'
  then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
  v_revision:=(p_body->>'expectedRevision')::numeric;
  if v_revision<>trunc(v_revision) or v_revision not between 1 and 2147483646
  then raise exception using errcode='HCDI2',message='Invalid discount command'; end if;
 end if;
 v_hash:=p_actor::text||':'||encode(sha256(convert_to(p_body::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':retail.discount:'||p_key,0));
 perform app.lock_discount_management_access(p_actor,p_tenant);
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='retail.discount.manage' and idempotency_key=p_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_existing.completed_at is not null then return v_existing.response_body; end if;
  raise exception using errcode='HCS08',message='Request key conflict';
 end if;
 if v_action<>'create' then
  select * into v_row from app.retail_discounts where tenant_id=p_tenant and id=(p_body->>'discountId')::uuid for update;
  if not found then raise exception using errcode='HCDI5',message='Discount not found'; end if;
  if v_row.status='archived' then raise exception using errcode='HCDI3',message='Discount history is immutable'; end if;
  if v_row.revision<>v_revision then raise exception using errcode='HCDI4',message='Discount revision conflict'; end if;
 end if;
 perform app.lock_discount_management_access(p_actor,p_tenant);
 v_now:=clock_timestamp();
 if v_action='create' then
  insert into app.retail_discounts(tenant_id,name,kind,amount_minor,rate_bps,status,revision,created_by,updated_by,updated_at)
  values(p_tenant,v_name,v_kind,v_amount,v_rate,p_body->>'status',1,p_actor,p_actor,v_now) returning * into v_row;
 elsif v_action='archive' then
  update app.retail_discounts set status='archived',revision=revision+1,updated_by=p_actor,updated_at=v_now
  where tenant_id=p_tenant and id=v_row.id returning * into v_row;
 else
  update app.retail_discounts set name=v_name,kind=v_kind,amount_minor=v_amount,rate_bps=v_rate,status=p_body->>'status',
  revision=revision+1,updated_by=p_actor,updated_at=v_now where tenant_id=p_tenant and id=v_row.id returning * into v_row;
 end if;
 perform app.lock_discount_management_access(p_actor,p_tenant);
 v_result:=app.retail_discount_json(v_row);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'retail.discount.'||v_action,'retail_discount',v_row.id,p_body,v_now);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at)
 values(p_tenant,'retail.discount.'||v_action,'retail_discount',v_row.id,v_result,v_now);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'retail.discount.manage',p_key,v_hash,200,v_result,v_now,v_now+interval '24 hours');
 return v_result;
end; $$;
revoke all on function app.retail_discount_json(app.retail_discounts),app.guard_retail_discount(),app.snapshot_retail_discount(),
 app.reject_retail_discount_version_mutation(),app.lock_discount_management_access(uuid,uuid),
 app.load_retail_discounts(uuid,uuid,uuid,integer),app.manage_retail_discount(uuid,uuid,jsonb,text,text)
 from public,anon,authenticated,hcs_hyperdrive;
grant execute on function app.load_retail_discounts(uuid,uuid,uuid,integer),app.manage_retail_discount(uuid,uuid,jsonb,text,text) to hcs_hyperdrive;
commit;
