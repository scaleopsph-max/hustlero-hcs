begin;
alter table app.inventory_counts drop constraint inventory_counts_status_check;
alter table app.inventory_counts add constraint inventory_counts_status_check
 check(status in ('draft','counting','submitted','awaiting_approval','approved','posted','cancelled'));
alter table app.inventory_count_events drop constraint inventory_count_events_action_check;
alter table app.inventory_count_events add constraint inventory_count_events_action_check
 check(action in ('created','counted','submitted','approved','rejected','posted','cancelled'));

create table app.inventory_count_approval_requests (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,count_id uuid not null,
 count_revision integer not null, snapshot_hash text not null, threshold numeric(18,3) not null,
 requested_by uuid not null,requested_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,count_id,count_revision),
 foreign key(tenant_id,count_id) references app.inventory_counts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,requested_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create table app.inventory_count_approval_decisions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,request_id uuid not null,
 decision text not null check(decision in ('approved','rejected')),decided_by uuid not null,
 note text,decided_at timestamptz not null default now(),unique(tenant_id,request_id),
 foreign key(tenant_id,request_id) references app.inventory_count_approval_requests(tenant_id,id) on delete restrict,
 foreign key(tenant_id,decided_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
alter table app.inventory_count_approval_requests enable row level security;
alter table app.inventory_count_approval_decisions enable row level security;
revoke all on app.inventory_count_approval_requests,app.inventory_count_approval_decisions from public,anon,authenticated,hcs_hyperdrive;
create trigger inventory_count_approval_requests_immutable before update or delete on app.inventory_count_approval_requests
for each row execute function app.reject_inventory_count_event_change();
create trigger inventory_count_approval_decisions_immutable before update or delete on app.inventory_count_approval_decisions
for each row execute function app.reject_inventory_count_event_change();

create or replace function app.inventory_count_json(p_tenant uuid,p_count uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'locationId',c.location_id,'status',c.status,'revision',c.revision,'createdAt',c.created_at,
 'approvalRequestId',(select r.id from app.inventory_count_approval_requests r where r.tenant_id=c.tenant_id and r.count_id=c.id order by r.count_revision desc limit 1),
 'lines',coalesce((select jsonb_agg(jsonb_build_object('variantId',l.variant_id,'productName',p.name,'variantName',v.name,'sku',v.sku::text,'expectedMilli',round(l.expected_on_hand*1000)::bigint,
 'balanceVersion',l.balance_version,'countedMilli',case when l.counted is null then null else round(l.counted*1000)::bigint end,
 'currentOnHandMilli',case when b.variant_id is null then null else round(b.on_hand*1000)::bigint end,
 'currentBalanceVersion',b.version) order by l.variant_id)
 from app.inventory_count_lines l join app.product_variants v on v.tenant_id=l.tenant_id and v.id=l.variant_id
 join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
 left join app.inventory_balances b on b.tenant_id=l.tenant_id and b.location_id=c.location_id and b.variant_id=l.variant_id
 where l.tenant_id=c.tenant_id and l.count_id=c.id),'[]'::jsonb))
 from app.inventory_counts c where c.tenant_id=p_tenant and c.id=p_count;
$$;

-- Serialize policy edits and count admission for this tenant, including when no
-- policy row exists. The prior policy command and its validation remain intact.
alter function app.update_inventory_adjustment_approval_policy(uuid,uuid,numeric,text,text,text) rename to adjustment_policy_before_inventory_count;
revoke all on function app.adjustment_policy_before_inventory_count(uuid,uuid,numeric,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
create function app.update_inventory_adjustment_approval_policy(p_actor_user_id uuid,p_tenant_id uuid,p_threshold numeric,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active' and is_owner for share;
 if not found then raise exception using errcode='HCS23',message='Approval policy management is not allowed'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':inventory_count.policy',0));
 return app.adjustment_policy_before_inventory_count(p_actor_user_id,p_tenant_id,p_threshold,p_idempotency_key,p_request_hash,p_request_id);
end; $$;

create function app.inventory_count_can(p_actor uuid,p_tenant uuid,p_location uuid,p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform app.lock_inventory_count_access(p_actor,p_tenant,p_location,p_action);return true;
exception when sqlstate 'HCPC0' or sqlstate 'HCPC1' then return false;
end; $$;
revoke all on function app.inventory_count_can(uuid,uuid,uuid,text) from public,anon,authenticated,hcs_hyperdrive;
create function app.list_inventory_counts(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record;v_rows jsonb:='[]';v_locations jsonb:='[]';
begin
 if not exists(select 1 from app.tenants t join app.tenant_memberships m on m.tenant_id=t.id and m.user_id=p_actor and m.status='active'
 join app.tenant_entitlements e on e.tenant_id=t.id and e.feature_code='inventory' and e.entitled and e.enabled
 join app.features f on f.code=e.feature_code and f.platform_available
 where t.id=p_tenant and t.status='active' and (e.starts_at is null or e.starts_at<=clock_timestamp()) and (e.ends_at is null or e.ends_at>clock_timestamp()))
 then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
 for c in select id,name from app.locations where tenant_id=p_tenant and is_active and app.can_read_wholesale_location(p_actor,p_tenant,id) order by id loop
  v_locations:=v_locations||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'canCreate',app.inventory_count_can(p_actor,p_tenant,c.id,'create'),
  'canEnter',app.inventory_count_can(p_actor,p_tenant,c.id,'enter'),'canApprove',app.inventory_count_can(p_actor,p_tenant,c.id,'approve'),
  'canPost',app.inventory_count_can(p_actor,p_tenant,c.id,'post')));
 end loop;
 for c in select id,location_id,status,revision,created_at from app.inventory_counts
 where tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,location_id)
 order by created_at desc,id limit 100 loop
  perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'read');
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',c.id,'locationId',c.location_id,'status',c.status,'revision',c.revision,'createdAt',c.created_at));
 end loop;
 return jsonb_build_object('counts',v_rows,'locations',v_locations);
end; $$;
revoke all on function app.update_inventory_adjustment_approval_policy(uuid,uuid,numeric,text,text,text) from public,anon,authenticated;
grant execute on function app.update_inventory_adjustment_approval_policy(uuid,uuid,numeric,text,text,text) to hcs_hyperdrive;

create or replace function app.lock_inventory_count_access(p_actor uuid,p_tenant uuid,p_location uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean;v_manager boolean:=false;v_ent app.tenant_entitlements%rowtype;
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
   perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and (rp.permission_code='inventory_counts.enter' or (p_action='read' and rp.permission_code='approvals.manage'))
   order by mr.role_id for share of mr,rp;
   if not found then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
  end if;
 end if;
 if v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp() then raise exception using errcode='HCPC0',message='Inventory count access denied'; end if;
end; $$;

-- Check every complete count line under deterministic inventory row locks.
create function app.lock_count_balances(p_tenant uuid,p_count uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;v_seen integer:=0;v_count integer;
begin
 select count(*) into v_count from app.inventory_count_lines where tenant_id=p_tenant and count_id=p_count;
 if v_count=0 then raise exception using errcode='HCPC2',message='Count has no items'; end if;
 perform 1 from app.products p where p.tenant_id=p_tenant and p.id in
  (select v.product_id from app.inventory_count_lines l join app.product_variants v on v.tenant_id=l.tenant_id and v.id=l.variant_id where l.tenant_id=p_tenant and l.count_id=p_count)
  order by p.id for share;
 for r in select l.variant_id,l.expected_on_hand,l.balance_version,l.counted,b.on_hand,b.version
 from app.inventory_count_lines l join app.inventory_counts c on c.tenant_id=l.tenant_id and c.id=l.count_id
 join app.inventory_balances b on b.tenant_id=l.tenant_id and b.location_id=c.location_id and b.variant_id=l.variant_id
 join app.product_variants v on v.tenant_id=l.tenant_id and v.id=l.variant_id and v.is_active and v.track_inventory
 join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id and p.status='active'
 where l.tenant_id=p_tenant and l.count_id=p_count order by l.variant_id for update of b for share of v,p loop
  v_seen:=v_seen+1;
  if r.counted is null then raise exception using errcode='HCPC2',message='Count every selected item first'; end if;
  if r.version<>r.balance_version or r.on_hand<>r.expected_on_hand then raise exception using errcode='HCPC4',message='Stock changed; start a fresh recount'; end if;
 end loop;
 if v_seen<>v_count then raise exception using errcode='HCPC4',message='Stock changed; start a fresh recount'; end if;
end; $$;

create function app.post_inventory_count(p_actor uuid,p_tenant uuid,p_count uuid,p_revision integer,p_reason text,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c app.inventory_counts%rowtype;old app.idempotency_records%rowtype;r record;h text;v_threshold numeric;v_requires boolean;v_time timestamptz;v_result jsonb;v_movement uuid;v_movements jsonb:='[]';v_variance numeric;
begin
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count;
 if not found then raise exception using errcode='HCPC1',message='Inventory count not found'; end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'post');
 if p_revision is null or p_revision<1 or p_reason is null or length(btrim(p_reason)) not between 3 and 240 or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 then raise exception using errcode='HCPC2',message='Invalid count posting'; end if;
 h:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'count',p_count,'revision',p_revision,'reason',p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.post:'||p_key,0));
 select * into old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.post' and idempotency_key=p_key;
 if found then if old.request_hash<>h then raise exception using errcode='HCS08',message='Inventory count request key conflict'; end if;
 if old.completed_at is not null then perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'post');return old.response_body; end if; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.policy',0));
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count for update;
 if c.status not in ('submitted','approved') or c.revision<>p_revision then raise exception using errcode='HCPC3',message='Count changed or approval is pending'; end if;
 perform app.lock_count_balances(p_tenant,p_count);
 select inventory_adjustment_threshold into v_threshold from app.approval_policies where tenant_id=p_tenant for share;
 select v_threshold is not null and exists(select 1 from app.inventory_count_lines where tenant_id=p_tenant and count_id=p_count and abs(counted-expected_on_hand)>v_threshold) into v_requires;
 if c.status='approved' and not exists(select 1 from app.inventory_count_approval_requests req
 join app.inventory_count_approval_decisions d on d.tenant_id=req.tenant_id and d.request_id=req.id and d.decision='approved'
 where req.tenant_id=p_tenant and req.count_id=p_count and req.count_revision=c.revision-1 and req.snapshot_hash=app.inventory_count_digest(p_tenant,p_count))
 then raise exception using errcode='HCPC3',message='Count approval is no longer valid'; end if;
 if v_requires and c.status<>'approved' then raise exception using errcode='HCPC3',message='Whole-count approval is required'; end if;
 -- Validate every line before writing any ledger effect.
 for r in select l.variant_id,l.counted,l.expected_on_hand,b.reserved,b.damaged,b.average_unit_cost
 from app.inventory_count_lines l join app.inventory_balances b on b.tenant_id=l.tenant_id and b.location_id=c.location_id and b.variant_id=l.variant_id
 where l.tenant_id=p_tenant and l.count_id=p_count order by l.variant_id loop
  if r.counted<r.reserved+r.damaged then raise exception using errcode='HCPC4',message='Count conflicts with reserved or damaged stock'; end if;
  if r.counted<>r.expected_on_hand and r.average_unit_cost is null then raise exception using errcode='HCPC4',message='Inventory cost needs reconciliation before posting'; end if;
 end loop;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'post');
 v_time:=clock_timestamp();
 for r in select l.variant_id,l.counted,l.expected_on_hand,b.average_unit_cost
 from app.inventory_count_lines l join app.inventory_balances b on b.tenant_id=l.tenant_id and b.location_id=c.location_id and b.variant_id=l.variant_id
 where l.tenant_id=p_tenant and l.count_id=p_count order by l.variant_id loop
  v_variance:=r.counted-r.expected_on_hand;
  if v_variance<>0 then
   insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id,occurred_at,created_at)
   values(p_tenant,c.location_id,r.variant_id,'ADJUSTMENT',v_variance,r.average_unit_cost,'physical_inventory_count',p_count::text,p_actor,v_time,v_time) returning id into v_movement;
   update app.inventory_balances set on_hand=r.counted,average_unit_cost=case when r.counted=0 then null else r.average_unit_cost end,
    version=version+1,updated_at=v_time where tenant_id=p_tenant and location_id=c.location_id and variant_id=r.variant_id;
   v_movements:=v_movements||jsonb_build_array(v_movement);
  end if;
 end loop;
 update app.inventory_counts set status='posted',revision=revision+1,updated_at=v_time where tenant_id=p_tenant and id=p_count returning * into c;
 v_result:=app.inventory_count_json(p_tenant,p_count)||jsonb_build_object('movementIds',v_movements);
 insert into app.inventory_count_events(tenant_id,count_id,revision,action,actor_id,payload,occurred_at) values(p_tenant,p_count,c.revision,'posted',p_actor,jsonb_build_object('reason',btrim(p_reason),'movementIds',v_movements),v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.posted','inventory_count',p_count,c.location_id,btrim(p_reason),jsonb_build_object('movementIds',v_movements),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,'inventory_count.posted','inventory_count',p_count,v_result,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.post',p_key,h,201,v_result,v_time,v_time+interval '24 hours');
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'post');
 return v_result;
end; $$;

create function app.cancel_inventory_count(p_actor uuid,p_tenant uuid,p_count uuid,p_revision integer,p_reason text,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c app.inventory_counts%rowtype;old app.idempotency_records%rowtype;h text;v_time timestamptz;v_result jsonb;
begin
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count;
 if not found then raise exception using errcode='HCPC1',message='Inventory count not found'; end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'cancel');
 if p_revision is null or p_revision<1 or p_reason is null or length(btrim(p_reason)) not between 3 and 240 or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 then raise exception using errcode='HCPC2',message='Invalid count cancellation'; end if;
 h:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'count',p_count,'revision',p_revision,'reason',p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.cancel:'||p_key,0));
 select * into old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.cancel' and idempotency_key=p_key;
 if found then if old.request_hash<>h then raise exception using errcode='HCS08',message='Inventory count request key conflict'; end if;
 if old.completed_at is not null then perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'cancel');return old.response_body; end if; end if;
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count for update;
 if c.status in ('posted','cancelled') or c.revision<>p_revision then raise exception using errcode='HCPC3',message='Count changed or cannot be cancelled'; end if;
 v_time:=clock_timestamp();
 update app.inventory_counts set status='cancelled',revision=revision+1,updated_at=v_time where tenant_id=p_tenant and id=p_count returning * into c;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'cancel');
 v_result:=app.inventory_count_json(p_tenant,p_count);
 insert into app.inventory_count_events(tenant_id,count_id,revision,action,actor_id,payload,occurred_at) values(p_tenant,p_count,c.revision,'cancelled',p_actor,jsonb_build_object('reason',btrim(p_reason)),v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.cancelled','inventory_count',p_count,c.location_id,btrim(p_reason),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,'inventory_count.cancelled','inventory_count',p_count,v_result,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.cancel',p_key,h,200,v_result,v_time,v_time+interval '24 hours');
 return v_result;
end; $$;

create function app.inventory_count_digest(p_tenant uuid,p_count uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object('variantId',variant_id,'expected',expected_on_hand,
 'version',balance_version,'counted',counted) order by variant_id),'[]'::jsonb)::text,'sha256'),'hex')
 from app.inventory_count_lines where tenant_id=p_tenant and count_id=p_count;
$$;
revoke all on function app.lock_count_balances(uuid,uuid),app.inventory_count_digest(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.submit_inventory_count(p_actor uuid,p_tenant uuid,p_count uuid,p_revision integer,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c app.inventory_counts%rowtype; old app.idempotency_records%rowtype;h text;v_threshold numeric;v_needs boolean;v_request uuid;v_time timestamptz;v_result jsonb;
begin
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count;
 if not found then raise exception using errcode='HCPC1',message='Inventory count not found'; end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'submit');
 if p_revision is null or p_revision<1 or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='HCPC2',message='Invalid count submission'; end if;
 h:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'count',p_count,'revision',p_revision)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.submit:'||p_key,0));
 select * into old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.submit' and idempotency_key=p_key;
 if found then if old.request_hash<>h then raise exception using errcode='HCS08',message='Inventory count request key conflict'; end if;
 if old.completed_at is not null then perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'submit');return old.response_body; end if; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.policy',0));
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count for update;
 if c.status not in ('counting','submitted') or c.revision<>p_revision then raise exception using errcode='HCPC3',message='Count changed; refresh before submitting'; end if;
 perform app.lock_count_balances(p_tenant,p_count);
 select inventory_adjustment_threshold into v_threshold from app.approval_policies where tenant_id=p_tenant for share;
 select v_threshold is not null and exists(select 1 from app.inventory_count_lines where tenant_id=p_tenant and count_id=p_count and abs(counted-expected_on_hand)>v_threshold) into v_needs;
 v_time:=clock_timestamp();
 update app.inventory_counts set status=case when v_needs then 'awaiting_approval' else 'submitted' end,revision=revision+1,updated_at=v_time
 where tenant_id=p_tenant and id=p_count returning * into c;
 if v_needs then
  insert into app.inventory_count_approval_requests(tenant_id,count_id,count_revision,snapshot_hash,threshold,requested_by,requested_at)
  values(p_tenant,p_count,c.revision,app.inventory_count_digest(p_tenant,p_count),v_threshold,p_actor,v_time) returning id into v_request;
 end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'submit');
 v_result:=app.inventory_count_json(p_tenant,p_count)||jsonb_build_object('approvalRequestId',v_request);
 insert into app.inventory_count_events(tenant_id,count_id,revision,action,actor_id,payload,occurred_at) values(p_tenant,p_count,c.revision,'submitted',p_actor,jsonb_build_object('approvalRequestId',v_request),v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.submitted','inventory_count',p_count,c.location_id,jsonb_build_object('approvalRequestId',v_request),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,'inventory_count.submitted','inventory_count',p_count,v_result,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.submit',p_key,h,200,v_result,v_time,v_time+interval '24 hours');
 return v_result;
end; $$;

create function app.decide_inventory_count_approval(p_actor uuid,p_tenant uuid,p_count uuid,p_revision integer,p_decision text,p_note text,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c app.inventory_counts%rowtype; r app.inventory_count_approval_requests%rowtype;old app.idempotency_records%rowtype;h text;v_time timestamptz;v_result jsonb;
begin
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count;
 if not found then raise exception using errcode='HCPC1',message='Inventory count not found'; end if;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'approve');
 if p_revision is null or p_revision<1 or p_decision is null or p_decision not in ('approved','rejected') or length(coalesce(p_note,''))>240 or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 then raise exception using errcode='HCPC2',message='Invalid approval decision'; end if;
 h:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'count',p_count,'revision',p_revision,'decision',p_decision,'note',p_note)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':inventory_count.approval:'||p_key,0));
 select * into old from app.idempotency_records where tenant_id=p_tenant and operation='inventory_count.approval' and idempotency_key=p_key;
 if found then if old.request_hash<>h then raise exception using errcode='HCS08',message='Inventory count request key conflict'; end if;
 if old.completed_at is not null then perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'approve');return old.response_body; end if; end if;
 select * into c from app.inventory_counts where tenant_id=p_tenant and id=p_count for update;
 if c.status<>'awaiting_approval' or c.revision<>p_revision then raise exception using errcode='HCPC3',message='Count approval changed'; end if;
 select * into r from app.inventory_count_approval_requests where tenant_id=p_tenant and count_id=p_count and count_revision=c.revision;
 if not found or r.snapshot_hash<>app.inventory_count_digest(p_tenant,p_count) then raise exception using errcode='HCPC3',message='Count approval changed'; end if;
 perform app.lock_count_balances(p_tenant,p_count);
 v_time:=clock_timestamp();
 insert into app.inventory_count_approval_decisions(tenant_id,request_id,decision,decided_by,note,decided_at) values(p_tenant,r.id,p_decision,p_actor,nullif(btrim(p_note),''),v_time);
 update app.inventory_counts set status=case when p_decision='approved' then 'approved' else 'counting' end,revision=revision+1,updated_at=v_time where tenant_id=p_tenant and id=p_count returning * into c;
 perform app.lock_inventory_count_access(p_actor,p_tenant,c.location_id,'approve');
 v_result:=app.inventory_count_json(p_tenant,p_count)||jsonb_build_object('approvalRequestId',r.id,'decision',p_decision);
 insert into app.inventory_count_events(tenant_id,count_id,revision,action,actor_id,payload,occurred_at) values(p_tenant,p_count,c.revision,p_decision,p_actor,jsonb_build_object('approvalRequestId',r.id),v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'inventory_count.'||p_decision,'inventory_count',p_count,c.location_id,jsonb_build_object('approvalRequestId',r.id),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,'inventory_count.'||p_decision,'inventory_count',p_count,v_result,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'inventory_count.approval',p_key,h,200,v_result,v_time,v_time+interval '24 hours');
 return v_result;
end; $$;

revoke all on function app.submit_inventory_count(uuid,uuid,uuid,integer,text,text),
 app.decide_inventory_count_approval(uuid,uuid,uuid,integer,text,text,text,text),
 app.post_inventory_count(uuid,uuid,uuid,integer,text,text,text),app.cancel_inventory_count(uuid,uuid,uuid,integer,text,text,text)
 from public,anon,authenticated;
revoke all on function app.list_inventory_counts(uuid,uuid) from public,anon,authenticated;
grant execute on function app.submit_inventory_count(uuid,uuid,uuid,integer,text,text),
 app.decide_inventory_count_approval(uuid,uuid,uuid,integer,text,text,text,text),
 app.post_inventory_count(uuid,uuid,uuid,integer,text,text,text),app.cancel_inventory_count(uuid,uuid,uuid,integer,text,text,text)
 to hcs_hyperdrive;
grant execute on function app.list_inventory_counts(uuid,uuid) to hcs_hyperdrive;
commit;
