begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('19000000-0000-4000-8000-000000000001','execution-owner@example.invalid','authenticated','authenticated',now()),
 ('19000000-0000-4000-8000-000000000002','execution-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
 ('29000000-0000-4000-8000-000000000001','catalog-execution-one','Catalog Execution One'),
 ('29000000-0000-4000-8000-000000000002','catalog-execution-two','Catalog Execution Two');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','active',true,now()),
 ('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002','active',false,now());
create function pg_temp.exec_plan(p_raw jsonb) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('rowNumber',r.ordinality+1,'issues','[]'::jsonb,
 'action',case when v.id is not null then 'update_variant' when coalesce(r.value->>'product_sku',r.value->>'sku')=r.value->>'sku' and parent.id is null then 'create_product' else 'create_variant' end,
 'productId',parent.product_id,'variantId',v.id,'productSku',coalesce(r.value->>'product_sku',r.value->>'sku'),
 'name',r.value->>'product_name','description',null,'categoryId',null,'categoryName',null,
 'variantName',coalesce(r.value->>'variant_name','Default'),'sku',r.value->>'sku','barcodes',coalesce((select jsonb_agg(b.barcode::text order by b.id) from app.product_barcodes b where b.tenant_id=v.tenant_id and b.variant_id=v.id),'[]'::jsonb),
 'retailPriceMinor',(r.value->>'retail_price')::numeric*100,'unitCostMinor',nullif(r.value->>'unit_cost','')::numeric*100,'trackInventory',true) order by r.ordinality)
 from jsonb_array_elements(p_raw) with ordinality r
 left join app.product_variants v on v.tenant_id='29000000-0000-4000-8000-000000000001' and v.sku=(r.value->>'sku')::extensions.citext
 left join app.product_variants parent on parent.tenant_id='29000000-0000-4000-8000-000000000001' and parent.sku=coalesce(r.value->>'product_sku',r.value->>'sku')::extensions.citext
$$;
create function pg_temp.new_exec_job(p_key text,p_raw jsonb) returns uuid language sql as $$
 select (app.save_catalog_import_job('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',
 jsonb_build_object('filename',p_key||'.csv','rows',p_raw),pg_temp.exec_plan(p_raw),p_key,p_key)->>'jobId')::uuid
$$;
create function pg_temp.start_exec(p_job uuid) returns jsonb language sql as $$
 select app.start_catalog_import('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',p_job,
 app.review_catalog_import('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',p_job)->>'hash','confirm-'||p_job::text,'confirm-import')
$$;
create function pg_temp.step_exec(p_job uuid,p_group integer default 0) returns jsonb language sql as $$
 select app.process_catalog_import_group('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',p_job,p_group,'process-import')
$$;
create temp table exec_cases(name text primary key,job uuid);
insert into exec_cases values('new',pg_temp.new_exec_job('execution-new-product-001','[
 {"product_sku":"EXEC-8","product_name":"Synthetic Shoes","variant_name":"Size 9","sku":"EXEC-9","retail_price":"499.99","unit_cost":"200.01"},
 {"product_sku":"EXEC-8","product_name":"Synthetic Shoes","variant_name":"Size 8","sku":"EXEC-8","retail_price":"499.99","unit_cost":"200.01"}]'));
select is(app.load_catalog_import_execution('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='new'))->'execution','null'::jsonb,'new preview has no execution');
select throws_ok($$select pg_temp.step_exec((select job from exec_cases where name='new'))$$,'HCIJ2','Confirm the import first','processing requires confirmation');
select is((app.review_catalog_import('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='new'))->>'groupCount')::integer,1,'parent and variant are one atomic group');
create temp table exec_started as select pg_temp.start_exec((select job from exec_cases where name='new')) value;
select is((select value->'execution'->>'state' from exec_started),'running','confirmation creates durable running execution');
select is((select count(*)::integer from app.products where tenant_id='29000000-0000-4000-8000-000000000001'),0,'confirmation does not post products');
select is(pg_temp.start_exec((select job from exec_cases where name='new')),(select value from exec_started),'confirmation replay returns same execution');
select throws_ok($$select app.cancel_catalog_import_job('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='new'),'cancel-confirmed')$$,'HCIJ3','Confirmed imports cannot be cancelled','confirmed job cannot be destructively cancelled');
create temp table exec_done as select pg_temp.step_exec((select job from exec_cases where name='new')) value;
select is((select value->'execution'->>'state' from exec_done),'completed','one group completes');
select is(jsonb_array_length((select value->'execution'->'results' from exec_done)),2,'both rows have permanent results');
select is((select count(*)::integer from app.products where tenant_id='29000000-0000-4000-8000-000000000001'),1,'parent sorted before variant even when last in file');
select is((select count(distinct product_id)::integer from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001'),1,'variants share one product');
select is((select retail_price from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku='EXEC-9'),499.99::numeric,'exact retail cents retained');
select is((select unit_cost from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku='EXEC-8'),200.01::numeric,'exact unit cost retained');
select is(pg_temp.step_exec((select job from exec_cases where name='new')),(select value from exec_done),'same group replay posts nothing again');
select is(pg_temp.start_exec((select job from exec_cases where name='new')),(select value from exec_done),'confirmation replay after posting ignores changed catalog baseline');
select is((select count(*)::integer from audit.audit_events where tenant_id='29000000-0000-4000-8000-000000000001' and action='catalog.import.group_processed'),1,'group replay emits one audit');
select is((select count(*)::integer from integration.event_outbox where tenant_id='29000000-0000-4000-8000-000000000001' and topic='catalog.import.group_processed'),1,'group replay emits one outbox');
insert into exec_cases values('update',pg_temp.new_exec_job('execution-update-product-001','[{"product_name":"Updated Shoes","sku":"EXEC-8","variant_name":"Size 8","retail_price":"450.01","unit_cost":"210.55"}]'));
select pg_temp.start_exec((select job from exec_cases where name='update'));
select is(pg_temp.step_exec((select job from exec_cases where name='update'))->'execution'->'results'->0->>'outcome','updated','existing SKU updates by stable identity');
select is((select retail_price from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku='EXEC-8'),450.01::numeric,'SKU update uses exact intended cents');
select is((select name from app.products where tenant_id='29000000-0000-4000-8000-000000000001'),'Updated Shoes','shared product details updated');
select is((select count(*)::integer from app.products where tenant_id='29000000-0000-4000-8000-000000000001'),1,'update never clones product');
insert into exec_cases values('stale',pg_temp.new_exec_job('execution-stale-product-001','[{"product_name":"Updated Shoes","sku":"EXEC-8","variant_name":"Size 8","retail_price":"400.01"}]'));
create temp table stale_review as select app.review_catalog_import('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='stale')) value;
update app.product_variants set retail_price=451.01 where tenant_id='29000000-0000-4000-8000-000000000001' and sku='EXEC-8';
select throws_ok($$select app.start_catalog_import('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='stale'),(select value->>'hash' from stale_review),'stale-confirm-import-key','stale-confirm')$$,'HCIS1','Catalog changed since review','price edit invalidates review hash');
select pg_temp.start_exec((select job from exec_cases where name='stale'));
update app.product_variants set retail_price=452.01 where tenant_id='29000000-0000-4000-8000-000000000001' and sku='EXEC-8';
select is(pg_temp.step_exec((select job from exec_cases where name='stale'))->'execution'->>'state','completed_with_errors','post-confirmation edit becomes explicit failed group');
select is((select retail_price from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku='EXEC-8'),452.01::numeric,'stale import never overwrites newer price');
select is(pg_temp.step_exec((select job from exec_cases where name='stale'))->'execution'->'results'->0->>'errorCode','HCIS1','failed result keeps sanitized stale code');
insert into exec_cases values('rollback',pg_temp.new_exec_job('execution-rollback-group-001','[
 {"product_sku":"ROLLBACK-1","product_name":"Must Roll Back","sku":"ROLLBACK-1","retail_price":"10.00"},
 {"product_sku":"ROLLBACK-1","product_name":"Must Roll Back","sku":"ROLLBACK-2","retail_price":"-1.00"}]'));
select pg_temp.start_exec((select job from exec_cases where name='rollback'));
select is(pg_temp.step_exec((select job from exec_cases where name='rollback'))->'execution'->>'state','completed_with_errors','private malformed fixture tests atomic core rejection');
select is((select count(*)::integer from app.products where tenant_id='29000000-0000-4000-8000-000000000001' and name='Must Roll Back'),0,'failed child rolls back parent product');
select is((select count(*)::integer from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku::text like 'ROLLBACK-%'),0,'failed child rolls back all variants');
select is((select count(*)::integer from audit.audit_events where tenant_id='29000000-0000-4000-8000-000000000001' and action='catalog.product.created' and metadata->>'sku'='ROLLBACK-1'),0,'failed group rolls back core audit');
select is(jsonb_array_length(pg_temp.step_exec((select job from exec_cases where name='rollback'))->'execution'->'results'),2,'failed group retains both row failures');
insert into exec_cases values('multi',pg_temp.new_exec_job('execution-multiple-groups-001','[{"product_name":"First","sku":"MULTI-1","retail_price":"1.01"},{"product_name":"Second","sku":"MULTI-2","retail_price":"2.02"}]'));
select pg_temp.start_exec((select job from exec_cases where name='multi'));
select throws_ok($$select pg_temp.step_exec((select job from exec_cases where name='multi'),1)$$,'HCS11','Invalid import group index','out-of-order processing denied');
select is(pg_temp.step_exec((select job from exec_cases where name='multi'),0)->'execution'->>'state','running','one request processes one product group');
select is(pg_temp.step_exec((select job from exec_cases where name='multi'),1)->'execution'->>'state','completed','second request completes remaining group');
select is((select count(*)::integer from app.inventory_movements where tenant_id='29000000-0000-4000-8000-000000000001'),0,'catalog import never posts stock');
select throws_ok($$update app.catalog_import_results set outcome='failed'$$,'HCIJ1','Import history is immutable','row results cannot be edited');
select throws_ok($$delete from app.catalog_import_results$$,'HCIJ1','Import history is immutable','row results cannot be deleted');
select throws_ok($$update app.catalog_import_executions set groups='[]'$$,'HCIJ1','Import history is immutable','reviewed manifest cannot be changed');
select throws_ok($$select app.load_catalog_import_execution('19000000-0000-4000-8000-000000000002','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='new'))$$,'HCS09','Catalog access denied','unprivileged member cannot inspect execution');
select throws_ok($$select app.process_catalog_import_group('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000002',(select job from exec_cases where name='new'),0,'foreign')$$,'HCS09','Catalog access denied','foreign tenant cannot process');
select ok(not has_table_privilege('authenticated','app.catalog_import_results','select'),'browser cannot read private results');
select ok(not has_table_privilege('hcs_hyperdrive','app.catalog_import_executions','update'),'API login cannot edit execution state directly');
select ok(not has_function_privilege('authenticated','app.process_catalog_import_group(uuid,uuid,uuid,integer,text)','execute'),'browser cannot directly invoke posting');
select ok(not has_function_privilege('hcs_hyperdrive','app.catalog_import_scope_state(uuid,jsonb)','execute'),'internal baseline projection is private');
select ok((select relrowsecurity from pg_class where oid='app.catalog_import_results'::regclass),'results RLS enabled');
insert into exec_cases values('oversized',pg_temp.new_exec_job('execution-oversized-group-001',(select jsonb_agg(jsonb_build_object('product_sku','BOUND-0','product_name','Bounded Product','sku','BOUND-'||i,'retail_price','1.00') order by i) from generate_series(0,100) i)));
select throws_ok($$select app.review_catalog_import('19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001',(select job from exec_cases where name='oversized'))$$,'HCIJ2','Product groups must contain 1 to 100 rows','oversized product group is rejected before confirmation');
select is((select count(*)::integer from app.catalog_import_executions where job_id=(select job from exec_cases where name='oversized')),0,'oversized preview creates no execution');
insert into exec_cases values('boundary',pg_temp.new_exec_job('execution-boundary-group-001',(select jsonb_agg(jsonb_build_object('product_sku','LIMIT-0','product_name','Boundary Product','sku','LIMIT-'||i,'retail_price','1.01','unit_cost','0.55') order by i) from generate_series(0,99) i)));
select pg_temp.start_exec((select job from exec_cases where name='boundary'));
select is(jsonb_array_length(pg_temp.step_exec((select job from exec_cases where name='boundary'))->'execution'->'results'),100,'exactly one hundred variants process atomically');
select is((select count(distinct product_id)::integer from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku::text like 'LIMIT-%'),1,'boundary variants still share one product');
select is((select sum(retail_price) from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku::text like 'LIMIT-%'),101.00::numeric,'one hundred exact prices reconcile');
select is((select sum(unit_cost) from app.product_variants where tenant_id='29000000-0000-4000-8000-000000000001' and sku::text like 'LIMIT-%'),55.00::numeric,'one hundred exact costs reconcile');
select is((select count(*)::integer from app.inventory_movements where tenant_id='29000000-0000-4000-8000-000000000001'),0,'boundary import also creates no stock');
update app.tenants set status='suspended' where id='29000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.step_exec((select job from exec_cases where name='new'))$$,'HCS09','Catalog access denied','suspended tenant cannot replay completed group');
select * from finish();
rollback;
