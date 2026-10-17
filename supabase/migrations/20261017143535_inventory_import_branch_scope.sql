begin;

create function app.require_inventory_import_scope(p_actor_user_id uuid, p_tenant_id uuid, p_batch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_is_owner boolean; v_creator uuid;
begin
  select m.is_owner into v_is_owner from app.tenant_memberships m
  where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active'
    and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant_id and mr.user_id=p_actor_user_id and rp.permission_code='inventory.manage'));
  if not found then raise exception using errcode='HCS17',message='Inventory management is not allowed'; end if;
  select b.created_by into v_creator from app.inventory_import_batches b where b.tenant_id=p_tenant_id and b.id=p_batch_id;
  if not found then raise exception using errcode='HCS32',message='Inventory import batch was not found'; end if;
  if not v_is_owner and exists(
    select 1 from app.inventory_import_rows r
    left join app.locations l on l.tenant_id=r.tenant_id and lower(l.code::text)=lower(btrim(r.branch_code))
    where r.tenant_id=p_tenant_id and r.batch_id=p_batch_id
      and (case when coalesce(r.location_id,l.id) is null then v_creator<>p_actor_user_id
        else not app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,coalesce(r.location_id,l.id)) end)
  ) then raise exception using errcode='HCS32',message='Inventory import batch was not found'; end if;
end;
$$;
revoke all on function app.require_inventory_import_scope(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

alter function app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text) rename to inventory_import_preview_scope_core;
alter function app.post_inventory_import(uuid,uuid,uuid,text,text,text) rename to inventory_import_post_scope_core;
alter function app.reconcile_inventory_import(uuid,uuid,uuid,text,text,text) rename to inventory_import_reconcile_scope_core;
revoke all on function app.inventory_import_preview_scope_core(uuid,uuid,text,timestamptz,jsonb,text,text,text),
  app.inventory_import_post_scope_core(uuid,uuid,uuid,text,text,text),
  app.inventory_import_reconcile_scope_core(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.preview_inventory_import(p_actor_user_id uuid,p_tenant_id uuid,p_filename text,p_cutover_at timestamptz,p_rows jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb;
begin
  v_response:=app.inventory_import_preview_scope_core(p_actor_user_id,p_tenant_id,p_filename,p_cutover_at,p_rows,p_idempotency_key,p_request_hash,p_request_id);
  -- A denied preview rolls back its rows, idempotency, audit and outbox together.
  perform app.require_inventory_import_scope(p_actor_user_id,p_tenant_id,(v_response->>'batchId')::uuid);
  return v_response;
end;
$$;

create function app.post_inventory_import(p_actor_user_id uuid,p_tenant_id uuid,p_batch_id uuid,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb;
begin
  perform app.require_inventory_import_scope(p_actor_user_id,p_tenant_id,p_batch_id);
  v_response:=app.inventory_import_post_scope_core(p_actor_user_id,p_tenant_id,p_batch_id,p_idempotency_key,p_request_hash,p_request_id);
  if (v_response->>'batchId')::uuid is distinct from p_batch_id then
    raise exception using errcode='HCS08',message='Idempotency key conflict';
  end if;
  return v_response;
end;
$$;

create function app.reconcile_inventory_import(p_actor_user_id uuid,p_tenant_id uuid,p_batch_id uuid,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response jsonb;
begin
  perform app.require_inventory_import_scope(p_actor_user_id,p_tenant_id,p_batch_id);
  v_response:=app.inventory_import_reconcile_scope_core(p_actor_user_id,p_tenant_id,p_batch_id,p_idempotency_key,p_request_hash,p_request_id);
  if (v_response->>'batchId')::uuid is distinct from p_batch_id then
    raise exception using errcode='HCS08',message='Idempotency key conflict';
  end if;
  return v_response;
end;
$$;
revoke all on function app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text),
  app.post_inventory_import(uuid,uuid,uuid,text,text,text),app.reconcile_inventory_import(uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text),
  app.post_inventory_import(uuid,uuid,uuid,text,text,text),app.reconcile_inventory_import(uuid,uuid,uuid,text,text,text)
  to hcs_hyperdrive;
commit;
