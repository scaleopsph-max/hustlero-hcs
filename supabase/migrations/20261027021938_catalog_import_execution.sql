begin;
create table app.catalog_import_executions(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, job_id uuid not null,
 confirmed_by uuid not null references auth.users(id), request_key text not null,
 review_hash text not null, groups jsonb not null check(jsonb_typeof(groups)='array' and jsonb_array_length(groups) between 1 and 5000),
 next_group integer not null default 0 check(next_group between 0 and jsonb_array_length(groups)),
 state text not null default 'running' check(state in ('running','completed','completed_with_errors')),
 confirmed_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(tenant_id,job_id), unique(tenant_id,id), unique(tenant_id,request_key),
 foreign key(tenant_id,job_id) references app.catalog_import_jobs(tenant_id,id),
 check((state='running' and completed_at is null and next_group<jsonb_array_length(groups))
 or (state<>'running' and completed_at is not null and next_group=jsonb_array_length(groups)))
);
create table app.catalog_import_results(
 tenant_id uuid not null, execution_id uuid not null, group_index integer not null check(group_index between 0 and 4999),
 row_number integer not null check(row_number between 2 and 5001),
 outcome text not null check(outcome in ('created','updated','failed')),
 product_id uuid, variant_id uuid, error_code text, recorded_at timestamptz not null,
 primary key(tenant_id,execution_id,row_number),
 foreign key(tenant_id,execution_id) references app.catalog_import_executions(tenant_id,id),
 check((outcome='failed' and error_code is not null and product_id is null and variant_id is null)
 or (outcome<>'failed' and error_code is null and product_id is not null and variant_id is not null))
);
create index catalog_import_results_groups on app.catalog_import_results(tenant_id,execution_id,group_index);
alter table app.catalog_import_executions enable row level security;
alter table app.catalog_import_results enable row level security;
revoke all on app.catalog_import_executions,app.catalog_import_results from public,anon,authenticated,hcs_hyperdrive;

create function app.guard_catalog_execution_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or tg_table_name='catalog_import_results' then
  raise exception using errcode='HCIJ1',message='Import history is immutable'; end if;
 if old.state<>'running' or new.next_group<>old.next_group+1
 or (to_jsonb(new)-array['next_group','state','completed_at']) is distinct from
 (to_jsonb(old)-array['next_group','state','completed_at']) then
  raise exception using errcode='HCIJ1',message='Import history is immutable'; end if;
 return new;
end; $$;
create trigger catalog_execution_history before update or delete on app.catalog_import_executions
for each row execute function app.guard_catalog_execution_history();
create trigger catalog_result_history before update or delete on app.catalog_import_results
for each row execute function app.guard_catalog_execution_history();
create function app.guard_catalog_import_confirmation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app.catalog_import_executions where tenant_id=old.tenant_id and job_id=old.id) then
  raise exception using errcode='HCIJ3',message='Confirmed imports cannot be cancelled'; end if;
 return new;
end; $$;
create trigger catalog_import_confirmed before update on app.catalog_import_jobs
for each row execute function app.guard_catalog_import_confirmation();

-- Includes original prices/costs and barcode ownership, not inventory balances.
create function app.catalog_import_scope_state(p_tenant uuid,p_raw jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 with skus as materialized(select distinct upper(btrim(value)) sku from jsonb_array_elements(p_raw) r,
 lateral unnest(array[r->>'sku',r->>'product_sku']) value where nullif(btrim(value),'') is not null),
 codes as materialized(select distinct upper(btrim(r->>'barcode')) code from jsonb_array_elements(p_raw) r where nullif(btrim(r->>'barcode'),'') is not null),
 variants as materialized(select v.* from app.product_variants v where v.tenant_id=p_tenant and
 (v.sku in(select sku::extensions.citext from skus) or exists(select 1 from app.product_barcodes b where b.tenant_id=p_tenant and b.variant_id=v.id and b.barcode in(select code::extensions.citext from codes))))
 select jsonb_build_object(
 'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from app.products p where p.tenant_id=p_tenant and p.id in(select product_id from variants)),
 'variants',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from variants v),
 'barcodes',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) from app.product_barcodes b where b.tenant_id=p_tenant and b.variant_id in(select id from variants)),
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'status',c.status) order by c.id),'[]'::jsonb)
 from app.product_categories c where c.tenant_id=p_tenant and lower(btrim(c.name)) in(select lower(btrim(r->>'category')) from jsonb_array_elements(p_raw) r)))
$$;

create function app.catalog_import_manifest(p_actor uuid,p_tenant uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job app.catalog_import_jobs%rowtype; v_groups jsonb;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 select * into v_job from app.catalog_import_jobs where tenant_id=p_tenant and id=p_job;
 if not found then raise exception using errcode='HCS12',message='Import job not found'; end if;
 if v_job.state<>'preview' or v_job.rejected_count<>0 then
  raise exception using errcode='HCIJ2',message='Import requires a valid active preview'; end if;
 select jsonb_agg(jsonb_build_object('rows',g.rows,'raw',g.raw,'baseline',app.catalog_import_scope_state(p_tenant,g.raw)) order by g.first_row)
 into v_groups from (
 select min(row_number) first_row,jsonb_agg(preview order by case when preview->>'action'='create_product' then 0 else 1 end,row_number) rows,
 jsonb_agg(v_job.raw_request->'rows'->(row_number-2) order by row_number) raw
 from app.catalog_import_job_rows where tenant_id=p_tenant and job_id=p_job
 group by case when preview->>'productId' is not null then 'product:'||(preview->>'productId') else 'sku:'||(preview->>'productSku') end) g;
 if v_groups is null or exists(select 1 from jsonb_array_elements(v_groups) g where jsonb_array_length(g->'rows')>100) then
  raise exception using errcode='HCIJ2',message='Product groups must contain 1 to 100 rows'; end if;
 return v_groups;
end; $$;

create function app.review_catalog_import(p_actor uuid,p_tenant uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_groups jsonb; v_job jsonb; v_rows jsonb;
begin
 v_groups:=app.catalog_import_manifest(p_actor,p_tenant,p_job);
 v_job:=app.load_catalog_import_jobs(p_actor,p_tenant,p_job); v_rows:=v_job->'source'->'rows';
 return jsonb_build_object('hash',encode(sha256(convert_to(p_actor::text||p_tenant::text||p_job::text||v_groups::text,'UTF8')),'hex'),
 'groupCount',jsonb_array_length(v_groups),'job',v_job,'snapshot',app.load_catalog_import_snapshot(p_actor,p_tenant,
 array(select distinct upper(btrim(v)) from jsonb_array_elements(v_rows) r,lateral unnest(array[r->>'sku',r->>'product_sku']) v where nullif(btrim(v),'') is not null),
 array(select distinct upper(btrim(r->>'barcode')) from jsonb_array_elements(v_rows) r where nullif(btrim(r->>'barcode'),'') is not null),
 array(select distinct lower(btrim(r->>'category')) from jsonb_array_elements(v_rows) r where nullif(btrim(r->>'category'),'') is not null)));
end; $$;

create function app.load_catalog_import_execution(p_actor uuid,p_tenant uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_exec app.catalog_import_executions%rowtype;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 perform 1 from app.catalog_import_jobs where tenant_id=p_tenant and id=p_job;
 if not found then raise exception using errcode='HCS12',message='Import job not found'; end if;
 select * into v_exec from app.catalog_import_executions where tenant_id=p_tenant and job_id=p_job;
 if not found then return jsonb_build_object('execution',null); end if;
 return jsonb_build_object('execution',jsonb_build_object('id',v_exec.id,'jobId',p_job,'state',v_exec.state,
 'groupCount',jsonb_array_length(v_exec.groups),'nextGroup',v_exec.next_group,
 'confirmedBy',v_exec.confirmed_by,'requestKey',v_exec.request_key,'reviewHash',v_exec.review_hash,'confirmedAt',v_exec.confirmed_at,'completedAt',v_exec.completed_at,
 'results',(select coalesce(jsonb_agg(jsonb_build_object('groupIndex',group_index,'rowNumber',row_number,'outcome',outcome,
 'productId',product_id,'variantId',variant_id,'errorCode',error_code,'recordedAt',recorded_at) order by row_number),'[]'::jsonb)
 from app.catalog_import_results where tenant_id=p_tenant and execution_id=v_exec.id)));
end; $$;

create function app.start_catalog_import(p_actor uuid,p_tenant uuid,p_job uuid,p_hash text,p_key text,p_request text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_exec app.catalog_import_executions%rowtype; v_groups jsonb; v_actual text; v_state text;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='HCS11',message='Invalid import confirmation'; end if;
 select state into v_state from app.catalog_import_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception using errcode='HCS12',message='Import job not found'; end if;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 select * into v_exec from app.catalog_import_executions where tenant_id=p_tenant and job_id=p_job;
 if found then
  if v_exec.confirmed_by<>p_actor or v_exec.request_key<>p_key or v_exec.review_hash<>p_hash then
   raise exception using errcode='HCS08',message='Import confirmation key conflict'; end if;
  return app.load_catalog_import_execution(p_actor,p_tenant,p_job);
 end if;
 v_groups:=app.catalog_import_manifest(p_actor,p_tenant,p_job);
 v_actual:=encode(sha256(convert_to(p_actor::text||p_tenant::text||p_job::text||v_groups::text,'UTF8')),'hex');
 if v_actual<>p_hash then raise exception using errcode='HCIS1',message='Catalog changed since review'; end if;
 insert into app.catalog_import_executions(tenant_id,job_id,confirmed_by,request_key,review_hash,groups)
 values(p_tenant,p_job,p_actor,p_key,p_hash,v_groups) returning * into v_exec;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request,'tenant_user',p_actor,'catalog.import.confirmed','catalog_import_execution',v_exec.id,jsonb_build_object('jobId',p_job));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'catalog.import.confirmed','catalog_import_execution',v_exec.id,jsonb_build_object('jobId',p_job));
 return app.load_catalog_import_execution(p_actor,p_tenant,p_job);
end; $$;

create function app.process_catalog_import_group(p_actor uuid,p_tenant uuid,p_job uuid,p_index integer,p_request text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_exec app.catalog_import_executions%rowtype; v_group jsonb; v_row jsonb; v_product uuid; v_reply jsonb;
 v_replies jsonb:='[]'; v_error text; v_key text; v_body jsonb; v_at timestamptz; v_failed boolean;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 perform 1 from app.catalog_import_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception using errcode='HCS12',message='Import job not found'; end if;
 select * into v_exec from app.catalog_import_executions where tenant_id=p_tenant and job_id=p_job for update;
 if not found then raise exception using errcode='HCIJ2',message='Confirm the import first'; end if;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if p_index is null or p_index<0 or p_index>=jsonb_array_length(v_exec.groups) or p_index>v_exec.next_group then
  raise exception using errcode='HCS11',message='Invalid import group index'; end if;
 if p_index<v_exec.next_group then return app.load_catalog_import_execution(p_actor,p_tenant,p_job); end if;
 v_group:=v_exec.groups->p_index;
 -- Expected business failures roll back the ENTIRE group, including core audits.
 begin
  perform 1 from app.product_categories where tenant_id=p_tenant and id in(select (c->>'id')::uuid from jsonb_array_elements(v_group->'baseline'->'categories') c) order by id for update;
  perform 1 from app.products where tenant_id=p_tenant and id in(select (p->>'id')::uuid from jsonb_array_elements(v_group->'baseline'->'products') p) order by id for update;
  perform 1 from app.product_variants where tenant_id=p_tenant and id in(select (v->>'id')::uuid from jsonb_array_elements(v_group->'baseline'->'variants') v) order by id for update;
  perform app.lock_catalog_access(p_actor,p_tenant,true);
  if app.catalog_import_scope_state(p_tenant,v_group->'raw') is distinct from v_group->'baseline' then
   raise exception using errcode='HCIS1',message='Catalog changed since review'; end if;
  v_product:=(v_group->'rows'->0->>'productId')::uuid;
  if v_product is not null then
   v_row:=v_group->'rows'->0;
   perform app.update_catalog_product_selected_category(p_actor,p_tenant,v_product,jsonb_build_object('name',v_row->>'name','description',v_row->'description','categoryId',v_row->'categoryId'),
    'import-'||v_exec.id::text||'-'||p_index||'-product',v_exec.review_hash,p_request);
  end if;
  for v_row in select value from jsonb_array_elements(v_group->'rows') loop
   v_key:='import-'||v_exec.id::text||'-'||(v_row->>'rowNumber');
   v_body:=jsonb_build_object('name',v_row->>'name','description',v_row->'description','categoryId',v_row->'categoryId',
    'variantName',v_row->>'variantName','sku',v_row->>'sku','retailPriceMinor',v_row->'retailPriceMinor',
    'unitCostMinor',v_row->'unitCostMinor','trackInventory',v_row->'trackInventory','barcodes',v_row->'barcodes');
   if v_row->>'action'='create_product' then
    if v_product is not null then raise exception using errcode='HCS11',message='Duplicate product parent'; end if;
    v_reply:=app.create_catalog_product_selected_category(p_actor,p_tenant,v_body,v_key,v_exec.review_hash,p_request);
    v_product:=(v_reply->>'productId')::uuid;
   elsif v_row->>'action'='create_variant' then
    if v_product is null then raise exception using errcode='HCS11',message='Missing product parent'; end if;
    v_reply:=app.create_catalog_variant(p_actor,p_tenant,v_product,v_row->>'variantName',v_row->>'sku',
     (v_row->>'retailPriceMinor')::numeric/100,(v_row->>'unitCostMinor')::numeric/100,(v_row->>'trackInventory')::boolean,
     array(select jsonb_array_elements_text(v_row->'barcodes')),v_key,p_actor::text||':'||v_exec.review_hash,p_request);
   elsif v_row->>'action'='update_variant' then
    v_reply:=app.update_catalog_variant(p_actor,p_tenant,v_product,(v_row->>'variantId')::uuid,v_row->>'variantName',v_row->>'sku',
     (v_row->>'retailPriceMinor')::numeric/100,(v_row->>'unitCostMinor')::numeric/100,(v_row->>'trackInventory')::boolean,
     array(select jsonb_array_elements_text(v_row->'barcodes')),v_key,p_actor::text||':'||v_exec.review_hash,p_request);
   else raise exception using errcode='HCS11',message='Invalid import action'; end if;
   v_replies:=v_replies||jsonb_build_array(jsonb_build_object('rowNumber',(v_row->>'rowNumber')::integer,
    'outcome',case when v_row->>'action'='update_variant' then 'updated' else 'created' end,
    'productId',v_reply->>'productId','variantId',v_reply->>'variantId'));
  end loop;
  perform app.lock_catalog_access(p_actor,p_tenant,true);
 exception when sqlstate 'HCIS1' or sqlstate 'HCS11' or sqlstate 'HCS12' or unique_violation then
  v_error:=sqlstate;
 end;
 v_at:=clock_timestamp();
 if v_error is null then
  insert into app.catalog_import_results(tenant_id,execution_id,group_index,row_number,outcome,product_id,variant_id,recorded_at)
  select p_tenant,v_exec.id,p_index,(r->>'rowNumber')::integer,r->>'outcome',(r->>'productId')::uuid,(r->>'variantId')::uuid,v_at from jsonb_array_elements(v_replies) r;
 else
  insert into app.catalog_import_results(tenant_id,execution_id,group_index,row_number,outcome,error_code,recorded_at)
  select p_tenant,v_exec.id,p_index,(r->>'rowNumber')::integer,'failed',v_error,v_at from jsonb_array_elements(v_group->'rows') r;
 end if;
 v_failed:=exists(select 1 from app.catalog_import_results where tenant_id=p_tenant and execution_id=v_exec.id and outcome='failed');
 update app.catalog_import_executions set next_group=p_index+1,
 state=case when p_index+1<jsonb_array_length(groups) then 'running' when v_failed then 'completed_with_errors' else 'completed' end,
 completed_at=case when p_index+1=jsonb_array_length(groups) then v_at else null end where id=v_exec.id and tenant_id=p_tenant;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request,'tenant_user',p_actor,'catalog.import.group_processed','catalog_import_execution',v_exec.id,
 jsonb_build_object('groupIndex',p_index,'errorCode',v_error));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'catalog.import.group_processed','catalog_import_execution',v_exec.id,jsonb_build_object('groupIndex',p_index,'jobId',p_job));
 return app.load_catalog_import_execution(p_actor,p_tenant,p_job);
end; $$;

revoke all on function app.guard_catalog_execution_history(),app.guard_catalog_import_confirmation(),
 app.catalog_import_scope_state(uuid,jsonb),app.catalog_import_manifest(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
revoke all on function app.review_catalog_import(uuid,uuid,uuid),app.load_catalog_import_execution(uuid,uuid,uuid),
 app.start_catalog_import(uuid,uuid,uuid,text,text,text),app.process_catalog_import_group(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function app.review_catalog_import(uuid,uuid,uuid),app.load_catalog_import_execution(uuid,uuid,uuid),
 app.start_catalog_import(uuid,uuid,uuid,text,text,text),app.process_catalog_import_group(uuid,uuid,uuid,integer,text) to hcs_hyperdrive;
commit;
