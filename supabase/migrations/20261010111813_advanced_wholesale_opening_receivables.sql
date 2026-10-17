-- AW3 opening classification only. No historical debt is posted by this migration.
begin;

create table app.wholesale_legacy_invoices (
  tenant_id uuid not null,
  invoice_id uuid not null,
  registered_at timestamptz not null default now(),
  primary key (tenant_id, invoice_id),
  foreign key (tenant_id, invoice_id) references app.invoices (tenant_id, id) on delete restrict
);
insert into app.wholesale_legacy_invoices (tenant_id, invoice_id)
select tenant_id, id from app.invoices;

create table app.wholesale_receivable_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null,
  customer_id uuid not null,
  charge_type text not null check (charge_type = 'opening'),
  amount numeric(18,2) not null check (amount > 0 and amount <= 90071992547409.91),
  due_date date not null,
  reason text not null check (length(btrim(reason)) between 2 and 500),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, invoice_id),
  foreign key (tenant_id, invoice_id) references app.wholesale_legacy_invoices (tenant_id, invoice_id) on delete restrict,
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, recorded_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict
);
create index wholesale_receivable_charges_customer_idx
  on app.wholesale_receivable_charges (tenant_id, customer_id, due_date, invoice_id);
create index wholesale_receivable_charges_actor_idx
  on app.wholesale_receivable_charges (tenant_id, recorded_by);

alter table app.wholesale_legacy_invoices enable row level security;
alter table app.wholesale_receivable_charges enable row level security;
revoke all on app.wholesale_legacy_invoices, app.wholesale_receivable_charges
  from public, anon, authenticated, hcs_hyperdrive;
create trigger wholesale_legacy_invoices_immutable before update or delete on app.wholesale_legacy_invoices
  for each row execute function app.reject_invoice_mutation();
create trigger wholesale_receivable_charges_immutable before update or delete on app.wholesale_receivable_charges
  for each row execute function app.reject_invoice_mutation();

create function app.assert_wholesale_receivable_access(p_actor uuid, p_tenant uuid, p_write boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant and entitlement.feature_code = 'advanced_wholesale'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then raise exception using errcode = 'HCSQ0', message = 'Advanced wholesale is not enabled'; end if;
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant and membership.user_id = p_actor and membership.status = 'active'
      and (membership.is_owner or (not p_write and exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id
          and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = p_tenant and membership_role.user_id = p_actor
          and permission.permission_code = 'wholesale_orders.read'
      )))
  ) then raise exception using errcode = 'HCAR1', message = 'Wholesale receivable access denied'; end if;
end;
$$;
revoke all on function app.assert_wholesale_receivable_access(uuid, uuid, boolean)
  from public, anon, authenticated, hcs_hyperdrive;

create function app.record_wholesale_opening_receivable(
  p_actor uuid, p_tenant uuid, p_payload jsonb,
  p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_invoice app.invoices%rowtype;
  v_charge app.wholesale_receivable_charges%rowtype;
  v_invoice_id uuid;
  v_due_date date;
  v_response jsonb;
begin
  perform app.assert_wholesale_receivable_access(p_actor, p_tenant, true);
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = 'HCAR2', message = 'Invalid opening receivable request';
  end if;
  if not (p_payload ?& array['invoiceId', 'dueDate', 'reason'])
    or exists (select 1 from jsonb_object_keys(p_payload) key where key not in ('invoiceId', 'dueDate', 'reason'))
    or length(btrim(coalesce(p_payload->>'reason', ''))) not between 2 and 500
    or coalesce(p_payload->>'dueDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$'
    or nullif(p_hash, '') is null or nullif(p_request_id, '') is null
  then raise exception using errcode = 'HCAR2', message = 'Invalid opening receivable request'; end if;
  begin
    v_invoice_id := (p_payload->>'invoiceId')::uuid;
    v_due_date := (p_payload->>'dueDate')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = 'HCAR2', message = 'Invalid opening invoice or due date';
  end;

  -- Serialize command-key retries, then same-invoice commands with different keys.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':receivable-opening-key:' || p_key, 0));
  select * into v_existing from app.idempotency_records
    where tenant_id = p_tenant and operation = 'wholesale_receivable.opening' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  end if;
  select * into v_invoice from app.invoices
    where tenant_id = p_tenant and id = v_invoice_id for update;
  if not found or not exists (select 1 from app.wholesale_legacy_invoices
    where tenant_id = p_tenant and invoice_id = v_invoice_id) then
    raise exception using errcode = 'HCAR3', message = 'Eligible legacy invoice not found';
  end if;
  if exists (select 1 from app.wholesale_receivable_charges where tenant_id = p_tenant and invoice_id = v_invoice_id) then
    raise exception using errcode = 'HCAR4', message = 'Invoice is already classified';
  end if;
  if v_invoice.total <= 0 or v_invoice.total > 90071992547409.91 then
    raise exception using errcode = 'HCAR2', message = 'Invoice amount is outside the supported opening range';
  end if;
  insert into app.wholesale_receivable_charges (
    tenant_id, invoice_id, customer_id, charge_type, amount, due_date, reason, recorded_by
  ) values (
    p_tenant, v_invoice.id, v_invoice.customer_id, 'opening', v_invoice.total,
    v_due_date, btrim(p_payload->>'reason'), p_actor
  ) returning * into v_charge;
  v_response := jsonb_build_object('chargeId', v_charge.id, 'invoiceId', v_invoice.id,
    'amountMinor', (v_charge.amount * 100)::bigint, 'dueDate', v_charge.due_date, 'status', 'unpaid');
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
    values (p_tenant, p_request_id, 'tenant_user', p_actor, 'wholesale_receivable.opened', 'invoice',
      v_invoice.id, v_charge.reason, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
    values (p_tenant, 'wholesale_receivable.opened', 'invoice', v_invoice.id, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash,
    response_status, response_body, completed_at, expires_at)
    values (p_tenant, 'wholesale_receivable.opening', p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

create function app.load_wholesale_receivables(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb;
begin
  perform app.assert_wholesale_receivable_access(p_actor, p_tenant, false);
  select jsonb_build_object(
    'canRecordOpening', exists (select 1 from app.tenant_memberships
      where tenant_id = p_tenant and user_id = p_actor and status = 'active' and is_owner),
    'invoices', coalesce(jsonb_agg(jsonb_build_object(
      'invoiceId', invoice.id, 'invoiceNumber', invoice.invoice_number::text,
      'customerId', invoice.customer_id, 'customerName', invoice.customer_name_snapshot,
      'locationId', invoice.location_id, 'locationName', invoice.location_name_snapshot,
      'totalMinor', (invoice.total * 100)::bigint,
      'classification', case when charge.id is not null then 'opening' else 'unclassified' end,
      'eligibleForOpening', legacy.invoice_id is not null and charge.id is null,
      'openBalanceMinor', case when charge.id is null then null else (charge.amount * 100)::bigint end,
      'dueDate', charge.due_date
    ) order by invoice.issued_at desc, invoice.id), '[]'::jsonb)
  ) into v_response
  from app.invoices invoice
  left join app.wholesale_legacy_invoices legacy on legacy.tenant_id = invoice.tenant_id and legacy.invoice_id = invoice.id
  left join app.wholesale_receivable_charges charge on charge.tenant_id = invoice.tenant_id and charge.invoice_id = invoice.id
  where invoice.tenant_id = p_tenant;
  return v_response;
end;
$$;

revoke all on function app.record_wholesale_opening_receivable(uuid, uuid, jsonb, text, text, text)
  from public, anon, authenticated;
revoke all on function app.load_wholesale_receivables(uuid, uuid) from public, anon, authenticated;
grant execute on function app.record_wholesale_opening_receivable(uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.load_wholesale_receivables(uuid, uuid) to hcs_hyperdrive;
commit;
