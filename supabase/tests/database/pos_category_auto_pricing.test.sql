begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1d000000-0000-4000-8000-000000000001', 'priced-sale-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1d000000-0000-4000-8000-000000000002', 'priced-sale-b@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2d000000-0000-4000-8000-000000000001', 'priced-sale-a', 'Priced Sale A'),
  ('2d000000-0000-4000-8000-000000000002', 'priced-sale-b', 'Priced Sale B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000002', 'active', true, now());

select lives_ok($$
  select app.create_customer(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    'Reseller A', 'reseller-a@example.invalid', null, null, 'reseller', false, false,
    'priced-customer-a', 'customer-a-hash', 'customer-a-request'
  )
$$, 'tenant A reseller is created');
select lives_ok($$
  select app.create_customer(
    '1d000000-0000-4000-8000-000000000002', '2d000000-0000-4000-8000-000000000002',
    'Reseller B', 'reseller-b@example.invalid', null, null, 'reseller', false, false,
    'priced-customer-b', 'customer-b-hash', 'customer-b-request'
  )
$$, 'tenant B reseller is created');

insert into app.locations (id, tenant_id, code, name) values
  ('3d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store');
insert into app.employees (id, tenant_id, employee_code, display_name) values
  ('4d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'CASH-1', 'Cashier One');
insert into app.employee_locations (tenant_id, employee_id, location_id) values
  ('2d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001');
insert into app.employee_roles (tenant_id, employee_id, role_id)
select '2d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', id
from app.roles where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cashier';
insert into app.registers (id, tenant_id, location_id, name, code) values
  ('5d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000001', 'Register 1', 'REG-1');
insert into app.pos_devices (
  id, tenant_id, register_id, location_id, name, status, token_hash, activated_at, created_by_user_id
) values (
  '6d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
  '5d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  'Priced Sale POS', 'active', repeat('a', 64), now(), '1d000000-0000-4000-8000-000000000001'
);
insert into app.pos_employee_sessions (
  tenant_id, device_id, register_id, location_id, employee_id, token_hash, expires_at
) values (
  '2d000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001',
  '5d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  '4d000000-0000-4000-8000-000000000001', repeat('b', 64), now() + interval '1 hour'
);
insert into app.products (id, tenant_id, name, created_by) values
  ('7d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   'Shared Stock Shirt', '1d000000-0000-4000-8000-000000000001');
insert into app.product_variants (
  id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by
) values (
  '8d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
  '7d000000-0000-4000-8000-000000000001', 'Black / XL', 'SHARED-XL', 899.00, 450.00,
  '1d000000-0000-4000-8000-000000000001'
);
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, average_unit_cost) values
  ('2d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
   '8d000000-0000-4000-8000-000000000001', 100.000, 450.00);

select lives_ok($$
  select app.upsert_price_list(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'WHOLESALE', 'name', 'Wholesale', 'pricingType', 'wholesale', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'WHOLESALE-GROUP', 'name', 'Wholesale group', 'thresholdMilli', 6000),
      'customerIds', jsonb_build_array((select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001')),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'unitPriceMinor', 75000))
    ),
    'priced-list-wholesale', 'list-wholesale-hash', 'list-wholesale-request'
  )
$$, 'wholesale list is configured');
select lives_ok($$
  select app.upsert_price_list(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'DEALER', 'name', 'Dealer', 'pricingType', 'dealer', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'DEALER-GROUP', 'name', 'Dealer group', 'thresholdMilli', 12000),
      'customerIds', jsonb_build_array((select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001')),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'unitPriceMinor', 60000))
    ),
    'priced-list-dealer', 'list-dealer-hash', 'list-dealer-request'
  )
$$, 'dealer list is configured');
select lives_ok($$
  select app.open_pos_register_session(repeat('b', 64), 100000, 'priced-register-open', 'open-hash', 'open-request')
$$, 'cashier opens the shared-stock register');


insert into app.product_categories(id,tenant_id,name,created_by) values
 ('9d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','Shoes','1d000000-0000-4000-8000-000000000001'),
 ('9d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','Socks','1d000000-0000-4000-8000-000000000001'),
 ('9d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000002','Foreign','1d000000-0000-4000-8000-000000000002');
update app.products set category_id='9d000000-0000-4000-8000-000000000001' where id='7d000000-0000-4000-8000-000000000001';
insert into app.products(id,tenant_id,name,category_id,created_by) values
 ('7d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','Other Shoe','9d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001'),
 ('7d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','Sock','9d000000-0000-4000-8000-000000000002','1d000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
 ('8d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000001','Large','SHOE-L',899,450,'1d000000-0000-4000-8000-000000000001'),
 ('8d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000002','Small','SHOE-OTHER',1000,450,'1d000000-0000-4000-8000-000000000001'),
 ('8d000000-0000-4000-8000-000000000004','2d000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000003','One','SOCK',100,40,'1d000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost)
 select tenant_id,'3d000000-0000-4000-8000-000000000001',id,100,unit_cost from app.product_variants
 where tenant_id='2d000000-0000-4000-8000-000000000001' and id<>'8d000000-0000-4000-8000-000000000001';
create function pg_temp.category_config(p_category uuid,p_key text) returns jsonb language sql as $$
 select app.upsert_price_list('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',
 jsonb_build_object('id',(select id from app.price_lists where tenant_id='2d000000-0000-4000-8000-000000000001' and code='WHOLESALE'),
 'code','WHOLESALE','name','Wholesale','pricingType','wholesale','isDefault',true,'isActive',true,
 'pricingGroup',jsonb_build_object('code','WHOLESALE-GROUP','name','Shoes','thresholdMilli',10000,'categoryId',p_category),
 'entries',jsonb_build_array(
 jsonb_build_object('variantId','8d000000-0000-4000-8000-000000000001','unitPriceMinor',75000),
 jsonb_build_object('variantId','8d000000-0000-4000-8000-000000000002','unitPriceMinor',65000),
 jsonb_build_object('variantId','8d000000-0000-4000-8000-000000000004','unitPriceMinor',5000))),
 p_key,p_key,'category-config');
$$;
select throws_ok($$select pg_temp.category_config('9d000000-0000-4000-8000-000000000003','foreign-category-key')$$,
 'HCSP1','Choose a valid pricing category','foreign tenant category rejected atomically');
select is((select count(*)::int from app.idempotency_records where idempotency_key='foreign-category-key'),0,'failed configuration retains no idempotency record');
select lives_ok($$select pg_temp.category_config('9d000000-0000-4000-8000-000000000001','category-config-key')$$,'explicit own category binding saves');
select is(app.load_pricing_context('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001')->'variants'->0->>'categoryId',
 '9d000000-0000-4000-8000-000000000001','Back Office projects explicit category IDs');
select ok(exists(select 1 from jsonb_array_elements(app.load_pos_sales_context(repeat('b',64))->'items') item
 where item->>'categoryId'='9d000000-0000-4000-8000-000000000001'),'POS projects real category IDs');
select ok(exists(select 1 from jsonb_array_elements(app.load_pos_pricing_options(repeat('b',64))) item
 where item->>'categoryId'='9d000000-0000-4000-8000-000000000001'),'POS pricing options expose configured category binding');
create function pg_temp.auto_sale(q1 bigint,q2 bigint,q3 bigint,q4 bigint,amount bigint,p_key text,buyer boolean default true,p_mode text default 'auto')
returns jsonb language sql as $$
 select app.complete_pos_priced_sale(repeat('b',64),
 (select jsonb_agg(jsonb_build_object('variantId',('8d000000-0000-4000-8000-00000000000'||n)::uuid,'quantityMilli',q) order by n)
 from (values (1,q1),(2,q2),(3,q3),(4,q4)) items(n,q) where q>0),
 jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='2d000000-0000-4000-8000-000000000001' and code='cash'),
 'amountCentavos',amount,'tenderedCentavos',amount)),
 case when buyer then (select id from app.customers where tenant_id='2d000000-0000-4000-8000-000000000001') else null end,
 p_mode,p_key,p_key,'auto-sale');
$$;
create temporary table category_results(kind text primary key,result jsonb);
insert into category_results values ('cross-category',pg_temp.auto_sale(9000,0,0,1000,819100,'auto-cross-category',false));
select is((select total from app.sales where id=(select (result->>'saleId')::uuid from category_results where kind='cross-category')),8191.00::numeric,'nine shoes plus a sock remain retail');
select is((select pricing_type from app.sales where id=(select (result->>'saleId')::uuid from category_results where kind='cross-category')),'retail','Auto does not mislabel retail-only receipt');
insert into category_results values ('sizes',pg_temp.auto_sale(4000,6000,0,0,690000,'auto-mixed-sizes'));
select is((select result->>'pricingType' from category_results where kind='sizes'),'wholesale','same-category mixed sizes qualify automatically');
select is((select total from app.sales where id=(select (result->>'saleId')::uuid from category_results where kind='sizes')),6900.00::numeric,'four at 750 plus six at 650 equals 6900');
select is((select sum(line_total) from app.sale_lines where sale_id=(select (result->>'saleId')::uuid from category_results where kind='sizes')),6900.00::numeric,'snapshotted lines reconcile to receipt');
insert into category_results values ('fallback',pg_temp.auto_sale(9000,0,1000,0,775000,'auto-retail-fallback'));
select is((select total from app.sales where id=(select (result->>'saleId')::uuid from category_results where kind='fallback')),7750.00::numeric,'nine priced plus one unpriced count ten and retain unpriced retail');
select is((select pricing_type from app.sale_lines where variant_id='8d000000-0000-4000-8000-000000000003' and sale_id=(select (result->>'saleId')::uuid from category_results where kind='fallback')),'retail','fallback line is not labeled wholesale');
select is((select pricing_quantity from app.sale_lines where variant_id='8d000000-0000-4000-8000-000000000001' and sale_id=(select (result->>'saleId')::uuid from category_results where kind='fallback')),10.000::numeric,'qualification snapshot includes the unpriced unit');
select is((select pricing_threshold_quantity from app.sale_lines where variant_id='8d000000-0000-4000-8000-000000000001' and sale_id=(select (result->>'saleId')::uuid from category_results where kind='fallback')),10.000::numeric,'threshold is snapshotted, not looked up later');
select throws_ok($$select pg_temp.auto_sale(10000,0,0,0,750000,'auto-missing-reseller',false)$$,'HCSW1',
 'An active reseller customer is required for wholesale or dealer pricing','qualified category requires active reseller');
select is((select count(*)::int from app.sales where tenant_id='2d000000-0000-4000-8000-000000000001'),3,'denied missing reseller posts no receipt');
insert into category_results values ('fraction',pg_temp.auto_sale(9999,0,0,0,898910,'auto-fraction',false));
select is((select result->>'pricingType' from category_results where kind='fraction'),'retail','9.999 units do not round up to MOQ');
select is((select total from app.sales where id=(select (result->>'saleId')::uuid from category_results where kind='fraction')),8989.10::numeric,'fractional quantity rounds once to exact cents');
insert into category_results values ('forced-retail',pg_temp.auto_sale(10000,0,0,0,899000,'auto-forced-retail',true,'retail'));
select is((select result->>'pricingType' from category_results where kind='forced-retail'),'retail','explicit retail override remains manual');
select is((select on_hand from app.inventory_balances where variant_id='8d000000-0000-4000-8000-000000000001'),58.001::numeric,'retail and auto deduct exactly the same shared inventory');
select is((app.load_sale_archive_record('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',
 (select (result->>'saleId')::uuid from category_results where kind='fallback'))->'lines'->0->>'pricingBasis'),'category','receipt exposes stored pricing decision');
create temporary table category_before as select
 (select count(*) from app.sales) sales,(select count(*) from app.inventory_movements) movements,
 (select count(*) from app.sale_payments) payments,(select count(*) from audit.audit_events) audits;
update app.pricing_groups set threshold_quantity=20 where tenant_id='2d000000-0000-4000-8000-000000000001' and code='WHOLESALE-GROUP';
select is(pg_temp.auto_sale(9000,0,1000,0,775000,'auto-retail-fallback'),(select result from category_results where kind='fallback'),
 'same-key retry returns original result after pricing configuration changes');
select is((select count(*) from app.sales),(select sales from category_before),'retry creates no sale');
select is((select count(*) from app.inventory_movements),(select movements from category_before),'retry creates no stock movement');
select is((select count(*) from app.sale_payments),(select payments from category_before),'retry creates no payment');
select is((select count(*) from audit.audit_events),(select audits from category_before),'retry creates no audit duplicate');
select is((select pricing_threshold_quantity from app.sale_lines where variant_id='8d000000-0000-4000-8000-000000000001' and sale_id=(select (result->>'saleId')::uuid from category_results where kind='fallback')),10.000::numeric,
 'historical threshold remains ten after settings change');
select ok(not has_function_privilege('hcs_hyperdrive','app.complete_pos_priced_sale_reference_core(text,jsonb,jsonb,uuid,text,text,text,text)','execute'),'category core cannot bypass payment references');
select * from finish();
rollback;
