begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

select has_table('app', 'sales', 'sales table exists');
select has_table('app', 'sale_lines', 'sale lines table exists');
select has_table('app', 'sale_payments', 'sale payments table exists');
select has_function('app', 'complete_pos_cash_sale', array['text','jsonb','bigint','text','text','text'], 'atomic POS sale command exists');
select has_function('app', 'complete_pos_sale', array['text','jsonb','jsonb','text','text','text'], 'atomic multi-tender POS sale command exists');
select has_function('app', 'complete_pos_sale_with_customer', array['text','jsonb','jsonb','uuid','text','text','text'], 'customer-aware multi-tender sale command exists');
select ok(not has_function_privilege('hcs_hyperdrive','app.complete_pos_cash_sale(text,jsonb,bigint,text,text,text)','execute'), 'API login cannot bypass the customer-aware POS command and cutover gate');
select ok(not has_function_privilege('hcs_hyperdrive','app.complete_pos_sale(text,jsonb,jsonb,text,text,text)','execute'), 'API login cannot bypass the customer-aware multi-tender command');
select ok(has_function_privilege('hcs_hyperdrive','app.complete_pos_sale_with_customer(text,jsonb,jsonb,uuid,text,text,text)','execute'), 'API login may execute only the customer-aware multi-tender command');
select ok(not has_table_privilege('hcs_hyperdrive','app.sales','select'), 'API login cannot read sales directly');

insert into auth.users (id,email,aud,role,email_confirmed_at) values ('19000000-0000-4000-8000-000000000001','pos-sale-owner@example.invalid','authenticated','authenticated',now());
insert into app.tenants (id,slug,name) values ('29000000-0000-4000-8000-000000000001','pos-sale-test','POS Sale Test');
insert into app.tenant_memberships (tenant_id,user_id,status,is_owner,joined_at) values ('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','active',true,now());
insert into app.locations (id,tenant_id,code,name) values ('39000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','MAIN','Main Store');
insert into app.employees (id,tenant_id,employee_code,display_name) values ('49000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.employee_locations (tenant_id,employee_id,location_id) values ('29000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001');
insert into app.employee_roles (tenant_id,employee_id,role_id) select '29000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001',id from app.roles where tenant_id='29000000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers (id,tenant_id,location_id,name,code) values ('59000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.pos_devices (id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values ('69000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','Test POS','active',repeat('a',64),now(),'19000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions (tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values ('29000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '1 hour');
insert into app.products (id,tenant_id,name,created_by) values ('79000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','Triple Black','19000000-0000-4000-8000-000000000001');
insert into app.product_variants (id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values ('89000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001','Small','TB-S',899.00,450.00,'19000000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id,location_id,variant_id,on_hand,average_unit_cost) values ('29000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000001',10.000,450.00);

select lives_ok($$select app.open_pos_register_session(repeat('b',64),100000,'test-register-open','open-hash','open-request')$$, 'cashier opens assigned register');
select lives_ok($$select app.complete_pos_cash_sale(repeat('b',64),jsonb_build_array(jsonb_build_object('variantId','89000000-0000-4000-8000-000000000001','quantityMilli',2000)),200000,'test-sale-001','sale-hash','sale-request')$$, 'cash sale completes atomically');
select is((select count(*)::integer from app.sales),1,'one sale is recorded');
select is((select receipt_number from app.sales),'MAIN-'||to_char((now() at time zone 'Asia/Manila')::date,'YYYYMMDD')||'-000001','branch daily receipt number is generated');
select is((select total from app.sales),1798.00::numeric,'total uses the server variant price');
select is((select quantity from app.sale_lines),2.000::numeric,'sale line stores exact quantity');
select is((select tendered_amount from app.sale_payments),2000.00::numeric,'payment stores cash tendered');
select is((select change_amount from app.sale_payments),202.00::numeric,'payment stores change');
select is((select on_hand from app.inventory_balances),8.000::numeric,'inventory balance is decremented');
select is((select count(*)::integer from app.inventory_movements where movement_type='SALE'),1,'sale appends one inventory movement');
select is((select count(*)::integer from app.cash_movements where movement_type='cash_sale'),1,'sale appends one cash movement');
select is((select count(*)::integer from audit.audit_events where action='sale.completed'),1,'sale completion is audited');
select is((select count(*)::integer from integration.event_outbox where topic='sale.completed'),1,'sale completion emits an outbox event');
select lives_ok($$select app.complete_pos_cash_sale(repeat('b',64),jsonb_build_array(jsonb_build_object('variantId','89000000-0000-4000-8000-000000000001','quantityMilli',2000)),200000,'test-sale-001','sale-hash','sale-retry')$$, 'identical retry returns stored response');
select is((select count(*)::integer from app.sales),1,'idempotent retry creates no second sale');
select throws_ok($$select app.complete_pos_cash_sale(repeat('b',64),jsonb_build_array(jsonb_build_object('variantId','89000000-0000-4000-8000-000000000001','quantityMilli',9000)),900000,'test-sale-002','stock-hash','stock-request')$$,'HCS98','Insufficient available stock','insufficient stock rolls back the sale');
select is((select count(*)::integer from app.sales),1,'failed stock check leaves sale count unchanged');

select lives_ok($$
  select app.complete_pos_sale_with_customer(
    repeat('b',64),
    jsonb_build_array(jsonb_build_object('variantId','89000000-0000-4000-8000-000000000001','quantityMilli',1000)),
    jsonb_build_array(
      jsonb_build_object(
        'paymentMethodId',(select id from app.payment_methods where tenant_id='29000000-0000-4000-8000-000000000001' and code='cash'),
        'amountCentavos',40000,
        'tenderedCentavos',50000
      ),
      jsonb_build_object(
        'paymentMethodId',(select id from app.payment_methods where tenant_id='29000000-0000-4000-8000-000000000001' and code='e_wallet'),
        'amountCentavos',49900,
        'tenderedCentavos',49900
      )
    ),
    null,
    'test-split-sale-001',
    'split-sale-hash',
    'split-sale-request'
  )
$$, 'split cash and e-wallet sale completes atomically');
select is((select count(*)::integer from app.sales),2,'split sale creates one additional sale');
select is((select count(*)::integer from app.sale_payments),3,'split sale stores one row per payment method');
select is(
  (select amount from app.sale_payments payment join app.payment_methods method on method.tenant_id=payment.tenant_id and method.id=payment.payment_method_id where payment.sale_id=(select sale_id from app.sale_payments group by sale_id having count(*)=2) and method.code='cash'),
  400.00::numeric,
  'split sale stores the allocated cash amount'
);
select is(
  (select change_amount from app.sale_payments payment join app.payment_methods method on method.tenant_id=payment.tenant_id and method.id=payment.payment_method_id where payment.sale_id=(select sale_id from app.sale_payments group by sale_id having count(*)=2) and method.code='cash'),
  100.00::numeric,
  'split sale stores change only on the cash payment'
);
select is((select count(*)::integer from app.cash_movements where movement_type='cash_sale'),2,'non-cash split portion creates no cash movement');
select is(
  (app.load_sale_receipt_with_customer('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select sale_id from app.sale_payments group by sale_id having count(*)=2))->>'canReverse')::boolean,
  false,
  'split receipt does not offer an unsafe cash-only reversal'
);
select is(
  app.load_sale_receipt_with_customer('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select sale_id from app.sale_payments group by sale_id having count(*)=2))->>'reversalBlockedReason',
  'Split and non-cash refunds require a dedicated payment return flow.',
  'split receipt explains why reversal is unavailable'
);
select lives_ok($$
  select app.complete_pos_sale_with_customer(
    repeat('b',64),
    jsonb_build_array(jsonb_build_object('variantId','89000000-0000-4000-8000-000000000001','quantityMilli',1000)),
    jsonb_build_array(
      jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='29000000-0000-4000-8000-000000000001' and code='cash'),'amountCentavos',40000,'tenderedCentavos',50000),
      jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='29000000-0000-4000-8000-000000000001' and code='e_wallet'),'amountCentavos',49900,'tenderedCentavos',49900)
    ),
    null,
    'test-split-sale-001',
    'split-sale-hash',
    'split-sale-retry'
  )
$$, 'split sale retry returns the stored response');
select is((select count(*)::integer from app.sales),2,'split sale retry creates no duplicate sale');
select throws_ok($$
  select app.complete_pos_sale_with_customer(
    repeat('b',64),
    jsonb_build_array(jsonb_build_object('variantId','89000000-0000-4000-8000-000000000001','quantityMilli',1000)),
    jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='29000000-0000-4000-8000-000000000001' and code='e_wallet'),'amountCentavos',50000,'tenderedCentavos',50000)),
    null,
    'test-split-sale-002',
    'bad-split-hash',
    'bad-split-request'
  )
$$,'HCS99','Payment allocation must equal the sale total','underallocated split payment rolls back the sale');
select is((select count(*)::integer from app.sales),2,'invalid payment allocation leaves sale count unchanged');

select * from finish();
rollback;
