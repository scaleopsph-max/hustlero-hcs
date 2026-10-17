begin;

create function app.can_read_notification_location(p_actor uuid,p_tenant uuid,p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor
  and m.status='active' and (m.is_owner or app.can_read_wholesale_location(p_actor,p_tenant,p_location)));
$$;
revoke all on function app.can_read_notification_location(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create or replace function app.sync_core_notifications(p_tenant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.sync_core_alerts(p_tenant_id);

  insert into app.notifications (
    tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata
  )
  select
    a.tenant_id, m.user_id, 'alert', a.severity, a.title, a.message,
    'risk_alert', a.id, a.location_id, '/alerts', 'alert:' || a.category,
    'alert:' || a.id::text,
    pg_catalog.jsonb_build_object('alertStatus', a.status, 'alertCategory', a.category)
  from app.risk_alerts a
  join app.tenant_memberships m on m.tenant_id = a.tenant_id and m.status = 'active'
  where a.tenant_id = p_tenant_id and a.status in ('open', 'acknowledged')
    and app.can_read_notification_location(m.user_id,p_tenant_id,a.location_id)
    and (m.is_owner or exists (
      select 1 from app.membership_roles mr
      join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
      where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id
        and rp.permission_code in ('alerts.read','alerts.manage')
    ))
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;

  insert into app.notifications (
    tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata
  )
  select
    request.tenant_id, membership.user_id, 'approval', 'attention',
    'Inventory adjustment needs approval',
    product.name || ' / ' || variant.name || ' at ' || location.name || ' is waiting for a decision.',
    'approval_request', request.id, request.location_id, '/approvals', 'approval:pending',
    'approval:' || request.id::text || ':pending',
    pg_catalog.jsonb_build_object('approvalStatus', request.status, 'subjectType', request.subject_type)
  from app.approval_requests request
  join app.locations location on location.tenant_id=request.tenant_id and location.id=request.location_id
  join app.product_variants variant on variant.tenant_id=request.tenant_id and variant.id=request.variant_id
  join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id
  join app.tenant_memberships membership on membership.tenant_id=request.tenant_id and membership.status='active'
  where request.tenant_id=p_tenant_id and request.status='pending'
    and app.can_read_notification_location(membership.user_id,p_tenant_id,request.location_id)
    and (membership.is_owner or exists (
      select 1 from app.membership_roles mr
      join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
      where mr.tenant_id=membership.tenant_id and mr.user_id=membership.user_id
        and rp.permission_code='approvals.manage'
    ))
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;

  insert into app.notifications (
    tenant_id, recipient_user_id, category, severity, title, message,
    linked_entity_type, linked_entity_id, location_id, href, group_key, dedup_key, metadata
  )
  select
    request.tenant_id, request.requested_by, 'approval',
    case when request.status='approved' then 'info' else 'warning' end,
    'Inventory adjustment ' || request.status,
    product.name || ' / ' || variant.name || ' at ' || location.name || ' was ' || request.status || '.',
    'approval_request', request.id, request.location_id, '/approvals', 'approval:decision',
    'approval:' || request.id::text || ':' || request.status,
    pg_catalog.jsonb_build_object('approvalStatus', request.status, 'subjectType', request.subject_type)
  from app.approval_requests request
  join app.locations location on location.tenant_id=request.tenant_id and location.id=request.location_id
  join app.product_variants variant on variant.tenant_id=request.tenant_id and variant.id=request.variant_id
  join app.products product on product.tenant_id=variant.tenant_id and product.id=variant.product_id
  join app.tenant_memberships membership on membership.tenant_id=request.tenant_id
    and membership.user_id=request.requested_by and membership.status='active'
  where request.tenant_id=p_tenant_id and request.status in ('approved','rejected')
    and app.can_read_notification_location(membership.user_id,p_tenant_id,request.location_id)
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;
end;
$$;

create or replace function app.load_notification_center(
  p_actor_user_id uuid, p_tenant_id uuid, p_unread_only boolean, p_limit integer, p_offset integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app.tenant_memberships
    where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active'
  ) then raise exception using errcode='HCSN0', message='Notification access is not allowed'; end if;
  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception using errcode='HCSN1', message='Notification filters are invalid'; end if;

  perform app.sync_core_notifications(p_tenant_id);

  return (
    with filtered as (
      select n.*, l.name location_name
      from app.notifications n
      left join app.locations l on l.tenant_id=n.tenant_id and l.id=n.location_id
      where n.tenant_id=p_tenant_id and n.recipient_user_id=p_actor_user_id
        and app.can_read_notification_location(p_actor_user_id,p_tenant_id,n.location_id)
        and (not p_unread_only or n.read_at is null)
    ), page as (
      select * from filtered order by (read_at is null) desc, created_at desc, id desc
      limit p_limit offset p_offset
    )
    select pg_catalog.jsonb_build_object(
      'unreadCount', (select count(*)::integer from app.notifications where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and read_at is null
        and app.can_read_notification_location(p_actor_user_id,p_tenant_id,location_id)),
      'total', (select count(*)::integer from filtered),
      'hasMore', (select count(*) > p_offset+p_limit from filtered),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'category', p.category, 'severity', p.severity,
        'title', p.title, 'message', p.message,
        'linkedEntityType', p.linked_entity_type, 'linkedEntityId', p.linked_entity_id,
        'locationId', p.location_id, 'locationName', p.location_name, 'href', p.href,
        'groupKey', p.group_key,
        'delivery', pg_catalog.jsonb_build_object('inApp', p.in_app_status, 'email', p.email_status),
        'readAt', p.read_at, 'metadata', p.metadata, 'createdAt', p.created_at
      ) order by (p.read_at is null) desc, p.created_at desc, p.id desc) from page p), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function app.update_notification_read_state(
  p_actor_user_id uuid, p_tenant_id uuid, p_notification_id uuid, p_read boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_notification app.notifications%rowtype;
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active') then
    raise exception using errcode='HCSN0', message='Notification access is not allowed'; end if;
  select * into v_notification from app.notifications
  where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and id=p_notification_id for update;
  if not found or not app.can_read_notification_location(p_actor_user_id,p_tenant_id,v_notification.location_id) then raise exception using errcode='HCSN2', message='Notification was not found'; end if;
  update app.notifications set read_at=case when p_read then coalesce(read_at,now()) else null end
  where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and id=p_notification_id;
  return pg_catalog.jsonb_build_object(
    'notificationId', p_notification_id, 'read', p_read,
    'unreadCount', (select count(*)::integer from app.notifications where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and read_at is null
      and app.can_read_notification_location(p_actor_user_id,p_tenant_id,location_id))
  );
end;
$$;

create or replace function app.mark_all_notifications_read(p_actor_user_id uuid, p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_marked integer;
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active') then
    raise exception using errcode='HCSN0', message='Notification access is not allowed'; end if;
  perform app.sync_core_notifications(p_tenant_id);
  update app.notifications set read_at=now()
  where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and read_at is null
    and app.can_read_notification_location(p_actor_user_id,p_tenant_id,location_id);
  get diagnostics v_marked = row_count;
  return pg_catalog.jsonb_build_object('markedCount', v_marked, 'unreadCount', 0);
end;
$$;

commit;
