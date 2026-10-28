begin;

-- Prepared jobs preserve the server-derived preview. They are not import posting.
create table app.catalog_import_jobs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references app.tenants(id),
 uploader_id uuid not null references auth.users(id),
 filename text not null check(length(filename) between 1 and 255),
 request_key text not null check(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 input_hash text not null,
 raw_request jsonb not null,
 state text not null default 'preview' check(state in ('preview','cancelled')),
 row_count integer not null check(row_count between 1 and 5000),
 rejected_count integer not null check(rejected_count between 0 and row_count),
 proposed_creates integer not null check(proposed_creates between 0 and row_count),
 proposed_updates integer not null check(proposed_updates between 0 and row_count),
 created_at timestamptz not null default clock_timestamp(),
 cancelled_at timestamptz,
 cancelled_by uuid references auth.users(id),
 unique(tenant_id,id), unique(tenant_id,request_key),
 check(proposed_creates+proposed_updates+rejected_count=row_count),
 check((state='preview' and cancelled_at is null and cancelled_by is null)
    or (state='cancelled' and cancelled_at is not null and cancelled_by is not null))
);
create index catalog_import_jobs_history on app.catalog_import_jobs(tenant_id,created_at desc,id desc);
create table app.catalog_import_job_rows (
 tenant_id uuid not null,
 job_id uuid not null,
 row_number integer not null check(row_number between 2 and 5001),
 preview jsonb not null,
 primary key(tenant_id,job_id,row_number),
 foreign key(tenant_id,job_id) references app.catalog_import_jobs(tenant_id,id)
);
alter table app.catalog_import_jobs enable row level security;
alter table app.catalog_import_job_rows enable row level security;
revoke all on app.catalog_import_jobs,app.catalog_import_job_rows from public,anon,authenticated,hcs_hyperdrive;

create function app.guard_catalog_import_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or tg_table_name='catalog_import_job_rows' then
  raise exception using errcode='HCIJ1',message='Import history is immutable';
 end if;
 if old.state<>'preview' or new.state<>'cancelled'
 or (to_jsonb(new)-array['state','cancelled_at','cancelled_by']) is distinct from
    (to_jsonb(old)-array['state','cancelled_at','cancelled_by']) then
  raise exception using errcode='HCIJ1',message='Import history is immutable';
 end if;
 return new;
end;
$$;
create trigger catalog_import_jobs_history before update or delete on app.catalog_import_jobs
for each row execute function app.guard_catalog_import_history();
create trigger catalog_import_rows_history before update or delete on app.catalog_import_job_rows
for each row execute function app.guard_catalog_import_history();
revoke all on function app.guard_catalog_import_history() from public,anon,authenticated,hcs_hyperdrive;

create function app.catalog_import_job_summary(p_job app.catalog_import_jobs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_job.id,'filename',p_job.filename,'uploaderId',p_job.uploader_id,
 'state',p_job.state,'rowCount',p_job.row_count,'rejectedCount',p_job.rejected_count,
 'proposedCreates',p_job.proposed_creates,'proposedUpdates',p_job.proposed_updates,
 'createdAt',p_job.created_at,'cancelledAt',p_job.cancelled_at)
$$;
revoke all on function app.catalog_import_job_summary(app.catalog_import_jobs) from public,anon,authenticated,hcs_hyperdrive;

create function app.save_catalog_import_job(p_actor uuid,p_tenant uuid,p_raw jsonb,p_rows jsonb,p_key text,p_request text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job app.catalog_import_jobs%rowtype; v_hash text; v_row jsonb; v_ordinal bigint;
 v_count integer; v_rejected integer:=0; v_creates integer:=0; v_updates integer:=0;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' or p_raw is null
 or jsonb_typeof(p_raw) is distinct from 'object' or octet_length(p_raw::text)>6*1024*1024
 or jsonb_typeof(p_raw->'filename') is distinct from 'string'
 or length(btrim(p_raw->>'filename')) not between 1 and 255
 or jsonb_typeof(p_raw->'rows') is distinct from 'array'
 or (p_raw-array['filename','rows'])<>'{}'::jsonb then
  raise exception using errcode='HCS11',message='Invalid import job';
 end if;
 v_hash:=encode(sha256(convert_to(p_raw::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':catalog.import.save:'||p_key,0));
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 select * into v_job from app.catalog_import_jobs where tenant_id=p_tenant and request_key=p_key;
 if found then
  if v_job.input_hash<>v_hash or v_job.uploader_id<>p_actor then
   raise exception using errcode='HCS08',message='Import request key conflict';
  end if;
  return jsonb_build_object('jobId',v_job.id,'status','saved');
 end if;
 v_count:=jsonb_array_length(p_raw->'rows');
 if v_count not between 1 and 5000 or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception using errcode='HCS11',message='Invalid import preview';
 end if;
 if jsonb_array_length(p_rows)<>v_count then
  raise exception using errcode='HCS11',message='Import row count mismatch';
 end if;
 for v_row,v_ordinal in select value,ordinality from jsonb_array_elements(p_rows) with ordinality loop
  if jsonb_typeof(v_row) is distinct from 'object'
   or jsonb_typeof(v_row->'issues') is distinct from 'array'
   or (v_row->>'rowNumber') is distinct from (v_ordinal+1)::text then
   raise exception using errcode='HCS11',message='Invalid import preview row';
  end if;
  if jsonb_array_length(v_row->'issues')>0 then
   if v_row->'action' is distinct from 'null'::jsonb then
    raise exception using errcode='HCS11',message='Rejected import row has an action';
   end if;
   v_rejected:=v_rejected+1;
  elsif v_row->>'action' in ('create_product','create_variant') then v_creates:=v_creates+1;
  elsif v_row->>'action'='update_variant' then v_updates:=v_updates+1;
  else raise exception using errcode='HCS11',message='Import action is missing';
  end if;
 end loop;
 insert into app.catalog_import_jobs(tenant_id,uploader_id,filename,request_key,input_hash,raw_request,
 row_count,rejected_count,proposed_creates,proposed_updates)
 values(p_tenant,p_actor,btrim(p_raw->>'filename'),p_key,v_hash,p_raw,v_count,v_rejected,v_creates,v_updates)
 returning * into v_job;
 insert into app.catalog_import_job_rows(tenant_id,job_id,row_number,preview)
 select p_tenant,v_job.id,ordinality+1,value from jsonb_array_elements(p_rows) with ordinality;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request,'tenant_user',p_actor,'catalog.import.prepared','catalog_import_job',v_job.id,
 jsonb_build_object('rowCount',v_count,'rejectedCount',v_rejected));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'catalog.import.prepared','catalog_import_job',v_job.id,jsonb_build_object('jobId',v_job.id));
 return jsonb_build_object('jobId',v_job.id,'status','saved');
end;
$$;

create function app.load_catalog_import_jobs(p_actor uuid,p_tenant uuid,p_job uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job app.catalog_import_jobs%rowtype;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if p_job is null then
  return jsonb_build_object('jobs',(select coalesce(jsonb_agg(app.catalog_import_job_summary(j::app.catalog_import_jobs) order by j.created_at desc,j.id desc),'[]'::jsonb)
   from (select * from app.catalog_import_jobs where tenant_id=p_tenant order by created_at desc,id desc limit 50) j));
 end if;
 select * into v_job from app.catalog_import_jobs where tenant_id=p_tenant and id=p_job;
 if not found then raise exception using errcode='HCS12',message='Import job not found'; end if;
 return app.catalog_import_job_summary(v_job)||jsonb_build_object('source',v_job.raw_request,'rows',(
  select jsonb_agg(preview order by row_number) from app.catalog_import_job_rows where tenant_id=p_tenant and job_id=p_job));
end;
$$;

create function app.cancel_catalog_import_job(p_actor uuid,p_tenant uuid,p_job uuid,p_request text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job app.catalog_import_jobs%rowtype;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 select * into v_job from app.catalog_import_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception using errcode='HCS12',message='Import job not found'; end if;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if v_job.state='preview' then
  update app.catalog_import_jobs set state='cancelled',cancelled_at=clock_timestamp(),cancelled_by=p_actor
  where tenant_id=p_tenant and id=p_job;
  insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
  values(p_tenant,p_request,'tenant_user',p_actor,'catalog.import.cancelled','catalog_import_job',p_job,'{}');
  insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
  values(p_tenant,'catalog.import.cancelled','catalog_import_job',p_job,jsonb_build_object('jobId',p_job));
 end if;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 return app.load_catalog_import_jobs(p_actor,p_tenant,p_job);
end;
$$;
revoke all on function app.save_catalog_import_job(uuid,uuid,jsonb,jsonb,text,text),
 app.load_catalog_import_jobs(uuid,uuid,uuid),app.cancel_catalog_import_job(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function app.save_catalog_import_job(uuid,uuid,jsonb,jsonb,text,text),
 app.load_catalog_import_jobs(uuid,uuid,uuid),app.cancel_catalog_import_job(uuid,uuid,uuid,text) to hcs_hyperdrive;
commit;
