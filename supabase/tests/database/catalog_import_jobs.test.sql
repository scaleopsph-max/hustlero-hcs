begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('18000000-0000-4000-8000-000000000001','import-job-owner@example.invalid','authenticated','authenticated',now()),
 ('18000000-0000-4000-8000-000000000002','import-job-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
 ('28000000-0000-4000-8000-000000000001','import-jobs-one','Import Jobs One'),
 ('28000000-0000-4000-8000-000000000002','import-jobs-two','Import Jobs Two');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000001','active',true,now()),
 ('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002','active',false,now());
insert into app.roles(id,tenant_id,code,name) values('38000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001','job-reader','Job Reader');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('28000000-0000-4000-8000-000000000001','38000000-0000-4000-8000-000000000001','catalog.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002','38000000-0000-4000-8000-000000000001');
create temp table job_input as select
 '{"filename":"catalog.csv","rows":[{"product_name":"Synthetic Shoe","sku":"JOB-1","retail_price":"499.99"}]}'::jsonb raw,
 '[{"rowNumber":2,"issues":[],"action":"create_product","sku":"JOB-1","retailPriceMinor":49999}]'::jsonb rows;
create function pg_temp.save_job(p_actor uuid default '18000000-0000-4000-8000-000000000001',p_tenant uuid default '28000000-0000-4000-8000-000000000001',p_key text default 'import-job-synthetic-001') returns jsonb language sql as $$
 select app.save_catalog_import_job(p_actor,p_tenant,raw,rows,p_key,'import-job-request') from job_input
$$;
create temp table saved_job as select pg_temp.save_job() value;
select is((select value->>'status' from saved_job),'saved','job is prepared, not posted');
select is(pg_temp.save_job(),(select value from saved_job),'same raw request and key return original job');
select is((select count(*)::integer from app.catalog_import_jobs where tenant_id='28000000-0000-4000-8000-000000000001'),1,'replay has one durable job');
select is((select count(*)::integer from app.catalog_import_job_rows where tenant_id='28000000-0000-4000-8000-000000000001'),1,'replay has one durable row');
select is((select count(*)::integer from audit.audit_events where tenant_id='28000000-0000-4000-8000-000000000001' and action='catalog.import.prepared'),1,'replay has one preparation audit');
select is((select count(*)::integer from integration.event_outbox where tenant_id='28000000-0000-4000-8000-000000000001' and topic='catalog.import.prepared'),1,'replay has one outbox event');
select is((app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001')->'jobs'->0->>'proposedCreates')::integer,1,'history counts proposed creates, not created products');
select ok(not(app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001')->'jobs'->0 ? 'source'),'summary excludes raw file');
select is(app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select (value->>'jobId')::uuid from saved_job))->'source',(select raw from job_input),'detail retains exact original raw file');
select is(app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select (value->>'jobId')::uuid from saved_job))->'rows',(select rows from job_input),'detail retains exact original preview');
select throws_ok($$select pg_temp.save_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000002')$$,'HCS09','Catalog access denied','foreign tenant cannot save');
select throws_ok($$select pg_temp.save_job('18000000-0000-4000-8000-000000000002')$$,'HCS09','Catalog access denied','read-only role cannot prepare job');
select throws_ok($$select app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000002','28000000-0000-4000-8000-000000000001')$$,'HCS09','Catalog access denied','reader cannot inspect import payloads');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('28000000-0000-4000-8000-000000000001','38000000-0000-4000-8000-000000000001','catalog.manage');
select throws_ok($$select pg_temp.save_job('18000000-0000-4000-8000-000000000002')$$,'HCS08','Import request key conflict','another manager cannot adopt another uploader key');
select throws_ok($$select app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001')$$,'HCS12','Import job not found','unknown ID does not leak existence');
update job_input set raw=jsonb_set(raw,'{rows,0,retail_price}','"1.00"');
select throws_ok($$select pg_temp.save_job()$$,'HCS08','Import request key conflict','changed raw input cannot reuse key');
update job_input set raw=jsonb_set(raw,'{rows,0,retail_price}','"499.99"');
select throws_ok($$update app.catalog_import_jobs set filename='changed.csv'$$,'HCIJ1','Import history is immutable','source identity cannot be edited');
select throws_ok($$delete from app.catalog_import_jobs$$,'HCIJ1','Import history is immutable','job cannot be deleted');
select throws_ok($$update app.catalog_import_job_rows set preview='{}'$$,'HCIJ1','Import history is immutable','preview row cannot be edited');
select throws_ok($$delete from app.catalog_import_job_rows$$,'HCIJ1','Import history is immutable','preview row cannot be deleted');
select is((select count(*)::integer from app.products where tenant_id='28000000-0000-4000-8000-000000000001'),0,'preparation never creates products');
select is((select count(*)::integer from app.inventory_movements where tenant_id='28000000-0000-4000-8000-000000000001'),0,'preparation never writes stock');
select is(app.cancel_catalog_import_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select (value->>'jobId')::uuid from saved_job),'cancel-job-request')->>'state','cancelled','explicit cancellation retains job');
select is(app.cancel_catalog_import_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select (value->>'jobId')::uuid from saved_job),'cancel-retry-request')->>'state','cancelled','cancellation is naturally idempotent');
select is((select count(*)::integer from audit.audit_events where tenant_id='28000000-0000-4000-8000-000000000001' and action='catalog.import.cancelled'),1,'cancellation replay emits one audit');
select is(pg_temp.save_job(),(select value from saved_job),'save replay never resurrects cancelled preview');
select throws_ok($$update app.catalog_import_jobs set state='preview',cancelled_at=null,cancelled_by=null$$,'HCIJ1','Import history is immutable','cancelled job cannot be reopened');
select ok(not has_table_privilege('authenticated','app.catalog_import_jobs','select'),'browser cannot read job tables');
select ok(not has_table_privilege('hcs_hyperdrive','app.catalog_import_job_rows','insert'),'API login cannot bypass guarded job functions');
select ok(not has_function_privilege('anon','app.save_catalog_import_job(uuid,uuid,jsonb,jsonb,text,text)','execute'),'anonymous cannot invoke preparation');
select ok(not has_function_privilege('authenticated','app.cancel_catalog_import_job(uuid,uuid,uuid,text)','execute'),'browser cannot invoke cancellation');
select ok(has_function_privilege('hcs_hyperdrive','app.load_catalog_import_jobs(uuid,uuid,uuid)','execute'),'API login may invoke guarded job lookup');
select ok((select relrowsecurity from pg_class where oid='app.catalog_import_jobs'::regclass),'job RLS enabled');
select ok((select relrowsecurity from pg_class where oid='app.catalog_import_job_rows'::regclass),'row RLS enabled');
select throws_ok($$select app.save_catalog_import_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select raw from job_input),'[]','invalid-count-import-key','bad')$$,'HCS11','Import row count mismatch','row-count mismatch is rejected before job insertion');
select throws_ok($$select app.save_catalog_import_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select raw from job_input),'[{"rowNumber":3,"issues":[],"action":"create_product"}]','invalid-ordinal-import-key','bad')$$,'HCS11','Invalid import preview row','row ordering cannot be forged');
select throws_ok($$select app.save_catalog_import_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',(select raw from job_input),'[{"rowNumber":2,"issues":[{"code":"INVALID_PRICE"}],"action":"create_product"}]','invalid-action-import-key','bad')$$,'HCS11','Rejected import row has an action','rejected rows cannot carry write intent');
select lives_ok($$select pg_temp.save_job('18000000-0000-4000-8000-000000000002','28000000-0000-4000-8000-000000000001','explicit-manager-import-key')$$,'explicit manager can save own job');
do $$begin
 for i in 1..51 loop perform pg_temp.save_job('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001','bounded-history-job-'||i);end loop;
end$$;
select is(jsonb_array_length(app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001')->'jobs'),50,'history projection is bounded to latest fifty jobs');
update app.tenants set status='suspended' where id='28000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.save_job()$$,'HCS09','Catalog access denied','suspended tenant cannot replay original save');
select throws_ok($$select app.load_catalog_import_jobs('18000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001')$$,'HCS09','Catalog access denied','suspended tenant cannot load history');
select * from finish();
rollback;
