begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.import_snapshot(p_actor uuid,p_tenant uuid) returns jsonb language sql as $$
 select app.load_catalog_import_snapshot(p_actor,p_tenant,array['IMPORT-OLD-8'],array[]::text[],array['shoes','archived','foreign secret category'])
$$;
insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('17000000-0000-4000-8000-000000000001','import-owner@example.invalid','authenticated','authenticated',now()),
 ('17000000-0000-4000-8000-000000000002','import-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
 ('27000000-0000-4000-8000-000000000001','import-preview-one','Import Preview One'),
 ('27000000-0000-4000-8000-000000000002','import-preview-two','Import Preview Two');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','active',true,now()),
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','active',false,now());
insert into app.roles(id,tenant_id,code,name) values('37000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','import-reader','Catalog Reader');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('27000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001','catalog.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000001');
select app.create_catalog_product('17000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',
 'Existing shoe',null,'Shoes','Size 8','IMPORT-OLD-8',499,200,true,array['480000171717'],'import-fixture-001','import-fixture-hash','import-fixture-request');
update app.product_variants set is_active=false where tenant_id='27000000-0000-4000-8000-000000000001';
update app.product_barcodes set id='fa000000-0000-4000-8000-000000000001' where tenant_id='27000000-0000-4000-8000-000000000001';
insert into app.product_barcodes(id,tenant_id,variant_id,barcode,is_primary)
select '0a000000-0000-4000-8000-000000000001',tenant_id,id,'480000171718',false from app.product_variants where tenant_id='27000000-0000-4000-8000-000000000001';
insert into app.product_categories(tenant_id,name,status,created_by) values
 ('27000000-0000-4000-8000-000000000001','Archived','archived','17000000-0000-4000-8000-000000000001'),
 ('27000000-0000-4000-8000-000000000002','Foreign secret category','active','17000000-0000-4000-8000-000000000001');
create temp table import_before as select
 (select count(*) from audit.audit_events where tenant_id='27000000-0000-4000-8000-000000000001') audits,
 (select count(*) from integration.event_outbox where tenant_id='27000000-0000-4000-8000-000000000001') events;
create temp table import_snapshot as select pg_temp.import_snapshot('17000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001') value;
select is(jsonb_array_length((select value->'products' from import_snapshot)),1,'snapshot contains own product');
select is(((select value->'products'->0->'variants'->0->>'isActive' from import_snapshot))::boolean,false,'inactive SKU is retained for conflict detection');
select is((select value->'products'->0->'variants'->0->'barcodes'->>0 from import_snapshot),'480000171717','snapshot preserves barcode ownership');
select is((select value->'products'->0->'variants'->0->'barcodes'->>1 from import_snapshot),'480000171718','secondary barcode never displaces primary despite earlier UUID order');
select is(jsonb_array_length((select value->'categories' from import_snapshot)),2,'active and archived categories both retained');
select ok((select value::text not like '%Foreign secret%' from import_snapshot),'foreign category is never projected');
select throws_ok($$select pg_temp.import_snapshot('17000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000002')$$,'HCS09','Catalog access denied','foreign tenant denied');
select throws_ok($$select pg_temp.import_snapshot('17000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000001')$$,'HCS09','Catalog access denied','catalog read alone cannot prepare imports');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('27000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001','catalog.manage');
select lives_ok($$select pg_temp.import_snapshot('17000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000001')$$,'explicit catalog manager can prepare imports');
select ok(not has_function_privilege('anon','app.load_catalog_import_snapshot(uuid,uuid,text[],text[],text[])','execute'),'anonymous cannot call private snapshot');
select ok(not has_function_privilege('authenticated','app.load_catalog_import_snapshot(uuid,uuid,text[],text[],text[])','execute'),'browser roles cannot bypass API');
select ok(has_function_privilege('hcs_hyperdrive','app.load_catalog_import_snapshot(uuid,uuid,text[],text[],text[])','execute'),'API login may call guarded snapshot');
select is((select count(*) from audit.audit_events where tenant_id='27000000-0000-4000-8000-000000000001'),(select audits from import_before),'preview creates no audit mutation');
select is((select count(*) from integration.event_outbox where tenant_id='27000000-0000-4000-8000-000000000001'),(select events from import_before),'preview creates no outbox mutation');
select is((select count(*)::integer from app.inventory_movements where tenant_id='27000000-0000-4000-8000-000000000001'),0,'preview creates no stock movement');
update app.tenants set status='suspended' where id='27000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.import_snapshot('17000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001')$$,'HCS09','Catalog access denied','suspended tenant cannot preview');
select * from finish();
rollback;
