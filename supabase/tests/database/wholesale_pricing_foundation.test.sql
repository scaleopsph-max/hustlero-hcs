begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('app','pricing_groups','pricing groups table exists');
select has_table('app','price_lists','price lists table exists');
select has_table('app','price_list_entries','price list entries table exists');
select has_table('app','customer_price_list_assignments','customer assignments table exists');
select has_column('app','sales','pricing_type','sales snapshot pricing type');
select has_column('app','sales','price_list_id','sales snapshot price list');
select has_function('app','load_pricing_context',array['uuid','uuid'],'protected pricing context exists');
select has_function('app','upsert_price_list',array['uuid','uuid','jsonb','text','text','text'],'protected pricing command exists');
select has_function('app','load_pos_pricing_options',array['text'],'POS pricing resolver context exists');
select has_function('app','complete_pos_priced_sale',array['text','jsonb','jsonb','uuid','text','text','text','text'],'server-authoritative priced sale command exists');
select ok(not has_table_privilege('hcs_hyperdrive','app.price_lists','select'),'API login cannot read price lists directly');
select ok(has_function_privilege('hcs_hyperdrive','app.load_pricing_context(uuid,uuid)','execute'),'API login can execute pricing context');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('11000000-0000-4000-8000-000000000001','pricing-a@example.invalid','authenticated','authenticated',now()),
('11000000-0000-4000-8000-000000000002','pricing-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
('21000000-0000-4000-8000-000000000001','pricing-a','Pricing A'),
('21000000-0000-4000-8000-000000000002','pricing-b','Pricing B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','active',true,now()),
('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','active',true,now());
insert into app.products(id,tenant_id,name,created_by) values
('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Core Shirt','11000000-0000-4000-8000-000000000001'),
('31000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','Other Shirt','11000000-0000-4000-8000-000000000002');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
('41000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','Black / XL','CORE-XL',999,500,'11000000-0000-4000-8000-000000000001'),
('41000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','White / XL','OTHER-XL',899,400,'11000000-0000-4000-8000-000000000002');

select lives_ok($$
  select app.upsert_price_list(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    jsonb_build_object('code','WHOLESALE','name','Wholesale','pricingType','wholesale','isDefault',true,'isActive',true,
      'pricingGroup',jsonb_build_object('code','CORE','name','Core products','thresholdMilli',6000),
      'customerIds','[]'::jsonb,'entries',jsonb_build_array(jsonb_build_object('variantId','41000000-0000-4000-8000-000000000001','unitPriceMinor',75000))),
    'pricing-upsert-001','hash-1','request-1')
$$,'owner creates a wholesale price list');
select is((select count(*)::integer from app.price_lists where tenant_id='21000000-0000-4000-8000-000000000001'),1,'one tenant price list exists');
select is((select round(threshold_quantity*1000)::bigint from app.pricing_groups where tenant_id='21000000-0000-4000-8000-000000000001'),6000::bigint,'group threshold is exact integer thousandths');
select is(jsonb_array_length(app.load_pricing_context('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001')->'priceLists'),1,'pricing context returns tenant list');
select is((select count(*)::integer from app.price_lists where tenant_id='21000000-0000-4000-8000-000000000001' and is_default),1,'one active default list exists');
select lives_ok($$
  select app.upsert_price_list(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    jsonb_build_object('code','WHOLESALE','name','Wholesale','pricingType','wholesale','isDefault',true,'isActive',true,
      'pricingGroup',jsonb_build_object('code','CORE','name','Core products','thresholdMilli',6000),
      'customerIds','[]'::jsonb,'entries',jsonb_build_array(jsonb_build_object('variantId','41000000-0000-4000-8000-000000000001','unitPriceMinor',75000))),
    'pricing-upsert-001','hash-1','retry-1')
$$,'identical command retry is accepted');
select is((select count(*)::integer from app.price_list_entries where tenant_id='21000000-0000-4000-8000-000000000001'),1,'idempotent retry creates no duplicate entry');
select is(jsonb_array_length(app.load_pricing_context('11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002')->'priceLists'),0,'other tenant sees no price lists');
select throws_ok($$
  select app.upsert_price_list(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    jsonb_build_object('code','DEALER','name','Dealer','pricingType','dealer','isDefault',true,'isActive',true,
      'pricingGroup',jsonb_build_object('code','DEALER','name','Dealer products','thresholdMilli',12000),
      'customerIds','[]'::jsonb,'entries',jsonb_build_array(jsonb_build_object('variantId','41000000-0000-4000-8000-000000000002','unitPriceMinor',65000))),
    'pricing-upsert-002','hash-2','request-2')
$$,'HCSP3','A price list variant is unavailable','cross-tenant variant assignment is rejected');

select * from finish();
rollback;
