-- AW3 credit configuration history. Enforcement and invoice snapshots follow separately.
begin;
create table app.wholesale_customer_credit_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  payment_term text not null check (payment_term in ('prepaid', 'cod', 'net_7', 'net_15', 'net_30')),
  credit_limit numeric(18,2) not null check (credit_limit between 0 and 90071992547409.91),
  reason text not null check (length(btrim(reason)) between 2 and 500),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, customer_id, revision),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, recorded_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);
create index wholesale_customer_credit_settings_actor_idx on app.wholesale_customer_credit_settings (tenant_id, recorded_by);
alter table app.wholesale_customer_credit_settings enable row level security;
revoke all on app.wholesale_customer_credit_settings from public, anon, authenticated, hcs_hyperdrive;

create function app.reject_wholesale_credit_settings_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Wholesale credit settings history is immutable';
end;
$$;
revoke all on function app.reject_wholesale_credit_settings_mutation() from public, anon, authenticated, hcs_hyperdrive;
create trigger wholesale_customer_credit_settings_immutable before update or delete on app.wholesale_customer_credit_settings
  for each row execute function app.reject_wholesale_credit_settings_mutation();

create function app.can_manage_wholesale_credit_settings(p_actor uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant and membership.user_id = p_actor and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = p_tenant and membership_role.user_id = p_actor
          and permission.permission_code = 'wholesale_orders.manage'
      ))
  );
$$;
revoke all on function app.can_manage_wholesale_credit_settings(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.save_wholesale_customer_credit_settings(
  p_actor uuid, p_tenant uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_limit_minor numeric;
  v_existing app.idempotency_records%rowtype;
  v_settings app.wholesale_customer_credit_settings%rowtype;
  v_response jsonb;
begin
  perform app.assert_wholesale_receivable_access(p_actor, p_tenant, false);
  if not app.can_manage_wholesale_credit_settings(p_actor, p_tenant) then
    raise exception using errcode = 'HCCS1', message = 'Wholesale credit management is not allowed';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = 'HCCS2', message = 'Invalid credit settings';
  end if;
  if not (p_payload ?& array['customerId', 'paymentTerm', 'creditLimitMinor', 'reason'])
    or exists (select 1 from jsonb_object_keys(p_payload) key where key not in ('customerId', 'paymentTerm', 'creditLimitMinor', 'reason'))
    or jsonb_typeof(p_payload->'creditLimitMinor') is distinct from 'number'
    or jsonb_typeof(p_payload->'customerId') is distinct from 'string'
    or jsonb_typeof(p_payload->'paymentTerm') is distinct from 'string'
    or jsonb_typeof(p_payload->'reason') is distinct from 'string'
    or coalesce(p_payload->>'paymentTerm', '') not in ('prepaid', 'cod', 'net_7', 'net_15', 'net_30')
    or length(btrim(coalesce(p_payload->>'reason', ''))) not between 2 and 500
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$'
    or nullif(p_hash, '') is null or nullif(p_request_id, '') is null
  then raise exception using errcode = 'HCCS2', message = 'Invalid credit settings'; end if;
  begin
    v_customer := (p_payload->>'customerId')::uuid;
    v_limit_minor := (p_payload->>'creditLimitMinor')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'HCCS2', message = 'Invalid credit settings';
  end;
  if v_limit_minor < 0 or v_limit_minor > 9007199254740991 or trunc(v_limit_minor) <> v_limit_minor then
    raise exception using errcode = 'HCCS2', message = 'Invalid credit settings';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':credit-settings-key:' || p_key, 0));
  -- Customer lock serializes revisions and will be shared with AW3 credit commands.
  perform 1 from app.customers where tenant_id = p_tenant and id = v_customer
    and status = 'active' and customer_type = 'reseller' for update;
  if not found then raise exception using errcode = 'HCCS3', message = 'Active reseller not found'; end if;
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant
    and operation = 'wholesale_credit_settings.save' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  insert into app.wholesale_customer_credit_settings (tenant_id, customer_id, revision, payment_term, credit_limit, reason, recorded_by)
  select p_tenant, v_customer, coalesce(max(revision), 0) + 1, p_payload->>'paymentTerm', v_limit_minor / 100,
    btrim(p_payload->>'reason'), p_actor
  from app.wholesale_customer_credit_settings where tenant_id = p_tenant and customer_id = v_customer
  returning * into v_settings;
  v_response := jsonb_build_object('settingsId', v_settings.id, 'customerId', v_customer, 'revision', v_settings.revision,
    'paymentTerm', v_settings.payment_term, 'creditLimitMinor', (v_settings.credit_limit * 100)::bigint, 'recordedAt', v_settings.recorded_at);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'wholesale_credit_settings.saved', 'customer', v_customer, v_settings.reason, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'wholesale_credit_settings.saved', 'customer', v_customer, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'wholesale_credit_settings.save', p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create function app.load_wholesale_customer_credit_settings(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb;
begin
  perform app.assert_wholesale_receivable_access(p_actor, p_tenant, false);
  select jsonb_build_object('canManage', app.can_manage_wholesale_credit_settings(p_actor, p_tenant),
    'customers', coalesce(jsonb_agg(jsonb_build_object('customerId', customer.id, 'customerName', customer.full_name,
      'customerNumber', customer.customer_number::text, 'settings', case when settings.id is null then null else
      jsonb_build_object('settingsId', settings.id, 'customerId', customer.id, 'revision', settings.revision,
        'paymentTerm', settings.payment_term, 'creditLimitMinor', (settings.credit_limit * 100)::bigint, 'recordedAt', settings.recorded_at) end)
      order by customer.full_name, customer.id), '[]'::jsonb)) into v_response
  from app.customers customer
  left join lateral (select * from app.wholesale_customer_credit_settings history
    where history.tenant_id = customer.tenant_id and history.customer_id = customer.id
    order by revision desc limit 1) settings on true
  where customer.tenant_id = p_tenant and customer.status = 'active' and customer.customer_type = 'reseller';
  return v_response;
end;
$$;
revoke all on function app.save_wholesale_customer_credit_settings(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.load_wholesale_customer_credit_settings(uuid, uuid) from public, anon, authenticated;
grant execute on function app.save_wholesale_customer_credit_settings(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.load_wholesale_customer_credit_settings(uuid, uuid) to hcs_hyperdrive;
commit;
