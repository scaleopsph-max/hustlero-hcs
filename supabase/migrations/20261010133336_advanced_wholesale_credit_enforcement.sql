-- AW3 net-term enforcement; payments and approved overrides are separate release gates.
begin;
create table app.wholesale_order_credit_snapshots (
  tenant_id uuid not null,
  sales_order_id uuid not null,
  settings_id uuid not null,
  payment_term text not null check (payment_term in ('prepaid','cod','net_7','net_15','net_30')),
  credit_limit numeric(18,2) not null check (credit_limit >= 0),
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, sales_order_id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders(tenant_id,id) on delete restrict,
  foreign key (tenant_id, settings_id) references app.wholesale_customer_credit_settings(tenant_id,id) on delete restrict
);
create index wholesale_order_credit_snapshots_settings_idx on app.wholesale_order_credit_snapshots(tenant_id,settings_id);
create table app.wholesale_invoice_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null,
  customer_id uuid not null,
  sales_order_id uuid not null,
  amount numeric(18,2) not null check (amount >= 0 and amount <= 90071992547409.91),
  payment_term text not null check (payment_term in ('net_7','net_15','net_30')),
  due_date date not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,invoice_id),
  foreign key (tenant_id,invoice_id) references app.invoices(tenant_id,id) on delete restrict,
  foreign key (tenant_id,customer_id) references app.customers(tenant_id,id) on delete restrict,
  foreign key (tenant_id,sales_order_id) references app.wholesale_order_credit_snapshots(tenant_id,sales_order_id) on delete restrict
);
create index wholesale_invoice_charges_customer_idx on app.wholesale_invoice_charges(tenant_id,customer_id,due_date);
create index wholesale_invoice_charges_order_idx on app.wholesale_invoice_charges(tenant_id,sales_order_id);
alter table app.wholesale_order_credit_snapshots enable row level security;
alter table app.wholesale_invoice_charges enable row level security;
revoke all on app.wholesale_order_credit_snapshots, app.wholesale_invoice_charges from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_order_credit_snapshots_immutable before update or delete on app.wholesale_order_credit_snapshots
  for each row execute function app.reject_invoice_mutation();
create trigger wholesale_invoice_charges_immutable before update or delete on app.wholesale_invoice_charges
  for each row execute function app.reject_invoice_mutation();

create function app.assert_wholesale_credit_capacity(p_tenant uuid,p_customer uuid,p_limit numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_exposure numeric;
begin
  -- Unknown historical balances cannot be interpreted as zero debt.
  if exists (select 1 from app.invoices invoice where invoice.tenant_id=p_tenant and invoice.customer_id=p_customer
    and not exists (select 1 from app.wholesale_receivable_charges charge where charge.tenant_id=p_tenant and charge.invoice_id=invoice.id)
    and not exists (select 1 from app.wholesale_invoice_charges charge where charge.tenant_id=p_tenant and charge.invoice_id=invoice.id)) then
    raise exception using errcode='HCCR4',message='Historical invoice classification is required';
  end if;
  select coalesce((select sum(amount) from app.wholesale_receivable_charges where tenant_id=p_tenant and customer_id=p_customer),0)
    + coalesce((select sum(amount) from app.wholesale_invoice_charges where tenant_id=p_tenant and customer_id=p_customer),0)
    + coalesce((select sum(round((line.ordered_quantity-line.fulfilled_quantity-line.cancelled_quantity)*line.unit_price,2))
      from app.sales_orders orders join app.sales_order_lines line on line.tenant_id=orders.tenant_id and line.sales_order_id=orders.id
      where orders.tenant_id=p_tenant and orders.customer_id=p_customer and orders.status in ('confirmed','partially_fulfilled')),0)
    into v_exposure;
  if p_limit is null or v_exposure > p_limit then
    raise exception using errcode='HCCR1',message='Customer credit limit exceeded';
  end if;
end;
$$;
revoke all on function app.assert_wholesale_credit_capacity(uuid,uuid,numeric) from public,anon,authenticated,hcs_hyperdrive;

-- Preserve the tested inventory implementation as a private transactional core.
create function app.assert_wholesale_order_credit_access(p_actor uuid,p_tenant uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.tenant_entitlements entitlement join app.features feature on feature.code=entitlement.feature_code
    where entitlement.tenant_id=p_tenant and entitlement.feature_code='advanced_wholesale' and entitlement.entitled and entitlement.enabled
      and feature.platform_available and (entitlement.starts_at is null or entitlement.starts_at<=now())
      and (entitlement.ends_at is null or entitlement.ends_at>now())) then
    raise exception using errcode='HCSQ0',message='Advanced wholesale is not enabled';
  end if;
  if not app.can_manage_wholesale_credit_settings(p_actor,p_tenant) then
    raise exception using errcode='HCSQ1',message='Wholesale order management is not allowed';
  end if;
end;
$$;
revoke all on function app.assert_wholesale_order_credit_access(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
alter function app.confirm_wholesale_order(uuid,uuid,uuid,text,text,text) rename to confirm_wholesale_order_inventory_core;
alter function app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text) rename to fulfill_wholesale_order_inventory_core;
revoke all on function app.confirm_wholesale_order_inventory_core(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
revoke all on function app.fulfill_wholesale_order_inventory_core(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.confirm_wholesale_order(p_actor_user_id uuid,p_tenant_id uuid,p_sales_order_id uuid,
  p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order app.sales_orders%rowtype; v_settings app.wholesale_customer_credit_settings%rowtype; v_response jsonb;
begin
  perform app.assert_wholesale_order_credit_access(p_actor_user_id,p_tenant_id);
  select * into v_order from app.sales_orders where tenant_id=p_tenant_id and id=p_sales_order_id for update;
  if not found then raise exception using errcode='HCSQ7',message='The wholesale order was not found'; end if;
  perform 1 from app.customers where tenant_id=p_tenant_id and id=v_order.customer_id and status='active' and customer_type='reseller' for update;
  if not found then raise exception using errcode='HCSQ3',message='An active reseller customer is required'; end if;
  if v_order.status <> 'draft' and not exists (select 1 from app.wholesale_order_credit_snapshots where tenant_id=p_tenant_id and sales_order_id=p_sales_order_id) then
    raise exception using errcode='HCCR2',message='Explicit customer credit settings are required';
  end if;
  -- The core revalidates auth and idempotency, and refreshes current prices before the capacity check.
  v_response := app.confirm_wholesale_order_inventory_core(p_actor_user_id,p_tenant_id,p_sales_order_id,p_idempotency_key,p_request_hash,p_request_id);
  if exists (select 1 from app.wholesale_order_credit_snapshots where tenant_id=p_tenant_id and sales_order_id=p_sales_order_id) then
    return v_response;
  end if;
  select * into v_settings from app.wholesale_customer_credit_settings where tenant_id=p_tenant_id and customer_id=v_order.customer_id order by revision desc limit 1;
  if not found then raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
  perform app.assert_wholesale_credit_capacity(p_tenant_id,v_order.customer_id,v_settings.credit_limit);
  insert into app.wholesale_order_credit_snapshots(tenant_id,sales_order_id,settings_id,payment_term,credit_limit)
    values(p_tenant_id,p_sales_order_id,v_settings.id,v_settings.payment_term,v_settings.credit_limit);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
    values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'wholesale_credit.confirmed','sales_order',p_sales_order_id,
      jsonb_build_object('settingsId',v_settings.id,'paymentTerm',v_settings.payment_term,'creditLimitMinor',(v_settings.credit_limit*100)::bigint));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
    values(p_tenant_id,'wholesale_credit.confirmed','sales_order',p_sales_order_id,jsonb_build_object('paymentTerm',v_settings.payment_term,'settingsId',v_settings.id));
  return v_response;
end;
$$;

create function app.fulfill_wholesale_order(p_actor_user_id uuid,p_tenant_id uuid,p_sales_order_id uuid,p_lines jsonb,
  p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order app.sales_orders%rowtype; v_snapshot app.wholesale_order_credit_snapshots%rowtype;
  v_limit numeric; v_response jsonb; v_invoice app.invoices%rowtype; v_due date; v_lines jsonb;
begin
  perform app.assert_wholesale_order_credit_access(p_actor_user_id,p_tenant_id);
  select * into v_order from app.sales_orders where tenant_id=p_tenant_id and id=p_sales_order_id for update;
  if not found then raise exception using errcode='HCSQ7',message='The wholesale order was not found'; end if;
  perform 1 from app.customers where tenant_id=p_tenant_id and id=v_order.customer_id and status='active' and customer_type='reseller' for update;
  if not found then raise exception using errcode='HCSQ3',message='An active reseller customer is required'; end if;
  select * into v_snapshot from app.wholesale_order_credit_snapshots where tenant_id=p_tenant_id and sales_order_id=p_sales_order_id;
  if not found then raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
  -- No cash receipt is inferred. This signature has no payment command yet.
  if v_snapshot.payment_term in ('prepaid','cod') then
    raise exception using errcode='HCCR3',message='Full payment is required at fulfillment';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception using errcode='HCSR1',message='Fulfillment lines are invalid'; end if;
  select jsonb_agg(item.value order by line.variant_id,item.value->>'salesOrderLineId') into v_lines
    from jsonb_array_elements(p_lines) item left join app.sales_order_lines line
      on line.tenant_id=p_tenant_id and line.sales_order_id=p_sales_order_id and line.id::text=item.value->>'salesOrderLineId';
  v_response := app.fulfill_wholesale_order_inventory_core(p_actor_user_id,p_tenant_id,p_sales_order_id,coalesce(v_lines,'[]'::jsonb),p_idempotency_key,p_request_hash,p_request_id);
  if exists (select 1 from app.wholesale_invoice_charges where tenant_id=p_tenant_id and invoice_id=(v_response->>'invoiceId')::uuid) then
    return v_response;
  end if;
  select * into v_invoice from app.invoices where tenant_id=p_tenant_id and id=(v_response->>'invoiceId')::uuid;
  select (v_invoice.issued_at at time zone coalesce(location.timezone,tenant.timezone))::date
    + case v_snapshot.payment_term when 'net_7' then 7 when 'net_15' then 15 when 'net_30' then 30 end into v_due
    from app.locations location join app.tenants tenant on tenant.id=location.tenant_id
    where location.tenant_id=p_tenant_id and location.id=v_invoice.location_id;
  insert into app.wholesale_invoice_charges(tenant_id,invoice_id,customer_id,sales_order_id,amount,payment_term,due_date)
    values(p_tenant_id,v_invoice.id,v_invoice.customer_id,p_sales_order_id,v_invoice.total,v_snapshot.payment_term,v_due);
  select credit_limit into v_limit from app.wholesale_customer_credit_settings where tenant_id=p_tenant_id and customer_id=v_order.customer_id order by revision desc limit 1;
  -- The fulfilled commitment is already released by the core; count it as debt only once.
  perform app.assert_wholesale_credit_capacity(p_tenant_id,v_order.customer_id,v_limit);
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
    values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'wholesale_receivable.charged','invoice',v_invoice.id,
      jsonb_build_object('amountMinor',(v_invoice.total*100)::bigint,'dueDate',v_due,'paymentTerm',v_snapshot.payment_term));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
    values(p_tenant_id,'wholesale_receivable.charged','invoice',v_invoice.id,jsonb_build_object('amountMinor',(v_invoice.total*100)::bigint,'dueDate',v_due));
  return v_response;
end;
$$;
revoke all on function app.confirm_wholesale_order(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.confirm_wholesale_order(uuid,uuid,uuid,text,text,text) to hcs_hyperdrive;
grant execute on function app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;

-- Opening classification shares the same credit scope lock; historical debt is never auto-posted.
alter function app.record_wholesale_opening_receivable(uuid,uuid,jsonb,text,text,text) rename to record_wholesale_opening_receivable_core;
revoke all on function app.record_wholesale_opening_receivable_core(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
create function app.record_wholesale_opening_receivable(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customer uuid;
begin
  perform app.assert_wholesale_receivable_access(p_actor,p_tenant,true);
  select customer_id into v_customer from app.invoices where tenant_id=p_tenant and id::text=p_payload->>'invoiceId';
  perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
  return app.record_wholesale_opening_receivable_core(p_actor,p_tenant,p_payload,p_key,p_hash,p_request_id);
end;
$$;
revoke all on function app.record_wholesale_opening_receivable(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.record_wholesale_opening_receivable(uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;
create or replace function app.load_wholesale_receivables(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb;
begin
  perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
  select jsonb_build_object('canRecordOpening',exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner),
    'invoices',coalesce(jsonb_agg(jsonb_build_object('invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number::text,
      'customerId',invoice.customer_id,'customerName',invoice.customer_name_snapshot,'locationId',invoice.location_id,'locationName',invoice.location_name_snapshot,
      'totalMinor',(invoice.total*100)::bigint,'classification',case when charge.id is not null then 'opening' when issued.id is not null then 'invoice' else 'unclassified' end,
      'eligibleForOpening',legacy.invoice_id is not null and charge.id is null and issued.id is null,
      'openBalanceMinor',case when charge.id is not null then (charge.amount*100)::bigint when issued.id is not null then (issued.amount*100)::bigint else null end,
      'dueDate',coalesce(charge.due_date,issued.due_date)) order by invoice.issued_at desc,invoice.id),'[]'::jsonb)) into v_response
    from app.invoices invoice
    left join app.wholesale_legacy_invoices legacy on legacy.tenant_id=invoice.tenant_id and legacy.invoice_id=invoice.id
    left join app.wholesale_receivable_charges charge on charge.tenant_id=invoice.tenant_id and charge.invoice_id=invoice.id
    left join app.wholesale_invoice_charges issued on issued.tenant_id=invoice.tenant_id and issued.invoice_id=invoice.id
    where invoice.tenant_id=p_tenant;
  return v_response;
end;
$$;
commit;
