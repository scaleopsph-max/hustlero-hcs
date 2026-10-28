begin;

-- Draft/counting only. This migration intentionally cannot adjust inventory.
insert into app.permissions(code,description) values
 ('inventory_counts.enter','Enter physical count quantities') on conflict(code) do nothing;

create table app.inventory_counts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references app.tenants(id) on delete restrict,
 location_id uuid not null,
 status text not null default 'draft' check(status in ('draft','counting')),
 revision integer not null default 1 check(revision>0),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,location_id) references app.locations(tenant_id,id) on delete restrict,
 foreign key(tenant_id,created_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create table app.inventory_count_lines (
 tenant_id uuid not null,
 count_id uuid not null,
 variant_id uuid not null,
 expected_on_hand numeric(18,3) not null check(expected_on_hand>=0),
 balance_version bigint not null check(balance_version>=0),
 counted numeric(18,3) check(counted>=0),
 counted_by uuid,
 counted_at timestamptz,
 primary key(tenant_id,count_id,variant_id),
 foreign key(tenant_id,count_id) references app.inventory_counts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,variant_id) references app.product_variants(tenant_id,id) on delete restrict,
 foreign key(tenant_id,counted_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict,
 check((counted is null and counted_by is null and counted_at is null) or (counted is not null and counted_by is not null and counted_at is not null))
);
create table app.inventory_count_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 count_id uuid not null,
 revision integer not null check(revision>0),
 action text not null check(action in ('created','counted')),
 actor_id uuid not null,
 payload jsonb not null,
 occurred_at timestamptz not null default now(),
 unique(tenant_id,count_id,revision),
 foreign key(tenant_id,count_id) references app.inventory_counts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,actor_id) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index inventory_counts_location_idx on app.inventory_counts(tenant_id,location_id,created_at desc,id);
alter table app.inventory_counts enable row level security;
alter table app.inventory_count_lines enable row level security;
alter table app.inventory_count_events enable row level security;
revoke all on app.inventory_counts,app.inventory_count_lines,app.inventory_count_events from public,anon,authenticated,hcs_hyperdrive;
create function app.reject_inventory_count_event_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='HCPC5',message='Inventory count events are append-only'; end; $$;
create trigger inventory_count_events_immutable before update or delete on app.inventory_count_events
for each row execute function app.reject_inventory_count_event_change();
revoke all on function app.reject_inventory_count_event_change() from public,anon,authenticated,hcs_hyperdrive;

-- The caller supplies authenticated context. Current active scope and authority
-- are held across the transaction, including before a replay is returned.
create function app.lock_inventory_count_access(p_actor uuid,p_tenant uuid,p_location uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean;v_manager boolean:=false;v_employee uuid;v_ent app.tenant_entitlements%rowtype;
begin
 if p_action is null or p_action not in ('create','enter','read') then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
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
  select e.id into v_employee from app.employees e join app.employee_locations el on el.tenant_id=e.tenant_id and el.employee_id=e.id
  where e.tenant_id=p_tenant and e.user_id=p_actor and e.status='active' and el.location_id=p_location order by e.id limit 1 for share of e,el;
  if not found then raise exception using errcode='HCPC1',message='Inventory count location not found'; end if;
  perform 1 from app.membership_roles mr join app.roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id
  where mr.tenant_id=p_tenant and mr.user_id=p_actor and lower(r.code::text)='manager' order by r.id for share of mr,r;
  v_manager:=found;
  if not v_manager then
   if p_action='create' then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
   perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='inventory_counts.enter' order by mr.role_id for share of mr,rp;
   if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
  end if;
 end if;
 if v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp() then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
end; $$;
revoke all on function app.lock_inventory_count_access(uuid,uuid,uuid,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.inventory_count_json(p_tenant uuid,p_count uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'locationId',c.location_id,'status',c.status,'revision',c.revision,'createdAt',c.created_at,
 'lines',coalesce((select jsonb_agg(jsonb_build_object('variantId',l.variant_id,'expectedMilli',round(l.expected_on_hand*1000)::bigint,
 'balanceVersion',l.balance_version,'countedMilli',case when l.counted is null then null else round(l.counted*1000)::bigint end)
 order by l.variant_id) from app.inventory_count_lines l where l.tenant_id=c.tenant_id and l.count_id=c.id),'[]'::jsonb))
 from app.inventory_counts c where c.tenant_id=p_tenant and c.id=p_count;
$$;
revoke all on function app.inventory_count_json(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.create_inventory_count(p_actor uuid,p_tenant uuid,p_location uuid,p_variants jsonb,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid();v_hash text;v_old app.idempotency_records%rowtype;v_result jsonb;v_variant jsonb;v_balance app.inventory_balances%rowtype;
begin
 perform app.lock_inventory_count_access(p_actor,p_tenant,p_location,'create');
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' or jsonb_typeof(p_variants) is distinct from 'array'
 then raise exception using errcode='HCPC2',message='Invalid inventory count'; end if;
 if jsonb_array_length(p_variants) not between 1 and 500 or exists(select 1 from jsonb_array_elements(p_variants) x where jsonb_typeof(x)<>'string'
 or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 or exists(select 1 from jsonb_array_elements_text(p_variants) x group by lower(x) having count(*)>1)
 then raise exception using errcode='HCPC2',message='Invalid inventory count'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'location',p_location,'variants',p_variants)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.create:'||p_key,0));
 select * into v_old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.create' and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='HCS08',message='Inventory count request key conflict'; end if;
  if v_old.completed_at is not null then perform app.lock_inventory_count_access(p_actor,p_tenant,p_location,'create'); return v_old.response_body; end if;
 end if;
 insert into app.inventory_counts(id,tenant_id,location_id,created_by) values(v_id,p_tenant,p_location,p_actor);
 for v_variant in select value from jsonb_array_elements(p_variants) order by (value #>> '{}')::uuid loop
  select b.* into v_balance from app.inventory_balances b join app.product_variants v on v.tenant_id=b.tenant_id and v.id=b.variant_id
  join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
  where b.tenant_id=p_tenant and b.location_id=p_location and b.variant_id=(v_variant #>> '{}')::uuid
  and v.is_active and v.track_inventory and p.status='active' for share of b,v,p;
  if not found or v_balance.on_hand<0 or v_balance.on_hand>999999999.999 or v_balance.version<0 or v_balance.version>9007199254740991
  then raise exception using errcode='HCPC1',message='Count inventory item not found'; end if;
  insert into app.inventory_count_lines(tenant_id,count_id,variant_id,expected_on_hand,balance_version)
  values(p_tenant,v_id,v_balance.variant_id,v_balance.on_hand,v_balance.version);
 end loop;
 perform app.lock_inventory_count_access(p_actor,p_tenant,p_location,'create');
 v_result:=app.inventory_count_json(p_tenant,v_id);
 insert into app.inventory_count_events(tenant_id,count_id,revision,action,actor_id,payload) values(p_tenant,v_id,1,'created',p_actor,jsonb_build_object('variants',p_variants));
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.created','inventory_count',v_id,p_location,jsonb_build_object('revision',1));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant,'inventory_count.created','inventory_count',v_id,v_result);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.create',p_key,v_hash,201,v_result,clock_timestamp(),clock_timestamp()+interval '24 hours');
 return v_result;
end; $$;

create function app.enter_inventory_count(p_actor uuid,p_tenant uuid,p_count uuid,p_revision integer,p_entries jsonb,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_count app.inventory_counts%rowtype;v_old app.idempotency_records%rowtype;v_hash text;v_line jsonb;v_result jsonb;v_time timestamptz;
begin
 select * into v_count from app.inventory_counts where tenant_id=p_tenant and id=p_count;
 if not found then raise exception using errcode='HCPC1',message='Inventory count not found'; end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,v_count.location_id,'enter');
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' or p_revision is null or p_revision<1 or jsonb_typeof(p_entries) is distinct from 'array'
 then raise exception using errcode='HCPC2',message='Invalid count entry'; end if;
 if jsonb_array_length(p_entries) not between 1 and 500 or exists(select 1 from jsonb_array_elements(p_entries) x where case
 when jsonb_typeof(x)='object' and jsonb_typeof(x->'variantId')='string' and (x->>'variantId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and jsonb_typeof(x->'countedMilli')='number' and (x->>'countedMilli') ~ '^(0|[1-9][0-9]*)$'
 then (x->>'countedMilli')::numeric>999999999999 or exists(select 1 from jsonb_object_keys(x) k where k not in ('variantId','countedMilli'))
 else true end)
 or exists(select 1 from jsonb_array_elements(p_entries) x group by lower(x->>'variantId') having count(*)>1)
 then raise exception using errcode='HCPC2',message='Invalid count entry'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'count',p_count,'revision',p_revision,'entries',p_entries)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.enter:'||p_key,0));
 select * into v_old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.enter' and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='HCS08',message='Inventory count request key conflict'; end if;
  if v_old.completed_at is not null then perform app.lock_inventory_count_access(p_actor,p_tenant,v_count.location_id,'enter'); return v_old.response_body; end if;
 end if;
 select * into v_count from app.inventory_counts where tenant_id=p_tenant and id=p_count for update;
 if not found or v_count.status not in ('draft','counting') or v_count.revision<>p_revision then raise exception using errcode='HCPC3',message='Count changed; refresh before entering quantities'; end if;
 v_time:=clock_timestamp();
 for v_line in select value from jsonb_array_elements(p_entries) order by (value->>'variantId')::uuid loop
  update app.inventory_count_lines set counted=(v_line->>'countedMilli')::numeric/1000,counted_by=p_actor,counted_at=v_time
  where tenant_id=p_tenant and count_id=p_count and variant_id=(v_line->>'variantId')::uuid;
  if not found then raise exception using errcode='HCPC1',message='Count inventory item not found'; end if;
 end loop;
 update app.inventory_counts set status='counting',revision=revision+1,updated_at=v_time where tenant_id=p_tenant and id=p_count returning * into v_count;
 perform app.lock_inventory_count_access(p_actor,p_tenant,v_count.location_id,'enter');
 v_result:=app.inventory_count_json(p_tenant,p_count);
 insert into app.inventory_count_events(tenant_id,count_id,revision,action,actor_id,payload,occurred_at) values(p_tenant,p_count,v_count.revision,'counted',p_actor,jsonb_build_object('entries',p_entries),v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.counted','inventory_count',p_count,v_count.location_id,jsonb_build_object('revision',v_count.revision),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,'inventory_count.counted','inventory_count',p_count,v_result,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.enter',p_key,v_hash,200,v_result,v_time,v_time+interval '24 hours');
 return v_result;
end; $$;

create function app.load_inventory_count(p_actor uuid,p_tenant uuid,p_count uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_location uuid;
begin
 select location_id into v_location from app.inventory_counts where tenant_id=p_tenant and id=p_count;
 if not found then raise exception using errcode='HCPC1',message='Inventory count not found'; end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,v_location,'read');
 return app.inventory_count_json(p_tenant,p_count);
end; $$;
revoke all on function app.create_inventory_count(uuid,uuid,uuid,jsonb,text,text),app.enter_inventory_count(uuid,uuid,uuid,integer,jsonb,text,text),app.load_inventory_count(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app.create_inventory_count(uuid,uuid,uuid,jsonb,text,text),app.enter_inventory_count(uuid,uuid,uuid,integer,jsonb,text,text),app.load_inventory_count(uuid,uuid,uuid) to hcs_hyperdrive;
commit;
