begin;

-- Private entry guards hold current tenant, membership, permission and branch
-- rows for the entire transaction, including cached responses after row waits.
create function app.lock_discount_reversal_access(p_actor uuid,p_tenant uuid,p_sale uuid,p_permission text)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean;v_location uuid;v_ent app.tenant_entitlements%rowtype;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
 perform 1 from app.features where code='sales' and platform_available for share;
 if not found then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
 select * into v_ent from app.tenant_entitlements where tenant_id=p_tenant and feature_code='sales' for share;
 if not found or not v_ent.entitled or not v_ent.enabled or v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp()
 then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found or p_permission not in ('sales.read','sales.refund','sales.void') then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
 if not v_owner then
  perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
  where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code=p_permission order by mr.role_id for share of mr,rp;
  if not found then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
 end if;
 select location_id into v_location from app.sales where tenant_id=p_tenant and id=p_sale;
 if not found then raise exception using errcode='HCSA1',message='Sale was not found'; end if;
 perform 1 from app.locations where tenant_id=p_tenant and id=v_location and is_active for share;
 if not found then raise exception using errcode='HCSA1',message='Sale was not found'; end if;
 if not v_owner then
  perform 1 from app.employees e join app.employee_locations el on el.tenant_id=e.tenant_id and el.employee_id=e.id
  where e.tenant_id=p_tenant and e.user_id=p_actor and e.status='active' and el.location_id=v_location order by e.id for share of e,el;
  if not found then raise exception using errcode='HCSA1',message='Sale was not found'; end if;
 end if;
 if v_ent.starts_at>clock_timestamp() or v_ent.ends_at<=clock_timestamp() then raise exception using errcode='HCSA0',message='Sales access is not allowed'; end if;
end; $$;

-- Also used by the read projection. Caller must first authorize; no direct grant.
create function app.discount_return_snapshot(p_tenant uuid,p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h app.pos_sale_discount_snapshots%rowtype;s app.sales%rowtype;r record;v_rows jsonb:='[]';
 v_gross numeric:=0;v_discount numeric:=0;v_net numeric:=0;v_refund numeric:=0;v_count integer:=0;v_through numeric:=0;
begin
 select * into h from app.pos_sale_discount_snapshots where tenant_id=p_tenant and sale_id=p_sale;
 if not found then raise exception using errcode='HCSA7',message='Original discount snapshots do not reconcile'; end if;
 select * into s from app.sales where tenant_id=p_tenant and id=p_sale;
 if not found or s.channel<>'pos' or s.tax_total<>0 or round(s.subtotal*100)<>h.subtotal_minor
 or round(s.discount_total*100)<>h.discount_minor or round(s.total*100)<>h.payable_minor
 then raise exception using errcode='HCSA7',message='Original discount snapshots do not reconcile'; end if;
 for r in select sl.*,d.gross_minor,d.discount_minor,d.net_minor,coalesce(x.quantity,0) refunded_quantity,coalesce(x.amount,0) refunded_amount
 from app.sale_lines sl left join app.pos_sale_line_discounts d on d.tenant_id=sl.tenant_id and d.sale_id=sl.sale_id and d.sale_line_id=sl.id
 left join lateral(select sum(ri.quantity) quantity,sum(ri.amount) amount from app.refund_items ri join app.refunds rf on rf.tenant_id=ri.tenant_id and rf.id=ri.refund_id
 where ri.tenant_id=sl.tenant_id and ri.sale_line_id=sl.id and rf.sale_id=p_sale and rf.status='completed') x on true
 where sl.tenant_id=p_tenant and sl.sale_id=p_sale order by sl.id loop
  v_count:=v_count+1;v_gross:=v_gross+coalesce(r.gross_minor,0);
  if r.gross_minor is null or r.pricing_type is distinct from 'retail' or r.gross_minor<>round(r.line_total*100)
  or r.net_minor<>r.gross_minor-r.discount_minor or r.discount_minor<>round(h.discount_minor*v_gross/h.subtotal_minor)-v_through
  or r.refunded_quantity>r.quantity or round(r.refunded_amount*100)<>round(r.net_minor*r.refunded_quantity/r.quantity)
  then raise exception using errcode='HCSA7',message='Original discount snapshots do not reconcile'; end if;
  v_through:=round(h.discount_minor*v_gross/h.subtotal_minor);v_discount:=v_discount+r.discount_minor;v_net:=v_net+r.net_minor;v_refund:=v_refund+round(r.refunded_amount*100);
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('saleLineId',r.id,'quantityMilli',round(r.quantity*1000)::bigint,
  'grossMinor',r.gross_minor::bigint,'discountMinor',r.discount_minor::bigint,'netMinor',r.net_minor::bigint,
  'refundedQuantityMilli',round(r.refunded_quantity*1000)::bigint,'refundedMinor',round(r.refunded_amount*100)::bigint));
 end loop;
 if v_count not between 1 and 200 or v_gross<>h.subtotal_minor or v_discount<>h.discount_minor or v_net<>h.payable_minor
 or v_refund<>coalesce((select round(sum(amount)*100) from app.refunds where tenant_id=p_tenant and sale_id=p_sale and status='completed'),0)
 or v_refund>v_net then raise exception using errcode='HCSA7',message='Original discount snapshots do not reconcile'; end if;
 return jsonb_build_object('subtotalMinor',h.subtotal_minor::bigint,'discountMinor',h.discount_minor::bigint,'totalMinor',h.payable_minor::bigint,
 'refundedMinor',v_refund::bigint,'lines',v_rows);
end; $$;

create function app.reverse_discounted_cash_sale(p_actor uuid,p_tenant uuid,p_sale uuid,p_type text,p_lines jsonb,p_reason text,p_key text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sale app.sales%rowtype;v_existing app.idempotency_records%rowtype;v_session app.register_sessions%rowtype;
 v_payment app.sale_payments%rowtype;v_hash text;v_snapshot jsonb;v_line jsonb;v_original jsonb;v_rows jsonb:='[]';
 v_quantity numeric;v_amount numeric;v_total numeric:=0;v_prior numeric;v_refund uuid:=gen_random_uuid();v_status text;v_response jsonb;v_time timestamptz;
 v_method text;v_item record;v_balance app.inventory_balances%rowtype;
begin
 if p_type is null or p_type not in ('refund','void') or p_reason is null or char_length(btrim(p_reason)) not between 3 and 240
 or p_key is null or char_length(p_key) not between 8 and 128 then raise exception using errcode='HCSA2',message='Sale reversal is invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':sale.'||p_type||':'||p_key,0));
 perform app.lock_discount_reversal_access(p_actor,p_tenant,p_sale,'sales.'||p_type);
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'tenant',p_tenant,'sale',p_sale,'type',p_type,'lines',p_lines,'reason',p_reason)::text,'sha256'),'hex');
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='sale.'||p_type and idempotency_key=p_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
  if v_existing.completed_at is not null then return v_existing.response_body; end if;
 end if;
 select * into v_sale from app.sales where tenant_id=p_tenant and id=p_sale for update;
 if not found then raise exception using errcode='HCSA1',message='Sale was not found'; end if;
 if (p_type='void' and v_sale.status<>'completed') or (p_type='refund' and v_sale.status not in ('completed','partially_refunded'))
 then raise exception using errcode='HCSA3',message='Sale cannot be reversed in its current state'; end if;
 select * into v_session from app.register_sessions where tenant_id=p_tenant and id=v_sale.register_session_id for update;
 if not found or v_session.status<>'open' then raise exception using errcode='HCSA6',message='Original register session must be open'; end if;
 if (select count(*) from app.sale_payments where tenant_id=p_tenant and sale_id=p_sale)<>1 then raise exception using errcode='HCSA7',message='Only single cash sale reversals are available'; end if;
 select * into v_payment from app.sale_payments where tenant_id=p_tenant and sale_id=p_sale for update;
 select method_type into v_method from app.payment_methods where tenant_id=p_tenant and id=v_payment.payment_method_id for share;
 if v_method is distinct from 'cash' or v_payment.amount<>v_sale.total then raise exception using errcode='HCSA7',message='Only single cash sale reversals are available'; end if;
 v_snapshot:=app.discount_return_snapshot(p_tenant,p_sale);
 v_prior:=(v_snapshot->>'refundedMinor')::numeric;
 if coalesce((select round(sum(amount)*100) from app.payment_reversals where tenant_id=p_tenant and sale_payment_id=v_payment.id and status='completed'),0)<>v_prior
 then raise exception using errcode='HCSA7',message='Original discount snapshots do not reconcile'; end if;
 if p_type='void' then
  select jsonb_agg(jsonb_build_object('saleLineId',value->>'saleLineId','quantityMilli',(value->>'quantityMilli')::bigint-(value->>'refundedQuantityMilli')::bigint,'returnToStock',true) order by value->>'saleLineId')
  into p_lines from jsonb_array_elements(v_snapshot->'lines');
 end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception using errcode='HCSA2',message='Sale reversal lines are invalid'; end if;
 if jsonb_array_length(p_lines) not between 1 and 200 or exists(select 1 from jsonb_array_elements(p_lines) x
 where jsonb_typeof(x)<>'object' or x->>'saleLineId' is null or x->>'quantityMilli' is null or x->>'quantityMilli' !~ '^[1-9][0-9]*$'
 or jsonb_typeof(x->'returnToStock') is distinct from 'boolean')
 or exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'saleLineId' having count(*)>1)
 then raise exception using errcode='HCSA2',message='Sale reversal lines are invalid'; end if;
 for v_line in select value from jsonb_array_elements(p_lines) order by value->>'saleLineId' loop
  select value into v_original from jsonb_array_elements(v_snapshot->'lines') where value->>'saleLineId'=v_line->>'saleLineId';
  if not found then raise exception using errcode='HCSA4',message='Sale line was not found'; end if;
  v_quantity:=(v_line->>'quantityMilli')::numeric;
  if v_quantity>(v_original->>'quantityMilli')::numeric-(v_original->>'refundedQuantityMilli')::numeric then raise exception using errcode='HCSA5',message='Refund quantity exceeds the remaining quantity'; end if;
  v_amount:=round((v_original->>'netMinor')::numeric*((v_original->>'refundedQuantityMilli')::numeric+v_quantity)/(v_original->>'quantityMilli')::numeric)-(v_original->>'refundedMinor')::numeric;
  if v_amount<=0 then raise exception using errcode='HCSA7',message='Selected quantity has no refundable centavo'; end if;
  if v_line?'expectedAmountCentavos' then
   if jsonb_typeof(v_line->'expectedAmountCentavos') is distinct from 'number' or (v_line->>'expectedAmountCentavos') !~ '^[1-9][0-9]*$'
   then raise exception using errcode='HCSA2',message='Sale reversal lines are invalid'; end if;
   if (v_line->>'expectedAmountCentavos')::numeric<>v_amount then raise exception using errcode='HCSA3',message='Refund quote changed; refresh the receipt before another request'; end if;
  end if;
  v_total:=v_total+v_amount;v_rows:=v_rows||jsonb_build_array(v_line||jsonb_build_object('amountMinor',v_amount));
 end loop;
 if v_total<=0 or v_total>(v_snapshot->>'totalMinor')::numeric-v_prior then raise exception using errcode='HCSA5',message='Refund amount exceeds the remaining payment'; end if;
 -- No silent exhausted-payment state with unreturned physical units; zero-only
 -- returns remain outside v1. A larger selection/full return can resolve this.
 if v_total+v_prior=(v_snapshot->>'totalMinor')::numeric and exists(select 1 from jsonb_array_elements(v_snapshot->'lines') original
 left join lateral(select (value->>'quantityMilli')::numeric quantity from jsonb_array_elements(v_rows) where value->>'saleLineId'=original->>'saleLineId') selected on true
 where (original->>'quantityMilli')::numeric>(original->>'refundedQuantityMilli')::numeric+coalesce(selected.quantity,0))
 then raise exception using errcode='HCSA7',message='Select all remaining quantities before exhausting the payment'; end if;
 -- Same canonical inventory row order as sales. Only actual restock selections lock.
 perform 1 from app.inventory_balances b where b.tenant_id=p_tenant and b.location_id=v_sale.location_id
 and b.variant_id in(select sl.variant_id from app.sale_lines sl join jsonb_array_elements(v_rows) x on sl.id=(x->>'saleLineId')::uuid
 where sl.tenant_id=p_tenant and sl.sale_id=p_sale and (x->>'returnToStock')::boolean) order by b.variant_id for update;
 perform app.lock_discount_reversal_access(p_actor,p_tenant,p_sale,'sales.'||p_type);
 v_time:=clock_timestamp();
 insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by,completed_at,created_at)
 values(v_refund,p_tenant,p_sale,p_type,v_total/100,btrim(p_reason),p_actor,v_time,v_time);
 for v_item in select sl.*,x.value item from app.sale_lines sl join jsonb_array_elements(v_rows) x(value) on sl.id=(x.value->>'saleLineId')::uuid
 where sl.tenant_id=p_tenant and sl.sale_id=p_sale order by sl.variant_id,sl.id loop
  v_quantity:=(v_item.item->>'quantityMilli')::numeric/1000;
  insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock,created_at)
  values(p_tenant,v_refund,v_item.id,v_quantity,(v_item.item->>'amountMinor')::numeric/100,(v_item.item->>'returnToStock')::boolean,v_time);
  if (v_item.item->>'returnToStock')::boolean and exists(select 1 from app.inventory_movements where tenant_id=p_tenant
  and location_id=v_sale.location_id and variant_id=v_item.variant_id and movement_type='SALE' and source_type='sale' and source_reference=p_sale::text) then
   select * into v_balance from app.inventory_balances where tenant_id=p_tenant and location_id=v_sale.location_id and variant_id=v_item.variant_id for update;
   if not found or v_balance.on_hand<0 or v_item.unit_cost is null or (v_balance.on_hand>0 and v_balance.average_unit_cost is null)
   then raise exception using errcode='HCSA7',message='Return inventory requires reconciliation'; end if;
   update app.inventory_balances set on_hand=on_hand+v_quantity,
   average_unit_cost=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,v_item.unit_cost)+v_quantity*v_item.unit_cost)/(v_balance.on_hand+v_quantity),2),
   version=version+1,updated_at=v_time where tenant_id=p_tenant and location_id=v_sale.location_id and variant_id=v_item.variant_id;
   insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id,occurred_at,created_at)
   values(p_tenant,v_sale.location_id,v_item.variant_id,'REFUND',v_quantity,v_item.unit_cost,p_type,v_refund::text,p_actor,v_time,v_time);
  end if;
 end loop;
 insert into app.payment_reversals(tenant_id,refund_id,sale_payment_id,amount,created_at) values(p_tenant,v_refund,v_payment.id,v_total/100,v_time);
 insert into app.cash_movements(tenant_id,register_session_id,location_id,movement_type,amount,source_type,source_id,reason,actor_user_id,occurred_at)
 values(p_tenant,v_sale.register_session_id,v_sale.location_id,'cash_refund',-v_total/100,p_type,v_refund,btrim(p_reason),p_actor,v_time);
 v_status:=case when p_type='void' then 'voided' when v_total+v_prior=(v_snapshot->>'totalMinor')::numeric then 'refunded' else 'partially_refunded' end;
 update app.sales set status=v_status where tenant_id=p_tenant and id=p_sale;
 if v_status in ('refunded','voided') then update app.sale_payments set status=v_status where tenant_id=p_tenant and id=v_payment.id; end if;
 v_response:=jsonb_build_object('reversalId',v_refund,'saleId',p_sale,'receiptNumber',v_sale.receipt_number,'type',p_type,'saleStatus',v_status,'amountCentavos',v_total::bigint,'completedAt',v_time);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'sale.'||case when p_type='void' then 'voided' else 'refunded' end,p_type,v_refund,v_sale.location_id,btrim(p_reason),jsonb_build_object('saleId',p_sale,'amount',v_total/100),v_time);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at)
 values(p_tenant,'sale.'||case when p_type='void' then 'voided' else 'refunded' end,p_type,v_refund,v_response,v_time,v_time);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,expires_at,response_status,response_body,completed_at)
 values(p_tenant,'sale.'||p_type,p_key,v_hash,v_time+interval '24 hours',201,v_response,v_time)
 on conflict(tenant_id,operation,idempotency_key) do update set response_status=201,response_body=excluded.response_body,completed_at=v_time;
 perform app.lock_discount_reversal_access(p_actor,p_tenant,p_sale,'sales.'||p_type);
 return v_response;
end; $$;

-- Normal reversals keep their original authorized implementation.
alter function app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text) rename to reverse_sale_before_discount;
revoke all on function app.reverse_sale_before_discount(uuid,uuid,uuid,text,jsonb,text,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
create function app.reverse_sale(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid,p_reversal_type text,p_lines jsonb,p_reason text,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_reversal_type is null or p_reversal_type not in ('refund','void') then raise exception using errcode='HCSA2',message='Sale reversal is invalid'; end if;
 perform app.require_sale_location_access(p_actor_user_id,p_tenant_id,p_sale_id,'sales.'||coalesce(p_reversal_type,''));
 if exists(select 1 from app.sales where tenant_id=p_tenant_id and id=p_sale_id and discount_total<>0) then
  return app.reverse_discounted_cash_sale(p_actor_user_id,p_tenant_id,p_sale_id,p_reversal_type,p_lines,p_reason,p_idempotency_key,p_request_id);
 end if;
 return app.reverse_sale_before_discount(p_actor_user_id,p_tenant_id,p_sale_id,p_reversal_type,p_lines,p_reason,p_idempotency_key,p_request_hash,p_request_id);
end; $$;

alter function app.load_sale_receipt(uuid,uuid,uuid) rename to sale_receipt_before_discount;
revoke all on function app.sale_receipt_before_discount(uuid,uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.load_sale_receipt(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;v_snapshot jsonb;
begin
 v_result:=app.sale_receipt_before_discount(p_actor_user_id,p_tenant_id,p_sale_id);
 if exists(select 1 from app.pos_sale_discount_snapshots where tenant_id=p_tenant_id and sale_id=p_sale_id) then
  perform app.lock_discount_reversal_access(p_actor_user_id,p_tenant_id,p_sale_id,'sales.read');
  v_snapshot:=app.discount_return_snapshot(p_tenant_id,p_sale_id);
  v_result:=v_result||jsonb_build_object('discountReturnSnapshot',v_snapshot,'discountDefinitionSnapshot',
  (select definition_snapshot from app.pos_sale_discount_snapshots where tenant_id=p_tenant_id and sale_id=p_sale_id));
  if exists(select 1 from jsonb_array_elements(v_snapshot->'lines') x where (x->>'netMinor')::numeric=0) then
   v_result:=v_result||jsonb_build_object('canReverse',false,'reversalBlockedReason','Zero-net line returns need a separate stock-return workflow.');
  end if;
 end if;
 return v_result;
end; $$;

revoke all on function app.lock_discount_reversal_access(uuid,uuid,uuid,text),app.discount_return_snapshot(uuid,uuid),
 app.reverse_discounted_cash_sale(uuid,uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated,hcs_hyperdrive;
revoke all on function app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text),app.load_sale_receipt(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text),app.load_sale_receipt(uuid,uuid,uuid) to hcs_hyperdrive;
commit;
