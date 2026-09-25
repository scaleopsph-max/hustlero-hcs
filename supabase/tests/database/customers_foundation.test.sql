begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select has_table('app','customer_groups','customer groups table exists');
select has_table('app','customer_counters','customer counters table exists');
select has_table('app','customers','customers table exists');
select has_table('app','customer_notes','customer notes table exists');
select has_column('app','sales','customer_id','sales can link a customer');
select has_function('app','list_customers',array['uuid','uuid','text','integer'],'tenant customer list exists');
select has_function('app','load_customer',array['uuid','uuid','uuid'],'customer detail exists');
select has_function('app','create_pos_customer',array['text','text','text','text','boolean','boolean','text','text','text'],'POS customer creation exists');
select has_function('app','complete_pos_cash_sale_with_customer',array['text','jsonb','bigint','uuid','text','text','text'],'customer-linked POS sale exists');
select ok(not has_table_privilege('hcs_hyperdrive','app.customers','select'),'API login cannot read customer tables directly');
select ok(has_function_privilege('hcs_hyperdrive','app.list_customers(uuid,uuid,text,integer)','execute'),'API login can execute protected customer reads');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1a000000-0000-4000-8000-000000000001','customer-a@example.invalid','authenticated','authenticated',now()),
('1a000000-0000-4000-8000-000000000002','customer-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
('2a000000-0000-4000-8000-000000000001','customer-a','Customer A'),
('2a000000-0000-4000-8000-000000000002','customer-b','Customer B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','active',true,now()),
('2a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000002','active',true,now());

select is((select count(*)::integer from app.customer_groups where tenant_id='2a000000-0000-4000-8000-000000000001'),1,'new tenant receives a default customer group');
select lives_ok($$select app.create_customer('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Maria Santos','MARIA@EXAMPLE.COM',null,null,'standard',false,false,'customer-create-001','hash-1','request-1')$$,'owner creates a customer');
select is((select customer_number::text from app.customers where tenant_id='2a000000-0000-4000-8000-000000000001'),'CUST-000001','customer number is tenant-sequenced');
select is((select email::text from app.customers where tenant_id='2a000000-0000-4000-8000-000000000001'),'maria@example.com','email is normalized');
select is((select origin from app.customers where tenant_id='2a000000-0000-4000-8000-000000000001'),'backoffice','back office origin is recorded');
select is((select count(*)::integer from audit.audit_events where action='customer.created'),1,'customer creation is audited');
select is((select count(*)::integer from integration.event_outbox where topic='customer.created'),1,'customer creation emits an outbox event');
select lives_ok($$select app.create_customer('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Maria Santos','MARIA@EXAMPLE.COM',null,null,'standard',false,false,'customer-create-001','hash-1','retry-1')$$,'identical customer retry is accepted');
select is((select count(*)::integer from app.customers where tenant_id='2a000000-0000-4000-8000-000000000001'),1,'idempotent retry creates no duplicate');
select throws_ok($$select app.create_customer('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Other Maria','maria@example.com',null,null,'standard',false,false,'customer-create-002','hash-2','request-2')$$,'HCSB3','An active customer already uses this email or phone','active duplicate contact is rejected');
select throws_ok($$select app.load_customer('1a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000002',(select id from app.customers where tenant_id='2a000000-0000-4000-8000-000000000001'))$$,'HCSB1','Customer was not found','cross-tenant customer detail is hidden');
select is(jsonb_array_length(app.list_customers('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','maria',100)->'customers'),1,'tenant search returns matching customer');
select lives_ok($$select app.add_customer_note('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',(select id from app.customers where tenant_id='2a000000-0000-4000-8000-000000000001'),'Prefers SMS updates','customer-note-001','note-hash','note-request')$$,'authorized user appends a note');
select throws_ok($$update app.customer_notes set note='Changed'$$,'HCSB8','Customer notes are append-only','customer notes cannot be edited');

insert into app.locations(id,tenant_id,code,name) values ('3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','MAIN','Main Store');
insert into app.employees(id,tenant_id,employee_code,display_name) values ('4a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.employee_locations(tenant_id,employee_id,location_id) values ('2a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001');
insert into app.employee_roles(tenant_id,employee_id,role_id) select '2a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001',id from app.roles where tenant_id='2a000000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers(id,tenant_id,location_id,name,code) values ('5a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values ('6a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','Test POS','active',repeat('c',64),now(),'1a000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values ('2a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001',repeat('d',64),now()+interval '1 hour');

select lives_ok($$select app.create_pos_customer(repeat('d',64),'Juan Dela Cruz',null,'09171234567',false,false,'pos-customer-001','pos-hash','pos-request')$$,'cashier creates a POS customer');
select is((select origin from app.customers where phone='09171234567'),'pos','POS origin is recorded');
select is(jsonb_array_length(app.search_pos_customers(repeat('d',64),'juan',20)->'customers'),1,'POS search returns tenant customer');

insert into app.products(id,tenant_id,name,created_by) values ('7a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Triple Black','1a000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values ('8a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','Small','TB-S',899.00,450.00,'1a000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values ('2a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000001',10.000,450.00);
select lives_ok($$select app.open_pos_register_session(repeat('d',64),100000,'customer-register-open','open-hash','open-request')$$,'cashier opens register for linked sale');
select lives_ok($$select app.complete_pos_cash_sale_with_customer(repeat('d',64),jsonb_build_array(jsonb_build_object('variantId','8a000000-0000-4000-8000-000000000001','quantityMilli',1000)),100000,(select id from app.customers where phone='09171234567'),'customer-sale-001','customer-sale-hash','customer-sale-request')$$,'sale completes with selected customer');
select is((select c.phone from app.sales s join app.customers c on c.tenant_id=s.tenant_id and c.id=s.customer_id where s.tenant_id='2a000000-0000-4000-8000-000000000001'),'09171234567','sale links the selected tenant customer');
select is((app.load_customer('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',(select id from app.customers where phone='09171234567'))->>'totalSpendCentavos')::bigint,89900::bigint,'customer spend is derived from linked sales');
select is((app.load_customer('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',(select id from app.customers where phone='09171234567'))->>'visitCount')::integer,1,'customer visit count is derived from linked sales');

select * from finish();
rollback;
