begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('1b000000-0000-4000-8000-000000000001','branch-owner@example.invalid','authenticated','authenticated',now()),
 ('1b000000-0000-4000-8000-000000000002','branch-reader@example.invalid','authenticated','authenticated',now()),
 ('1b000000-0000-4000-8000-000000000003','unassigned-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
 ('2b000000-0000-4000-8000-000000000001','branch-scope-a','Branch Scope A'),
 ('2b000000-0000-4000-8000-000000000002','branch-scope-b','Branch Scope B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values
 ('2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000001','active',true),
 ('2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000002','active',false),
 ('2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000003','active',false);
insert into app.locations(id,tenant_id,code,name) values
 ('3b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','MAIN','Assigned'),
 ('3b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','OTHER','Other'),
 ('3b000000-0000-4000-8000-000000000003','2b000000-0000-4000-8000-000000000002','FOREIGN','Foreign');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
 ('4b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000002','READ-001','Branch Reader');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('2b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000001','3b000000-0000-4000-8000-000000000001');
create function pg_temp.allowed(p_actor text,p_location text) returns boolean language sql as $$
 select app.can_read_wholesale_location(('1b000000-0000-4000-8000-'||p_actor)::uuid,
 '2b000000-0000-4000-8000-000000000001',('3b000000-0000-4000-8000-'||p_location)::uuid);
$$;
select ok(pg_temp.allowed('000000000001','000000000002'),'owner reads other own branch');
select ok(not pg_temp.allowed('000000000001','000000000003'),'owner cannot read foreign tenant location');
select ok(pg_temp.allowed('000000000002','000000000001'),'reader reads assigned branch');
select ok(not pg_temp.allowed('000000000002','000000000002'),'reader cannot read unassigned branch');
select ok(not pg_temp.allowed('000000000003','000000000001'),'membership alone does not grant branch');
select is(app.scope_wholesale_rows('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001',
 '[{"locationId":"3b000000-0000-4000-8000-000000000002","n":1},{"locationId":"3b000000-0000-4000-8000-000000000001","n":2},{"locationId":"3b000000-0000-4000-8000-000000000001","n":3}]', 'locationId'),
 '[{"locationId":"3b000000-0000-4000-8000-000000000001","n":2},{"locationId":"3b000000-0000-4000-8000-000000000001","n":3}]'::jsonb,'projection preserves allowed row order');
update app.employees set status='suspended';
select ok(not pg_temp.allowed('000000000002','000000000001'),'suspended employee fails closed');
update app.employees set status='active';
update app.tenant_memberships set status='suspended' where user_id='1b000000-0000-4000-8000-000000000002';
select ok(not pg_temp.allowed('000000000002','000000000001'),'suspended membership fails closed');

select ok(not has_function_privilege(r.role_name,f.signature,'execute'),r.role_name||' cannot bypass branch wrappers: '||f.signature)
 from (values ('anon'),('authenticated'),('hcs_hyperdrive')) r(role_name)
 cross join (values
 ('app.wholesale_order_context_unscoped(uuid,uuid)'),
 ('app.wholesale_invoices_unscoped(uuid,uuid)'),
 ('app.wholesale_receivables_unscoped(uuid,uuid)'),
 ('app.wholesale_overrides_unscoped(uuid,uuid)'),
 ('app.wholesale_payments_unscoped(uuid,uuid)'),
 ('app.wholesale_statement_unscoped(uuid,uuid,date,uuid,uuid)'),
 ('app.can_read_wholesale_location(uuid,uuid,uuid)'),
 ('app.scope_wholesale_rows(uuid,uuid,jsonb,text)')) f(signature);
-- Synthetic financial fixtures are rolled back; no live account or ledger is used.
update app.tenant_memberships set status='active';
update app.tenant_entitlements set entitled=true,enabled=true
 where tenant_id='2b000000-0000-4000-8000-000000000001' and feature_code='advanced_wholesale';
insert into app.roles(id,tenant_id,code,name) values
 ('5b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','READ','Read Only');
insert into app.role_permissions(tenant_id,role_id,permission_code)
 select '2b000000-0000-4000-8000-000000000001','5b000000-0000-4000-8000-000000000001',code
 from app.permissions where code in ('wholesale_orders.read','reports.read');
insert into app.membership_roles(tenant_id,user_id,role_id)
 select '2b000000-0000-4000-8000-000000000001',id,'5b000000-0000-4000-8000-000000000001'
 from auth.users where id in ('1b000000-0000-4000-8000-000000000002','1b000000-0000-4000-8000-000000000003');
insert into app.customers(id,tenant_id,customer_number,full_name,email,customer_type,origin,created_by_user_id) values
 ('6b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','CUST-001','Shared Customer','branch-customer@example.invalid','reseller','backoffice','1b000000-0000-4000-8000-000000000001');
insert into app.price_lists(id,tenant_id,code,name,pricing_type,created_by) values
 ('7b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','WHOLESALE','Wholesale','wholesale','1b000000-0000-4000-8000-000000000001');
do $$
declare n integer; v_order uuid; v_sale uuid; v_invoice uuid; v_location uuid; v_total numeric;
begin
 for n in 1..4 loop
  v_order:=('8b000000-0000-4000-8000-00000000000'||n)::uuid;
  v_sale:=('9b000000-0000-4000-8000-00000000000'||n)::uuid;
  v_invoice:=('ab000000-0000-4000-8000-00000000000'||n)::uuid;
  v_location:=case when n in (1,3) then '3b000000-0000-4000-8000-000000000001'::uuid else '3b000000-0000-4000-8000-000000000002'::uuid end;
  v_total:=case n when 1 then 1000 when 2 then 2000 when 3 then 500 else 700 end;
  insert into app.sales_orders(id,tenant_id,order_number,customer_id,location_id,price_list_id,pricing_type,created_by)
   values(v_order,'2b000000-0000-4000-8000-000000000001','SO-BRANCH-'||n,'6b000000-0000-4000-8000-000000000001',v_location,'7b000000-0000-4000-8000-000000000001','wholesale','1b000000-0000-4000-8000-000000000001');
  insert into app.sales(id,tenant_id,location_id,receipt_number,subtotal,total,channel,completed_by_user_id)
   values(v_sale,'2b000000-0000-4000-8000-000000000001',v_location,'BRANCH-'||n,v_total,v_total,'wholesale','1b000000-0000-4000-8000-000000000001');
  insert into app.invoices(id,tenant_id,invoice_number,sales_order_id,sale_id,customer_id,location_id,
   order_number_snapshot,customer_number_snapshot,customer_name_snapshot,location_name_snapshot,subtotal,total,issued_by)
   values(v_invoice,'2b000000-0000-4000-8000-000000000001','INV-BRANCH-'||n,v_order,v_sale,'6b000000-0000-4000-8000-000000000001',v_location,
    'SO-BRANCH-'||n,'CUST-001','Shared Customer','Branch',v_total,v_total,'1b000000-0000-4000-8000-000000000001');
  if n<=2 then
   insert into app.wholesale_legacy_invoices(tenant_id,invoice_id) values('2b000000-0000-4000-8000-000000000001',v_invoice);
   insert into app.wholesale_receivable_charges(tenant_id,invoice_id,customer_id,charge_type,amount,due_date,reason,recorded_by)
    values('2b000000-0000-4000-8000-000000000001',v_invoice,'6b000000-0000-4000-8000-000000000001','opening',v_total,
     (statement_timestamp() at time zone 'Asia/Manila')::date-10,'Synthetic opening','1b000000-0000-4000-8000-000000000001');
   insert into app.wholesale_credit_overrides(tenant_id,sales_order_id,customer_id,action,approved_excess,expires_at,reason,approved_by)
    values('2b000000-0000-4000-8000-000000000001',v_order,'6b000000-0000-4000-8000-000000000001','confirm',200,now()+interval '1 day','Synthetic approval','1b000000-0000-4000-8000-000000000001');
  end if;
 end loop;
end;
$$;
insert into app.payment_methods(id,tenant_id,code,name,method_type) values
 ('bb000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','BRANCH-UAT-CASH','Cash','cash');
insert into app.wholesale_payments(id,tenant_id,customer_id,payment_method_id,amount,reference,recorded_by) values
 ('cb000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','6b000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',200,'Mixed branches','1b000000-0000-4000-8000-000000000001'),
 ('cb000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','6b000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',200,'Assigned only','1b000000-0000-4000-8000-000000000001'),
 ('cb000000-0000-4000-8000-000000000003','2b000000-0000-4000-8000-000000000001','6b000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',50,'Unallocated','1b000000-0000-4000-8000-000000000001');
insert into app.wholesale_payment_allocations(tenant_id,payment_id,invoice_id,amount) values
 ('2b000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',100),
 ('2b000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002',100),
 ('2b000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000002','ab000000-0000-4000-8000-000000000001',200);
create function pg_temp.statement(p_actor uuid default '1b000000-0000-4000-8000-000000000002') returns jsonb language sql as $$
 select app.load_wholesale_statement(p_actor,'2b000000-0000-4000-8000-000000000001',(statement_timestamp() at time zone 'Asia/Manila')::date);
$$;
create function pg_temp.settlement(p_actor uuid default '1b000000-0000-4000-8000-000000000002') returns jsonb language sql as $$
 select app.load_wholesale_settlement_report(p_actor,'2b000000-0000-4000-8000-000000000001',
  (statement_timestamp() at time zone 'Asia/Manila')::date,(statement_timestamp() at time zone 'Asia/Manila')::date);
$$;
select is((pg_temp.statement()->'summary'->>'balanceMinor')::bigint,70000::bigint,'branch balance excludes other branch debt');
select is((pg_temp.statement()->'summary'->>'days1To30Minor')::bigint,70000::bigint,'branch aging uses exact remaining balance');
select is((pg_temp.statement()->'summary'->>'unclassifiedCount')::int,1,'unknown invoices remain scoped and unknown');
select is((pg_temp.statement()->'summary'->>'unclassifiedMinor')::bigint,50000::bigint,'unknown branch total excludes foreign branch');
select is(jsonb_array_length(pg_temp.statement()->'entries'),3,'statement includes assigned charge and two permitted allocation entries');
select is((pg_temp.statement('1b000000-0000-4000-8000-000000000001')->'summary'->>'balanceMinor')::bigint,260000::bigint,'owner retains whole-customer report');
select is((pg_temp.settlement()->'summary'->>'issuedMinor')::bigint,150000::bigint,'branch issued total includes its unknown invoice');
select is((pg_temp.settlement()->'summary'->>'recordedReceiptsMinor')::bigint,30000::bigint,'mixed receipt contributes only assigned allocation to settlement');
select is((pg_temp.settlement()->'summary'->>'receiptCount')::int,2,'branch receipt count uses distinct permitted receipts');
select is((pg_temp.settlement()->'byPaymentMethod'->0->>'amountMinor')::bigint,30000::bigint,'cash method scoped amount reconciles');
select is((pg_temp.settlement('1b000000-0000-4000-8000-000000000001')->'summary'->>'recordedReceiptsMinor')::bigint,40000::bigint,'owner counts mixed allocations once, excludes unallocated money');
select is((pg_temp.settlement()->'summary'->>'closingReceivablesMinor')::bigint,70000::bigint,'branch closing balance reconciles');
select is(jsonb_array_length(app.load_wholesale_payments('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001')->'payments'),1,'mixed and unallocated receipt headers hidden from branch reader');
select is(app.load_wholesale_payments('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001')->'payments'->0->>'reference','Assigned only','permitted whole receipt retains true reference');
select is(jsonb_array_length(app.load_wholesale_payments('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001')->'payments'),3,'owner retains all receipt headers');
select is(jsonb_array_length(app.load_wholesale_credit_overrides('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001')->'overrides'),1,'override history scoped by order branch');
select is(jsonb_array_length(pg_temp.statement('1b000000-0000-4000-8000-000000000003')->'invoices'),0,'unassigned reporting role cannot see invoice data');
select is((pg_temp.settlement('1b000000-0000-4000-8000-000000000003')->'summary'->>'issuedMinor')::bigint,0::bigint,'unassigned reporting role has zero accessible totals');
insert into app.role_permissions(tenant_id,role_id,permission_code) values
 ('2b000000-0000-4000-8000-000000000001','5b000000-0000-4000-8000-000000000001','sales.read');
select is(jsonb_array_length(app.list_sales_archive('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001',2)->'sales'),2,
 'archive scopes before limit instead of discarding another branch after pagination');
select is(app.list_sales_archive('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001',2)->'sales'->1->>'id',
 '9b000000-0000-4000-8000-000000000003','second visible row skips disallowed branch');
select is(jsonb_array_length(app.list_sales_archive('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001')->'sales'),4,
 'owner archive retains both own branches');
select throws_ok($$select app.load_sale_archive_record('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000002')$$,
 'HCSA1','Sale was not found','wholesale detail denies other branch');
select lives_ok($$select app.load_sale_archive_record('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001')$$,
 'wholesale detail allows assigned branch');
select throws_ok($$select app.load_sale_archive_record('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000002')$$,
 'HCSA0','Sales access is not allowed','foreign tenant cannot be selected by a same-tenant reader');
-- Legacy method metadata has no reference snapshot; do not invent one.
update app.payment_methods set method_type='bank_transfer' where id='bb000000-0000-4000-8000-000000000001';
create function pg_temp.bank_report(p_actor uuid default '1b000000-0000-4000-8000-000000000002',p_location uuid default null)
returns jsonb language sql as $$
 select app.load_wholesale_payment_reference_report(p_actor,'2b000000-0000-4000-8000-000000000001',
 (statement_timestamp() at time zone 'Asia/Manila')::date,(statement_timestamp() at time zone 'Asia/Manila')::date,p_location);
$$;
select is(jsonb_array_length(pg_temp.bank_report()->'rows'),1,'restricted bank report hides mixed and unallocated receipt headers');
select is((pg_temp.bank_report()->'rows'->0->>'amountMinor')::bigint,20000::bigint,'restricted bank amount is the complete permitted receipt');
select is((pg_temp.bank_report()->'rows'->0->>'referenceLastFour'),null::text,'legacy bank reference remains explicitly unrecorded');
select is(jsonb_array_length(pg_temp.bank_report('1b000000-0000-4000-8000-000000000001')->'rows'),3,'owner bank report counts one row per receipt, not per invoice');
select is((select sum((item->>'amountMinor')::bigint) from jsonb_array_elements(pg_temp.bank_report('1b000000-0000-4000-8000-000000000001')->'rows') item),45000::numeric,'owner bank header amounts reconcile without duplicate mixed receipt');
select is(jsonb_array_length(pg_temp.bank_report('1b000000-0000-4000-8000-000000000001','3b000000-0000-4000-8000-000000000001')->'rows'),1,'single-branch bank filter excludes mixed/unallocated receipts rather than mislabeling whole amounts');
select * from finish();
rollback;
