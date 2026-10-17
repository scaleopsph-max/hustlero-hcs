begin;

insert into app.permissions (code, description) values
  ('customers.read', 'View customer profiles and purchase history'),
  ('customers.create', 'Create customer profiles'),
  ('customers.update', 'Update and deactivate customer profiles'),
  ('customers.notes', 'Add customer notes')
on conflict (code) do update set description = excluded.description;

create table app.customer_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  kind text not null default 'standard' check (kind in ('standard', 'vip', 'reseller', 'wholesale')),
  is_system_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  constraint customer_groups_name_not_blank check (btrim(name) <> '')
);
create unique index customer_groups_one_default_idx on app.customer_groups (tenant_id) where is_system_default;

create table app.customer_counters (
  tenant_id uuid primary key references app.tenants (id) on delete restrict,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);

create table app.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  customer_number extensions.citext not null,
  full_name text not null,
  email extensions.citext,
  phone text,
  customer_group_id uuid,
  customer_type text not null default 'standard' check (customer_type in ('standard', 'reseller')),
  email_marketing_consent boolean not null default false,
  sms_marketing_consent boolean not null default false,
  consent_updated_at timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  origin text not null check (origin in ('backoffice', 'pos')),
  origin_location_id uuid,
  created_by_user_id uuid,
  created_by_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, customer_number),
  foreign key (tenant_id, customer_group_id) references app.customer_groups (tenant_id, id) on delete restrict,
  foreign key (tenant_id, origin_location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, created_by_employee_id) references app.employees (tenant_id, id) on delete restrict,
  constraint customers_name_not_blank check (char_length(btrim(full_name)) between 2 and 160),
  constraint customers_email_not_blank check (email is null or btrim(email::text) <> ''),
  constraint customers_phone_not_blank check (phone is null or btrim(phone) <> ''),
  constraint customers_contact_required check (email is not null or phone is not null),
  constraint customers_creation_actor check (num_nonnulls(created_by_user_id, created_by_employee_id) = 1),
  constraint customers_consent_timestamp check (
    (not email_marketing_consent and not sms_marketing_consent) or consent_updated_at is not null
  )
);
create index customers_tenant_name_idx on app.customers (tenant_id, lower(full_name), id);
create index customers_group_idx on app.customers (tenant_id, customer_group_id, status, created_at desc);
create unique index customers_active_email_idx on app.customers (tenant_id, lower(email::text)) where email is not null and status = 'active';
create unique index customers_active_phone_idx on app.customers (tenant_id, phone) where phone is not null and status = 'active';

create table app.customer_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  customer_id uuid not null,
  note text not null,
  created_by_user_id uuid,
  created_by_employee_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, created_by_employee_id) references app.employees (tenant_id, id) on delete restrict,
  constraint customer_notes_not_blank check (char_length(btrim(note)) between 2 and 1000),
  constraint customer_notes_actor check (num_nonnulls(created_by_user_id, created_by_employee_id) = 1)
);
create index customer_notes_customer_idx on app.customer_notes (tenant_id, customer_id, created_at desc, id);

alter table app.sales add column customer_id uuid;
alter table app.sales add constraint sales_customer_fkey foreign key (tenant_id, customer_id)
  references app.customers (tenant_id, id) on delete restrict;
create index sales_customer_completed_idx on app.sales (tenant_id, customer_id, completed_at desc, id)
  where customer_id is not null;

create trigger customer_groups_set_updated_at before update on app.customer_groups
for each row execute function app.set_updated_at();
create trigger customer_counters_set_updated_at before update on app.customer_counters
for each row execute function app.set_updated_at();
create trigger customers_set_updated_at before update on app.customers
for each row execute function app.set_updated_at();

create function app.reject_customer_note_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'HCSB8', message = 'Customer notes are append-only';
end;
$$;
revoke all on function app.reject_customer_note_mutation() from public, anon, authenticated, hcs_hyperdrive;
create trigger customer_notes_append_only before update or delete on app.customer_notes
for each row execute function app.reject_customer_note_mutation();

alter table app.customer_groups enable row level security;
alter table app.customer_counters enable row level security;
alter table app.customers enable row level security;
alter table app.customer_notes enable row level security;
revoke all on table app.customer_groups, app.customer_counters, app.customers, app.customer_notes
  from public, anon, authenticated, hcs_hyperdrive;

insert into app.customer_groups (tenant_id, code, name, kind, is_system_default)
select id, 'retail', 'Retail customers', 'standard', true from app.tenants
on conflict (tenant_id, code) do nothing;
insert into app.customer_counters (tenant_id) select id from app.tenants on conflict do nothing;

create function app.initialize_customer_tenant_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.customer_groups (tenant_id, code, name, kind, is_system_default)
  values (new.id, 'retail', 'Retail customers', 'standard', true);
  insert into app.customer_counters (tenant_id) values (new.id);
  return new;
end;
$$;
revoke all on function app.initialize_customer_tenant_defaults() from public, anon, authenticated, hcs_hyperdrive;
create trigger tenants_initialize_customer_defaults after insert on app.tenants
for each row execute function app.initialize_customer_tenant_defaults();

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from app.roles r join app.permissions p on p.code = any(case lower(r.code::text)
  when 'owner' then array['customers.read','customers.create','customers.update','customers.notes']
  when 'admin' then array['customers.read','customers.create','customers.update','customers.notes']
  when 'manager' then array['customers.read','customers.create','customers.update','customers.notes']
  when 'cashier' then array['customers.read','customers.create']
  else array[]::text[] end)
where lower(r.code::text) in ('owner','admin','manager','cashier')
on conflict do nothing;

create function app.initialize_role_customer_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.role_permissions (tenant_id, role_id, permission_code)
  select new.tenant_id, new.id, p.code from app.permissions p
  where p.code = any(case lower(new.code::text)
    when 'owner' then array['customers.read','customers.create','customers.update','customers.notes']
    when 'admin' then array['customers.read','customers.create','customers.update','customers.notes']
    when 'manager' then array['customers.read','customers.create','customers.update','customers.notes']
    when 'cashier' then array['customers.read','customers.create']
    else array[]::text[] end)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.initialize_role_customer_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_customer_permissions after insert on app.roles
for each row execute function app.initialize_role_customer_permissions();

create function app.list_customers(p_actor_user_id uuid, p_tenant_id uuid, p_search text default '', p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_search text := lower(btrim(coalesce(p_search, ''))); v_can_manage boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.read'))) then
    raise exception using errcode='HCSB0',message='Customer access is not allowed';
  end if;
  select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.update'))) into v_can_manage;
  return jsonb_build_object(
    'canManage',v_can_manage,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'code',g.code::text,'name',g.name,'kind',g.kind,'isActive',g.is_active) order by g.is_system_default desc,g.name) from app.customer_groups g where g.tenant_id=p_tenant_id),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'customerNumber',c.customer_number::text,'fullName',c.full_name,'email',c.email::text,'phone',c.phone,
      'customerType',c.customer_type,'groupName',g.name,'status',c.status,'origin',c.origin,
      'totalSpendCentavos',round(coalesce(x.total_spend,0)*100)::bigint,'visitCount',coalesce(x.visit_count,0),
      'lastVisitAt',x.last_visit_at,'createdAt',c.created_at
    ) order by coalesce(x.last_visit_at,c.created_at) desc,c.id)
    from (select * from app.customers c0 where c0.tenant_id=p_tenant_id and (v_search='' or lower(c0.full_name) like '%'||v_search||'%' or lower(c0.customer_number::text) like '%'||v_search||'%' or lower(coalesce(c0.email::text,'')) like '%'||v_search||'%' or lower(coalesce(c0.phone,'')) like '%'||v_search||'%') order by created_at desc,id limit least(greatest(p_limit,1),200)) c
    left join app.customer_groups g on g.tenant_id=c.tenant_id and g.id=c.customer_group_id
    left join lateral (select sum(greatest(s.total-coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0),0)) total_spend,count(*)::integer visit_count,max(s.completed_at) last_visit_at from app.sales s where s.tenant_id=c.tenant_id and s.customer_id=c.id and s.status<>'voided') x on true),'[]'::jsonb)
  );
end;
$$;

create function app.load_customer(p_actor_user_id uuid,p_tenant_id uuid,p_customer_id uuid)
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
    'purchases',coalesce((select jsonb_agg(jsonb_build_object('saleId',s.id,'receiptNumber',s.receipt_number,'status',s.status,'locationName',l.name,'totalCentavos',round(s.total*100)::bigint,'refundedCentavos',round(coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0)*100)::bigint,'completedAt',s.completed_at) order by s.completed_at desc,s.id) from app.sales s join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id),'[]'::jsonb),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'actorName',coalesce(e.display_name,m_user.email::text,'Business user'),'createdAt',n.created_at) order by n.created_at desc,n.id) from app.customer_notes n left join app.employees e on e.tenant_id=n.tenant_id and e.id=n.created_by_employee_id left join auth.users m_user on m_user.id=n.created_by_user_id where n.tenant_id=p_tenant_id and n.customer_id=p_customer_id),'[]'::jsonb)
  );
end;
$$;

create function app.create_customer(p_actor_user_id uuid,p_tenant_id uuid,p_full_name text,p_email text,p_phone text,p_customer_group_id uuid,p_customer_type text,p_email_consent boolean,p_sms_consent boolean,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_id uuid:=gen_random_uuid(); v_number bigint; v_code text; v_response jsonb; v_group uuid; v_email text:=nullif(lower(btrim(p_email)),''); v_phone text:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g'),'');
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.create'))) then raise exception using errcode='HCSB0',message='Customer creation is not allowed'; end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 160 or (v_email is null and v_phone is null) or p_customer_type not in ('standard','reseller') then raise exception using errcode='HCSB2',message='Customer details are invalid'; end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception using errcode='HCSB2',message='Customer email is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':customer.create:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='customer.create' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'customer.create',p_idempotency_key,p_request_hash,now()+interval '24 hours'); end if;
  if p_customer_group_id is null then select id into v_group from app.customer_groups where tenant_id=p_tenant_id and is_system_default and is_active; else select id into v_group from app.customer_groups where tenant_id=p_tenant_id and id=p_customer_group_id and is_active; end if;
  if v_group is null then raise exception using errcode='HCSB2',message='Customer group is invalid'; end if;
  insert into app.customer_counters(tenant_id,last_number) values(p_tenant_id,1) on conflict(tenant_id) do update set last_number=app.customer_counters.last_number+1 returning last_number into v_number;
  v_code:='CUST-'||lpad(v_number::text,6,'0');
  insert into app.customers(id,tenant_id,customer_number,full_name,email,phone,customer_group_id,customer_type,email_marketing_consent,sms_marketing_consent,consent_updated_at,origin,created_by_user_id)
  values(v_id,p_tenant_id,v_code,btrim(p_full_name),v_email,v_phone,v_group,p_customer_type,p_email_consent,p_sms_consent,case when p_email_consent or p_sms_consent then now() else null end,'backoffice',p_actor_user_id);
  v_response:=jsonb_build_object('customerId',v_id,'customerNumber',v_code,'status','created');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'customer.created','customer',v_id,jsonb_build_object('customerNumber',v_code,'origin','backoffice'));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'customer.created','customer',v_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='customer.create' and idempotency_key=p_idempotency_key;
  return v_response;
exception when unique_violation then raise exception using errcode='HCSB3',message='An active customer already uses this email or phone';
end;
$$;

create function app.update_customer(p_actor_user_id uuid,p_tenant_id uuid,p_customer_id uuid,p_full_name text,p_email text,p_phone text,p_customer_group_id uuid,p_customer_type text,p_email_consent boolean,p_sms_consent boolean,p_status text,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_customer app.customers%rowtype; v_response jsonb; v_email text:=nullif(lower(btrim(p_email)),''); v_phone text:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g'),'');
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.update'))) then raise exception using errcode='HCSB0',message='Customer update is not allowed'; end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 160 or (v_email is null and v_phone is null) or p_customer_type not in ('standard','reseller') or p_status not in ('active','inactive') then raise exception using errcode='HCSB2',message='Customer details are invalid'; end if;
  if not exists(select 1 from app.customer_groups where tenant_id=p_tenant_id and id=p_customer_group_id and is_active) then raise exception using errcode='HCSB2',message='Customer group is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':customer.update:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='customer.update' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'customer.update',p_idempotency_key,p_request_hash,now()+interval '24 hours'); end if;
  select * into v_customer from app.customers where tenant_id=p_tenant_id and id=p_customer_id for update;
  if not found then raise exception using errcode='HCSB1',message='Customer was not found'; end if;
  update app.customers set full_name=btrim(p_full_name),email=v_email,phone=v_phone,customer_group_id=p_customer_group_id,customer_type=p_customer_type,email_marketing_consent=p_email_consent,sms_marketing_consent=p_sms_consent,consent_updated_at=case when email_marketing_consent is distinct from p_email_consent or sms_marketing_consent is distinct from p_sms_consent then now() else consent_updated_at end,status=p_status where tenant_id=p_tenant_id and id=p_customer_id;
  v_response:=jsonb_build_object('customerId',p_customer_id,'status','updated');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'customer.updated','customer',p_customer_id,jsonb_build_object('status',p_status));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'customer.updated','customer',p_customer_id,v_response);
  update app.idempotency_records set response_status=200,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='customer.update' and idempotency_key=p_idempotency_key;
  return v_response;
exception when unique_violation then raise exception using errcode='HCSB3',message='An active customer already uses this email or phone';
end;
$$;

create function app.add_customer_note(p_actor_user_id uuid,p_tenant_id uuid,p_customer_id uuid,p_note text,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_id uuid:=gen_random_uuid(); v_response jsonb;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.notes'))) then raise exception using errcode='HCSB0',message='Customer notes access is not allowed'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 2 and 1000 then raise exception using errcode='HCSB2',message='Customer note is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':customer.note:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='customer.note' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(p_tenant_id,'customer.note',p_idempotency_key,p_request_hash,now()+interval '24 hours'); end if;
  if not exists(select 1 from app.customers where tenant_id=p_tenant_id and id=p_customer_id) then raise exception using errcode='HCSB1',message='Customer was not found'; end if;
  insert into app.customer_notes(id,tenant_id,customer_id,note,created_by_user_id) values(v_id,p_tenant_id,p_customer_id,btrim(p_note),p_actor_user_id);
  v_response:=jsonb_build_object('noteId',v_id,'customerId',p_customer_id,'status','created');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'customer.note_added','customer',p_customer_id,jsonb_build_object('noteId',v_id));
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=p_tenant_id and operation='customer.note' and idempotency_key=p_idempotency_key;
  return v_response;
end;
$$;

create function app.search_pos_customers(p_session_token_hash text,p_search text default '',p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pos app.pos_employee_sessions%rowtype; v_search text:=lower(btrim(coalesce(p_search,'')));
begin
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  if not exists(select 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code='customers.read') then raise exception using errcode='HCS93',message='Employee cannot view customers'; end if;
  return jsonb_build_object('customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'customerNumber',c.customer_number::text,'fullName',c.full_name,'email',c.email::text,'phone',c.phone,'customerType',c.customer_type) order by c.full_name,c.id) from (select * from app.customers c0 where c0.tenant_id=v_pos.tenant_id and c0.status='active' and (v_search='' or lower(c0.full_name) like '%'||v_search||'%' or lower(c0.customer_number::text) like '%'||v_search||'%' or lower(coalesce(c0.email::text,'')) like '%'||v_search||'%' or lower(coalesce(c0.phone,'')) like '%'||v_search||'%') order by full_name,id limit least(greatest(p_limit,1),50)) c),'[]'::jsonb));
end;
$$;

create function app.create_pos_customer(p_session_token_hash text,p_full_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pos app.pos_employee_sessions%rowtype; v_existing app.idempotency_records%rowtype; v_id uuid:=gen_random_uuid(); v_number bigint; v_code text; v_group uuid; v_response jsonb; v_email text:=nullif(lower(btrim(p_email)),''); v_phone text:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g'),'');
begin
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  if not exists(select 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id=er.tenant_id and rp.role_id=er.role_id where er.tenant_id=v_pos.tenant_id and er.employee_id=v_pos.employee_id and rp.permission_code='customers.create') then raise exception using errcode='HCS93',message='Employee cannot create customers'; end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 160 or (v_email is null and v_phone is null) then raise exception using errcode='HCSB2',message='Customer details are invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text||':pos-customer.create:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=v_pos.tenant_id and operation='pos-customer.create' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if; if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at) values(v_pos.tenant_id,'pos-customer.create',p_idempotency_key,p_request_hash,now()+interval '24 hours'); end if;
  select id into v_group from app.customer_groups where tenant_id=v_pos.tenant_id and is_system_default and is_active;
  insert into app.customer_counters(tenant_id,last_number) values(v_pos.tenant_id,1) on conflict(tenant_id) do update set last_number=app.customer_counters.last_number+1 returning last_number into v_number;
  v_code:='CUST-'||lpad(v_number::text,6,'0');
  insert into app.customers(id,tenant_id,customer_number,full_name,email,phone,customer_group_id,email_marketing_consent,sms_marketing_consent,consent_updated_at,origin,origin_location_id,created_by_employee_id)
  values(v_id,v_pos.tenant_id,v_code,btrim(p_full_name),v_email,v_phone,v_group,p_email_consent,p_sms_consent,case when p_email_consent or p_sms_consent then now() else null end,'pos',v_pos.location_id,v_pos.employee_id);
  v_response:=jsonb_build_object('customerId',v_id,'customerNumber',v_code,'fullName',btrim(p_full_name),'email',v_email,'phone',v_phone,'customerType','standard','status','created');
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'customer.created','customer',v_id,v_pos.location_id,jsonb_build_object('customerNumber',v_code,'origin','pos'));
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'customer.created','customer',v_id,v_response);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now() where tenant_id=v_pos.tenant_id and operation='pos-customer.create' and idempotency_key=p_idempotency_key;
  return v_response;
exception when unique_violation then raise exception using errcode='HCSB3',message='An active customer already uses this email or phone';
end;
$$;

create function app.complete_pos_cash_sale_with_customer(p_session_token_hash text,p_lines jsonb,p_cash_received_centavos bigint,p_customer_id uuid,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pos app.pos_employee_sessions%rowtype; v_customer app.customers%rowtype; v_response jsonb; v_sale_id uuid; v_was_linked boolean;
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
    select customer_id is not null into v_was_linked from app.sales where tenant_id=v_pos.tenant_id and id=v_sale_id for update;
    update app.sales set customer_id=p_customer_id where tenant_id=v_pos.tenant_id and id=v_sale_id and customer_id is null;
    if not v_was_linked then
      insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'sale.customer_linked','sale',v_sale_id,v_pos.location_id,jsonb_build_object('customerId',p_customer_id));
      insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'sale.customer_linked','sale',v_sale_id,jsonb_build_object('saleId',v_sale_id,'customerId',p_customer_id));
    end if;
    v_response:=v_response||jsonb_build_object('customerId',p_customer_id,'customerName',v_customer.full_name);
  else
    v_response:=v_response||jsonb_build_object('customerId',null,'customerName',null);
  end if;
  return v_response;
end;
$$;

create function app.load_sale_receipt_with_customer(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_receipt jsonb;
begin
  v_receipt:=app.load_sale_receipt(p_actor_user_id,p_tenant_id,p_sale_id);
  return v_receipt||coalesce((select jsonb_build_object('customerId',c.id,'customerName',c.full_name,'customerNumber',c.customer_number::text) from app.sales s join app.customers c on c.tenant_id=s.tenant_id and c.id=s.customer_id where s.tenant_id=p_tenant_id and s.id=p_sale_id),jsonb_build_object('customerId',null,'customerName',null,'customerNumber',null));
end;
$$;

revoke all on function app.list_customers(uuid,uuid,text,integer), app.load_customer(uuid,uuid,uuid), app.create_customer(uuid,uuid,text,text,text,uuid,text,boolean,boolean,text,text,text), app.update_customer(uuid,uuid,uuid,text,text,text,uuid,text,boolean,boolean,text,text,text,text), app.add_customer_note(uuid,uuid,uuid,text,text,text,text), app.search_pos_customers(text,text,integer), app.create_pos_customer(text,text,text,text,boolean,boolean,text,text,text), app.complete_pos_cash_sale_with_customer(text,jsonb,bigint,uuid,text,text,text), app.load_sale_receipt_with_customer(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app.list_customers(uuid,uuid,text,integer), app.load_customer(uuid,uuid,uuid), app.create_customer(uuid,uuid,text,text,text,uuid,text,boolean,boolean,text,text,text), app.update_customer(uuid,uuid,uuid,text,text,text,uuid,text,boolean,boolean,text,text,text,text), app.add_customer_note(uuid,uuid,uuid,text,text,text,text), app.search_pos_customers(text,text,integer), app.create_pos_customer(text,text,text,text,boolean,boolean,text,text,text), app.complete_pos_cash_sale_with_customer(text,jsonb,bigint,uuid,text,text,text), app.load_sale_receipt_with_customer(uuid,uuid,uuid) to hcs_hyperdrive;

commit;
