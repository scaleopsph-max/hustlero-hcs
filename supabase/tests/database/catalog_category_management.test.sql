begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('16000000-0000-4000-8000-000000000001','category-owner@example.invalid','authenticated','authenticated',now()),
 ('16000000-0000-4000-8000-000000000002','category-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
 ('26000000-0000-4000-8000-000000000001','category-manager-one','Category One'),
 ('26000000-0000-4000-8000-000000000002','category-manager-two','Category Two');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('26000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','active',true,now()),
 ('26000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000002','active',false,now());
create function pg_temp.category(p_body jsonb,p_key text,p_actor uuid default '16000000-0000-4000-8000-000000000001',p_tenant uuid default '26000000-0000-4000-8000-000000000001')
returns jsonb language sql as $$select app.manage_catalog_category(p_actor,p_tenant,p_body,p_key,md5(p_body::text),'category-test')$$;
create temp table category_state as select pg_temp.category('{"action":"create","name":" Shoes "}','category-create-key-001') result;
select is((select result->>'name' from category_state),'Shoes','category name is trimmed');
select is((select result->>'status' from category_state),'active','created category is active');
select is(pg_temp.category('{"action":"create","name":" Shoes "}','category-create-key-001'),(select result from category_state),'same command replays exact original response');
select is((select count(*)::integer from app.product_categories where tenant_id='26000000-0000-4000-8000-000000000001'),1,'replay creates no duplicate');
select throws_ok($$select pg_temp.category('{"action":"create","name":"shoes"}','category-duplicate-001')$$,'23505',null,'normalized duplicate rejected');
select throws_ok($$select pg_temp.category('{"action":"create","name":"Other"}','category-create-key-001')$$,'HCS08','Request key conflict','changed body cannot reuse key');
select throws_ok($$select pg_temp.category('{"action":"create","name":"Other"}','category-no-access-01','16000000-0000-4000-8000-000000000002')$$,'HCS09','Catalog access denied','plain member cannot create');
select throws_ok($$select pg_temp.category('{"action":"create","name":"Other"}','category-foreign-001','16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000002')$$,'HCS09','Catalog access denied','foreign tenant denied');
select is((app.load_catalog_categories('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001')->>'canManage')::boolean,true,'owner may manage');
select is(jsonb_array_length(app.load_catalog_categories('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001')->'categories'),1,'authorized list matches tenant');
select ok(not has_function_privilege('anon','app.manage_catalog_category(uuid,uuid,jsonb,text,text,text)','execute'),'anonymous cannot call category command');
select ok(not has_function_privilege('authenticated','app.load_catalog_categories(uuid,uuid)','execute'),'browser role cannot load private categories directly');
select ok(not has_table_privilege('hcs_hyperdrive','app.product_categories','insert'),'API cannot bypass category commands');
select ok(not has_function_privilege('hcs_hyperdrive','app.create_catalog_product(uuid,uuid,text,text,text,text,text,numeric,numeric,boolean,text[],text,text,text)','execute'),'API cannot invoke implicit category creation core');
select ok(not has_function_privilege('hcs_hyperdrive','app.update_catalog_product(uuid,uuid,uuid,text,text,text,text,text,text)','execute'),'API cannot invoke implicit category update core');

create temp table category_product as select app.create_catalog_product_selected_category(
 '16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001',
 jsonb_build_object('name','Shoes A','categoryId',(select result->>'categoryId' from category_state),'variantName','Size 8','sku','CATEGORY-SHOE-8','retailPriceMinor',49900,'unitCostMinor',20000,'trackInventory',true,'barcodes',jsonb_build_array()),
 'category-product-001','product-hash-001','product-request') result;
select is((select category_id::text from app.products where id=(select (result->>'productId')::uuid from category_product)),(select result->>'categoryId' from category_state),'product binds to selected category ID');
select is((select retail_price from app.product_variants where id=(select (result->>'variantId')::uuid from category_product)),499::numeric,'exact minor-unit conversion retained');
select throws_ok($$select pg_temp.category(jsonb_build_object('action','archive','categoryId',(select result->>'categoryId' from category_state)),'category-archive-used')$$,'HCCT2','Category has product or pricing references','cannot archive referenced category');
select lives_ok($$select pg_temp.category(jsonb_build_object('action','rename','categoryId',(select result->>'categoryId' from category_state),'name','Footwear'),'category-rename-001')$$,'rename succeeds');
select is((select category_id::text from app.products where id=(select (result->>'productId')::uuid from category_product)),(select result->>'categoryId' from category_state),'rename preserves product category identity');
select is((select count(*)::integer from app.product_categories where tenant_id='26000000-0000-4000-8000-000000000001'),1,'rename does not clone a category');
select throws_ok($$select app.create_catalog_product_selected_category('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001','{"name":"Other","categoryName":"Unknown","variantName":"Default","sku":"OTHER-001","retailPriceMinor":100,"unitCostMinor":null,"trackInventory":false,"barcodes":[]}','category-unknown-001','unknown-hash','unknown-request')$$,'HCS11','Select an existing active category','legacy free text cannot create an unknown category');
select throws_ok($$select app.create_catalog_product_selected_category('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001','{"categoryId":"36000000-0000-4000-8000-000000000009"}','category-bad-id-001','unknown-hash','unknown-request')$$,'HCS11','Select an existing active category','unknown category ID rejected before product writes');

create temp table unused_category as select pg_temp.category('{"action":"create","name":"Unused"}','category-unused-001') result;
select lives_ok($$select pg_temp.category(jsonb_build_object('action','archive','categoryId',(select result->>'categoryId' from unused_category)),'category-archive-001')$$,'unreferenced category archives');
select is((select status from app.product_categories where id=(select (result->>'categoryId')::uuid from unused_category)),'archived','archive preserves category row');
select throws_ok($$select pg_temp.category(jsonb_build_object('action','rename','categoryId',(select result->>'categoryId' from unused_category),'name','Changed'),'category-archived-rename')$$,'HCCT1','Category is archived','archived category cannot be renamed');
create temp table bound_category as select pg_temp.category('{"action":"create","name":"Bound"}','category-bound-001') result;
insert into app.pricing_groups(tenant_id,code,name,threshold_quantity,category_id) values('26000000-0000-4000-8000-000000000001','BOUND','Bound',10,(select (result->>'categoryId')::uuid from bound_category));
select throws_ok($$select pg_temp.category(jsonb_build_object('action','archive','categoryId',(select result->>'categoryId' from bound_category)),'category-bound-archive')$$,'HCCT2','Category has product or pricing references','pricing binding blocks archival');
select throws_ok($$update app.pricing_groups set category_id=(select (result->>'categoryId')::uuid from unused_category) where tenant_id='26000000-0000-4000-8000-000000000001'$$,'HCS11','Select an active category','pricing cannot bind archived category');
select is((select count(*)::integer from audit.audit_events where tenant_id='26000000-0000-4000-8000-000000000001' and action='catalog.category.create'),3,'only successful creates are audited once');
select is((select count(*)::integer from integration.event_outbox where tenant_id='26000000-0000-4000-8000-000000000001' and topic='catalog.category.create'),3,'only successful creates emit events once');
update app.tenants set status='suspended' where id='26000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.category('{"action":"create","name":" Shoes "}','category-create-key-001')$$,'HCS09','Catalog access denied','suspension also denies historical replay');
select * from finish();
rollback;
