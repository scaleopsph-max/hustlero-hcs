begin;

alter function app.list_transfer_context(uuid,uuid) rename to transfer_context_scope_core;
alter function app.create_stock_transfer(uuid,uuid,text,uuid,uuid,jsonb,text,text,text) rename to transfer_create_scope_core;
alter function app.dispatch_stock_transfer(uuid,uuid,uuid,text,text,text) rename to transfer_dispatch_scope_core;
alter function app.receive_stock_transfer(uuid,uuid,uuid,jsonb,text,text,text) rename to transfer_receive_scope_core;
revoke all on function app.transfer_context_scope_core(uuid,uuid),
 app.transfer_create_scope_core(uuid,uuid,text,uuid,uuid,jsonb,text,text,text),
 app.transfer_dispatch_scope_core(uuid,uuid,uuid,text,text,text),
 app.transfer_receive_scope_core(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;

create function app.require_transfer_location_access(p_actor uuid,p_tenant uuid,p_location uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor
  and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr
   join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='transfers.manage')))
 then raise exception using errcode='HCS50',message='Transfer management is not allowed'; end if;
 if not app.can_read_wholesale_location(p_actor,p_tenant,p_location) then
  raise exception using errcode='HCS55',message='Transfer was not found';
 end if;
end;
$$;
revoke all on function app.require_transfer_location_access(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;

create function app.list_transfer_context(p_actor_user_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_rows jsonb; v_action_locations jsonb;
begin
 v_result:=app.transfer_context_scope_core(p_actor_user_id,p_tenant_id);
 select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into v_rows
 from jsonb_array_elements(v_result->'transfers') with ordinality item(value,ordinality)
 where app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,(item.value->>'sourceLocationId')::uuid)
    or app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,(item.value->>'destinationLocationId')::uuid);
 select coalesce(jsonb_agg(l.id order by l.id),'[]'::jsonb) into v_action_locations
 from app.locations l where l.tenant_id=p_tenant_id and l.is_active
  and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,l.id)
  and exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id
   and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr
    join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
    where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='transfers.manage')));
 -- Location names remain routing configuration, not access to balances at other branches.
 return v_result || jsonb_build_object('transfers',v_rows,'actionLocationIds',v_action_locations);
end;
$$;

create function app.create_stock_transfer(p_actor_user_id uuid,p_tenant_id uuid,p_transfer_number text,
 p_source_location_id uuid,p_destination_location_id uuid,p_items jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform app.require_transfer_location_access(p_actor_user_id,p_tenant_id,p_source_location_id);
 return app.transfer_create_scope_core(p_actor_user_id,p_tenant_id,p_transfer_number,p_source_location_id,
  p_destination_location_id,p_items,p_idempotency_key,p_request_hash,p_request_id);
end;
$$;

create function app.dispatch_stock_transfer(p_actor_user_id uuid,p_tenant_id uuid,p_transfer_id uuid,
 p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_result jsonb;
begin
 select source_location_id into v_location from app.stock_transfers where tenant_id=p_tenant_id and id=p_transfer_id;
 perform app.require_transfer_location_access(p_actor_user_id,p_tenant_id,v_location);
 v_result:=app.transfer_dispatch_scope_core(p_actor_user_id,p_tenant_id,p_transfer_id,p_idempotency_key,p_request_hash,p_request_id);
 if v_result->>'stockTransferId' is distinct from p_transfer_id::text then
  raise exception using errcode='HCS08',message='Idempotency key conflict';
 end if;
 return v_result;
end;
$$;

create function app.receive_stock_transfer(p_actor_user_id uuid,p_tenant_id uuid,p_transfer_id uuid,
 p_items jsonb,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_result jsonb;
begin
 select destination_location_id into v_location from app.stock_transfers where tenant_id=p_tenant_id and id=p_transfer_id;
 perform app.require_transfer_location_access(p_actor_user_id,p_tenant_id,v_location);
 v_result:=app.transfer_receive_scope_core(p_actor_user_id,p_tenant_id,p_transfer_id,p_items,p_idempotency_key,p_request_hash,p_request_id);
 if v_result->>'stockTransferId' is distinct from p_transfer_id::text then
  raise exception using errcode='HCS08',message='Idempotency key conflict';
 end if;
 return v_result;
end;
$$;

revoke all on function app.list_transfer_context(uuid,uuid),
 app.create_stock_transfer(uuid,uuid,text,uuid,uuid,jsonb,text,text,text),
 app.dispatch_stock_transfer(uuid,uuid,uuid,text,text,text),app.receive_stock_transfer(uuid,uuid,uuid,jsonb,text,text,text)
 from public,anon,authenticated;
grant execute on function app.list_transfer_context(uuid,uuid),
 app.create_stock_transfer(uuid,uuid,text,uuid,uuid,jsonb,text,text,text),
 app.dispatch_stock_transfer(uuid,uuid,uuid,text,text,text),app.receive_stock_transfer(uuid,uuid,uuid,jsonb,text,text,text)
 to hcs_hyperdrive;

-- Keep the established receiving command; correct its destination cost calculation.
create or replace function app.receive_stock_transfer_impl(p_actor_user_id uuid,p_tenant_id uuid,p_transfer_id uuid,p_items jsonb,p_idempotency_key text,p_request_hash text,p_request_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_t app.stock_transfers%rowtype; v_i app.stock_transfer_items%rowtype; v_b app.inventory_balances%rowtype; v_item jsonb; v_qty numeric; v_response jsonb; v_count int:=0;
begin
 if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and(m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='transfers.manage'))) then raise exception using errcode='HCS50',message='Transfer management is not allowed'; end if;
 select * into v_t from app.stock_transfers where tenant_id=p_tenant_id and id=p_transfer_id for update; if not found or v_t.status not in('dispatched','partially_received') then raise exception using errcode='HCS55',message='Transfer is not ready to receive'; end if;
 for v_item in select * from jsonb_array_elements(p_items) loop select * into v_i from app.stock_transfer_items where tenant_id=p_tenant_id and id=(v_item->>'stockTransferItemId')::uuid and transfer_id=p_transfer_id for update; if not found then raise exception using errcode='HCS58',message='Transfer item was not found'; end if; v_qty:=(v_item->>'quantityMilli')::numeric/1000; if v_qty is null or v_qty<=0 or v_qty>v_i.requested_quantity-v_i.received_quantity then raise exception using errcode='HCS59',message='Receipt exceeds transfer quantity'; end if; select * into v_b from app.inventory_balances where tenant_id=p_tenant_id and location_id=v_t.destination_location_id and variant_id=v_i.variant_id for update; update app.inventory_balances set in_transit=in_transit-v_qty,on_hand=on_hand+v_qty,average_unit_cost=round((v_b.on_hand*coalesce(v_b.average_unit_cost,v_i.unit_cost)+v_qty*v_i.unit_cost)/(v_b.on_hand+v_qty),2),version=version+1,updated_at=now() where tenant_id=p_tenant_id and location_id=v_t.destination_location_id and variant_id=v_i.variant_id; update app.stock_transfer_items set received_quantity=received_quantity+v_qty where tenant_id=p_tenant_id and id=v_i.id; insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id) values(p_tenant_id,v_t.destination_location_id,v_i.variant_id,'TRANSFER_IN',v_qty,v_i.unit_cost,'stock_transfer',p_transfer_id::text,p_actor_user_id); v_count:=v_count+1; end loop;
 if not exists(select 1 from app.stock_transfer_items where tenant_id=p_tenant_id and transfer_id=p_transfer_id and received_quantity<requested_quantity) then update app.stock_transfers set status='received',received_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=p_transfer_id; else update app.stock_transfers set status='partially_received',updated_at=now() where tenant_id=p_tenant_id and id=p_transfer_id; end if; select status into v_t.status from app.stock_transfers where tenant_id=p_tenant_id and id=p_transfer_id; v_response=jsonb_build_object('stockTransferId',p_transfer_id,'status',v_t.status,'itemCount',v_count); insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id) values(p_tenant_id,p_request_id,'tenant_user',p_actor_user_id,'stock_transfer.received','stock_transfer',p_transfer_id); insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(p_tenant_id,'stock_transfer.received','stock_transfer',p_transfer_id,v_response); return v_response; end; $$;

commit;
