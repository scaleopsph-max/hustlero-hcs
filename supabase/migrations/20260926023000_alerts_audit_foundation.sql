begin;

insert into app.permissions (code, description) values
  ('alerts.read', 'View tenant alerts'),
  ('alerts.manage', 'Acknowledge, resolve, and dismiss tenant alerts'),
  ('audit.read', 'View tenant business audit activity')
on conflict (code) do update set description = excluded.description;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r
cross join app.permissions p
where lower(r.code::text) in ('owner', 'admin', 'manager')
  and p.code in ('alerts.read', 'alerts.manage', 'audit.read')
on conflict do nothing;

create function app.initialize_role_control_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) in ('owner', 'admin', 'manager') then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values
      (new.tenant_id, new.id, 'alerts.read'),
      (new.tenant_id, new.id, 'alerts.manage'),
      (new.tenant_id, new.id, 'audit.read')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_role_control_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_control_permissions
after insert on app.roles for each row execute function app.initialize_role_control_permissions();

create table app.risk_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  location_id uuid,
  category text not null check (category in ('cash_register','inventory','sales','employee','expense','orders','finance','system')),
  severity text not null check (severity in ('info','attention','warning','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  title text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  dedup_key text not null,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  dismissed_at timestamptz,
  dismissed_by uuid,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, dedup_key),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, acknowledged_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, resolved_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, dismissed_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint risk_alerts_title_not_blank check (btrim(title) <> ''),
  constraint risk_alerts_message_not_blank check (btrim(message) <> ''),
  constraint risk_alerts_dedup_not_blank check (btrim(dedup_key) <> '')
);
create index risk_alerts_tenant_status_detected_idx on app.risk_alerts (tenant_id, status, last_detected_at desc);
create index risk_alerts_tenant_location_status_idx on app.risk_alerts (tenant_id, location_id, status);
alter table app.risk_alerts enable row level security;
revoke all on table app.risk_alerts from public, anon, authenticated, hcs_hyperdrive;

create function app.reject_risk_alert_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'risk alerts cannot be deleted';
end;
$$;
revoke all on function app.reject_risk_alert_delete() from public, anon, authenticated, hcs_hyperdrive;
create trigger risk_alerts_reject_delete before delete on app.risk_alerts
for each row execute function app.reject_risk_alert_delete();
create trigger risk_alerts_set_updated_at before update on app.risk_alerts
for each row execute function app.set_updated_at();

create function app.sync_core_alerts(p_tenant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.risk_alerts (
    tenant_id, location_id, category, severity, status, title, message,
    entity_type, entity_id, dedup_key, metadata
  )
  select
    ib.tenant_id,
    ib.location_id,
    'inventory',
    'warning',
    'open',
    pv.sku::text || ' is out of stock',
    p.name || ' / ' || pv.name || ' has no available stock at ' || l.name || '.',
    'product_variant',
    ib.variant_id,
    'inventory.out_of_stock:' || ib.location_id::text || ':' || ib.variant_id::text,
    pg_catalog.jsonb_build_object(
      'productId', p.id,
      'productName', p.name,
      'variantName', pv.name,
      'sku', pv.sku::text,
      'availableMilli', pg_catalog.round((ib.on_hand - ib.reserved - ib.damaged) * 1000)::bigint
    )
  from app.inventory_balances ib
  join app.product_variants pv on pv.tenant_id = ib.tenant_id and pv.id = ib.variant_id
  join app.products p on p.tenant_id = pv.tenant_id and p.id = pv.product_id
  join app.locations l on l.tenant_id = ib.tenant_id and l.id = ib.location_id
  where ib.tenant_id = p_tenant_id
    and pv.track_inventory and pv.is_active and p.status = 'active' and l.is_active
    and ib.on_hand - ib.reserved - ib.damaged <= 0
  on conflict (tenant_id, dedup_key) do update set
    severity = excluded.severity,
    title = excluded.title,
    message = excluded.message,
    last_detected_at = now(),
    metadata = excluded.metadata,
    status = case when app.risk_alerts.status = 'resolved' then 'open' else app.risk_alerts.status end,
    resolved_at = case when app.risk_alerts.status = 'resolved' then null else app.risk_alerts.resolved_at end,
    resolved_by = case when app.risk_alerts.status = 'resolved' then null else app.risk_alerts.resolved_by end;

  update app.risk_alerts alert set
    status = 'resolved',
    resolved_at = now(),
    resolved_by = null,
    note = coalesce(alert.note, 'Condition cleared automatically.')
  where alert.tenant_id = p_tenant_id
    and alert.category = 'inventory'
    and alert.dedup_key like 'inventory.out_of_stock:%'
    and alert.status in ('open', 'acknowledged')
    and not exists (
      select 1
      from app.inventory_balances ib
      join app.product_variants pv on pv.tenant_id = ib.tenant_id and pv.id = ib.variant_id
      join app.products p on p.tenant_id = pv.tenant_id and p.id = pv.product_id
      join app.locations l on l.tenant_id = ib.tenant_id and l.id = ib.location_id
      where ib.tenant_id = alert.tenant_id and ib.location_id = alert.location_id and ib.variant_id = alert.entity_id
        and pv.track_inventory and pv.is_active and p.status = 'active' and l.is_active
        and ib.on_hand - ib.reserved - ib.damaged <= 0
    );

  insert into app.risk_alerts (
    tenant_id, location_id, category, severity, status, title, message,
    entity_type, entity_id, dedup_key, metadata, first_detected_at, last_detected_at
  )
  select
    rs.tenant_id,
    rs.location_id,
    'cash_register',
    'attention',
    'open',
    r.name || ' closed with a cash variance',
    'Counted cash differs from expected cash by ' || trim(to_char(rs.variance, 'FM999999999990.00')) || '.',
    'register_session',
    rs.id,
    'cash_register.variance:' || rs.id::text,
    pg_catalog.jsonb_build_object(
      'registerId', rs.register_id,
      'registerName', r.name,
      'expectedCashCentavos', pg_catalog.round(rs.expected_cash * 100)::bigint,
      'countedCashCentavos', pg_catalog.round(rs.counted_cash * 100)::bigint,
      'varianceCentavos', pg_catalog.round(rs.variance * 100)::bigint
    ),
    coalesce(rs.closed_at, rs.updated_at),
    coalesce(rs.closed_at, rs.updated_at)
  from app.register_sessions rs
  join app.registers r on r.tenant_id = rs.tenant_id and r.id = rs.register_id
  where rs.tenant_id = p_tenant_id and rs.status in ('closed', 'exception') and rs.variance <> 0
  on conflict (tenant_id, dedup_key) do update set
    title = excluded.title,
    message = excluded.message,
    metadata = excluded.metadata;
end;
$$;
revoke all on function app.sync_core_alerts(uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.load_alert_center(p_actor_user_id uuid, p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_can_manage boolean;
begin
  if not exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_actor_user_id and m.status = 'active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr
        join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = m.tenant_id and mr.user_id = m.user_id and rp.permission_code in ('alerts.read','alerts.manage')
      ))
  ) then raise exception using errcode = 'HCSE0', message = 'Alert access is not allowed'; end if;

  select m.is_owner or exists (
    select 1 from app.membership_roles mr
    join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
    where mr.tenant_id = m.tenant_id and mr.user_id = m.user_id and rp.permission_code = 'alerts.manage'
  ) into v_can_manage
  from app.tenant_memberships m
  where m.tenant_id = p_tenant_id and m.user_id = p_actor_user_id and m.status = 'active';

  perform app.sync_core_alerts(p_tenant_id);

  return pg_catalog.jsonb_build_object(
    'canManage', coalesce(v_can_manage, false),
    'counts', pg_catalog.jsonb_build_object(
      'open', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and status='open'),
      'acknowledged', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and status='acknowledged'),
      'resolved', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and status='resolved'),
      'dismissed', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and status='dismissed')
    ),
    'alerts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', a.id, 'category', a.category, 'severity', a.severity, 'status', a.status,
        'title', a.title, 'message', a.message, 'entityType', a.entity_type, 'entityId', a.entity_id,
        'locationId', a.location_id, 'locationName', l.name,
        'firstDetectedAt', a.first_detected_at, 'lastDetectedAt', a.last_detected_at,
        'acknowledgedAt', a.acknowledged_at, 'resolvedAt', a.resolved_at,
        'dismissedAt', a.dismissed_at, 'note', a.note, 'metadata', a.metadata
      ) order by
        case a.status when 'open' then 0 when 'acknowledged' then 1 when 'resolved' then 2 else 3 end,
        case a.severity when 'critical' then 0 when 'warning' then 1 when 'attention' then 2 else 3 end,
        a.last_detected_at desc)
      from app.risk_alerts a left join app.locations l on l.tenant_id=a.tenant_id and l.id=a.location_id
      where a.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

create function app.update_alert_status(
  p_actor_user_id uuid, p_tenant_id uuid, p_alert_id uuid, p_status text, p_note text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_alert app.risk_alerts%rowtype;
begin
  if p_status not in ('acknowledged','resolved','dismissed') then
    raise exception using errcode='HCSE1', message='Alert status is invalid';
  end if;
  if not exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp
          on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
        where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='alerts.manage'
      ))
  ) then raise exception using errcode='HCSE0', message='Alert management is not allowed'; end if;

  select * into v_alert from app.risk_alerts where tenant_id=p_tenant_id and id=p_alert_id for update;
  if not found then raise exception using errcode='HCSE2', message='Alert was not found'; end if;
  if v_alert.status = p_status then
    return pg_catalog.jsonb_build_object('alertId', p_alert_id, 'status', p_status);
  end if;

  update app.risk_alerts set
    status=p_status,
    note=nullif(btrim(p_note),''),
    acknowledged_at=case when p_status='acknowledged' then now() else acknowledged_at end,
    acknowledged_by=case when p_status='acknowledged' then p_actor_user_id else acknowledged_by end,
    resolved_at=case when p_status='resolved' then now() else resolved_at end,
    resolved_by=case when p_status='resolved' then p_actor_user_id else resolved_by end,
    dismissed_at=case when p_status='dismissed' then now() else dismissed_at end,
    dismissed_by=case when p_status='dismissed' then p_actor_user_id else dismissed_by end
  where tenant_id=p_tenant_id and id=p_alert_id;

  insert into audit.audit_events(
    tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata
  ) values (
    p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'alert.'||p_status,'risk_alert',p_alert_id,
    v_alert.location_id,nullif(btrim(p_note),''),
    pg_catalog.jsonb_build_object('fromStatus',v_alert.status,'toStatus',p_status,'category',v_alert.category,'severity',v_alert.severity)
  );
  return pg_catalog.jsonb_build_object('alertId', p_alert_id, 'status', p_status);
end;
$$;

create function app.load_audit_activity(
  p_actor_user_id uuid, p_tenant_id uuid, p_from date, p_to date,
  p_location_id uuid, p_actor_type text, p_action text, p_entity_type text,
  p_search text, p_limit integer, p_offset integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz;
begin
  if not exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp
          on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
        where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='audit.read'
      ))
  ) then raise exception using errcode='HCSE0', message='Audit access is not allowed'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_limit not between 1 and 100 or p_offset<0
    or (p_actor_type is not null and p_actor_type not in ('tenant_user','pos_employee','platform_admin','system')) then
    raise exception using errcode='HCSE1', message='Audit filters are invalid';
  end if;
  if p_location_id is not null and not exists(select 1 from app.locations where tenant_id=p_tenant_id and id=p_location_id) then
    raise exception using errcode='HCSE2', message='Audit location was not found';
  end if;
  select timezone into v_timezone from app.tenants where id=p_tenant_id;
  v_start:=p_from::timestamp at time zone v_timezone;
  v_end:=(p_to+1)::timestamp at time zone v_timezone;

  return (
    with activity as (
      select a.*,
        case a.actor_type
          when 'tenant_user' then coalesce((select u.email from auth.users u where u.id=a.actor_id),'Tenant user')
          when 'pos_employee' then coalesce((select e.display_name from app.employees e where e.tenant_id=a.tenant_id and e.id=a.actor_id),'POS employee')
          when 'system' then 'System'
          else 'Platform admin'
        end actor_label,
        l.name location_name
      from audit.audit_events a
      left join app.locations l on l.tenant_id=a.tenant_id and l.id=a.location_id
      where a.tenant_id=p_tenant_id and a.occurred_at>=v_start and a.occurred_at<v_end
        and (p_location_id is null or a.location_id=p_location_id)
        and (p_actor_type is null or a.actor_type=p_actor_type)
        and (p_action is null or a.action=p_action)
        and (p_entity_type is null or a.entity_type=p_entity_type)
    ), filtered as (
      select * from activity
      where coalesce(btrim(p_search),'')='' or concat_ws(' ',action,entity_type,reason,actor_label,location_name,metadata::text) ilike '%'||btrim(p_search)||'%'
    ), page as (
      select * from filtered order by occurred_at desc,id desc limit p_limit offset p_offset
    )
    select pg_catalog.jsonb_build_object(
      'locations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',l.id,'code',l.code::text,'name',l.name) order by l.name) from app.locations l where l.tenant_id=p_tenant_id and l.is_active),'[]'::jsonb),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',p.id,'requestId',p.request_id,'actorType',p.actor_type,'actorId',p.actor_id,'actorLabel',p.actor_label,
        'action',p.action,'entityType',p.entity_type,'entityId',p.entity_id,'locationId',p.location_id,
        'locationName',p.location_name,'reason',p.reason,'metadata',p.metadata,'occurredAt',p.occurred_at
      ) order by p.occurred_at desc,p.id desc) from page p),'[]'::jsonb),
      'total',(select count(*)::integer from filtered),
      'hasMore',(select count(*)>p_offset+p_limit from filtered)
    )
  );
end;
$$;

revoke all on function app.load_alert_center(uuid,uuid) from public, anon, authenticated;
revoke all on function app.update_alert_status(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function app.load_alert_center(uuid,uuid) to hcs_hyperdrive;
grant execute on function app.update_alert_status(uuid,uuid,uuid,text,text,text) to hcs_hyperdrive;
grant execute on function app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer) to hcs_hyperdrive;

commit;
