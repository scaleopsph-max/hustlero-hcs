begin;

insert into app.permissions (code, description) values
  ('loyalty.read', 'View loyalty policy, balances, and transaction history'),
  ('loyalty.manage', 'Configure the tenant loyalty earning policy')
on conflict (code) do update set description = excluded.description;

create table app.loyalty_policies (
  tenant_id uuid primary key references app.tenants (id) on delete restrict,
  enabled boolean not null default false,
  spend_per_point numeric(18,2),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (spend_per_point is null or spend_per_point > 0),
  check (not enabled or spend_per_point is not null)
);

create table app.loyalty_accounts (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  customer_id uuid not null,
  balance_points bigint not null default 0 check (balance_points >= 0),
  lifetime_earned_points bigint not null default 0 check (lifetime_earned_points >= 0),
  lifetime_reversed_points bigint not null default 0 check (lifetime_reversed_points >= 0),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, customer_id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict
);

create table app.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  customer_id uuid not null,
  transaction_type text not null check (transaction_type in ('sale_earn', 'refund_reversal')),
  points_delta bigint not null check (points_delta <> 0),
  balance_after_points bigint not null check (balance_after_points >= 0),
  spend_per_point_centavos bigint not null check (spend_per_point_centavos > 0),
  sale_id uuid not null,
  refund_id uuid,
  actor_user_id uuid,
  actor_employee_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id) on delete restrict,
  foreign key (tenant_id, refund_id) references app.refunds (tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, actor_employee_id) references app.employees (tenant_id, id) on delete restrict,
  check ((transaction_type = 'sale_earn' and points_delta > 0 and refund_id is null) or
         (transaction_type = 'refund_reversal' and points_delta < 0 and refund_id is not null)),
  check (num_nonnulls(actor_user_id, actor_employee_id) = 1)
);

create unique index loyalty_transactions_sale_earn_idx
  on app.loyalty_transactions (tenant_id, sale_id) where transaction_type = 'sale_earn';
create unique index loyalty_transactions_refund_reversal_idx
  on app.loyalty_transactions (tenant_id, refund_id) where transaction_type = 'refund_reversal';
create index loyalty_transactions_customer_activity_idx
  on app.loyalty_transactions (tenant_id, customer_id, occurred_at desc, id);
create index loyalty_transactions_sale_idx on app.loyalty_transactions (tenant_id, sale_id);
create index loyalty_transactions_refund_idx on app.loyalty_transactions (tenant_id, refund_id) where refund_id is not null;
create index loyalty_transactions_actor_user_idx on app.loyalty_transactions (tenant_id, actor_user_id) where actor_user_id is not null;
create index loyalty_transactions_actor_employee_idx on app.loyalty_transactions (tenant_id, actor_employee_id) where actor_employee_id is not null;

alter table app.loyalty_policies enable row level security;
alter table app.loyalty_accounts enable row level security;
alter table app.loyalty_transactions enable row level security;
revoke all on table app.loyalty_policies, app.loyalty_accounts, app.loyalty_transactions
  from public, anon, authenticated, hcs_hyperdrive;

create trigger loyalty_policies_set_updated_at before update on app.loyalty_policies
for each row execute function app.set_updated_at();
create trigger loyalty_accounts_set_updated_at before update on app.loyalty_accounts
for each row execute function app.set_updated_at();

create function app.initialize_loyalty_tenant_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.loyalty_policies (tenant_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_loyalty_tenant_defaults() from public, anon, authenticated, hcs_hyperdrive;
create trigger tenants_initialize_loyalty_defaults after insert on app.tenants
for each row execute function app.initialize_loyalty_tenant_defaults();
insert into app.loyalty_policies (tenant_id) select id from app.tenants on conflict do nothing;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r join app.permissions p on p.code = any(case lower(r.code::text)
  when 'owner' then array['loyalty.read', 'loyalty.manage']
  when 'admin' then array['loyalty.read', 'loyalty.manage']
  when 'manager' then array['loyalty.read', 'loyalty.manage']
  else array[]::text[] end)
where lower(r.code::text) in ('owner', 'admin', 'manager')
on conflict do nothing;

create function app.initialize_role_loyalty_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.role_permissions (tenant_id, role_id, permission_code)
  select new.tenant_id, new.id, p.code from app.permissions p
  where p.code = any(case lower(new.code::text)
    when 'owner' then array['loyalty.read', 'loyalty.manage']
    when 'admin' then array['loyalty.read', 'loyalty.manage']
    when 'manager' then array['loyalty.read', 'loyalty.manage']
    else array[]::text[] end)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_role_loyalty_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_loyalty_permissions after insert on app.roles
for each row execute function app.initialize_role_loyalty_permissions();

create function app.apply_loyalty_transaction_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_balance bigint;
begin
  insert into app.loyalty_accounts (tenant_id, customer_id)
  values (new.tenant_id, new.customer_id)
  on conflict do nothing;
  select balance_points into v_balance from app.loyalty_accounts
  where tenant_id = new.tenant_id and customer_id = new.customer_id for update;
  v_balance := v_balance + new.points_delta;
  if v_balance < 0 then
    raise exception using errcode = 'HCSC4', message = 'Loyalty balance cannot become negative';
  end if;
  new.balance_after_points := v_balance;
  update app.loyalty_accounts set
    balance_points = v_balance,
    lifetime_earned_points = lifetime_earned_points + greatest(new.points_delta, 0),
    lifetime_reversed_points = lifetime_reversed_points + greatest(-new.points_delta, 0),
    last_activity_at = new.occurred_at
  where tenant_id = new.tenant_id and customer_id = new.customer_id;
  return new;
end;
$$;
revoke all on function app.apply_loyalty_transaction_balance() from public, anon, authenticated, hcs_hyperdrive;
create trigger loyalty_transactions_apply_balance before insert on app.loyalty_transactions
for each row execute function app.apply_loyalty_transaction_balance();

create function app.reject_loyalty_transaction_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'HCSC8', message = 'Loyalty transactions are append-only';
end;
$$;
revoke all on function app.reject_loyalty_transaction_mutation() from public, anon, authenticated, hcs_hyperdrive;
create trigger loyalty_transactions_append_only before update or delete on app.loyalty_transactions
for each row execute function app.reject_loyalty_transaction_mutation();

create function app.reverse_refunded_loyalty_points() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sale app.sales%rowtype;
  v_earn app.loyalty_transactions%rowtype;
  v_refunded_centavos bigint;
  v_target_points bigint;
  v_already_reversed bigint;
  v_reverse_points bigint;
  v_transaction_id uuid := gen_random_uuid();
begin
  select * into v_sale from app.sales where tenant_id = new.tenant_id and id = new.sale_id;
  select * into v_earn from app.loyalty_transactions
  where tenant_id = new.tenant_id and sale_id = new.sale_id and transaction_type = 'sale_earn';
  if not found then return new; end if;
  select round(coalesce(sum(amount), 0) * 100)::bigint into v_refunded_centavos
  from app.refunds where tenant_id = new.tenant_id and sale_id = new.sale_id and status = 'completed';
  v_target_points := greatest(floor(greatest(round(v_sale.total * 100)::bigint - v_refunded_centavos, 0)::numeric / v_earn.spend_per_point_centavos)::bigint, 0);
  select coalesce(-sum(points_delta), 0)::bigint into v_already_reversed
  from app.loyalty_transactions
  where tenant_id = new.tenant_id and sale_id = new.sale_id and transaction_type = 'refund_reversal';
  v_reverse_points := greatest(v_earn.points_delta - v_target_points - v_already_reversed, 0);
  if v_reverse_points = 0 then return new; end if;
  insert into app.loyalty_transactions (
    id, tenant_id, customer_id, transaction_type, points_delta, balance_after_points,
    spend_per_point_centavos, sale_id, refund_id, actor_user_id, occurred_at
  ) values (
    v_transaction_id, new.tenant_id, v_sale.customer_id, 'refund_reversal', -v_reverse_points, 0,
    v_earn.spend_per_point_centavos, new.sale_id, new.id, new.completed_by, new.completed_at
  );
  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    new.tenant_id, 'loyalty-refund-' || new.id::text, 'tenant_user', new.completed_by, 'loyalty.points_reversed', 'loyalty_transaction',
    v_transaction_id, v_sale.location_id,
    jsonb_build_object('saleId', new.sale_id, 'refundId', new.id, 'customerId', v_sale.customer_id, 'points', v_reverse_points)
  );
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (
    new.tenant_id, 'loyalty.points_reversed', 'customer', v_sale.customer_id,
    jsonb_build_object('transactionId', v_transaction_id, 'saleId', new.sale_id, 'refundId', new.id, 'customerId', v_sale.customer_id, 'points', v_reverse_points)
  );
  return new;
end;
$$;
revoke all on function app.reverse_refunded_loyalty_points() from public, anon, authenticated, hcs_hyperdrive;
create trigger refunds_reverse_loyalty_points after insert on app.refunds
for each row execute function app.reverse_refunded_loyalty_points();

create function app.load_loyalty(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_policy app.loyalty_policies%rowtype; v_can_manage boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='loyalty.read'))) then
    raise exception using errcode='HCSC0', message='Loyalty access is not allowed';
  end if;
  select * into v_policy from app.loyalty_policies where tenant_id=p_tenant_id;
  select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='loyalty.manage'))) into v_can_manage;
  return jsonb_build_object(
    'policy', jsonb_build_object('enabled',v_policy.enabled,'spendPerPointCentavos',case when v_policy.spend_per_point is null then null else round(v_policy.spend_per_point*100)::bigint end,'updatedAt',v_policy.updated_at),
    'canManage', v_can_manage,
    'summary', jsonb_build_object(
      'memberCount',(select count(*)::integer from app.loyalty_accounts where tenant_id=p_tenant_id),
      'outstandingPoints',(select coalesce(sum(balance_points),0)::bigint from app.loyalty_accounts where tenant_id=p_tenant_id),
      'lifetimeEarnedPoints',(select coalesce(sum(lifetime_earned_points),0)::bigint from app.loyalty_accounts where tenant_id=p_tenant_id),
      'lifetimeReversedPoints',(select coalesce(sum(lifetime_reversed_points),0)::bigint from app.loyalty_accounts where tenant_id=p_tenant_id)
    ),
    'recentTransactions', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'customerId',t.customer_id,'customerNumber',c.customer_number::text,'customerName',c.full_name,
      'type',t.transaction_type,'pointsDelta',t.points_delta,'balanceAfterPoints',t.balance_after_points,
      'receiptNumber',s.receipt_number,'occurredAt',t.occurred_at
    ) order by t.occurred_at desc,t.id) from (select * from app.loyalty_transactions where tenant_id=p_tenant_id order by occurred_at desc,id limit 100) t join app.customers c on c.tenant_id=t.tenant_id and c.id=t.customer_id join app.sales s on s.tenant_id=t.tenant_id and s.id=t.sale_id),'[]'::jsonb)
  );
end;
$$;

create function app.update_loyalty_policy(p_actor_user_id uuid,p_tenant_id uuid,p_enabled boolean,p_spend_per_point_centavos bigint,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='loyalty.manage'))) then
    raise exception using errcode='HCSC0', message='Loyalty policy management is not allowed';
  end if;
  if p_enabled is null or (p_spend_per_point_centavos is not null and p_spend_per_point_centavos <= 0) or (p_enabled and p_spend_per_point_centavos is null) then
    raise exception using errcode='HCSC2', message='Loyalty policy is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':loyalty.policy:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='loyalty.policy' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'loyalty.policy',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;
  update app.loyalty_policies set enabled=p_enabled,spend_per_point=case when p_spend_per_point_centavos is null then null else p_spend_per_point_centavos::numeric/100 end,updated_by=p_actor_user_id where tenant_id=p_tenant_id;
  v_response:=jsonb_build_object('enabled',p_enabled,'spendPerPointCentavos',p_spend_per_point_centavos,'status','updated');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'loyalty.policy_updated','loyalty_policy',p_tenant_id,jsonb_build_object('enabled',p_enabled,'spendPerPointCentavos',p_spend_per_point_centavos));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'loyalty.policy_updated','tenant',p_tenant_id,v_response);
  update app.idempotency_records set response_status=200,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='loyalty.policy' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create or replace function app.search_pos_customers(p_session_token_hash text,p_search text default '',p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pos app.pos_employee_sessions%rowtype; v_search text:=lower(btrim(coalesce(p_search,''))); v_enabled boolean;
begin
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  if not exists(select 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code='customers.read') then raise exception using errcode='HCS93',message='Employee cannot view customers'; end if;
  select enabled into v_enabled from app.loyalty_policies where tenant_id=v_pos.tenant_id;
  return jsonb_build_object('customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'customerNumber',c.customer_number::text,'fullName',c.full_name,'email',c.email::text,'phone',c.phone,'customerType',c.customer_type,'loyaltyEnabled',coalesce(v_enabled,false),'loyaltyBalancePoints',coalesce(a.balance_points,0)) order by c.full_name,c.id) from (select * from app.customers c0 where c0.tenant_id=v_pos.tenant_id and c0.status='active' and (v_search='' or lower(c0.full_name) like '%'||v_search||'%' or lower(c0.customer_number::text) like '%'||v_search||'%' or lower(coalesce(c0.email::text,'')) like '%'||v_search||'%' or lower(coalesce(c0.phone,'')) like '%'||v_search||'%') order by full_name,id limit least(greatest(p_limit,1),50)) c left join app.loyalty_accounts a on a.tenant_id=c.tenant_id and a.customer_id=c.id),'[]'::jsonb));
end;
$$;

create or replace function app.complete_pos_cash_sale_with_customer(p_session_token_hash text,p_lines jsonb,p_cash_received_centavos bigint,p_customer_id uuid,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype; v_customer app.customers%rowtype; v_response jsonb; v_sale_id uuid;
  v_existing_customer_id uuid; v_policy app.loyalty_policies%rowtype; v_points bigint:=0; v_balance bigint;
  v_loyalty_transaction_id uuid;
begin
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  if p_customer_id is not null then
    select * into v_customer from app.customers where tenant_id=v_pos.tenant_id and id=p_customer_id and status='active';
    if not found then raise exception using errcode='HCSB1',message='Customer was not found'; end if;
  end if;
  v_response:=app.complete_pos_cash_sale(p_session_token_hash,p_lines,p_cash_received_centavos,p_idempotency_key,p_request_hash,p_request_id);
  v_sale_id:=(v_response->>'saleId')::uuid;
  if p_customer_id is not null then
    select customer_id into v_existing_customer_id from app.sales where tenant_id=v_pos.tenant_id and id=v_sale_id for update;
    if v_existing_customer_id is not null and v_existing_customer_id<>p_customer_id then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing_customer_id is null then
      update app.sales set customer_id=p_customer_id where tenant_id=v_pos.tenant_id and id=v_sale_id;
      insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'sale.customer_linked','sale',v_sale_id,v_pos.location_id,jsonb_build_object('customerId',p_customer_id));
      insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'sale.customer_linked','sale',v_sale_id,jsonb_build_object('saleId',v_sale_id,'customerId',p_customer_id));
      select * into v_policy from app.loyalty_policies where tenant_id=v_pos.tenant_id;
      if v_policy.enabled then
        v_points:=floor((v_response->>'totalCentavos')::bigint / round(v_policy.spend_per_point*100)::bigint)::bigint;
        if v_points>0 then
          v_loyalty_transaction_id:=gen_random_uuid();
          insert into app.loyalty_transactions(id,tenant_id,customer_id,transaction_type,points_delta,balance_after_points,spend_per_point_centavos,sale_id,actor_employee_id,occurred_at)
          values(v_loyalty_transaction_id,v_pos.tenant_id,p_customer_id,'sale_earn',v_points,0,round(v_policy.spend_per_point*100)::bigint,v_sale_id,v_pos.employee_id,(v_response->>'completedAt')::timestamptz);
          insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'loyalty.points_earned','loyalty_transaction',v_loyalty_transaction_id,v_pos.location_id,jsonb_build_object('saleId',v_sale_id,'customerId',p_customer_id,'points',v_points));
          insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'loyalty.points_earned','customer',p_customer_id,jsonb_build_object('transactionId',v_loyalty_transaction_id,'saleId',v_sale_id,'customerId',p_customer_id,'points',v_points));
        end if;
      end if;
    end if;
    select coalesce(points_delta,0) into v_points from app.loyalty_transactions where tenant_id=v_pos.tenant_id and sale_id=v_sale_id and transaction_type='sale_earn';
    v_points:=coalesce(v_points,0);
    select coalesce(balance_points,0) into v_balance from app.loyalty_accounts where tenant_id=v_pos.tenant_id and customer_id=p_customer_id;
    v_balance:=coalesce(v_balance,0);
    v_response:=v_response||jsonb_build_object('customerId',p_customer_id,'customerName',v_customer.full_name,'loyaltyEarnedPoints',v_points,'loyaltyBalancePoints',v_balance);
  else
    v_response:=v_response||jsonb_build_object('customerId',null,'customerName',null,'loyaltyEarnedPoints',0,'loyaltyBalancePoints',null);
  end if;
  return v_response;
end;
$$;

create or replace function app.load_customer(p_actor_user_id uuid,p_tenant_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customer app.customers%rowtype; v_can_manage boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.read'))) then raise exception using errcode='HCSB0',message='Customer access is not allowed'; end if;
  select * into v_customer from app.customers where tenant_id=p_tenant_id and id=p_customer_id;
  if not found then raise exception using errcode='HCSB1',message='Customer was not found'; end if;
  select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.update'))) into v_can_manage;
  return jsonb_build_object(
    'id',v_customer.id,'customerNumber',v_customer.customer_number::text,'fullName',v_customer.full_name,
    'email',v_customer.email::text,'phone',v_customer.phone,'customerGroupId',v_customer.customer_group_id,
    'customerType',v_customer.customer_type,'emailMarketingConsent',v_customer.email_marketing_consent,
    'smsMarketingConsent',v_customer.sms_marketing_consent,'consentUpdatedAt',v_customer.consent_updated_at,
    'status',v_customer.status,'origin',v_customer.origin,'createdAt',v_customer.created_at,'updatedAt',v_customer.updated_at,
    'canManage',v_can_manage,
    'totalSpendCentavos',round(coalesce((select sum(greatest(s.total-coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0),0)) from app.sales s where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id and s.status<>'voided'),0)*100)::bigint,
    'visitCount',(select count(*)::integer from app.sales s where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id and s.status<>'voided'),
    'loyalty',jsonb_build_object(
      'enabled',coalesce((select enabled from app.loyalty_policies where tenant_id=p_tenant_id),false),
      'balancePoints',coalesce((select balance_points from app.loyalty_accounts where tenant_id=p_tenant_id and customer_id=p_customer_id),0),
      'lifetimeEarnedPoints',coalesce((select lifetime_earned_points from app.loyalty_accounts where tenant_id=p_tenant_id and customer_id=p_customer_id),0),
      'lifetimeReversedPoints',coalesce((select lifetime_reversed_points from app.loyalty_accounts where tenant_id=p_tenant_id and customer_id=p_customer_id),0),
      'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.transaction_type,'pointsDelta',t.points_delta,'balanceAfterPoints',t.balance_after_points,'receiptNumber',s.receipt_number,'occurredAt',t.occurred_at) order by t.occurred_at desc,t.id) from app.loyalty_transactions t join app.sales s on s.tenant_id=t.tenant_id and s.id=t.sale_id where t.tenant_id=p_tenant_id and t.customer_id=p_customer_id),'[]'::jsonb)
    ),
    'purchases',coalesce((select jsonb_agg(jsonb_build_object('saleId',s.id,'receiptNumber',s.receipt_number,'status',s.status,'locationName',l.name,'totalCentavos',round(s.total*100)::bigint,'refundedCentavos',round(coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0)*100)::bigint,'completedAt',s.completed_at) order by s.completed_at desc,s.id) from app.sales s join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id),'[]'::jsonb),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'actorName',coalesce(e.display_name,m_user.email::text,'Business user'),'createdAt',n.created_at) order by n.created_at desc,n.id) from app.customer_notes n left join app.employees e on e.tenant_id=n.tenant_id and e.id=n.created_by_employee_id left join auth.users m_user on m_user.id=n.created_by_user_id where n.tenant_id=p_tenant_id and n.customer_id=p_customer_id),'[]'::jsonb)
  );
end;
$$;

create or replace function app.load_sale_receipt_with_customer(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_receipt jsonb;
begin
  v_receipt:=app.load_sale_receipt(p_actor_user_id,p_tenant_id,p_sale_id);
  return v_receipt||coalesce((select jsonb_build_object('customerId',c.id,'customerName',c.full_name,'customerNumber',c.customer_number::text) from app.sales s join app.customers c on c.tenant_id=s.tenant_id and c.id=s.customer_id where s.tenant_id=p_tenant_id and s.id=p_sale_id),jsonb_build_object('customerId',null,'customerName',null,'customerNumber',null))||jsonb_build_object(
    'loyaltyEarnedPoints',coalesce((select sum(greatest(points_delta,0)) from app.loyalty_transactions where tenant_id=p_tenant_id and sale_id=p_sale_id),0),
    'loyaltyReversedPoints',coalesce((select -sum(least(points_delta,0)) from app.loyalty_transactions where tenant_id=p_tenant_id and sale_id=p_sale_id),0)
  );
end;
$$;

revoke all on function app.load_loyalty(uuid,uuid), app.update_loyalty_policy(uuid,uuid,boolean,bigint,text,text,text) from public, anon, authenticated;
grant execute on function app.load_loyalty(uuid,uuid), app.update_loyalty_policy(uuid,uuid,boolean,bigint,text,text,text) to hcs_hyperdrive;

commit;
