begin;

insert into app.permissions (code, description) values
  ('approvals.read', 'View approval requests and policies'),
  ('approvals.manage', 'Configure approval policies and decide requests')
on conflict (code) do update set description = excluded.description;

create table app.approval_policies (
  tenant_id uuid primary key references app.tenants (id) on delete restrict,
  inventory_adjustment_threshold numeric(18, 3),
  updated_by uuid references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint approval_policy_threshold_nonnegative check (
    inventory_adjustment_threshold is null or inventory_adjustment_threshold >= 0
  )
);

create table app.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  subject_type text not null check (subject_type in ('inventory_adjustment')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  location_id uuid not null,
  variant_id uuid not null,
  requested_quantity numeric(18, 3) not null check (requested_quantity <> 0),
  requested_unit_cost numeric(18, 2) check (requested_unit_cost is null or requested_unit_cost >= 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 240),
  requested_by uuid not null references auth.users (id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  resulting_movement_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  foreign key (tenant_id, resulting_movement_id) references app.inventory_movements (tenant_id, id) on delete restrict,
  constraint approval_request_decision_consistent check (
    (status = 'pending' and decided_by is null and decided_at is null and resulting_movement_id is null)
    or (status = 'approved' and decided_by is not null and decided_at is not null and resulting_movement_id is not null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null and resulting_movement_id is null)
  )
);
create index approval_requests_tenant_status_requested_idx
  on app.approval_requests (tenant_id, status, requested_at desc, id);

alter table app.approval_policies enable row level security;
alter table app.approval_requests enable row level security;
revoke all on table app.approval_policies, app.approval_requests from public, anon, authenticated, hcs_hyperdrive;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, permission.code
from app.roles role
cross join app.permissions permission
where lower(role.code::text) = 'owner'
  and permission.code in ('approvals.read', 'approvals.manage')
on conflict do nothing;

create function app.initialize_owner_approval_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.code::text) = 'owner' then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values
      (new.tenant_id, new.id, 'approvals.read'),
      (new.tenant_id, new.id, 'approvals.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_owner_approval_permissions() from public, anon, authenticated;
create trigger roles_initialize_approval_permissions
after insert on app.roles for each row execute function app.initialize_owner_approval_permissions();

create function app.list_approval_center(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_can_manage boolean;
  v_threshold numeric(18, 3);
begin
  select membership.is_owner or exists (
    select 1 from app.membership_roles membership_role
    join app.role_permissions role_permission
      on role_permission.tenant_id = membership_role.tenant_id and role_permission.role_id = membership_role.role_id
    where membership_role.tenant_id = membership.tenant_id
      and membership_role.user_id = membership.user_id
      and role_permission.permission_code = 'approvals.manage'
  ) into v_can_manage
  from app.tenant_memberships membership
  where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active'
    and (membership.is_owner or exists (
      select 1 from app.membership_roles mr
      join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where mr.tenant_id = membership.tenant_id and mr.user_id = membership.user_id
        and rp.permission_code in ('approvals.read', 'approvals.manage')
    ));
  if not found then raise exception using errcode = 'HCS23', message = 'Approval access is not allowed'; end if;

  select inventory_adjustment_threshold into v_threshold
  from app.approval_policies where tenant_id = p_tenant_id;

  return pg_catalog.jsonb_build_object(
    'canManage', v_can_manage,
    'inventoryAdjustmentThresholdMilli', case when v_threshold is null then null else round(v_threshold * 1000)::bigint end,
    'requests', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', request.id,
        'subjectType', request.subject_type,
        'status', request.status,
        'locationId', request.location_id,
        'locationName', location.name,
        'variantId', request.variant_id,
        'productName', product.name,
        'variantName', variant.name,
        'sku', variant.sku::text,
        'quantityMilli', round(request.requested_quantity * 1000)::bigint,
        'unitCostMinor', case when request.requested_unit_cost is null then null else round(request.requested_unit_cost * 100)::bigint end,
        'reason', request.reason,
        'requestedByLabel', coalesce(requester.display_name, case when membership.is_owner then 'Business owner' else 'Tenant user' end),
        'requestedAt', request.requested_at,
        'decidedByLabel', case when request.decided_by is null then null else coalesce(decider.display_name, 'Business owner') end,
        'decidedAt', request.decided_at,
        'decisionNote', request.decision_note
      ) order by request.requested_at desc)
      from app.approval_requests request
      join app.locations location on location.tenant_id = request.tenant_id and location.id = request.location_id
      join app.product_variants variant on variant.tenant_id = request.tenant_id and variant.id = request.variant_id
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      join app.tenant_memberships membership on membership.tenant_id = request.tenant_id and membership.user_id = request.requested_by
      left join app.employees requester on requester.tenant_id = request.tenant_id and requester.user_id = request.requested_by
      left join app.employees decider on decider.tenant_id = request.tenant_id and decider.user_id = request.decided_by
      where request.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

create function app.update_inventory_adjustment_approval_policy(
  p_actor_user_id uuid, p_tenant_id uuid, p_threshold numeric,
  p_idempotency_key text, p_request_hash text, p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb;
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant_id and user_id = p_actor_user_id and status = 'active' and is_owner) then
    raise exception using errcode = 'HCS23', message = 'Approval policy management is not allowed';
  end if;
  if p_threshold is not null and (p_threshold < 0 or p_threshold <> round(p_threshold, 3) or p_threshold > 999999999.999) then
    raise exception using errcode = 'HCS24', message = 'Approval threshold is invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text || ':approval.policy:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id and operation = 'approval.policy.update' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key was reused with different approval policy'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'approval.policy.update', p_idempotency_key, p_request_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;
  insert into app.approval_policies (tenant_id, inventory_adjustment_threshold, updated_by)
  values (p_tenant_id, p_threshold, p_actor_user_id)
  on conflict (tenant_id) do update set inventory_adjustment_threshold = excluded.inventory_adjustment_threshold, updated_by = excluded.updated_by, updated_at = now();
  v_response := pg_catalog.jsonb_build_object('inventoryAdjustmentThresholdMilli', case when p_threshold is null then null else round(p_threshold * 1000)::bigint end, 'status', 'updated');
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'approval.policy.updated', 'approval_policy', p_tenant_id, pg_catalog.jsonb_build_object('inventoryAdjustmentThreshold', p_threshold));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'approval.policy.updated', 'approval_policy', p_tenant_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'approval.policy.update' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create or replace function app.record_inventory_adjustment(
  p_actor_user_id uuid, p_tenant_id uuid, p_location_id uuid, p_variant_id uuid,
  p_quantity numeric, p_unit_cost numeric, p_reason text,
  p_idempotency_key text, p_request_hash text, p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_records%rowtype; v_is_owner boolean; v_employee_id uuid;
  v_balance app.inventory_balances%rowtype; v_threshold numeric(18,3); v_effective_cost numeric(18,2);
  v_new_on_hand numeric(18,3); v_new_average numeric(18,2); v_entity_id uuid; v_response jsonb;
begin
  select membership.is_owner, employee.id into v_is_owner, v_employee_id
  from app.tenant_memberships membership left join app.employees employee on employee.tenant_id = membership.tenant_id and employee.user_id = membership.user_id and employee.status = 'active'
  where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id and membership.status = 'active'
    and (membership.is_owner or exists (select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id where mr.tenant_id = membership.tenant_id and mr.user_id = membership.user_id and rp.permission_code = 'inventory.manage'));
  if not found then raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed'; end if;
  if not exists (select 1 from app.tenant_entitlements e join app.features f on f.code = e.feature_code where e.tenant_id = p_tenant_id and e.feature_code = 'inventory' and e.entitled and e.enabled and f.platform_available and (e.starts_at is null or e.starts_at <= now()) and (e.ends_at is null or e.ends_at > now())) then raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable'; end if;
  if p_quantity is null or p_quantity = 0 or p_quantity <> round(p_quantity,3) or abs(p_quantity) > 999999999.999 or p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost <> round(p_unit_cost,2)) or p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 240 then raise exception using errcode = 'HCS20', message = 'Inventory adjustment is invalid'; end if;
  if not exists (select 1 from app.locations l where l.tenant_id = p_tenant_id and l.id = p_location_id and l.is_active and (v_is_owner or exists (select 1 from app.employee_locations el where el.tenant_id = p_tenant_id and el.employee_id = v_employee_id and el.location_id = l.id))) then raise exception using errcode = 'HCS19', message = 'Inventory location was not found'; end if;
  if not exists (select 1 from app.product_variants v join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id where v.tenant_id=p_tenant_id and v.id=p_variant_id and v.is_active and v.track_inventory and p.status='active') then raise exception using errcode = 'HCS21', message = 'Inventory variant was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.adjustment:' || p_location_id::text || ':' || p_variant_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.adjustment.request:' || p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='inventory.adjustment.record' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with different adjustment'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records (tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values (p_tenant_id,'inventory.adjustment.record',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours'); end if;
  select * into v_balance from app.inventory_balances where tenant_id=p_tenant_id and location_id=p_location_id and variant_id=p_variant_id for update;
  if not found then raise exception using errcode='HCS22', message='Opening inventory must be recorded before an adjustment'; end if;
  v_new_on_hand:=v_balance.on_hand+p_quantity;
  if v_new_on_hand<0 or v_new_on_hand<v_balance.reserved then raise exception using errcode='HCS22', message='Adjustment would make available stock negative'; end if;
  select inventory_adjustment_threshold into v_threshold from app.approval_policies where tenant_id=p_tenant_id;
  if v_threshold is not null and abs(p_quantity)>v_threshold then
    insert into app.approval_requests (tenant_id,subject_type,location_id,variant_id,requested_quantity,requested_unit_cost,reason,requested_by)
    values (p_tenant_id,'inventory_adjustment',p_location_id,p_variant_id,p_quantity,p_unit_cost,btrim(p_reason),p_actor_user_id) returning id into v_entity_id;
    v_response:=pg_catalog.jsonb_build_object('approvalRequestId',v_entity_id,'locationId',p_location_id,'variantId',p_variant_id,'quantityMilli',round(p_quantity*1000)::bigint,'status','pending_approval');
    insert into audit.audit_events (tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata) values (p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'inventory.adjustment.requested','approval_request',v_entity_id,p_location_id,btrim(p_reason),pg_catalog.jsonb_build_object('quantity',p_quantity,'unitCost',p_unit_cost));
    insert into integration.event_outbox (tenant_id,topic,aggregate_type,aggregate_id,payload) values (p_tenant_id,'inventory.adjustment.requested','approval_request',v_entity_id,v_response);
  else
    v_effective_cost:=coalesce(p_unit_cost,v_balance.average_unit_cost);
    if p_quantity>0 and p_unit_cost is not null then v_new_average:=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,p_unit_cost)+p_quantity*p_unit_cost)/v_new_on_hand,2); else v_new_average:=case when v_new_on_hand=0 then null else v_balance.average_unit_cost end; end if;
    insert into app.inventory_movements (tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id) values (p_tenant_id,p_location_id,p_variant_id,'ADJUSTMENT',p_quantity,v_effective_cost,'manual_inventory_adjustment',p_idempotency_key,p_actor_user_id) returning id into v_entity_id;
    update app.inventory_balances set on_hand=v_new_on_hand,average_unit_cost=v_new_average,version=version+1,updated_at=now() where tenant_id=p_tenant_id and location_id=p_location_id and variant_id=p_variant_id;
    v_response:=pg_catalog.jsonb_build_object('movementId',v_entity_id,'locationId',p_location_id,'variantId',p_variant_id,'quantityMilli',round(p_quantity*1000)::bigint,'onHandMilli',round(v_new_on_hand*1000)::bigint,'status','recorded');
    insert into audit.audit_events (tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata) values (p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'inventory.adjustment.recorded','inventory_movement',v_entity_id,p_location_id,btrim(p_reason),pg_catalog.jsonb_build_object('quantity',p_quantity,'unitCost',v_effective_cost,'onHand',v_new_on_hand));
    insert into integration.event_outbox (tenant_id,topic,aggregate_type,aggregate_id,payload) values (p_tenant_id,'inventory.adjustment.recorded','inventory_movement',v_entity_id,v_response);
  end if;
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='inventory.adjustment.record' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function app.decide_approval_request(
  p_actor_user_id uuid, p_tenant_id uuid, p_approval_request_id uuid, p_decision text, p_note text,
  p_idempotency_key text, p_request_hash text, p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_records%rowtype; v_request app.approval_requests%rowtype; v_balance app.inventory_balances%rowtype;
  v_new_on_hand numeric(18,3); v_new_average numeric(18,2); v_effective_cost numeric(18,2); v_movement_id uuid; v_response jsonb;
begin
  if not exists (select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists (select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='approvals.manage'))) then raise exception using errcode='HCS23', message='Approval management is not allowed'; end if;
  if p_decision not in ('approved','rejected') or p_note is not null and char_length(p_note)>240 then raise exception using errcode='HCS24', message='Approval decision is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text || ':approval.decision:' || p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='approval.request.decide' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08', message='Idempotency key was reused with different approval decision'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records (tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values (p_tenant_id,'approval.request.decide',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours'); end if;
  select * into v_request from app.approval_requests where tenant_id=p_tenant_id and id=p_approval_request_id for update;
  if not found then raise exception using errcode='HCS25', message='Approval request was not found'; end if;
  if v_request.status<>'pending' then raise exception using errcode='HCS26', message='Approval request is already decided'; end if;
  if p_decision='approved' then
    select * into v_balance from app.inventory_balances where tenant_id=p_tenant_id and location_id=v_request.location_id and variant_id=v_request.variant_id for update;
    if not found then raise exception using errcode='HCS22', message='Opening inventory must be recorded before an adjustment'; end if;
    v_new_on_hand:=v_balance.on_hand+v_request.requested_quantity;
    if v_new_on_hand<0 or v_new_on_hand<v_balance.reserved then raise exception using errcode='HCS22', message='Adjustment would make available stock negative'; end if;
    v_effective_cost:=coalesce(v_request.requested_unit_cost,v_balance.average_unit_cost);
    if v_request.requested_quantity>0 and v_request.requested_unit_cost is not null then v_new_average:=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,v_request.requested_unit_cost)+v_request.requested_quantity*v_request.requested_unit_cost)/v_new_on_hand,2); else v_new_average:=case when v_new_on_hand=0 then null else v_balance.average_unit_cost end; end if;
    insert into app.inventory_movements (tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id) values (p_tenant_id,v_request.location_id,v_request.variant_id,'ADJUSTMENT',v_request.requested_quantity,v_effective_cost,'approved_inventory_adjustment',v_request.id::text,p_actor_user_id) returning id into v_movement_id;
    update app.inventory_balances set on_hand=v_new_on_hand,average_unit_cost=v_new_average,version=version+1,updated_at=now() where tenant_id=p_tenant_id and location_id=v_request.location_id and variant_id=v_request.variant_id;
  end if;
  update app.approval_requests set status=p_decision,decided_by=p_actor_user_id,decided_at=now(),decision_note=nullif(btrim(p_note),''),resulting_movement_id=v_movement_id where tenant_id=p_tenant_id and id=p_approval_request_id;
  v_response:=pg_catalog.jsonb_build_object('approvalRequestId',p_approval_request_id,'movementId',v_movement_id,'status',p_decision);
  insert into audit.audit_events (tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata) values (p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'approval.request.'||p_decision,'approval_request',p_approval_request_id,v_request.location_id,nullif(btrim(p_note),''),pg_catalog.jsonb_build_object('subjectType',v_request.subject_type,'movementId',v_movement_id));
  insert into integration.event_outbox (tenant_id,topic,aggregate_type,aggregate_id,payload) values (p_tenant_id,'approval.request.'||p_decision,'approval_request',p_approval_request_id,v_response);
  update app.idempotency_records set response_status=200,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='approval.request.decide' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function app.list_approval_center(uuid,uuid), app.update_inventory_adjustment_approval_policy(uuid,uuid,numeric,text,text,text), app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function app.list_approval_center(uuid,uuid), app.update_inventory_adjustment_approval_policy(uuid,uuid,numeric,text,text,text), app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text) to hcs_hyperdrive;

commit;
