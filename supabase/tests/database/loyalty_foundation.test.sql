begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select has_table('app','loyalty_policies','loyalty policies table exists');
select has_table('app','loyalty_accounts','loyalty accounts table exists');
select has_table('app','loyalty_transactions','loyalty transaction ledger exists');
select has_function('app','load_loyalty',array['uuid','uuid'],'loyalty context function exists');
select has_function('app','update_loyalty_policy',array['uuid','uuid','boolean','bigint','text','text','text'],'loyalty policy command exists');
select ok(not has_table_privilege('hcs_hyperdrive','app.loyalty_transactions','select'),'API login cannot read loyalty ledger directly');
select ok(has_function_privilege('hcs_hyperdrive','app.load_loyalty(uuid,uuid)','execute'),'API login can execute protected loyalty reads');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1c000000-0000-4000-8000-000000000001','loyalty-a@example.invalid','authenticated','authenticated',now()),
('1c000000-0000-4000-8000-000000000002','loyalty-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
('2c000000-0000-4000-8000-000000000001','loyalty-a','Loyalty A'),
('2c000000-0000-4000-8000-000000000002','loyalty-b','Loyalty B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','active',true,now()),
('2c000000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-000000000002','active',true,now());

select is((select enabled from app.loyalty_policies where tenant_id='2c000000-0000-4000-8000-000000000001'),false,'new tenant loyalty is disabled by default');
select is((select spend_per_point from app.loyalty_policies where tenant_id='2c000000-0000-4000-8000-000000000001'),null::numeric,'no arbitrary earning rate is assigned');
select throws_ok($$select app.update_loyalty_policy('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',true,null,'loyalty-invalid-001','invalid-hash','invalid-request')$$,'HCSC2','Loyalty policy is invalid','enabled policy requires a rate');
select lives_ok($$select app.update_loyalty_policy('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',true,10000,'loyalty-policy-001','policy-hash','policy-request')$$,'owner enables a tenant-defined earning rate');
select is((select spend_per_point from app.loyalty_policies where tenant_id='2c000000-0000-4000-8000-000000000001'),100.00::numeric,'centavos are stored as exact database money');
select lives_ok($$select app.update_loyalty_policy('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',true,10000,'loyalty-policy-001','policy-hash','policy-retry')$$,'identical policy retry is accepted');
select is((select count(*)::integer from audit.audit_events where tenant_id='2c000000-0000-4000-8000-000000000001' and action='loyalty.policy_updated'),1,'policy retry creates no duplicate audit event');
select throws_ok($$select app.load_loyalty('1c000000-0000-4000-8000-000000000002','2c000000-0000-4000-8000-000000000001')$$,'HCSC0','Loyalty access is not allowed','cross-tenant loyalty access is denied');

select lives_ok($$select app.create_customer('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','Loyal Customer','loyal@example.invalid',null,null,'standard',false,false,'loyalty-customer-001','customer-hash','customer-request')$$,'owner creates the loyalty customer');
insert into app.locations(id,tenant_id,code,name) values ('3c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','MAIN','Main Store');
insert into app.employees(id,tenant_id,employee_code,display_name) values ('4c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.employee_locations(tenant_id,employee_id,location_id) values ('2c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001');
insert into app.employee_roles(tenant_id,employee_id,role_id) select '2c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001',id from app.roles where tenant_id='2c000000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers(id,tenant_id,location_id,name,code) values ('5c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values ('6c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','Loyalty POS','active',repeat('e',64),now(),'1c000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values ('2c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 hour');
insert into app.products(id,tenant_id,name,created_by) values ('7c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','Loyalty Shirt','1c000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values ('8c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001','Standard','LOYAL-SHIRT',500.00,200.00,'1c000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values ('2c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','8c000000-0000-4000-8000-000000000001',10.000,200.00);
select lives_ok($$select app.open_pos_register_session(repeat('f',64),100000,'loyalty-register-001','open-hash','open-request')$$,'cashier opens the register');
select lives_ok($$select app.complete_pos_cash_sale_with_customer(repeat('f',64),jsonb_build_array(jsonb_build_object('variantId','8c000000-0000-4000-8000-000000000001','quantityMilli',2000)),100000,(select id from app.customers where tenant_id='2c000000-0000-4000-8000-000000000001'),'loyalty-sale-0001','sale-hash','sale-request')$$,'customer-linked POS sale earns points');
select is((select points_delta from app.loyalty_transactions where tenant_id='2c000000-0000-4000-8000-000000000001' and transaction_type='sale_earn'),10::bigint,'sale earns floor(total divided by configured rate)');
select is((select balance_points from app.loyalty_accounts where tenant_id='2c000000-0000-4000-8000-000000000001'),10::bigint,'account projects the earned balance');
select lives_ok($$select app.complete_pos_cash_sale_with_customer(repeat('f',64),jsonb_build_array(jsonb_build_object('variantId','8c000000-0000-4000-8000-000000000001','quantityMilli',2000)),100000,(select id from app.customers where tenant_id='2c000000-0000-4000-8000-000000000001'),'loyalty-sale-0001','sale-hash','sale-retry')$$,'sale retry is accepted');
select is((select count(*)::integer from app.loyalty_transactions where tenant_id='2c000000-0000-4000-8000-000000000001' and transaction_type='sale_earn'),1,'sale retry does not earn twice');
select is((app.load_customer('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',(select id from app.customers where tenant_id='2c000000-0000-4000-8000-000000000001'))->'loyalty'->>'balancePoints')::bigint,10::bigint,'customer profile exposes loyalty balance');
select is((app.search_pos_customers(repeat('f',64),'loyal',20)->'customers'->0->>'loyaltyBalancePoints')::bigint,10::bigint,'POS customer search exposes loyalty balance');
select is((app.load_loyalty('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001')->'summary'->>'outstandingPoints')::bigint,10::bigint,'tenant summary reconciles account balances');

select lives_ok($$select app.update_loyalty_policy('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',true,20000,'loyalty-policy-002','new-policy-hash','new-policy-request')$$,'owner can change the future earning rate');
select lives_ok($$select app.reverse_sale('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='2c000000-0000-4000-8000-000000000001'),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where tenant_id='2c000000-0000-4000-8000-000000000001'),'quantityMilli',1000,'returnToStock',true)),'Partial return','loyalty-refund-001','refund-hash-1','refund-request-1')$$,'partial refund reverses points');
select is((select balance_points from app.loyalty_accounts where tenant_id='2c000000-0000-4000-8000-000000000001'),5::bigint,'partial refund uses the original sale rate snapshot');
select is((select points_delta from app.loyalty_transactions where tenant_id='2c000000-0000-4000-8000-000000000001' and transaction_type='refund_reversal'),-5::bigint,'partial refund appends a negative ledger transaction');
select lives_ok($$select app.reverse_sale('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='2c000000-0000-4000-8000-000000000001'),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where tenant_id='2c000000-0000-4000-8000-000000000001'),'quantityMilli',1000,'returnToStock',true)),'Final return','loyalty-refund-002','refund-hash-2','refund-request-2')$$,'full refund reverses the remaining points');
select is((select balance_points from app.loyalty_accounts where tenant_id='2c000000-0000-4000-8000-000000000001'),0::bigint,'full refund leaves zero outstanding points');
select is((select sum(points_delta) from app.loyalty_transactions where tenant_id='2c000000-0000-4000-8000-000000000001'),0::numeric,'ledger sum reproduces the account balance');
select throws_ok($$update app.loyalty_transactions set points_delta=99 where tenant_id='2c000000-0000-4000-8000-000000000001'$$,'HCSC8','Loyalty transactions are append-only','loyalty ledger cannot be edited');

select * from finish();
rollback;
