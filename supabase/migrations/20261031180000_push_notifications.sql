-- Web Push for reseller portal updates and Back Office portal notifications.
-- Browsers that opt in store a push subscription. Every five minutes the API cron builds the in-app notifications
-- (the same rows the inboxes show), takes the ones not yet pushed, sends each to the recipient's subscriptions,
-- and reports back. Each notification is pushed at most once; subscriptions the push service says are gone
-- (404/410) are switched off. Back Office pushes are limited to reseller portal notifications.
begin;

create table app.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  reseller_account_id uuid,
  user_id uuid,
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  disabled_at timestamptz,
  unique (tenant_id, id),
  unique (endpoint),
  foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint push_subscriptions_owner check (num_nonnulls(reseller_account_id, user_id) = 1)
);
create index push_subscriptions_reseller_idx on app.push_subscriptions (tenant_id, reseller_account_id) where disabled_at is null;
create index push_subscriptions_member_idx on app.push_subscriptions (tenant_id, user_id) where disabled_at is null;
alter table app.push_subscriptions enable row level security;
revoke all on app.push_subscriptions from public, anon, authenticated, hcs_hyperdrive;

alter table app.reseller_notifications add column push_sent_at timestamptz;
alter table app.notifications add column push_sent_at timestamptz;
create index reseller_notifications_push_idx on app.reseller_notifications (created_at) where push_sent_at is null;
create index notifications_portal_push_idx on app.notifications (created_at)
  where push_sent_at is null and group_key like 'portal:%';

-- Reseller notifications may now record when they were pushed, and nothing else changes.
create or replace function app.protect_reseller_notification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'notifications cannot be deleted'; end if;
  if (to_jsonb(new) - 'read_at' - 'push_sent_at') <> (to_jsonb(old) - 'read_at' - 'push_sent_at') then
    raise exception 'notification history fields are immutable';
  end if;
  return new;
end;
$$;

create function app.validate_push_subscription(p_payload jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key where key not in ('endpoint', 'p256dh', 'auth', 'userAgent'))
    or coalesce(p_payload->>'endpoint', '') !~ '^https://' or char_length(p_payload->>'endpoint') > 1000
    or coalesce(p_payload->>'p256dh', '') !~ '^[A-Za-z0-9_-]{80,100}$'
    or coalesce(p_payload->>'auth', '') !~ '^[A-Za-z0-9_-]{16,32}$'
    or char_length(coalesce(p_payload->>'userAgent', '')) > 300
  then raise exception using errcode = 'HCPU1', message = 'Push subscription is invalid'; end if;
end;
$$;
revoke all on function app.validate_push_subscription(jsonb) from public, anon, authenticated, hcs_hyperdrive;

-- Saves (or moves to this person) the browser's subscription. One browser endpoint belongs to one person.
create function app.save_push_subscription(p_tenant uuid, p_reseller uuid, p_user uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.validate_push_subscription(p_payload);
  insert into app.push_subscriptions (tenant_id, reseller_account_id, user_id, endpoint, p256dh, auth_secret, user_agent)
  values (p_tenant, p_reseller, p_user, p_payload->>'endpoint', p_payload->>'p256dh', p_payload->>'auth',
    nullif(btrim(coalesce(p_payload->>'userAgent', '')), ''))
  on conflict (endpoint) do update set tenant_id = excluded.tenant_id, reseller_account_id = excluded.reseller_account_id,
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
    user_agent = excluded.user_agent, created_at = now(), failure_count = 0, disabled_at = null
  returning id into v_id;
  return jsonb_build_object('subscriptionId', v_id, 'enabled', true);
end;
$$;
revoke all on function app.save_push_subscription(uuid, uuid, uuid, jsonb) from public, anon, authenticated, hcs_hyperdrive;

create function app.save_reseller_push_subscription(p_auth_user uuid, p_tenant uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  return app.save_push_subscription(p_tenant, v_account.id, null, p_payload);
end;
$$;
revoke all on function app.save_reseller_push_subscription(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.save_reseller_push_subscription(uuid, uuid, jsonb) to hcs_hyperdrive;

create function app.save_member_push_subscription(p_actor uuid, p_tenant uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant and user_id = p_actor and status = 'active') then
    raise exception using errcode = 'HCSN0', message = 'Notification access is not allowed';
  end if;
  return app.save_push_subscription(p_tenant, null, p_actor, p_payload);
end;
$$;
revoke all on function app.save_member_push_subscription(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.save_member_push_subscription(uuid, uuid, jsonb) to hcs_hyperdrive;

-- Turns push off for this browser. Only the endpoint's owner can do it; an unknown endpoint is already off.
create function app.remove_push_subscription(p_auth_user uuid, p_tenant uuid, p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update app.push_subscriptions s set disabled_at = coalesce(s.disabled_at, now())
  where s.endpoint = p_endpoint and s.tenant_id = p_tenant
    and (s.user_id = p_auth_user or exists (select 1 from app.reseller_accounts a where a.tenant_id = s.tenant_id
      and a.id = s.reseller_account_id and a.auth_user_id = p_auth_user));
  return jsonb_build_object('enabled', false);
end;
$$;
revoke all on function app.remove_push_subscription(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.remove_push_subscription(uuid, uuid, text) to hcs_hyperdrive;

-- Builds new notifications for everyone who can be pushed, then returns up to p_limit unsent ones with their
-- subscriptions. Only notifications created after the subscription are pushed, so turning push on never
-- replays history. Nothing older than a day is pushed.
create function app.collect_push_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row record; v_items jsonb := '[]'::jsonb;
begin
  for v_row in select distinct tenant_id from app.push_subscriptions where disabled_at is null and user_id is not null loop
    perform app.sync_core_notifications(v_row.tenant_id);
  end loop;
  for v_row in select distinct tenant_id, reseller_account_id from app.push_subscriptions
    where disabled_at is null and reseller_account_id is not null loop
    perform app.sync_reseller_notifications(v_row.tenant_id, v_row.reseller_account_id);
  end loop;

  with pending as (
    select 'reseller'::text audience, n.id, n.tenant_id, n.title, n.message,
      '/' || coalesce('?order=' || n.sales_order_id::text, '') url, n.created_at,
      (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret))
        from app.push_subscriptions s where s.tenant_id = n.tenant_id and s.reseller_account_id = n.reseller_account_id
          and s.disabled_at is null and s.created_at < n.created_at) subscriptions
    from app.reseller_notifications n
    where n.push_sent_at is null and n.read_at is null and n.created_at > now() - interval '1 day'
    union all
    select 'member', n.id, n.tenant_id, n.title, n.message, n.href, n.created_at,
      (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret))
        from app.push_subscriptions s where s.tenant_id = n.tenant_id and s.user_id = n.recipient_user_id
          and s.disabled_at is null and s.created_at < n.created_at) subscriptions
    from app.notifications n
    where n.push_sent_at is null and n.read_at is null and n.group_key like 'portal:%'
      and n.created_at > now() - interval '1 day'
  )
  select coalesce(jsonb_agg(jsonb_build_object('audience', audience, 'notificationId', id, 'title', title,
      'body', message, 'url', url, 'subscriptions', subscriptions) order by created_at, id), '[]'::jsonb)
    into v_items
  from (select * from pending where subscriptions is not null order by created_at, id limit greatest(least(p_limit, 500), 1)) p;
  return jsonb_build_object('items', v_items);
end;
$$;
revoke all on function app.collect_push_batch(integer) from public, anon, authenticated;
grant execute on function app.collect_push_batch(integer) to hcs_hyperdrive;

-- Records what happened: every listed notification is marked pushed (one attempt each), working subscriptions
-- are stamped, and subscriptions the push service rejected as gone are switched off.
create function app.complete_push_batch(p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_marked integer := 0; v_disabled integer := 0; v_count integer;
begin
  if jsonb_typeof(p_result) is distinct from 'object' or jsonb_typeof(p_result->'notifications') is distinct from 'array'
    or jsonb_typeof(p_result->'subscriptions') is distinct from 'array' then
    raise exception using errcode = 'HCPU1', message = 'Push result is invalid';
  end if;
  update app.reseller_notifications set push_sent_at = now()
  where push_sent_at is null and id in (select (item->>'notificationId')::uuid from jsonb_array_elements(p_result->'notifications') item
    where item->>'audience' = 'reseller');
  get diagnostics v_count = row_count; v_marked := v_marked + v_count;
  update app.notifications set push_sent_at = now()
  where push_sent_at is null and id in (select (item->>'notificationId')::uuid from jsonb_array_elements(p_result->'notifications') item
    where item->>'audience' = 'member');
  get diagnostics v_count = row_count; v_marked := v_marked + v_count;
  update app.push_subscriptions s set
    last_success_at = case when r.outcome = 'sent' then now() else s.last_success_at end,
    failure_count = case when r.outcome = 'sent' then 0 else s.failure_count + 1 end,
    disabled_at = case when r.outcome = 'gone' or (r.outcome = 'failed' and s.failure_count + 1 >= 10)
      then coalesce(s.disabled_at, now()) else s.disabled_at end
  from (select (item->>'id')::uuid id, item->>'outcome' outcome from jsonb_array_elements(p_result->'subscriptions') item
    where item->>'outcome' in ('sent', 'gone', 'failed')) r
  where s.id = r.id;
  select count(*) into v_disabled from app.push_subscriptions s
  where s.disabled_at > now() - interval '1 second'
    and s.id in (select (item->>'id')::uuid from jsonb_array_elements(p_result->'subscriptions') item);
  return jsonb_build_object('marked', v_marked, 'disabled', v_disabled);
end;
$$;
revoke all on function app.complete_push_batch(jsonb) from public, anon, authenticated;
grant execute on function app.complete_push_batch(jsonb) to hcs_hyperdrive;

commit;
