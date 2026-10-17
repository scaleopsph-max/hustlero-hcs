begin;

-- Replace unscoped entry points in full; preserve established capability checks and grants.
create or replace function app.load_alert_center(p_actor_user_id uuid, p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_can_manage boolean;
  v_is_owner boolean;
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

  select is_owner into v_is_owner from app.tenant_memberships
  where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active';

  perform app.sync_core_alerts(p_tenant_id);

  return pg_catalog.jsonb_build_object(
    'canManage', coalesce(v_can_manage, false),
    'counts', pg_catalog.jsonb_build_object(
      'open', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location_id)) and status='open'),
      'acknowledged', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location_id)) and status='acknowledged'),
      'resolved', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location_id)) and status='resolved'),
      'dismissed', (select count(*)::integer from app.risk_alerts where tenant_id=p_tenant_id and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,location_id)) and status='dismissed')
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
        and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,a.location_id))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app.update_alert_status(
  p_actor_user_id uuid, p_tenant_id uuid, p_alert_id uuid, p_status text, p_note text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_alert app.risk_alerts%rowtype; v_is_owner boolean;
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

  select is_owner into v_is_owner from app.tenant_memberships
  where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active';

  select * into v_alert from app.risk_alerts where tenant_id=p_tenant_id and id=p_alert_id for update;
  if not found or not (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,v_alert.location_id)) then
    raise exception using errcode='HCSE2', message='Alert was not found';
  end if;
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

create or replace function app.load_audit_activity(
  p_actor_user_id uuid, p_tenant_id uuid, p_from date, p_to date,
  p_location_id uuid, p_actor_type text, p_action text, p_entity_type text,
  p_search text, p_limit integer, p_offset integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz; v_is_owner boolean;
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
  select is_owner into v_is_owner from app.tenant_memberships
  where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active';

  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_limit not between 1 and 100 or p_offset<0
    or (p_actor_type is not null and p_actor_type not in ('tenant_user','pos_employee','platform_admin','system')) then
    raise exception using errcode='HCSE1', message='Audit filters are invalid';
  end if;
  if p_location_id is not null and not app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,p_location_id) then
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
        and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,a.location_id))
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
      'locations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',l.id,'code',l.code::text,'name',l.name) order by l.name) from app.locations l where l.tenant_id=p_tenant_id and l.is_active
        and (v_is_owner or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,l.id))),'[]'::jsonb),
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

revoke all on function app.load_alert_center(uuid,uuid), app.update_alert_status(uuid,uuid,uuid,text,text,text),
 app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function app.load_alert_center(uuid,uuid), app.update_alert_status(uuid,uuid,uuid,text,text,text),
 app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer) to hcs_hyperdrive;

commit;
