-- AW4 invoice-linked returns and credit notes; no historical returns are posted.
begin;
insert into app.permissions(code,description) values ('wholesale_returns.post','Post invoice-linked wholesale returns and credit notes') on conflict do nothing;
create table app.wholesale_credit_notes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, invoice_id uuid not null,
 customer_id uuid not null, refund_id uuid not null, amount numeric(18,2) not null check(amount>0),
 debt_reduction numeric(18,2) not null check(debt_reduction>=0),
 customer_credit numeric(18,2) not null check(customer_credit>=0),
 reason text not null check(length(btrim(reason)) between 3 and 240),
 request_body jsonb not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), unique(tenant_id,refund_id), check(amount=debt_reduction+customer_credit),
 foreign key(tenant_id,invoice_id) references app.invoices(tenant_id,id) on delete restrict,
 foreign key(tenant_id,customer_id) references app.customers(tenant_id,id) on delete restrict,
 foreign key(tenant_id,refund_id) references app.refunds(tenant_id,id) on delete restrict,
 foreign key(tenant_id,recorded_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create table app.wholesale_credit_note_lines (
 tenant_id uuid not null, credit_note_id uuid not null, invoice_line_id uuid not null,
 quantity numeric(18,3) not null check(quantity>0 and trunc(quantity)=quantity),
 amount numeric(18,2) not null check(amount>0), return_to_stock boolean not null,
 primary key(tenant_id,credit_note_id,invoice_line_id),
 foreign key(tenant_id,credit_note_id) references app.wholesale_credit_notes(tenant_id,id) on delete restrict,
 foreign key(tenant_id,invoice_line_id) references app.invoice_lines(tenant_id,id) on delete restrict
);
create table app.wholesale_customer_credit_issues (
 tenant_id uuid not null, credit_note_id uuid not null, customer_id uuid not null,
 amount numeric(18,2) not null check(amount>0), recorded_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,credit_note_id),
 foreign key(tenant_id,credit_note_id) references app.wholesale_credit_notes(tenant_id,id) on delete restrict,
 foreign key(tenant_id,customer_id) references app.customers(tenant_id,id) on delete restrict
);
create index wholesale_credit_notes_invoice_idx on app.wholesale_credit_notes(tenant_id,invoice_id,recorded_at,id);
create index wholesale_credit_notes_customer_idx on app.wholesale_credit_notes(tenant_id,customer_id,recorded_at,id);
create index wholesale_credit_note_lines_original_idx on app.wholesale_credit_note_lines(tenant_id,invoice_line_id);
create index wholesale_credit_issues_customer_idx on app.wholesale_customer_credit_issues(tenant_id,customer_id);
alter table app.wholesale_credit_notes enable row level security;
alter table app.wholesale_credit_note_lines enable row level security;
alter table app.wholesale_customer_credit_issues enable row level security;
revoke all on app.wholesale_credit_notes,app.wholesale_credit_note_lines,app.wholesale_customer_credit_issues from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_credit_notes_immutable before update or delete on app.wholesale_credit_notes for each row execute function app.reject_invoice_mutation();
create trigger wholesale_credit_note_lines_immutable before update or delete on app.wholesale_credit_note_lines for each row execute function app.reject_invoice_mutation();
create trigger wholesale_customer_credit_issues_immutable before update or delete on app.wholesale_customer_credit_issues for each row execute function app.reject_invoice_mutation();

-- Hold authorization rows through posting; revocation and commands have a defined admission order.
create function app.lock_wholesale_return_access(p_actor uuid,p_tenant uuid,p_permission text)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean; v_permission text; v_entitlement app.tenant_entitlements%rowtype;
 v_denial text:=case when p_permission='wholesale_returns.post' then 'Return access denied' else 'Credit action access denied' end;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCWR0',message=v_denial; end if;
 perform 1 from app.features where code='advanced_wholesale' and platform_available for share;
 if not found then raise exception using errcode='HCSQ0',message='Advanced wholesale is not enabled'; end if;
 select * into v_entitlement from app.tenant_entitlements where tenant_id=p_tenant and feature_code='advanced_wholesale' for share;
 if not found or not v_entitlement.entitled or not v_entitlement.enabled
 or (v_entitlement.starts_at is not null and v_entitlement.starts_at>clock_timestamp())
 or (v_entitlement.ends_at is not null and v_entitlement.ends_at<=clock_timestamp())
 then raise exception using errcode='HCSQ0',message='Advanced wholesale is not enabled'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception using errcode='HCAR1',message='Wholesale receivable access denied'; end if;
 if p_permission is null or p_permission not in ('wholesale_returns.post','wholesale_credits.apply','wholesale_credits.refund')
 then raise exception using errcode='HCWR0',message=v_denial; end if;
 if not v_owner then
   for v_permission in select unnest(array['wholesale_orders.read',p_permission]) order by 1 loop
     perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
     where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code=v_permission
     order by mr.role_id for share of mr,rp;
     if not found then
       if v_permission='wholesale_orders.read' then raise exception using errcode='HCAR1',message='Wholesale receivable access denied'; end if;
       raise exception using errcode='HCWR0',message=v_denial;
     end if;
   end loop;
 end if;
end;
$$;
revoke all on function app.lock_wholesale_return_access(uuid,uuid,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.lock_wholesale_return_location(p_actor uuid,p_tenant uuid,p_location uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from app.locations where tenant_id=p_tenant and id=p_location and is_active for share;
 if not found then raise exception using errcode='HCWR2',message='Return or credit scope unavailable'; end if;
 if not exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' and is_owner) then
   perform 1 from app.employees e join app.employee_locations el on el.tenant_id=e.tenant_id and el.employee_id=e.id
   where e.tenant_id=p_tenant and e.user_id=p_actor and e.status='active' and el.location_id=p_location
   order by e.id for share of e,el;
   if not found then raise exception using errcode='HCWR2',message='Return or credit scope unavailable'; end if;
 end if;
end;
$$;
revoke all on function app.lock_wholesale_return_location(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.post_wholesale_return(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_invoice app.invoices%rowtype; v_sale app.sales%rowtype; v_line app.invoice_lines%rowtype;
 v_balance app.inventory_balances%rowtype; v_existing app.idempotency_records%rowtype;
 v_customer uuid; v_invoice_id uuid; v_item jsonb; v_line_id uuid; v_quantity numeric;
 v_prior_quantity numeric; v_prior_credit numeric; v_total numeric:=0; v_prior_total numeric;
 v_paid numeric; v_charge numeric; v_debt_before numeric; v_debt_after numeric; v_new_credit numeric;
 v_refund uuid:=gen_random_uuid(); v_note uuid:=gen_random_uuid(); v_response jsonb;
 v_returned_total numeric; v_cost numeric; v_whole numeric; v_effective_at timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 if not(p_payload ?& array['invoiceId','reason','lines'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('invoiceId','reason','lines'))
 or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or jsonb_typeof(p_payload->'lines') is distinct from 'array'
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 begin v_invoice_id:=(p_payload->>'invoiceId')::uuid;
 exception when invalid_text_representation then raise exception using errcode='HCWR1',message='Invalid return'; end;
 for v_item in select value from jsonb_array_elements(p_payload->'lines') loop
   if jsonb_typeof(v_item) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid return'; end if;
   if not(v_item ?& array['invoiceLineId','quantityMilli','returnToStock'])
   or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('invoiceLineId','quantityMilli','returnToStock'))
   or jsonb_typeof(v_item->'invoiceLineId') is distinct from 'string'
   or jsonb_typeof(v_item->'quantityMilli') is distinct from 'number'
   or jsonb_typeof(v_item->'returnToStock') is distinct from 'boolean'
   then raise exception using errcode='HCWR1',message='Invalid return'; end if;
   begin v_line_id:=(v_item->>'invoiceLineId')::uuid; v_whole:=(v_item->>'quantityMilli')::numeric;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCWR1',message='Invalid return'; end;
   if v_whole<1000 or v_whole>9007199254740991 or mod(v_whole,1000)<>0 then raise exception using errcode='HCWR1',message='Whole units required'; end if;
 end loop;
 if (select count(distinct(value->>'invoiceLineId')::uuid) from jsonb_array_elements(p_payload->'lines'))<>jsonb_array_length(p_payload->'lines')
 then raise exception using errcode='HCWR1',message='Duplicate return lines'; end if;
 select customer_id into v_customer from app.invoices where tenant_id=p_tenant and id=v_invoice_id;
 if not found then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
 -- Match the existing payment-command lock order: customer before invoice and inventory.
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 select * into v_invoice from app.invoices where tenant_id=p_tenant and id=v_invoice_id for update;
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_invoice.location_id)
 then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
 perform app.lock_wholesale_return_location(p_actor,p_tenant,v_invoice.location_id);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':wholesale-return:'||p_key,0));
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='wholesale_return.post' and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null or not exists(
     select 1 from app.wholesale_credit_notes where tenant_id=p_tenant and id=(v_existing.response_body->>'creditNoteId')::uuid
     and invoice_id=v_invoice.id and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 select * into v_sale from app.sales where tenant_id=p_tenant and id=v_invoice.sale_id for update;
 if v_sale.channel<>'wholesale' or v_sale.customer_id is distinct from v_invoice.customer_id or v_sale.location_id<>v_invoice.location_id
 or v_sale.status not in ('completed','partially_refunded') or v_sale.total<>v_invoice.total
 then raise exception using errcode='HCWR3',message='Invoice sale cannot be returned'; end if;
 if v_invoice.total*100>9007199254740991 or v_invoice.discount_total<>0 or v_invoice.tax_total<>0 or v_sale.discount_total<>0 or v_sale.tax_total<>0
 then raise exception using errcode='HCWR3',message='Taxed or discounted return valuation is unsupported'; end if;
 select coalesce(sum(amount),0) into v_prior_total from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=v_invoice.id;
 if (select coalesce(sum(amount),0) from app.refunds where tenant_id=p_tenant and sale_id=v_sale.id)<>v_prior_total
 then raise exception using errcode='HCWR3',message='Commercial reversal history requires reconciliation'; end if;
 select coalesce((select amount from app.wholesale_receivable_charges where tenant_id=p_tenant and invoice_id=v_invoice.id),
 (select amount from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=v_invoice.id)) into v_charge;
 if v_charge is null or v_charge<>v_invoice.total then raise exception using errcode='HCWR3',message='Invoice classification requires reconciliation'; end if;
 for v_item in select value from jsonb_array_elements(p_payload->'lines') order by (value->>'invoiceLineId')::uuid loop
   select * into v_line from app.invoice_lines where tenant_id=p_tenant and invoice_id=v_invoice.id and id=(v_item->>'invoiceLineId')::uuid;
   if not found then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
   v_quantity:=(v_item->>'quantityMilli')::numeric/1000;
   select coalesce(sum(quantity),0),coalesce(sum(amount),0) into v_prior_quantity,v_prior_credit
   from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=v_line.id;
   if v_line.quantity*1000>9007199254740991 or v_line.unit_price*100>9007199254740991
   or trunc(v_line.quantity)<>v_line.quantity or v_line.unit_price<=0 or v_line.line_total<>v_line.quantity*v_line.unit_price
   or v_prior_credit<>v_prior_quantity*v_line.unit_price
   then raise exception using errcode='HCWR3',message='Original line valuation is unsupported'; end if;
   if v_quantity>v_line.quantity-v_prior_quantity then raise exception using errcode='HCWR4',message='Return exceeds remaining fulfilled quantity'; end if;
   if not exists(select 1 from app.sale_lines sl where sl.tenant_id=p_tenant and sl.id=v_line.sale_line_id and sl.sale_id=v_sale.id
     and sl.variant_id=v_line.variant_id and sl.quantity=v_line.quantity and sl.unit_price=v_line.unit_price)
   then raise exception using errcode='HCWR3',message='Invoice and sale line snapshots disagree'; end if;
   v_total:=v_total+v_quantity*v_line.unit_price;
 end loop;
 select coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=v_invoice.id),0)
  +coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=v_invoice.id),0) into v_paid;
 if v_total<=0 or v_total*100>9007199254740991 or v_prior_total+v_total>v_charge or v_paid>v_charge
 then raise exception using errcode='HCWR4',message='Credit exceeds remaining original invoice'; end if;
 v_debt_before:=greatest(v_charge-v_prior_total-v_paid,0); v_debt_after:=greatest(v_charge-v_prior_total-v_total-v_paid,0);
 v_new_credit:=greatest(v_paid-(v_charge-v_prior_total-v_total),0)-greatest(v_paid-(v_charge-v_prior_total),0);
 -- Acquire all stock locks before choosing the single effective time for this business event.
 perform 1 from app.inventory_balances b join app.invoice_lines l
 on l.tenant_id=b.tenant_id and l.variant_id=b.variant_id and l.invoice_id=v_invoice.id
 join jsonb_array_elements(p_payload->'lines') item on l.id=(item.value->>'invoiceLineId')::uuid
 where b.tenant_id=p_tenant and b.location_id=v_invoice.location_id and (item.value->>'returnToStock')::boolean
 order by b.variant_id,l.id for update of b;
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 v_effective_at:=clock_timestamp();
 insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by,completed_at,created_at)
 values(v_refund,p_tenant,v_sale.id,'refund',v_total,btrim(p_payload->>'reason'),p_actor,v_effective_at,v_effective_at);
 insert into app.wholesale_credit_notes(id,tenant_id,invoice_id,customer_id,refund_id,amount,debt_reduction,customer_credit,reason,request_body,recorded_by,recorded_at)
 values(v_note,p_tenant,v_invoice.id,v_customer,v_refund,v_total,v_debt_before-v_debt_after,v_new_credit,btrim(p_payload->>'reason'),p_payload,p_actor,v_effective_at);
 -- Stable variant ordering also serializes different invoices returning the same branch stock.
 for v_item in select item.value from jsonb_array_elements(p_payload->'lines') item
 join app.invoice_lines line on line.tenant_id=p_tenant and line.invoice_id=v_invoice.id and line.id=(item.value->>'invoiceLineId')::uuid
 order by line.variant_id,line.id loop
   select * into v_line from app.invoice_lines where tenant_id=p_tenant and id=(v_item->>'invoiceLineId')::uuid;
   v_quantity:=(v_item->>'quantityMilli')::numeric/1000;
   insert into app.wholesale_credit_note_lines values(p_tenant,v_note,v_line.id,v_quantity,v_quantity*v_line.unit_price,(v_item->>'returnToStock')::boolean);
   insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock,created_at)
   values(p_tenant,v_refund,v_line.sale_line_id,v_quantity,v_quantity*v_line.unit_price,(v_item->>'returnToStock')::boolean,v_effective_at);
   if (v_item->>'returnToStock')::boolean then
     select unit_cost into v_cost from app.sale_lines where tenant_id=p_tenant and id=v_line.sale_line_id;
     select * into v_balance from app.inventory_balances where tenant_id=p_tenant and location_id=v_invoice.location_id and variant_id=v_line.variant_id for update;
     if not found or v_balance.on_hand<0 or v_cost is null or (v_balance.on_hand>0 and v_balance.average_unit_cost is null)
     then raise exception using errcode='HCWR3',message='Return inventory requires reconciliation'; end if;
     update app.inventory_balances set on_hand=on_hand+v_quantity,
       average_unit_cost=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,v_cost)+v_quantity*v_cost)/(v_balance.on_hand+v_quantity),2),
       version=version+1,updated_at=v_effective_at
     where tenant_id=p_tenant and location_id=v_invoice.location_id and variant_id=v_line.variant_id;
     insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id,occurred_at,created_at)
     values(p_tenant,v_invoice.location_id,v_line.variant_id,'REFUND',v_quantity,v_cost,'wholesale_credit_note',v_note::text,p_actor,v_effective_at,v_effective_at);
   end if;
 end loop;
 if v_new_credit>0 then insert into app.wholesale_customer_credit_issues(tenant_id,credit_note_id,customer_id,amount,recorded_at)
 values(p_tenant,v_note,v_customer,v_new_credit,v_effective_at); end if;
 v_returned_total:=v_prior_total+v_total;
 update app.sales set status=case when v_returned_total=total then 'refunded' else 'partially_refunded' end where tenant_id=p_tenant and id=v_sale.id;
 v_response:=jsonb_build_object('creditNoteId',v_note,'invoiceId',v_invoice.id,'refundId',v_refund,'amountMinor',(v_total*100)::bigint,
 'debtReductionMinor',((v_debt_before-v_debt_after)*100)::bigint,'newCustomerCreditMinor',(v_new_credit*100)::bigint,
 'openDebtMinor',(v_debt_after*100)::bigint,'cashPayoutMinor',0);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_return.posted','wholesale_credit_note',v_note,v_invoice.location_id,btrim(p_payload->>'reason'),v_response,v_effective_at);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at)
 values(p_tenant,'wholesale_return.posted','wholesale_credit_note',v_note,v_response,v_effective_at,v_effective_at);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'wholesale_return.post',p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
end;
$$;
revoke all on function app.post_wholesale_return(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
create table app.wholesale_credit_applications (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, credit_note_id uuid not null,
 invoice_id uuid not null, amount numeric(18,2) not null check(amount>0 and amount<=90071992547409.91),
 request_body jsonb not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),
 foreign key(tenant_id,credit_note_id) references app.wholesale_credit_notes(tenant_id,id) on delete restrict,
 foreign key(tenant_id,invoice_id) references app.invoices(tenant_id,id) on delete restrict,
 foreign key(tenant_id,recorded_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create table app.wholesale_credit_payouts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, credit_note_id uuid not null,
 payment_method_id uuid not null, register_session_id uuid, amount numeric(18,2) not null check(amount>0 and amount<=90071992547409.91),
 reference_last_four text check(reference_last_four ~ '^[0-9]{4}$'),
 request_body jsonb not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),
 foreign key(tenant_id,credit_note_id) references app.wholesale_credit_notes(tenant_id,id) on delete restrict,
 foreign key(tenant_id,payment_method_id) references app.payment_methods(tenant_id,id) on delete restrict,
 foreign key(tenant_id,register_session_id) references app.register_sessions(tenant_id,id) on delete restrict,
 foreign key(tenant_id,recorded_by) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_credit_applications_note_idx on app.wholesale_credit_applications(tenant_id,credit_note_id);
create index wholesale_credit_applications_invoice_idx on app.wholesale_credit_applications(tenant_id,invoice_id,recorded_at);
create index wholesale_credit_payouts_note_idx on app.wholesale_credit_payouts(tenant_id,credit_note_id,recorded_at);
create index wholesale_credit_payouts_method_idx on app.wholesale_credit_payouts(tenant_id,payment_method_id,recorded_at);
create index wholesale_credit_payouts_register_idx on app.wholesale_credit_payouts(tenant_id,register_session_id);
alter table app.wholesale_credit_applications enable row level security;
alter table app.wholesale_credit_payouts enable row level security;
revoke all on app.wholesale_credit_applications,app.wholesale_credit_payouts from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_credit_applications_immutable before update or delete on app.wholesale_credit_applications for each row execute function app.reject_invoice_mutation();
create trigger wholesale_credit_payouts_immutable before update or delete on app.wholesale_credit_payouts for each row execute function app.reject_invoice_mutation();
insert into app.permissions(code,description) values ('wholesale_credits.apply','Apply existing wholesale customer credit'),('wholesale_credits.refund','Record authorized customer-credit payouts') on conflict do nothing;

create function app.wholesale_invoice_balance_asof(p_tenant uuid,p_invoice uuid,p_end timestamptz)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(coalesce(
   (select amount from app.wholesale_receivable_charges where tenant_id=p_tenant and invoice_id=p_invoice and recorded_at<p_end),
   (select amount from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=p_invoice and recorded_at<p_end))
 -coalesce((select sum(n.amount) from app.wholesale_credit_notes n where n.tenant_id=p_tenant and n.invoice_id=p_invoice and n.recorded_at<p_end),0)
 -coalesce((select sum(a.amount) from app.wholesale_payment_allocations a join app.wholesale_payments p on p.tenant_id=a.tenant_id and p.id=a.payment_id where a.tenant_id=p_tenant and a.invoice_id=p_invoice and p.recorded_at<p_end),0)
 -coalesce((select sum(a.amount) from app.wholesale_credit_applications a where a.tenant_id=p_tenant and a.invoice_id=p_invoice and a.recorded_at<p_end),0),0)
 where exists(select 1 from app.wholesale_receivable_charges where tenant_id=p_tenant and invoice_id=p_invoice and recorded_at<p_end
 union all select 1 from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=p_invoice and recorded_at<p_end);
$$;
create or replace function app.wholesale_invoice_open_balance(p_tenant uuid,p_invoice uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select app.wholesale_invoice_balance_asof(p_tenant,p_invoice,'infinity'::timestamptz);
$$;
create function app.wholesale_credit_available(p_tenant uuid,p_note uuid,p_end timestamptz default 'infinity')
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select sum(amount) from app.wholesale_customer_credit_issues where tenant_id=p_tenant and credit_note_id=p_note and recorded_at<p_end),0)
 -coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and credit_note_id=p_note and recorded_at<p_end),0)
 -coalesce((select sum(amount) from app.wholesale_credit_payouts where tenant_id=p_tenant and credit_note_id=p_note and recorded_at<p_end),0);
$$;
revoke all on function app.wholesale_invoice_balance_asof(uuid,uuid,timestamptz),app.wholesale_credit_available(uuid,uuid,timestamptz) from public,anon,authenticated,hcs_hyperdrive;

create function app.command_wholesale_credit(p_actor uuid,p_tenant uuid,p_operation text,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_note app.wholesale_credit_notes%rowtype; v_source app.invoices%rowtype; v_target app.invoices%rowtype;
 v_existing app.idempotency_records%rowtype; v_method app.payment_methods%rowtype; v_session app.register_sessions%rowtype;
 v_amount numeric; v_id uuid:=gen_random_uuid(); v_response jsonb; v_operation text; v_customer uuid; v_note_id uuid; v_target_id uuid; v_method_id uuid; v_session_id uuid;
 v_permission text; v_effective_at timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if p_operation is null or p_operation not in ('apply','refund') then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 v_operation:='wholesale_credit.'||p_operation;
 v_permission:=case when p_operation='apply' then 'wholesale_credits.apply' else 'wholesale_credits.refund' end;
 perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 if not(p_payload ?& array['creditNoteId','amountMinor','reason'])
 or jsonb_typeof(p_payload->'creditNoteId') is distinct from 'string' or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCWR1',message='Invalid credit action'; end if;
 if p_operation='apply' and (not(p_payload ? 'invoiceId') or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('creditNoteId','invoiceId','amountMinor','reason')))
 then raise exception using errcode='HCWR1',message='Invalid credit application'; end if;
 if p_operation='refund' and (not(p_payload ?& array['paymentMethodId','registerSessionId','referenceLastFour','payoutConfirmed'])
 or jsonb_typeof(p_payload->'paymentMethodId') is distinct from 'string' or p_payload->'payoutConfirmed' is distinct from 'true'::jsonb
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('creditNoteId','paymentMethodId','registerSessionId','referenceLastFour','payoutConfirmed','amountMinor','reason')))
 then raise exception using errcode='HCWR1',message='Invalid confirmed refund'; end if;
 begin
 v_note_id:=(p_payload->>'creditNoteId')::uuid; v_amount:=(p_payload->>'amountMinor')::numeric;
 v_target_id:=(p_payload->>'invoiceId')::uuid; v_method_id:=(p_payload->>'paymentMethodId')::uuid; v_session_id:=(p_payload->>'registerSessionId')::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCWR1',message='Invalid credit action'; end;
 if v_amount<=0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception using errcode='HCWR1',message='Invalid credit amount'; end if;
 v_amount:=v_amount/100;
 select customer_id into v_customer from app.wholesale_credit_notes where tenant_id=p_tenant and id=v_note_id;
 if not found then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 select * into v_note from app.wholesale_credit_notes where tenant_id=p_tenant and id=v_note_id;
 select * into v_source from app.invoices where tenant_id=p_tenant and id=v_note.invoice_id;
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_source.location_id) then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 perform app.lock_wholesale_return_location(p_actor,p_tenant,v_source.location_id);
 if p_operation='apply' then
   select * into v_target from app.invoices where tenant_id=p_tenant and id=v_target_id and customer_id=v_customer and location_id=v_source.location_id for update;
   if not found or not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_target.location_id) then raise exception using errcode='HCWR2',message='Credit scope unavailable'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||v_operation||':'||p_key,0));
 perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation=v_operation and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   if p_operation='apply' and not exists(select 1 from app.wholesale_credit_applications where tenant_id=p_tenant and id=(v_existing.response_body->>'applicationId')::uuid and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   if p_operation='refund' and not exists(select 1 from app.wholesale_credit_payouts where tenant_id=p_tenant and id=(v_existing.response_body->>'payoutId')::uuid and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 if v_amount>app.wholesale_credit_available(p_tenant,v_note.id) then raise exception using errcode='HCWR4',message='Credit exceeds available balance'; end if;
 if p_operation='apply' then
   if app.wholesale_invoice_open_balance(p_tenant,v_target.id) is null or v_amount>app.wholesale_invoice_open_balance(p_tenant,v_target.id)
   then raise exception using errcode='HCWR4',message='Credit exceeds open invoice balance'; end if;
   perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
   v_effective_at:=clock_timestamp();
   insert into app.wholesale_credit_applications(id,tenant_id,credit_note_id,invoice_id,amount,request_body,recorded_by,recorded_at)
   values(v_id,p_tenant,v_note.id,v_target.id,v_amount,p_payload,p_actor,v_effective_at);
   v_response:=jsonb_build_object('applicationId',v_id,'creditNoteId',v_note.id,'invoiceId',v_target.id,'amountMinor',(v_amount*100)::bigint);
 else
   -- Allocated receipts require a separate approved, audited fund-reversal workflow.
   if exists(select 1 from app.wholesale_payment_allocations a join app.wholesale_fund_allocations f on f.tenant_id=a.tenant_id and f.payment_id=a.payment_id where a.tenant_id=p_tenant and a.invoice_id=v_source.id)
   then raise exception using errcode='HCWR5',message='Funded receipt requires audited reversal before payout'; end if;
   select * into v_method from app.payment_methods where tenant_id=p_tenant and id=v_method_id and is_active for share;
   -- These availability denials happen only after the original-key replay check.
   if not found or v_method.method_type not in ('cash','e_wallet','bank_transfer') then raise exception using errcode='HCWR6',message='Refund method unavailable'; end if;
   if v_amount+coalesce((select sum(p.amount) from app.wholesale_credit_payouts p join app.wholesale_credit_notes n on n.tenant_id=p.tenant_id and n.id=p.credit_note_id where p.tenant_id=p_tenant and n.invoice_id=v_source.id and p.payment_method_id=v_method.id),0)
     >coalesce((select sum(a.amount) from app.wholesale_payment_allocations a join app.wholesale_payments p on p.tenant_id=a.tenant_id and p.id=a.payment_id where a.tenant_id=p_tenant and a.invoice_id=v_source.id and p.payment_method_id=v_method.id),0)
   then raise exception using errcode='HCWR4',message='Refund exceeds original method collection'; end if;
   if v_method.method_type='cash' then
     if v_session_id is null or p_payload->'referenceLastFour' is distinct from 'null'::jsonb then raise exception using errcode='HCWR1',message='Cash refund requires a register session and no external reference'; end if;
     select * into v_session from app.register_sessions where tenant_id=p_tenant and id=v_session_id and location_id=v_source.location_id and status='open' for update;
     if not found or not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active' and(m.is_owner or (
       exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='registers.operate')
       and exists(select 1 from app.employees e where e.tenant_id=p_tenant and e.id=v_session.employee_id and e.user_id=p_actor and e.status='active'))))
     then raise exception using errcode='HCWR6',message='Authorized open cash session required'; end if;
     if coalesce((select sum(amount) from app.cash_movements where tenant_id=p_tenant and register_session_id=v_session.id),0)<v_amount
     then raise exception using errcode='HCWR4',message='Register cash is insufficient'; end if;
   else
     if p_payload->'registerSessionId' is distinct from 'null'::jsonb or jsonb_typeof(p_payload->'referenceLastFour') is distinct from 'string' or (p_payload->>'referenceLastFour') !~ '^[0-9]{4}$'
     then raise exception using errcode='HCWR1',message='External refund requires exactly four reference digits'; end if;
   end if;
   perform app.lock_wholesale_return_access(p_actor,p_tenant,v_permission);
   v_effective_at:=clock_timestamp();
   insert into app.wholesale_credit_payouts(id,tenant_id,credit_note_id,payment_method_id,register_session_id,amount,reference_last_four,request_body,recorded_by,recorded_at)
   values(v_id,p_tenant,v_note.id,v_method.id,v_session_id,v_amount,p_payload->>'referenceLastFour',p_payload,p_actor,v_effective_at);
   if v_method.method_type='cash' then
     insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,reason,actor_user_id,occurred_at)
     values(p_tenant,v_session.id,v_source.location_id,'cash_refund',-v_amount,'wholesale_credit_payout',v_id,btrim(p_payload->>'reason'),p_actor,v_effective_at);
   end if;
   v_response:=jsonb_build_object('payoutId',v_id,'creditNoteId',v_note.id,'paymentMethodId',v_method.id,'registerSessionId',v_session_id,'amountMinor',(v_amount*100)::bigint,'referenceLastFour',p_payload->>'referenceLastFour');
 end if;
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,v_operation,'wholesale_credit',v_id,v_source.location_id,btrim(p_payload->>'reason'),v_response,v_effective_at);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at) values(p_tenant,v_operation,'wholesale_credit',v_id,v_response,v_effective_at,v_effective_at);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,v_operation,p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
end;
$$;
revoke all on function app.command_wholesale_credit(uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

alter function app.load_wholesale_statement(uuid,uuid,date,uuid,uuid) rename to wholesale_statement_before_credit_notes;
create function app.load_wholesale_statement(p_actor uuid,p_tenant uuid,p_date date,p_customer uuid default null,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_rows jsonb; v_entries jsonb; v_summary jsonb; v_end timestamptz;
begin
 v_result:=app.wholesale_statement_before_credit_notes(p_actor,p_tenant,p_date,p_customer,p_location);
 v_end:=(v_result->'scope'->>'asOf')::timestamptz;
 select coalesce(jsonb_agg(i||jsonb_build_object('balanceMinor',case when i->>'classification'='unclassified' then null else (app.wholesale_invoice_balance_asof(p_tenant,(i->>'invoiceId')::uuid,v_end)*100)::bigint end,
 'creditedMinor',(coalesce((select sum(amount) from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=(i->>'invoiceId')::uuid and recorded_at<v_end),0)*100)::bigint,
 'creditIssuedMinor',(coalesce((select sum(customer_credit) from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=(i->>'invoiceId')::uuid and recorded_at<v_end),0)*100)::bigint,
 'appliedCreditMinor',(coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=(i->>'invoiceId')::uuid and recorded_at<v_end),0)*100)::bigint)),'[]'::jsonb)
 into v_rows from jsonb_array_elements(v_result->'invoices') i;
 with additions as (
 select 'credit-note:'||n.id::text id,n.recorded_at,n.invoice_id,'credit_note'::text kind,0::numeric debit,n.amount credit
 from app.wholesale_credit_notes n where n.tenant_id=p_tenant and n.recorded_at<v_end
 union all select 'customer-credit:'||n.id,n.recorded_at,n.invoice_id,'customer_credit_issued',n.customer_credit,0 from app.wholesale_credit_notes n where n.tenant_id=p_tenant and n.recorded_at<v_end and n.customer_credit>0
 union all select 'credit-application:'||a.id,a.recorded_at,a.invoice_id,'credit_application',0,a.amount from app.wholesale_credit_applications a where a.tenant_id=p_tenant and a.recorded_at<v_end
 ), all_entries as (
 select value item from jsonb_array_elements(v_result->'entries')
 union all select jsonb_build_object('entryId',a.id,'recordedAt',a.recorded_at,'invoiceId',a.invoice_id,'invoiceNumber',i->>'invoiceNumber','customerName',i->>'customerName','kind',a.kind,'reference',a.id,'debitMinor',(a.debit*100)::bigint,'creditMinor',(a.credit*100)::bigint)
 from additions a join jsonb_array_elements(v_rows) i on (i->>'invoiceId')::uuid=a.invoice_id)
 select coalesce(jsonb_agg(item order by (item->>'recordedAt')::timestamptz,item->>'entryId'),'[]'::jsonb) into v_entries from all_entries;
 select (v_result->'summary')||jsonb_build_object(
 'balanceMinor',coalesce(sum((i->>'balanceMinor')::bigint),0),
 'currentMinor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='current'),0),
 'days1To30Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='1-30'),0),
 'days31To60Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='31-60'),0),
 'days61To90Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='61-90'),0),
 'over90Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='over-90'),0)) into v_summary from jsonb_array_elements(v_rows) i;
 return v_result||jsonb_build_object('invoices',v_rows,'entries',v_entries,'summary',v_summary);
end;
$$;
alter function app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid) rename to wholesale_settlement_before_credit_notes;
create function app.load_wholesale_settlement_report(p_actor uuid,p_tenant uuid,p_from date,p_to date,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_end timestamptz; v_total numeric;
begin
 v_result:=app.wholesale_settlement_before_credit_notes(p_actor,p_tenant,p_from,p_to,p_location);
 v_end:=(v_result->'scope'->>'asOf')::timestamptz;
 select coalesce(sum(app.wholesale_invoice_balance_asof(p_tenant,id,v_end)),0) into v_total from app.invoices where tenant_id=p_tenant and issued_at<v_end
 and(p_location is null or location_id=p_location) and app.can_read_wholesale_location(p_actor,p_tenant,location_id);
 return jsonb_set(v_result,'{summary,closingReceivablesMinor}',to_jsonb((v_total*100)::bigint));
end;
$$;
-- Do not allocate a receipt which still backs issued return credit as if it were free cash.
alter function app.allocate_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text) rename to wholesale_funds_before_credit_notes;
create function app.allocate_wholesale_payment_funds(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_customer uuid; v_payment uuid;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if not app.has_wholesale_fund_access(p_actor,p_tenant,true) then raise exception using errcode='HCFD1',message='Fund permission required'; end if;
 if exists(select 1 from app.idempotency_records where tenant_id=p_tenant and operation='wholesale.funds' and idempotency_key=p_key and completed_at is not null) then
   return app.wholesale_funds_before_credit_notes(p_actor,p_tenant,p_payload,p_key,p_hash,p_request_id);
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'paymentId') is distinct from 'string' then
   raise exception using errcode='HCFD2',message='Invalid fund allocation';
 end if;
 begin v_payment:=(p_payload->>'paymentId')::uuid;
 exception when invalid_text_representation then raise exception using errcode='HCFD2',message='Invalid fund allocation'; end;
 select customer_id into v_customer from app.wholesale_payments where tenant_id=p_tenant and id=v_payment;
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 if exists(select 1 from app.wholesale_payment_allocations a join app.wholesale_credit_notes n on n.tenant_id=a.tenant_id and n.invoice_id=a.invoice_id
 where a.tenant_id=p_tenant and a.payment_id=v_payment and n.customer_credit>0)
 then raise exception using errcode='HCWR5',message='Return-backed receipt requires explicit liability reconciliation'; end if;
 return app.wholesale_funds_before_credit_notes(p_actor,p_tenant,p_payload,p_key,p_hash,p_request_id);
end;
$$;
create function app.load_wholesale_returns(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_post boolean; v_apply boolean; v_refund boolean;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_returns.post'),
 m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_credits.apply'),
 m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_credits.refund')
 into v_post,v_apply,v_refund from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active';
 return jsonb_build_object('canPost',coalesce(v_post,false),'canApply',coalesce(v_apply,false),'canRefund',coalesce(v_refund,false),
 'invoices',(select coalesce(jsonb_agg(jsonb_build_object('invoiceId',i.id,'invoiceNumber',i.invoice_number::text,'customerId',i.customer_id,'customerName',i.customer_name_snapshot,'locationId',i.location_id,'locationName',i.location_name_snapshot,
 'totalMinor',(i.total*100)::bigint,'creditedMinor',(coalesce((select sum(amount) from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=i.id),0)*100)::bigint,'settledMinor',((coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=i.id),0)+coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=i.id),0))*100)::bigint,'openDebtMinor',(app.wholesale_invoice_open_balance(p_tenant,i.id)*100)::bigint,'valuationSupported',i.discount_total=0 and i.tax_total=0,
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('invoiceLineId',l.id,'name',l.product_name||' / '||l.variant_name,'quantityMilli',(l.quantity*1000)::bigint,'returnedQuantityMilli',(coalesce((select sum(quantity) from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=l.id),0)*1000)::bigint,'unitPriceMinor',(l.unit_price*100)::bigint,'originalTotalMinor',(l.line_total*100)::bigint,'priorCreditMinor',(coalesce((select sum(amount) from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=l.id),0)*100)::bigint) order by l.id),'[]'::jsonb) from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=i.id)) order by i.issued_at desc,i.id),'[]'::jsonb) from app.invoices i where i.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'notes',(select coalesce(jsonb_agg(jsonb_build_object(
   'creditNoteId',n.id,'invoiceId',n.invoice_id,'refundId',n.refund_id,
   'customerId',n.customer_id,'locationId',i.location_id,'reason',n.reason,
   'amountMinor',(n.amount*100)::bigint,'debtReductionMinor',(n.debt_reduction*100)::bigint,
   'issuedCreditMinor',(n.customer_credit*100)::bigint,
   'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=n.tenant_id and k.operation='wholesale_return.post' and k.response_body->>'creditNoteId'=n.id::text),
   'payoutBlocked',exists(select 1 from app.wholesale_payment_allocations a join app.wholesale_fund_allocations f on f.tenant_id=a.tenant_id and f.payment_id=a.payment_id where a.tenant_id=n.tenant_id and a.invoice_id=n.invoice_id),
   'availableCreditMinor',(app.wholesale_credit_available(p_tenant,n.id)*100)::bigint,'recordedAt',n.recorded_at,
   'lines',(select coalesce(jsonb_agg(jsonb_build_object(
     'invoiceLineId',line.invoice_line_id,'name',original.product_name||' / '||original.variant_name,
     'quantityMilli',(line.quantity*1000)::bigint,'amountMinor',(line.amount*100)::bigint,
     'returnToStock',line.return_to_stock) order by line.invoice_line_id),'[]'::jsonb)
     from app.wholesale_credit_note_lines line join app.invoice_lines original
       on original.tenant_id=line.tenant_id and original.id=line.invoice_line_id and original.invoice_id=n.invoice_id
     where line.tenant_id=n.tenant_id and line.credit_note_id=n.id)
 ) order by n.recorded_at desc,n.id),'[]'::jsonb)
 from app.wholesale_credit_notes n join app.invoices i on i.tenant_id=n.tenant_id and i.id=n.invoice_id
 where n.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'applications',(select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=a.tenant_id and k.operation='wholesale_credit.apply' and k.response_body->>'applicationId'=a.id::text),'creditNoteId',a.credit_note_id,'invoiceId',a.invoice_id,'amountMinor',(a.amount*100)::bigint) order by a.recorded_at,a.id),'[]'::jsonb) from app.wholesale_credit_applications a join app.invoices i on i.tenant_id=a.tenant_id and i.id=a.invoice_id where a.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'payouts',(select coalesce(jsonb_agg(jsonb_build_object('payoutId',p.id,'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=p.tenant_id and k.operation='wholesale_credit.refund' and k.response_body->>'payoutId'=p.id::text),'creditNoteId',p.credit_note_id,'paymentMethodId',p.payment_method_id,'registerSessionId',p.register_session_id,'amountMinor',(p.amount*100)::bigint,'referenceLastFour',p.reference_last_four) order by p.recorded_at,p.id),'[]'::jsonb) from app.wholesale_credit_payouts p join app.wholesale_credit_notes n on n.tenant_id=p.tenant_id and n.id=p.credit_note_id join app.invoices i on i.tenant_id=n.tenant_id and i.id=n.invoice_id where p.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'methods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',method_type) order by name,id),'[]'::jsonb) from app.payment_methods where tenant_id=p_tenant and is_active and method_type in ('cash','e_wallet','bank_transfer') and v_refund),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'locationId',s.location_id,'name',r.name) order by r.name,s.id),'[]'::jsonb) from app.register_sessions s join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id where s.tenant_id=p_tenant and s.status='open' and v_refund and app.can_record_wholesale_payment_at_location(p_actor,p_tenant,s.location_id)));
end;
$$;
revoke all on function app.load_wholesale_returns(uuid,uuid),app.load_wholesale_statement(uuid,uuid,date,uuid,uuid),app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid),app.allocate_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
-- Keep renamed pre-credit projections private; only validated wrappers are API-callable.
revoke all on function app.wholesale_statement_before_credit_notes(uuid,uuid,date,uuid,uuid),app.wholesale_settlement_before_credit_notes(uuid,uuid,date,date,uuid),app.wholesale_funds_before_credit_notes(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
grant execute on function app.load_wholesale_returns(uuid,uuid),app.post_wholesale_return(uuid,uuid,jsonb,text,text,text),app.command_wholesale_credit(uuid,uuid,text,jsonb,text,text,text),app.load_wholesale_statement(uuid,uuid,date,uuid,uuid),app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid),app.allocate_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;
-- Preserve COGS for returned goods that are not restored to sellable stock.
create or replace function app.load_reporting(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_channel text default 'all'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_actor_user_id and m.status = 'active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr
        join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = m.tenant_id and mr.user_id = m.user_id and rp.permission_code = 'reports.read'
      ))
  ) then
    raise exception using errcode = 'HCSD0', message = 'Reporting access is not allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_channel not in ('all', 'pos') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  if p_location_id is not null and not exists (
    select 1 from app.locations where tenant_id = p_tenant_id and id = p_location_id
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, id)
  ) then
    raise exception using errcode = 'HCSD2', message = 'Reporting location was not found';
  end if;

  select timezone into v_timezone from app.tenants where id = p_tenant_id;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with
  scoped_sales as (
    select s.* from app.sales s
    where s.tenant_id = p_tenant_id and s.completed_at >= v_start and s.completed_at < v_end
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, s.location_id)
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  scoped_refunds as (
    select rf.*, s.location_id, s.employee_id
    from app.refunds rf join app.sales s on s.tenant_id = rf.tenant_id and s.id = rf.sale_id
    where rf.tenant_id = p_tenant_id and rf.completed_at >= v_start and rf.completed_at < v_end
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, s.location_id)
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  summary as (
    select
      coalesce((select sum(total) from scoped_sales), 0) gross_sales,
      coalesce((select sum(amount) from scoped_refunds), 0) refunds,
      coalesce((select sum(discount_total) from scoped_sales), 0) discounts,
      coalesce((select sum(tax_total) from scoped_sales), 0) taxes,
      coalesce((select sum(sl.quantity * coalesce(sl.unit_cost, 0)) from app.sale_lines sl join scoped_sales s on s.id = sl.sale_id and s.tenant_id = sl.tenant_id), 0)
        - coalesce((select sum(case when ri.returned_to_stock then ri.quantity * coalesce(sl.unit_cost, 0) else 0 end) from app.refund_items ri join scoped_refunds rf on rf.id = ri.refund_id and rf.tenant_id = ri.tenant_id join app.sale_lines sl on sl.tenant_id = ri.tenant_id and sl.id = ri.sale_line_id), 0) cogs,
      (select count(*) from scoped_sales) transactions
  ),
  trend_days as (select generate_series(p_from, p_to, interval '1 day')::date business_date),
  trend_sales as (
    select (s.completed_at at time zone v_timezone)::date business_date, sum(s.total) gross, count(*) transactions
    from scoped_sales s group by 1
  ),
  trend_refunds as (
    select (rf.completed_at at time zone v_timezone)::date business_date, sum(rf.amount) refunds
    from scoped_refunds rf group by 1
  ),
  branch_sales as (select location_id, sum(total) gross, count(*) transactions from scoped_sales group by location_id),
  branch_refunds as (select location_id, sum(amount) refunds from scoped_refunds group by location_id),
  branch_cogs as (
    select s.location_id, sum(sl.quantity * coalesce(sl.unit_cost, 0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by s.location_id
  ),
  branch_refund_cogs as (
    select rf.location_id, sum(case when ri.returned_to_stock then ri.quantity * coalesce(sl.unit_cost, 0) else 0 end) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by rf.location_id
  ),
  inventory_rows as (
    select b.location_id, l.name location_name, p.name product_name, v.name variant_name, v.sku::text sku,
      b.on_hand, b.reserved, b.on_hand-b.reserved available, b.in_transit, b.average_unit_cost
    from app.inventory_balances b
    join app.locations l on l.tenant_id=b.tenant_id and l.id=b.location_id
    join app.product_variants v on v.tenant_id=b.tenant_id and v.id=b.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    where b.tenant_id=p_tenant_id and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, b.location_id) and (p_location_id is null or b.location_id=p_location_id)
      and v.is_active and p.status='active'
  ),
  item_sales as (
    select sl.variant_id, max(sl.product_name) product_name, max(sl.variant_name) variant_name, max(sl.sku) sku,
      sum(sl.quantity) quantity, count(distinct s.id) transactions, sum(sl.line_total) gross,
      sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by sl.variant_id
  ),
  item_refunds as (
    select sl.variant_id, sum(ri.quantity) quantity, count(distinct rf.id) transactions, sum(ri.amount) refunds,
      sum(case when ri.returned_to_stock then ri.quantity*coalesce(sl.unit_cost,0) else 0 end) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by sl.variant_id
  ),
  category_sales as (
    select coalesce(c.name,'Uncategorized') label, count(distinct s.id) transactions, sum(sl.line_total) gross,
      sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id
    join app.product_variants v on v.tenant_id=sl.tenant_id and v.id=sl.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    left join app.product_categories c on c.tenant_id=p.tenant_id and c.id=p.category_id group by 1
  ),
  category_refunds as (
    select coalesce(c.name,'Uncategorized') label, sum(ri.amount) refunds, sum(case when ri.returned_to_stock then ri.quantity*coalesce(sl.unit_cost,0) else 0 end) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id
    join app.product_variants v on v.tenant_id=sl.tenant_id and v.id=sl.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    left join app.product_categories c on c.tenant_id=p.tenant_id and c.id=p.category_id group by 1
  ),
  employee_sales as (select employee_id, count(*) transactions, sum(total) gross from scoped_sales group by employee_id),
  employee_refunds as (select employee_id, sum(amount) refunds from scoped_refunds group by employee_id),
  employee_cogs as (
    select s.employee_id, sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by s.employee_id
  ),
  employee_refund_cogs as (
    select rf.employee_id, sum(case when ri.returned_to_stock then ri.quantity*coalesce(sl.unit_cost,0) else 0 end) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by rf.employee_id
  ),
  payment_sales as (
    select pm.method_type, pm.name, sum(sp.amount) gross
    from scoped_sales s join app.sale_payments sp on sp.tenant_id=s.tenant_id and sp.sale_id=s.id
    join app.payment_methods pm on pm.tenant_id=sp.tenant_id and pm.id=sp.payment_method_id group by pm.method_type,pm.name
  ),
  payment_refunds as (
    select pm.method_type, pm.name, sum(pr.amount) refunds
    from scoped_refunds rf join app.payment_reversals pr on pr.tenant_id=rf.tenant_id and pr.refund_id=rf.id
    join app.sale_payments sp on sp.tenant_id=pr.tenant_id and sp.id=pr.sale_payment_id
    join app.payment_methods pm on pm.tenant_id=sp.tenant_id and pm.id=sp.payment_method_id group by pm.method_type,pm.name
  )
  select jsonb_build_object(
    'scope', jsonb_build_object('from',p_from,'to',p_to,'locationId',p_location_id,'channel',p_channel,'timezone',v_timezone,'generatedAt',now()),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'code',l.code::text,'name',l.name) order by l.name) from app.locations l where l.tenant_id=p_tenant_id and l.is_active and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, l.id)),'[]'::jsonb),
    'summary', (select jsonb_build_object('grossSalesCentavos',round(gross_sales*100)::bigint,'refundsCentavos',round(refunds*100)::bigint,'netSalesCentavos',round((gross_sales-refunds)*100)::bigint,'cogsCentavos',round(cogs*100)::bigint,'grossProfitCentavos',round((gross_sales-refunds-cogs)*100)::bigint,'transactionCount',transactions::integer,'discountCentavos',round(discounts*100)::bigint,'taxCentavos',round(taxes*100)::bigint) from summary),
    'salesTrend', coalesce((select jsonb_agg(jsonb_build_object('date',d.business_date,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'transactionCount',coalesce(s.transactions,0)::integer) order by d.business_date) from trend_days d left join trend_sales s on s.business_date=d.business_date left join trend_refunds r on r.business_date=d.business_date),'[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('locationId',l.id,'locationName',l.name,'netSalesCentavos',round((coalesce(bs.gross,0)-coalesce(br.refunds,0))*100)::bigint,'grossProfitCentavos',round((coalesce(bs.gross,0)-coalesce(br.refunds,0)-coalesce(bc.cogs,0)+coalesce(brc.cogs,0))*100)::bigint,'transactionCount',coalesce(bs.transactions,0)::integer) order by l.name) from app.locations l left join branch_sales bs on bs.location_id=l.id left join branch_refunds br on br.location_id=l.id left join branch_cogs bc on bc.location_id=l.id left join branch_refund_cogs brc on brc.location_id=l.id where l.tenant_id=p_tenant_id and l.is_active and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, l.id) and (p_location_id is null or l.id=p_location_id)),'[]'::jsonb),
    'inventory', jsonb_build_object('skuCount',(select count(*)::integer from inventory_rows),'onHandMilli',(select coalesce(round(sum(on_hand)*1000),0)::bigint from inventory_rows),'reservedMilli',(select coalesce(round(sum(reserved)*1000),0)::bigint from inventory_rows),'availableMilli',(select coalesce(round(sum(available)*1000),0)::bigint from inventory_rows),'inTransitMilli',(select coalesce(round(sum(in_transit)*1000),0)::bigint from inventory_rows),'outOfStockCount',(select count(*)::integer from inventory_rows where available<=0),'valuationCentavos',(select coalesce(round(sum(on_hand*coalesce(average_unit_cost,0))*100),0)::bigint from inventory_rows)),
    'registers', jsonb_build_object('openCount',(select count(*)::integer from app.register_sessions rs join app.registers r on r.tenant_id=rs.tenant_id and r.id=rs.register_id where rs.tenant_id=p_tenant_id and rs.status='open' and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, rs.location_id) and (p_location_id is null or r.location_id=p_location_id)),'totalCount',(select count(*)::integer from app.registers r where r.tenant_id=p_tenant_id and r.status='active' and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, r.location_id) and (p_location_id is null or r.location_id=p_location_id))),
    'byItem', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.variant_id,r.variant_id)::text,'label',coalesce(s.product_name,vp.name),'variantName',coalesce(s.variant_name,v.name),'sku',coalesce(s.sku,v.sku::text),'quantityMilli',round((coalesce(s.quantity,0)-coalesce(r.quantity,0))*1000)::bigint,'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(s.cogs,0)-coalesce(r.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(s.cogs,0)+coalesce(r.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from item_sales s full join item_refunds r on r.variant_id=s.variant_id join app.product_variants v on v.tenant_id=p_tenant_id and v.id=coalesce(s.variant_id,r.variant_id) join app.products vp on vp.tenant_id=v.tenant_id and vp.id=v.product_id),'[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.label,r.label),'label',coalesce(s.label,r.label),'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(s.cogs,0)-coalesce(r.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(s.cogs,0)+coalesce(r.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from category_sales s full join category_refunds r on r.label=s.label),'[]'::jsonb),
    'byEmployee', coalesce((select jsonb_agg(jsonb_build_object('key',e.id::text,'label',e.display_name,'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(c.cogs,0)-coalesce(rc.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(c.cogs,0)+coalesce(rc.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from app.employees e left join employee_sales s on s.employee_id=e.id left join employee_refunds r on r.employee_id=e.id left join employee_cogs c on c.employee_id=e.id left join employee_refund_cogs rc on rc.employee_id=e.id where e.tenant_id=p_tenant_id and (s.employee_id is not null or r.employee_id is not null)),'[]'::jsonb),
    'byPaymentType', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.method_type,r.method_type),'label',coalesce(s.name,r.name),'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from payment_sales s full join payment_refunds r on r.method_type=s.method_type and r.name=s.name),'[]'::jsonb),
    'inventoryItems', coalesce((select jsonb_agg(jsonb_build_object('locationId',location_id,'locationName',location_name,'productName',product_name,'variantName',variant_name,'sku',sku,'onHandMilli',round(on_hand*1000)::bigint,'reservedMilli',round(reserved*1000)::bigint,'availableMilli',round(available*1000)::bigint,'inTransitMilli',round(in_transit*1000)::bigint,'averageUnitCostCentavos',case when average_unit_cost is null then null else round(average_unit_cost*100)::bigint end,'valuationCentavos',round(on_hand*coalesce(average_unit_cost,0)*100)::bigint) order by location_name,product_name,variant_name) from inventory_rows),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function app.load_reporting_by_channel(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_channel text default 'all'
) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
declare
  v_context jsonb;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_sales_context jsonb;
begin
  if p_channel not in ('all', 'pos', 'wholesale') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  v_context := app.load_reporting_with_inventory_policy(
    p_actor_user_id, p_tenant_id, p_from, p_to, p_location_id, 'all'
  );
  select timezone into v_timezone from app.tenants where id = p_tenant_id;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with
  scoped_sales as (
    select sale.* from app.sales sale
    where sale.tenant_id = p_tenant_id and (p_channel = 'all' or sale.channel = p_channel)
      and sale.completed_at >= v_start and sale.completed_at < v_end
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, sale.location_id)
      and (p_location_id is null or sale.location_id = p_location_id)
  ),
  scoped_refunds as (
    select refund.*, sale.location_id, sale.employee_id, sale.completed_by_user_id
    from app.refunds refund
    join app.sales sale on sale.tenant_id = refund.tenant_id and sale.id = refund.sale_id
    where refund.tenant_id = p_tenant_id and (p_channel = 'all' or sale.channel = p_channel)
      and refund.completed_at >= v_start and refund.completed_at < v_end
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, sale.location_id)
      and (p_location_id is null or sale.location_id = p_location_id)
  ),
  summary as (
    select
      coalesce((select sum(total) from scoped_sales), 0) gross_sales,
      coalesce((select sum(amount) from scoped_refunds), 0) refunds,
      coalesce((select sum(discount_total) from scoped_sales), 0) discounts,
      coalesce((select sum(tax_total) from scoped_sales), 0) taxes,
      coalesce((select sum(line.quantity * coalesce(line.unit_cost, 0))
        from app.sale_lines line join scoped_sales sale
          on sale.id = line.sale_id and sale.tenant_id = line.tenant_id), 0)
      - coalesce((select sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end)
        from app.refund_items item join scoped_refunds refund
          on refund.id = item.refund_id and refund.tenant_id = item.tenant_id
        join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id), 0) cogs,
      (select count(*) from scoped_sales) transactions
  ),
  trend_days as (select generate_series(p_from, p_to, interval '1 day')::date business_date),
  trend_sales as (
    select (sale.completed_at at time zone v_timezone)::date business_date,
      sum(sale.total) gross, count(*) transactions
    from scoped_sales sale group by 1
  ),
  trend_refunds as (
    select (refund.completed_at at time zone v_timezone)::date business_date, sum(refund.amount) refunds
    from scoped_refunds refund group by 1
  ),
  branch_sales as (
    select location_id, sum(total) gross, count(*) transactions from scoped_sales group by location_id
  ),
  branch_refunds as (
    select location_id, sum(amount) refunds from scoped_refunds group by location_id
  ),
  branch_cogs as (
    select sale.location_id, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by sale.location_id
  ),
  branch_refund_cogs as (
    select refund.location_id, sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    group by refund.location_id
  ),
  item_sales as (
    select line.variant_id, max(line.product_name) product_name, max(line.variant_name) variant_name,
      max(line.sku) sku, sum(line.quantity) quantity, count(distinct sale.id) transactions,
      sum(line.line_total) gross, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by line.variant_id
  ),
  item_refunds as (
    select line.variant_id, sum(item.quantity) quantity, count(distinct refund.id) transactions,
      sum(item.amount) refunds, sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    group by line.variant_id
  ),
  category_sales as (
    select coalesce(category.name, 'Uncategorized') label, count(distinct sale.id) transactions,
      sum(line.line_total) gross, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id
    join app.product_variants variant on variant.tenant_id = line.tenant_id and variant.id = line.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    left join app.product_categories category
      on category.tenant_id = product.tenant_id and category.id = product.category_id group by 1
  ),
  category_refunds as (
    select coalesce(category.name, 'Uncategorized') label, sum(item.amount) refunds,
      sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    join app.product_variants variant on variant.tenant_id = line.tenant_id and variant.id = line.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    left join app.product_categories category
      on category.tenant_id = product.tenant_id and category.id = product.category_id group by 1
  ),
  actor_sales as (
    select coalesce(sale.employee_id, sale.completed_by_user_id) actor_id,
      count(*) transactions, sum(sale.total) gross
    from scoped_sales sale group by 1
  ),
  actor_refunds as (
    select coalesce(refund.employee_id, refund.completed_by_user_id) actor_id, sum(refund.amount) refunds
    from scoped_refunds refund group by 1
  ),
  actor_cogs as (
    select coalesce(sale.employee_id, sale.completed_by_user_id) actor_id,
      sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by 1
  ),
  actor_refund_cogs as (
    select coalesce(refund.employee_id, refund.completed_by_user_id) actor_id,
      sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id group by 1
  ),
  actor_labels as (
    select actor_id, coalesce(employee.display_name, user_account.email::text, 'Business user') label
    from (select actor_id from actor_sales union select actor_id from actor_refunds) actor
    left join app.employees employee on employee.tenant_id = p_tenant_id and employee.id = actor.actor_id
    left join auth.users user_account on user_account.id = actor.actor_id
  ),
  payment_sales as (
    select method.method_type, method.name, sum(payment.amount) gross
    from scoped_sales sale join app.sale_payments payment
      on payment.tenant_id = sale.tenant_id and payment.sale_id = sale.id
    join app.payment_methods method
      on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
    group by method.method_type, method.name
  ),
  payment_refunds as (
    select method.method_type, method.name, sum(reversal.amount) refunds
    from scoped_refunds refund join app.payment_reversals reversal
      on reversal.tenant_id = refund.tenant_id and reversal.refund_id = refund.id
    join app.sale_payments payment
      on payment.tenant_id = reversal.tenant_id and payment.id = reversal.sale_payment_id
    join app.payment_methods method
      on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
    group by method.method_type, method.name
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'grossSalesCentavos', round(gross_sales * 100)::bigint,
      'refundsCentavos', round(refunds * 100)::bigint,
      'netSalesCentavos', round((gross_sales - refunds) * 100)::bigint,
      'cogsCentavos', round(cogs * 100)::bigint,
      'grossProfitCentavos', round((gross_sales - refunds - cogs) * 100)::bigint,
      'transactionCount', transactions::integer,
      'discountCentavos', round(discounts * 100)::bigint,
      'taxCentavos', round(taxes * 100)::bigint
    ) from summary),
    'salesTrend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day.business_date,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer
    ) order by day.business_date) from trend_days day
      left join trend_sales sale on sale.business_date = day.business_date
      left join trend_refunds refund on refund.business_date = day.business_date), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object(
      'locationId', location.id,
      'locationName', location.name,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(cost.cogs, 0) + coalesce(refund_cost.cogs, 0)) * 100)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer
    ) order by location.name) from app.locations location
      left join branch_sales sale on sale.location_id = location.id
      left join branch_refunds refund on refund.location_id = location.id
      left join branch_cogs cost on cost.location_id = location.id
      left join branch_refund_cogs refund_cost on refund_cost.location_id = location.id
      where location.tenant_id = p_tenant_id and location.is_active
        and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, location.id)
        and (p_location_id is null or location.id = p_location_id)), '[]'::jsonb),
    'byItem', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.variant_id, refund.variant_id)::text,
      'label', coalesce(sale.product_name, product.name),
      'variantName', coalesce(sale.variant_name, variant.name),
      'sku', coalesce(sale.sku, variant.sku::text),
      'quantityMilli', round((coalesce(sale.quantity, 0) - coalesce(refund.quantity, 0)) * 1000)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(sale.cogs, 0) - coalesce(refund.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(sale.cogs, 0) + coalesce(refund.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from item_sales sale full join item_refunds refund on refund.variant_id = sale.variant_id
      join app.product_variants variant
        on variant.tenant_id = p_tenant_id and variant.id = coalesce(sale.variant_id, refund.variant_id)
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id), '[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.label, refund.label), 'label', coalesce(sale.label, refund.label),
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(sale.cogs, 0) - coalesce(refund.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(sale.cogs, 0) + coalesce(refund.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from category_sales sale full join category_refunds refund on refund.label = sale.label), '[]'::jsonb),
    'byEmployee', coalesce((select jsonb_agg(jsonb_build_object(
      'key', label.actor_id::text, 'label', label.label,
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(cost.cogs, 0) - coalesce(refund_cost.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(cost.cogs, 0) + coalesce(refund_cost.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from actor_labels label
      left join actor_sales sale on sale.actor_id = label.actor_id
      left join actor_refunds refund on refund.actor_id = label.actor_id
      left join actor_cogs cost on cost.actor_id = label.actor_id
      left join actor_refund_cogs refund_cost on refund_cost.actor_id = label.actor_id), '[]'::jsonb),
    'byPaymentType', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.method_type, refund.method_type),
      'label', coalesce(sale.name, refund.name),
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from payment_sales sale full join payment_refunds refund
        on refund.method_type = sale.method_type and refund.name = sale.name), '[]'::jsonb)
  ) into v_sales_context;

  return v_context
    || v_sales_context
    || jsonb_build_object('scope', (v_context -> 'scope') || jsonb_build_object('channel', p_channel));
end;
$$;
commit;
