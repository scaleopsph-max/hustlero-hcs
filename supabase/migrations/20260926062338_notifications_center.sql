begin;

insert into app.permissions (code, description) values
  ('notifications.read', 'View personal tenant notifications')
on conflict (code) do update set description = excluded.description;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'notifications.read'
from app.roles r
where lower(r.code::text) in ('owner', 'admin', 'manager')
on conflict do nothing;

create function app.initialize_role_notification_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) in ('owner', 'admin', 'manager') then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values (new.tenant_id, new.id, 'notifications.read')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_role_notification_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_notification_permissions
after insert on app.roles for each row execute function app.initialize_role_notification_permissions();

create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  recipient_user_id uuid not null,
  category text not null check (category in ('alert', 'approval', 'system')),
  severity text not null check (severity in ('info', 'attention', 'warning', 'critical')),
  title text not null,
  message text not null,
  linked_entity_type text,
  linked_entity_id uuid,
  location_id uuid,
  href text not null,
  group_key text not null,
  dedup_key text not null,
  in_app_status text not null default 'delivered' check (in_app_status in ('pending', 'delivered', 'failed')),
  email_status text not null default 'not_configured' check (email_status in ('pending', 'delivered', 'failed', 'not_configured')),
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, recipient_user_id, dedup_key),
  foreign key (tenant_id, recipient_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  constraint notifications_title_not_blank check (btrim(title) <> ''),
  constraint notifications_message_not_blank check (btrim(message) <> ''),
  constraint notifications_href_internal check (href ~ '^/[a-z0-9/_-]*$'),
  constraint notifications_group_not_blank check (btrim(group_key) <> ''),
  constraint notifications_dedup_not_blank check (btrim(dedup_key) <> '')
);
create index notifications_recipient_unread_idx
  on app.notifications (tenant_id, recipient_user_id, created_at desc, id)
  where read_at is null;
create index notifications_recipient_history_idx
  on app.notifications (tenant_id, recipient_user_id, created_at desc, id);
create index notifications_location_idx on app.notifications (tenant_id, location_id) where location_id is not null;
alter table app.notifications enable row level security;
revoke all on table app.notifications from public, anon, authenticated, hcs_hyperdrive;

create function app.protect_notification_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'notifications cannot be deleted'; end if;
  if new.tenant_id <> old.tenant_id
    or new.recipient_user_id <> old.recipient_user_id
    or new.category <> old.category
    or new.severity <> old.severity
    or new.title <> old.title
    or new.message <> old.message
    or new.linked_entity_type is distinct from old.linked_entity_type
    or new.linked_entity_id is distinct from old.linked_entity_id
    or new.location_id is distinct from old.location_id
    or new.href <> old.href
    or new.group_key <> old.group_key
    or new.dedup_key <> old.dedup_key
    or new.in_app_status <> old.in_app_status
    or new.email_status <> old.email_status
    or new.metadata <> old.metadata
    or new.created_at <> old.created_at then
    raise exception 'notification history fields are immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function app.protect_notification_history() from public, anon, authenticated, hcs_hyperdrive;
create trigger notifications_protect_history before update or delete on app.notifications
for each row execute function app.protect_notification_history();

create function app.sync_core_notifications(p_tenant_id uuid) returns void
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
  on conflict (tenant_id, recipient_user_id, dedup_key) do nothing;
end;
$$;
revoke all on function app.sync_core_notifications(uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.load_notification_center(
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
        and (not p_unread_only or n.read_at is null)
    ), page as (
      select * from filtered order by (read_at is null) desc, created_at desc, id desc
      limit p_limit offset p_offset
    )
    select pg_catalog.jsonb_build_object(
      'unreadCount', (select count(*)::integer from app.notifications where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and read_at is null),
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

create function app.update_notification_read_state(
  p_actor_user_id uuid, p_tenant_id uuid, p_notification_id uuid, p_read boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_notification app.notifications%rowtype;
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active') then
    raise exception using errcode='HCSN0', message='Notification access is not allowed'; end if;
  select * into v_notification from app.notifications
  where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and id=p_notification_id for update;
  if not found then raise exception using errcode='HCSN2', message='Notification was not found'; end if;
  update app.notifications set read_at=case when p_read then coalesce(read_at,now()) else null end
  where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and id=p_notification_id;
  return pg_catalog.jsonb_build_object(
    'notificationId', p_notification_id, 'read', p_read,
    'unreadCount', (select count(*)::integer from app.notifications where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and read_at is null)
  );
end;
$$;

create function app.mark_all_notifications_read(p_actor_user_id uuid, p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_marked integer;
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active') then
    raise exception using errcode='HCSN0', message='Notification access is not allowed'; end if;
  perform app.sync_core_notifications(p_tenant_id);
  update app.notifications set read_at=now()
  where tenant_id=p_tenant_id and recipient_user_id=p_actor_user_id and read_at is null;
  get diagnostics v_marked = row_count;
  return pg_catalog.jsonb_build_object('markedCount', v_marked, 'unreadCount', 0);
end;
$$;

revoke all on function app.load_notification_center(uuid,uuid,boolean,integer,integer) from public, anon, authenticated;
revoke all on function app.update_notification_read_state(uuid,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function app.mark_all_notifications_read(uuid,uuid) from public, anon, authenticated;
grant execute on function app.load_notification_center(uuid,uuid,boolean,integer,integer) to hcs_hyperdrive;
grant execute on function app.update_notification_read_state(uuid,uuid,uuid,boolean) to hcs_hyperdrive;
grant execute on function app.mark_all_notifications_read(uuid,uuid) to hcs_hyperdrive;

commit;
