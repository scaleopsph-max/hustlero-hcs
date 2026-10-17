begin;

insert into app.permissions(code,description) values
  ('funds.read','View business fund accounts and ledger'),
  ('funds.manage','Create fund accounts and allocations')
on conflict(code) do update set description=excluded.description;

create table app.fund_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  fund_type text not null check(fund_type in ('capital_cogs','operating')),
  status text not null default 'active' check(status in ('active','inactive')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id),
  unique(tenant_id,code),
  unique(tenant_id,fund_type),
  foreign key(tenant_id,created_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict,
  constraint fund_accounts_code_not_blank check(btrim(code::text)<>''),
  constraint fund_accounts_name_not_blank check(btrim(name)<>'')
);

create table app.fund_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  fund_account_id uuid not null,
  entry_type text not null check(entry_type in ('allocation','transfer_in','transfer_out','expense','correction','reversal')),
  amount numeric(18,2) not null check(amount<>0),
  source_type text not null,
  source_id uuid,
  reason text not null,
  actor_user_id uuid not null,
  reversal_of uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key(tenant_id,fund_account_id) references app.fund_accounts(tenant_id,id) on delete restrict,
  foreign key(tenant_id,actor_user_id) references app.tenant_memberships(tenant_id,user_id) on delete restrict,
  foreign key(tenant_id,reversal_of) references app.fund_ledger_entries(tenant_id,id) on delete restrict,
  constraint fund_ledger_source_not_blank check(btrim(source_type)<>''),
  constraint fund_ledger_reason_not_blank check(char_length(btrim(reason)) between 3 and 240),
  constraint fund_ledger_reversal_link check(
    (entry_type='reversal' and reversal_of is not null) or (entry_type<>'reversal' and reversal_of is null)
  )
);
create index fund_accounts_tenant_status_idx on app.fund_accounts(tenant_id,status,fund_type);
create index fund_ledger_entries_account_occurred_idx on app.fund_ledger_entries(tenant_id,fund_account_id,occurred_at,id);
create index fund_ledger_entries_actor_idx on app.fund_ledger_entries(tenant_id,actor_user_id,occurred_at desc,id);
create index fund_ledger_entries_reversal_idx on app.fund_ledger_entries(tenant_id,reversal_of) where reversal_of is not null;

create trigger fund_accounts_set_updated_at before update on app.fund_accounts
for each row execute function app.set_updated_at();

create function app.reject_fund_ledger_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='HCS90',message='Fund ledger entries are append-only';
end;
$$;
create trigger fund_ledger_entries_append_only before update or delete on app.fund_ledger_entries
for each row execute function app.reject_fund_ledger_mutation();

alter table app.fund_accounts enable row level security;
alter table app.fund_ledger_entries enable row level security;
revoke all on table app.fund_accounts,app.fund_ledger_entries from public,anon,authenticated,hcs_hyperdrive;
revoke all on function app.reject_fund_ledger_mutation() from public,anon,authenticated,hcs_hyperdrive;

insert into app.role_permissions(tenant_id,role_id,permission_code)
select r.tenant_id,r.id,p.code from app.roles r join app.permissions p on p.code=any(
  case lower(r.code::text)
    when 'owner' then array['funds.read','funds.manage']
    when 'admin' then array['funds.read','funds.manage']
    when 'accountant' then array['funds.read','funds.manage']
    when 'manager' then array['funds.read']
    else array[]::text[] end)
where lower(r.code::text) in ('owner','admin','accountant','manager')
on conflict do nothing;

create function app.create_basic_fund_setup(
  p_actor_user_id uuid,p_tenant_id uuid,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb;
begin
  if not exists(select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active' and is_owner) then
    raise exception using errcode='HCS03',message='Only an active owner can complete basic fund setup';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':onboarding.basic-funds:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='onboarding.basic-funds' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at)
    values(p_tenant_id,'onboarding.basic-funds',p_idempotency_key,p_request_hash,now()+interval '24 hours');
  end if;
  insert into app.fund_accounts(tenant_id,code,name,fund_type,created_by) values
    (p_tenant_id,'capital-cogs','Capital / COGS Fund','capital_cogs',p_actor_user_id),
    (p_tenant_id,'operating','Operating Fund','operating',p_actor_user_id)
  on conflict(tenant_id,fund_type) do update set status='active',updated_at=now();
  v_response:=pg_catalog.jsonb_build_object(
    'step','basic_fund_setup','status','complete',
    'fundAccounts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',f.id,'code',f.code::text,'name',f.name,'fundType',f.fund_type,'status',f.status
    ) order by f.fund_type) from app.fund_accounts f where f.tenant_id=p_tenant_id and f.status='active'),'[]'::jsonb)
  );
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
  values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'onboarding.basic_funds.completed','tenant',p_tenant_id,
    pg_catalog.jsonb_build_object('fundTypes',pg_catalog.jsonb_build_array('capital_cogs','operating')));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
  values(p_tenant_id,'onboarding.basic_funds.completed','tenant',p_tenant_id,v_response);
  update app.idempotency_records set response_status=200,response_body=v_response,completed_at=now()
  where tenant_id=p_tenant_id and operation='onboarding.basic-funds' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function app.load_onboarding_snapshot(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_profile app.tenant_onboarding_profiles%rowtype; v_result jsonb;
begin
  if not exists(select 1 from app.tenant_memberships where tenant_id=p_tenant_id and user_id=p_actor_user_id and status='active' and is_owner) then
    raise exception using errcode='HCS03',message='Business setup is available to its active owner';
  end if;
  select * into v_profile from app.tenant_onboarding_profiles where tenant_id=p_tenant_id;
  v_result:=pg_catalog.jsonb_build_object(
    'hasMainLocation',exists(select 1 from app.locations where tenant_id=p_tenant_id and is_active),
    'hasProducts',app.tenant_has_products(p_tenant_id),
    'hasOpeningInventory',coalesce(v_profile.tracks_inventory=false,false) or app.tenant_has_opening_inventory(p_tenant_id),
    'hasPaymentMethods',exists(select 1 from app.payment_methods where tenant_id=p_tenant_id and is_active and method_type='cash'),
    'hasBasicFunds',(select count(distinct fund_type)=2 from app.fund_accounts where tenant_id=p_tenant_id and status='active' and fund_type in('capital_cogs','operating')),
    'hasEmployees',exists(select 1 from app.employees e join app.employee_locations el on el.tenant_id=e.tenant_id and el.employee_id=e.id join app.locations l on l.tenant_id=el.tenant_id and l.id=el.location_id where e.tenant_id=p_tenant_id and e.status='active' and l.is_active),
    'hasRegister',exists(select 1 from app.registers where tenant_id=p_tenant_id and status='active'),
    'hasPosActivation',exists(select 1 from app.pos_devices where tenant_id=p_tenant_id and status='active'),
    'hasTestSale',exists(select 1 from app.sales where tenant_id=p_tenant_id and status in('completed','partially_refunded','refunded','voided')),
    'businessQuestionsComplete',v_profile.business_questions_completed_at is not null,
    'featureSelectionComplete',v_profile.feature_selection_completed_at is not null,
    'businessProfile',case when v_profile.business_questions_completed_at is not null then pg_catalog.jsonb_build_object(
      'businessType',v_profile.business_type,'salesChannels',v_profile.sales_channels,
      'tracksInventory',v_profile.tracks_inventory,'productSetupMethod',v_profile.product_setup_method
    ) else null end,
    'featureOptions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code',feature.code,'name',feature.name,'enabled',entitlement.enabled,
      'required',feature.code in('catalog','sales','reports')
    ) order by case feature.code when 'catalog' then 1 when 'sales' then 2 when 'reports' then 3 when 'inventory' then 4 when 'purchasing' then 5 when 'customers' then 6 when 'employees' then 7 when 'finance' then 8 end)
    from app.tenant_entitlements entitlement join app.features feature on feature.code=entitlement.feature_code
    where entitlement.tenant_id=p_tenant_id and entitlement.entitled and feature.platform_available
      and feature.code in('catalog','sales','reports','inventory','purchasing','customers','employees','finance')
      and (entitlement.ends_at is null or entitlement.ends_at>now())),'[]'::jsonb)
  );
  return v_result || pg_catalog.jsonb_build_object('readyToSell',
    (v_result->>'hasMainLocation')::boolean and (v_result->>'hasProducts')::boolean
    and (v_result->>'hasOpeningInventory')::boolean and (v_result->>'hasPaymentMethods')::boolean
    and (v_result->>'hasBasicFunds')::boolean and (v_result->>'hasEmployees')::boolean
    and (v_result->>'hasRegister')::boolean and (v_result->>'hasPosActivation')::boolean
    and (v_result->>'hasTestSale')::boolean and (v_result->>'businessQuestionsComplete')::boolean
    and (v_result->>'featureSelectionComplete')::boolean
  );
end;
$$;

revoke all on function app.create_basic_fund_setup(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function app.load_onboarding_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function app.create_basic_fund_setup(uuid,uuid,text,text,text) to hcs_hyperdrive;
grant execute on function app.load_onboarding_snapshot(uuid,uuid) to hcs_hyperdrive;

commit;
