begin;

alter function app.list_purchasing_context(uuid,uuid) rename to purchasing_context_scope_core;
alter function app.create_purchase_order(uuid,uuid,uuid,uuid,text,timestamptz,text,jsonb,text,text,text) rename to purchase_order_create_scope_core;
alter function app.send_purchase_order(uuid,uuid,uuid,text,text,text) rename to purchase_order_send_scope_core;
alter function app.receive_purchase_order(uuid,uuid,uuid,jsonb,text,text,text,text) rename to purchase_order_receive_scope_core;
revoke all on function app.purchasing_context_scope_core(uuid,uuid),
 app.purchase_order_create_scope_core(uuid,uuid,uuid,uuid,text,timestamptz,text,jsonb,text,text,text),
 app.purchase_order_send_scope_core(uuid,uuid,uuid,text,text,text),
 app.purchase_order_receive_scope_core(uuid,uuid,uuid,jsonb,text,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.require_purchase_location_access(p_actor uuid,p_tenant uuid,p_location uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor
  and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr
   join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='purchasing.manage')))
 then raise exception using errcode='HCS30',message='Purchasing management is not allowed'; end if;
 if not app.can_read_wholesale_location(p_actor,p_tenant,p_location) then
  raise exception using errcode='HCS36',message='Purchase order was not found';
 end if;
end;
$$;
revoke all on function app.require_purchase_location_access(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.list_purchasing_context(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 v_result:=app.purchasing_context_scope_core(p_actor_user_id,p_tenant_id);
 return v_result || jsonb_build_object(
  'locations',app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'locations','id'),
  'orders',app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'orders','locationId'));
end;
$$;

create function app.create_purchase_order(p_actor_user_id uuid,p_tenant_id uuid,p_supplier_id uuid,p_location_id uuid,
 p_order_number text,p_expected_at timestamptz,p_notes text,p_lines jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform app.require_purchase_location_access(p_actor_user_id,p_tenant_id,p_location_id);
 return app.purchase_order_create_scope_core(p_actor_user_id,p_tenant_id,p_supplier_id,p_location_id,
  p_order_number,p_expected_at,p_notes,p_lines,p_idempotency_key,p_request_hash,p_request_id);
end;
$$;

create function app.send_purchase_order(p_actor_user_id uuid,p_tenant_id uuid,p_purchase_order_id uuid,
 p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_result jsonb;
begin
 select location_id into v_location from app.purchase_orders where tenant_id=p_tenant_id and id=p_purchase_order_id;
 perform app.require_purchase_location_access(p_actor_user_id,p_tenant_id,v_location);
 v_result:=app.purchase_order_send_scope_core(p_actor_user_id,p_tenant_id,p_purchase_order_id,p_idempotency_key,p_request_hash,p_request_id);
 if v_result->>'purchaseOrderId' is distinct from p_purchase_order_id::text then
  raise exception using errcode='HCS08',message='Idempotency key conflict';
 end if;
 return v_result;
end;
$$;

create function app.receive_purchase_order(p_actor_user_id uuid,p_tenant_id uuid,p_purchase_order_id uuid,
 p_lines jsonb,p_delivery_reference text,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_result jsonb;
begin
 select location_id into v_location from app.purchase_orders where tenant_id=p_tenant_id and id=p_purchase_order_id;
 perform app.require_purchase_location_access(p_actor_user_id,p_tenant_id,v_location);
 v_result:=app.purchase_order_receive_scope_core(p_actor_user_id,p_tenant_id,p_purchase_order_id,p_lines,
  p_delivery_reference,p_idempotency_key,p_request_hash,p_request_id);
 if v_result->>'purchaseOrderId' is distinct from p_purchase_order_id::text then
  raise exception using errcode='HCS08',message='Idempotency key conflict';
 end if;
 return v_result;
end;
$$;

revoke all on function app.list_purchasing_context(uuid,uuid),
 app.create_purchase_order(uuid,uuid,uuid,uuid,text,timestamptz,text,jsonb,text,text,text),
 app.send_purchase_order(uuid,uuid,uuid,text,text,text),app.receive_purchase_order(uuid,uuid,uuid,jsonb,text,text,text,text)
 from public,anon,authenticated;
grant execute on function app.list_purchasing_context(uuid,uuid),
 app.create_purchase_order(uuid,uuid,uuid,uuid,text,timestamptz,text,jsonb,text,text,text),
 app.send_purchase_order(uuid,uuid,uuid,text,text,text),app.receive_purchase_order(uuid,uuid,uuid,jsonb,text,text,text,text)
 to hcs_hyperdrive;

commit;
