begin;

alter function app.dispatch_stock_transfer(uuid,uuid,uuid,text,text,text) rename to dispatch_stock_transfer_impl;
alter function app.receive_stock_transfer(uuid,uuid,uuid,jsonb,text,text,text) rename to receive_stock_transfer_impl;
revoke all on function app.dispatch_stock_transfer_impl(uuid,uuid,uuid,text,text,text), app.receive_stock_transfer_impl(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.dispatch_stock_transfer(p_actor_user_id uuid,p_tenant_id uuid,p_transfer_id uuid,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':transfer.dispatch:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='transfer.dispatch' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values(p_tenant_id,'transfer.dispatch',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours');
  end if;
  v_response:=app.dispatch_stock_transfer_impl(p_actor_user_id,p_tenant_id,p_transfer_id,p_idempotency_key,p_request_hash,p_request_id);
  update app.idempotency_records set response_status=200,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='transfer.dispatch' and idempotency_key=p_idempotency_key;
  return v_response;
end; $$;

create function app.receive_stock_transfer(p_actor_user_id uuid,p_tenant_id uuid,p_transfer_id uuid,p_items jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing app.idempotency_records%rowtype; v_response jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':transfer.receive:'||p_idempotency_key,0));
  select * into v_existing from app.idempotency_records where tenant_id=p_tenant_id and operation='transfer.receive' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,locked_until,expires_at) values(p_tenant_id,'transfer.receive',p_idempotency_key,p_request_hash,now()+interval '1 minute',now()+interval '24 hours');
  end if;
  v_response:=app.receive_stock_transfer_impl(p_actor_user_id,p_tenant_id,p_transfer_id,p_items,p_idempotency_key,p_request_hash,p_request_id);
  update app.idempotency_records set response_status=201,response_body=v_response,completed_at=now(),locked_until=null where tenant_id=p_tenant_id and operation='transfer.receive' and idempotency_key=p_idempotency_key;
  return v_response;
end; $$;

revoke all on function app.dispatch_stock_transfer(uuid,uuid,uuid,text,text,text), app.receive_stock_transfer(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.dispatch_stock_transfer(uuid,uuid,uuid,text,text,text), app.receive_stock_transfer(uuid,uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;

commit;
