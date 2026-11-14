begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function('app', 'close_pos_register_session', array['text','bigint','text','text','text','text'], 'POS close command exists');
select ok(has_function_privilege('hcs_hyperdrive','app.close_pos_register_session(text,bigint,text,text,text,text)','execute'), 'API login may close from the POS');
select ok(not has_function_privilege('hcs_hyperdrive','app.register_session_summary_json(uuid,uuid)','execute'), 'API login cannot call the summary helper directly');

insert into auth.users (id,email,aud,role,email_confirmed_at) values ('1c000000-0000-4000-8000-000000000001','pos-close-owner@example.invalid','authenticated','authenticated',now());
insert into app.tenants (id,slug,name) values ('2c000000-0000-4000-8000-000000000001','pos-close-test','POS Sale Test');
insert into app.tenant_memberships (tenant_id,user_id,status,is_owner,joined_at) values ('2c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','active',true,now());
insert into app.locations (id,tenant_id,code,name) values ('3c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','MAIN','Main Store');
insert into app.employees (id,tenant_id,employee_code,display_name) values ('4c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.employee_locations (tenant_id,employee_id,location_id) values ('2c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001');
insert into app.employee_roles (tenant_id,employee_id,role_id) select '2c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001',id from app.roles where tenant_id='2c000000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers (id,tenant_id,location_id,name,code) values ('5c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.pos_devices (id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values ('6c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','Test POS','active',repeat('a',64),now(),'1c000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions (tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values ('2c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '1 hour');
insert into app.products (id,tenant_id,name,created_by) values ('7c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','Triple Black','1c000000-0000-4000-8000-000000000001');
insert into app.product_variants (id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values ('8c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001','Small','TB-S',899.00,450.00,'1c000000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id,location_id,variant_id,on_hand,average_unit_cost) values ('2c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','8c000000-0000-4000-8000-000000000001',10.000,450.00);
-- A second cashier signed in on the same register.
insert into app.employees (id,tenant_id,employee_code,display_name) values ('4c000000-0000-4000-8000-000000000002','2c000000-0000-4000-8000-000000000001','CASH-2','Cashier Two');
insert into app.employee_locations (tenant_id,employee_id,location_id) values ('2c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000002','3c000000-0000-4000-8000-000000000001');
insert into app.employee_roles (tenant_id,employee_id,role_id) select '2c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000002',id from app.roles where tenant_id='2c000000-0000-4000-8000-000000000001' and code='cashier';
insert into app.pos_employee_sessions (tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values ('2c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000002',repeat('e',64),now()+interval '1 hour');

select throws_ok($$select app.close_pos_register_session(repeat('b',64),0,null,'close-before-open','h0','r0')$$,'HCRG2',null,'a register that is not open cannot be closed');
select lives_ok($$select app.open_pos_register_session(repeat('b',64),100000,'close-test-open','open-hash','open-request')$$,'cashier one opens with 1,000');
select lives_ok($$select app.complete_pos_sale_with_customer(repeat('b',64),
  jsonb_build_array(jsonb_build_object('variantId','8c000000-0000-4000-8000-000000000001','quantityMilli',2000)),
  jsonb_build_array(
    jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='2c000000-0000-4000-8000-000000000001' and code='cash'),'amountCentavos',129800,'tenderedCentavos',130000),
    jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='2c000000-0000-4000-8000-000000000001' and code='e_wallet'),'amountCentavos',50000,'tenderedCentavos',50000)),
  null,'close-test-sale','sale-hash','sale-request')$$,'a split sale of 1,298 cash and 500 e-wallet');

select throws_ok($$select app.close_pos_register_session(repeat('e',64),229800,null,'close-other','h1','r1')$$,'HCRG3',null,'another cashier cannot close the register');
select throws_ok($$select app.close_pos_register_session(repeat('b',64),-1,null,'close-negative','h2','r2')$$,'HCRG1',null,'negative counted cash is refused');
select throws_ok($$select app.close_pos_register_session(repeat('b',64),100,repeat('x',501),'close-long-note','h3','r3')$$,'HCRG1',null,'a note longer than 500 characters is refused');

select is(app.close_pos_register_session(repeat('b',64),225000,'Short ₱48; gave wrong change','close-short','h4','r4')->>'status','exception','a short drawer still closes, as an exception');
select is((select (variance, expected_cash, counted_cash, closed_by_employee_id::text, close_note)::text from app.register_sessions where tenant_id='2c000000-0000-4000-8000-000000000001'),
  '(-48.00,2298.00,2250.00,4c000000-0000-4000-8000-000000000001,"Short ₱48; gave wrong change")','expected, counted, variance, closer, and note are kept');
select is((select (amount, reason, actor_employee_id::text)::text from app.cash_movements where tenant_id='2c000000-0000-4000-8000-000000000001' and movement_type='close_variance'),
  '(-48.00,"Short ₱48; gave wrong change",4c000000-0000-4000-8000-000000000001)','the variance is a cash movement with the cashier''s note');
select is((select response_body->'cash' from app.idempotency_records where tenant_id='2c000000-0000-4000-8000-000000000001' and operation='pos-register.close'),
  '{"otherCentavos": 0, "salesCentavos": 129800, "openingCentavos": 100000, "refundsCentavos": 0}'::jsonb,'the summary splits opening cash and cash sales');
select is((select response_body->'nonCash' from app.idempotency_records where tenant_id='2c000000-0000-4000-8000-000000000001' and operation='pos-register.close'),
  '[{"method": "E-wallet", "amountCentavos": 50000}]'::jsonb,'the summary lists non-cash payments by method');
select is((select (response_body->>'salesCount')::integer from app.idempotency_records where tenant_id='2c000000-0000-4000-8000-000000000001' and operation='pos-register.close'),1,'the summary counts the sales');
select is(app.close_pos_register_session(repeat('b',64),225000,'Short ₱48; gave wrong change','close-short','h4','r4-retry')->>'varianceCentavos','-4800','a retry returns the stored result');
select is((select count(*)::integer from app.cash_movements where tenant_id='2c000000-0000-4000-8000-000000000001' and movement_type='close_variance'),1,'a retry records no second variance');
select is((select count(*)::integer from audit.audit_events where tenant_id='2c000000-0000-4000-8000-000000000001' and action='register.closed' and actor_type='pos_employee'),1,'the close is audited as the cashier');

select lives_ok($$select app.open_pos_register_session(repeat('b',64),50000,'close-test-open-2','open-hash-2','open-request-2')$$,'the register opens again');
select is(app.close_pos_register_session(repeat('b',64),50000,'  ','close-exact','h5','r5')->>'status','closed','an exact count closes cleanly with no note');

select * from finish();
rollback;
