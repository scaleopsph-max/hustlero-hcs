-- Original snapshot valuation with cumulative cent rounding; no historical rewrite.
begin;
alter table app.wholesale_credit_note_lines drop constraint wholesale_credit_note_lines_quantity_check;
alter table app.wholesale_credit_note_lines add constraint wholesale_credit_note_lines_quantity_check check(quantity>0);
alter table app.wholesale_credit_note_lines add column valuation_snapshot jsonb;

-- Owner-approved header allocation. Independent cumulative cent allocation per component
-- conserves the exact header totals; returned money uses cumulative payable valuation.
create function app.wholesale_return_line_valuations(p_tenant uuid,p_invoice uuid)
returns table(invoice_line_id uuid,gross numeric,discount numeric,tax numeric,payable numeric)
language plpgsql stable security definer set search_path='' as $$
declare v_invoice app.invoices%rowtype; v_sale app.sales%rowtype;
begin
 select * into v_invoice from app.invoices where tenant_id=p_tenant and id=p_invoice;
 if not found then return; end if;
 select * into v_sale from app.sales where tenant_id=p_tenant and id=v_invoice.sale_id;
 if not found or v_sale.channel<>'wholesale' or v_sale.customer_id is distinct from v_invoice.customer_id
 or v_sale.location_id<>v_invoice.location_id or v_sale.subtotal<>v_invoice.subtotal
 or v_sale.discount_total<>v_invoice.discount_total or v_sale.tax_total<>v_invoice.tax_total or v_sale.total<>v_invoice.total
 or v_invoice.subtotal<0 or v_invoice.discount_total>v_invoice.subtotal
 or greatest(v_invoice.total,v_invoice.subtotal,v_invoice.tax_total)*100>9007199254740991
 or v_invoice.subtotal<>(select coalesce(sum(l.line_total),0) from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=p_invoice)
 or exists(select 1 from app.invoice_lines l left join app.sale_lines sl on sl.tenant_id=l.tenant_id and sl.id=l.sale_line_id and sl.sale_id=v_sale.id
 where l.tenant_id=p_tenant and l.invoice_id=p_invoice and (sl.id is null or sl.variant_id<>l.variant_id or sl.quantity<>l.quantity
 or sl.unit_price<>l.unit_price or sl.line_total<>l.line_total or l.quantity*1000>9007199254740991
 or l.unit_price*100>9007199254740991 or l.line_total<>round(l.quantity*l.unit_price,2)))
 or (select count(*) from app.sale_lines where tenant_id=p_tenant and sale_id=v_sale.id)<>
 (select count(*) from app.invoice_lines where tenant_id=p_tenant and invoice_id=p_invoice)
 then return; end if;
 if v_invoice.subtotal=0 then
   if v_invoice.tax_total<>0 then return; end if;
   return query select l.id,l.line_total,0::numeric,0::numeric,l.line_total
   from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=p_invoice order by l.id;
   return;
 end if;
 return query with gross_lines as (
 select l.id,l.line_total,sum(l.line_total) over(order by l.id rows unbounded preceding) running
 from app.invoice_lines l where l.tenant_id=p_tenant and l.invoice_id=p_invoice
 ), allocated as (
 select id,line_total,
 round(v_invoice.discount_total*running/v_invoice.subtotal,2)-round(v_invoice.discount_total*(running-line_total)/v_invoice.subtotal,2) allocated_discount,
 round(v_invoice.tax_total*running/v_invoice.subtotal,2)-round(v_invoice.tax_total*(running-line_total)/v_invoice.subtotal,2) allocated_tax
 from gross_lines)
 select id,line_total,allocated_discount,allocated_tax,line_total-allocated_discount+allocated_tax from allocated order by id;
end;
$$;
revoke all on function app.wholesale_return_line_valuations(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create or replace function app.post_wholesale_return(p_actor uuid,p_tenant uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_invoice app.invoices%rowtype; v_sale app.sales%rowtype; v_line app.invoice_lines%rowtype;
 v_balance app.inventory_balances%rowtype; v_existing app.idempotency_records%rowtype;
 v_customer uuid; v_invoice_id uuid; v_item jsonb; v_line_id uuid; v_quantity numeric; v_line_credit numeric;
 v_valuations jsonb; v_line_payable numeric;
 v_prior_quantity numeric; v_prior_credit numeric; v_total numeric:=0; v_prior_total numeric;
 v_paid numeric; v_charge numeric; v_debt_before numeric; v_debt_after numeric; v_new_credit numeric;
 v_refund uuid:=gen_random_uuid(); v_note uuid:=gen_random_uuid(); v_response jsonb;
 v_returned_total numeric; v_cost numeric; v_whole numeric; v_effective_at timestamptz;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 if not(p_payload ?& array['invoiceId','reason','lines'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('invoiceId','reason','lines'))
 or jsonb_typeof(p_payload->'invoiceId') is distinct from 'string'
 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 3 and 240
 or jsonb_typeof(p_payload->'lines') is distinct from 'array'
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='HCWR1',message='Invalid return'; end if;
 begin v_invoice_id:=(p_payload->>'invoiceId')::uuid;
 exception when invalid_text_representation then raise exception using errcode='HCWR1',message='Invalid return'; end;
 for v_item in select value from jsonb_array_elements(p_payload->'lines') loop
   if jsonb_typeof(v_item) is distinct from 'object' then raise exception using errcode='HCWR1',message='Invalid return'; end if;
   if not(v_item ?& array['invoiceLineId','quantityMilli','returnToStock'])
   or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('invoiceLineId','quantityMilli','returnToStock'))
   or jsonb_typeof(v_item->'invoiceLineId') is distinct from 'string'
   or jsonb_typeof(v_item->'quantityMilli') is distinct from 'number'
   or jsonb_typeof(v_item->'returnToStock') is distinct from 'boolean'
   then raise exception using errcode='HCWR1',message='Invalid return'; end if;
   begin v_line_id:=(v_item->>'invoiceLineId')::uuid; v_whole:=(v_item->>'quantityMilli')::numeric;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCWR1',message='Invalid return'; end;
   if v_whole<1 or v_whole>9007199254740991 or trunc(v_whole)<>v_whole then raise exception using errcode='HCWR1',message='Positive integer milli-units required'; end if;
 end loop;
 if (select count(distinct(value->>'invoiceLineId')::uuid) from jsonb_array_elements(p_payload->'lines'))<>jsonb_array_length(p_payload->'lines')
 then raise exception using errcode='HCWR1',message='Duplicate return lines'; end if;
 select customer_id into v_customer from app.invoices where tenant_id=p_tenant and id=v_invoice_id;
 if not found then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
 -- Match the existing payment-command lock order: customer before invoice and inventory.
 perform 1 from app.customers where tenant_id=p_tenant and id=v_customer for update;
 select * into v_invoice from app.invoices where tenant_id=p_tenant and id=v_invoice_id for update;
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_invoice.location_id)
 then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
 perform app.lock_wholesale_return_location(p_actor,p_tenant,v_invoice.location_id);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':wholesale-return:'||p_key,0));
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='wholesale_return.post' and idempotency_key=p_key;
 if found then
   if v_existing.request_hash<>p_hash or v_existing.completed_at is null or not exists(
     select 1 from app.wholesale_credit_notes where tenant_id=p_tenant and id=(v_existing.response_body->>'creditNoteId')::uuid
     and invoice_id=v_invoice.id and recorded_by=p_actor and request_body=p_payload)
   then raise exception using errcode='HCS08',message='Idempotency conflict'; end if;
   return v_existing.response_body;
 end if;
 select * into v_sale from app.sales where tenant_id=p_tenant and id=v_invoice.sale_id for update;
 if v_sale.channel<>'wholesale' or v_sale.customer_id is distinct from v_invoice.customer_id or v_sale.location_id<>v_invoice.location_id
 or v_sale.status not in ('completed','partially_refunded') or v_sale.total<>v_invoice.total
 then raise exception using errcode='HCWR3',message='Invoice sale cannot be returned'; end if;
 select jsonb_object_agg(invoice_line_id::text,jsonb_build_object('policy','header_gross_proportional_v1',
 'grossMinor',(gross*100)::bigint,'discountMinor',(discount*100)::bigint,'taxMinor',(tax*100)::bigint,'payableMinor',(payable*100)::bigint))
 into v_valuations from app.wholesale_return_line_valuations(p_tenant,v_invoice.id);
 if v_valuations is null then raise exception using errcode='HCWR3',message='Original invoice valuation requires reconciliation'; end if;
 select coalesce(sum(amount),0) into v_prior_total from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=v_invoice.id;
 if (select coalesce(sum(amount),0) from app.refunds where tenant_id=p_tenant and sale_id=v_sale.id)<>v_prior_total
 then raise exception using errcode='HCWR3',message='Commercial reversal history requires reconciliation'; end if;
 select coalesce((select amount from app.wholesale_receivable_charges where tenant_id=p_tenant and invoice_id=v_invoice.id),
 (select amount from app.wholesale_invoice_charges where tenant_id=p_tenant and invoice_id=v_invoice.id)) into v_charge;
 if v_charge is null or v_charge<>v_invoice.total then raise exception using errcode='HCWR3',message='Invoice classification requires reconciliation'; end if;
 for v_item in select value from jsonb_array_elements(p_payload->'lines') order by (value->>'invoiceLineId')::uuid loop
   select * into v_line from app.invoice_lines where tenant_id=p_tenant and invoice_id=v_invoice.id and id=(v_item->>'invoiceLineId')::uuid;
   if not found then raise exception using errcode='HCWR2',message='Return scope unavailable'; end if;
   v_quantity:=(v_item->>'quantityMilli')::numeric/1000;
   v_line_payable:=(v_valuations->v_line.id::text->>'payableMinor')::numeric/100;
   select coalesce(sum(quantity),0),coalesce(sum(amount),0) into v_prior_quantity,v_prior_credit
   from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=v_line.id;
   if v_line.quantity*1000>9007199254740991 or v_line.unit_price*100>9007199254740991
   or v_line.unit_price<=0 or v_line.line_total<>round(v_line.quantity*v_line.unit_price,2)
   or v_line_payable is null or v_line_payable<=0 or v_prior_credit<>round(v_line_payable*v_prior_quantity/v_line.quantity,2)
   then raise exception using errcode='HCWR3',message='Original line valuation is unsupported'; end if;
   if v_quantity>v_line.quantity-v_prior_quantity then raise exception using errcode='HCWR4',message='Return exceeds remaining fulfilled quantity'; end if;
   if not exists(select 1 from app.sale_lines sl where sl.tenant_id=p_tenant and sl.id=v_line.sale_line_id and sl.sale_id=v_sale.id
     and sl.variant_id=v_line.variant_id and sl.quantity=v_line.quantity and sl.unit_price=v_line.unit_price and sl.line_total=v_line.line_total)
   then raise exception using errcode='HCWR3',message='Invoice and sale line snapshots disagree'; end if;
   v_line_credit:=round(v_line_payable*(v_prior_quantity+v_quantity)/v_line.quantity,2)-v_prior_credit;
   if v_line_credit<=0 then raise exception using errcode='HCWR4',message='Selected quantity has no refundable centavo'; end if;
   v_total:=v_total+v_line_credit;
 end loop;
 select coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=v_invoice.id),0)
  +coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=v_invoice.id),0) into v_paid;
 if v_total<=0 or v_total*100>9007199254740991 or v_prior_total+v_total>v_charge or v_paid>v_charge
 then raise exception using errcode='HCWR4',message='Credit exceeds remaining original invoice'; end if;
 v_debt_before:=greatest(v_charge-v_prior_total-v_paid,0); v_debt_after:=greatest(v_charge-v_prior_total-v_total-v_paid,0);
 v_new_credit:=greatest(v_paid-(v_charge-v_prior_total-v_total),0)-greatest(v_paid-(v_charge-v_prior_total),0);
 -- Acquire all stock locks before choosing the single effective time for this business event.
 perform 1 from app.inventory_balances b join app.invoice_lines l
 on l.tenant_id=b.tenant_id and l.variant_id=b.variant_id and l.invoice_id=v_invoice.id
 join jsonb_array_elements(p_payload->'lines') item on l.id=(item.value->>'invoiceLineId')::uuid
 where b.tenant_id=p_tenant and b.location_id=v_invoice.location_id and (item.value->>'returnToStock')::boolean
 order by b.variant_id,l.id for update of b;
 perform app.lock_wholesale_return_access(p_actor,p_tenant,'wholesale_returns.post');
 v_effective_at:=clock_timestamp();
 insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by,completed_at,created_at)
 values(v_refund,p_tenant,v_sale.id,'refund',v_total,btrim(p_payload->>'reason'),p_actor,v_effective_at,v_effective_at);
 insert into app.wholesale_credit_notes(id,tenant_id,invoice_id,customer_id,refund_id,amount,debt_reduction,customer_credit,reason,request_body,recorded_by,recorded_at)
 values(v_note,p_tenant,v_invoice.id,v_customer,v_refund,v_total,v_debt_before-v_debt_after,v_new_credit,btrim(p_payload->>'reason'),p_payload,p_actor,v_effective_at);
 -- Stable variant ordering also serializes different invoices returning the same branch stock.
 for v_item in select item.value from jsonb_array_elements(p_payload->'lines') item
 join app.invoice_lines line on line.tenant_id=p_tenant and line.invoice_id=v_invoice.id and line.id=(item.value->>'invoiceLineId')::uuid
 order by line.variant_id,line.id loop
   select * into v_line from app.invoice_lines where tenant_id=p_tenant and id=(v_item->>'invoiceLineId')::uuid;
   v_quantity:=(v_item->>'quantityMilli')::numeric/1000;
   select coalesce(sum(quantity),0),coalesce(sum(amount),0) into v_prior_quantity,v_prior_credit from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=v_line.id;
   v_line_payable:=(v_valuations->v_line.id::text->>'payableMinor')::numeric/100;
   v_line_credit:=round(v_line_payable*(v_prior_quantity+v_quantity)/v_line.quantity,2)-v_prior_credit;
   insert into app.wholesale_credit_note_lines(tenant_id,credit_note_id,invoice_line_id,quantity,amount,return_to_stock,valuation_snapshot)
   values(p_tenant,v_note,v_line.id,v_quantity,v_line_credit,(v_item->>'returnToStock')::boolean,
     (v_valuations->v_line.id::text)||jsonb_build_object('originalQuantityMilli',(v_line.quantity*1000)::bigint));
   insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock,created_at)
   values(p_tenant,v_refund,v_line.sale_line_id,v_quantity,v_line_credit,(v_item->>'returnToStock')::boolean,v_effective_at);
   if (v_item->>'returnToStock')::boolean then
     select unit_cost into v_cost from app.sale_lines where tenant_id=p_tenant and id=v_line.sale_line_id;
     select * into v_balance from app.inventory_balances where tenant_id=p_tenant and location_id=v_invoice.location_id and variant_id=v_line.variant_id for update;
     if not found or v_balance.on_hand<0 or v_cost is null or (v_balance.on_hand>0 and v_balance.average_unit_cost is null)
     then raise exception using errcode='HCWR3',message='Return inventory requires reconciliation'; end if;
     update app.inventory_balances set on_hand=on_hand+v_quantity,
       average_unit_cost=round((v_balance.on_hand*coalesce(v_balance.average_unit_cost,v_cost)+v_quantity*v_cost)/(v_balance.on_hand+v_quantity),2),
       version=version+1,updated_at=v_effective_at
     where tenant_id=p_tenant and location_id=v_invoice.location_id and variant_id=v_line.variant_id;
     insert into app.inventory_movements(tenant_id,location_id,variant_id,movement_type,quantity,unit_cost,source_type,source_reference,actor_user_id,occurred_at,created_at)
     values(p_tenant,v_invoice.location_id,v_line.variant_id,'REFUND',v_quantity,v_cost,'wholesale_credit_note',v_note::text,p_actor,v_effective_at,v_effective_at);
   end if;
 end loop;
 if v_new_credit>0 then insert into app.wholesale_customer_credit_issues(tenant_id,credit_note_id,customer_id,amount,recorded_at)
 values(p_tenant,v_note,v_customer,v_new_credit,v_effective_at); end if;
 v_returned_total:=v_prior_total+v_total;
 update app.sales set status=case when v_returned_total=total then 'refunded' else 'partially_refunded' end where tenant_id=p_tenant and id=v_sale.id;
 v_response:=jsonb_build_object('creditNoteId',v_note,'invoiceId',v_invoice.id,'refundId',v_refund,'amountMinor',(v_total*100)::bigint,
 'debtReductionMinor',((v_debt_before-v_debt_after)*100)::bigint,'newCustomerCreditMinor',(v_new_credit*100)::bigint,
 'openDebtMinor',(v_debt_after*100)::bigint,'cashPayoutMinor',0);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,reason,metadata,occurred_at)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_return.posted','wholesale_credit_note',v_note,v_invoice.location_id,btrim(p_payload->>'reason'),v_response,v_effective_at);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,created_at,available_at)
 values(p_tenant,'wholesale_return.posted','wholesale_credit_note',v_note,v_response,v_effective_at,v_effective_at);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'wholesale_return.post',p_key,p_hash,201,v_response,now(),now()+interval '24 hours');
 return v_response;
end;
$$;

create or replace function app.load_wholesale_returns(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_post boolean; v_apply boolean; v_refund boolean;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_returns.post'),
 m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_credits.apply'),
 m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_credits.refund')
 into v_post,v_apply,v_refund from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active';
 return jsonb_build_object('canPost',coalesce(v_post,false),'canApply',coalesce(v_apply,false),'canRefund',coalesce(v_refund,false),
 'invoices',(select coalesce(jsonb_agg(jsonb_build_object('invoiceId',i.id,'invoiceNumber',i.invoice_number::text,'customerId',i.customer_id,'customerName',i.customer_name_snapshot,'locationId',i.location_id,'locationName',i.location_name_snapshot,
 'totalMinor',(i.total*100)::bigint,'creditedMinor',(coalesce((select sum(amount) from app.wholesale_credit_notes where tenant_id=p_tenant and invoice_id=i.id),0)*100)::bigint,'settledMinor',((coalesce((select sum(amount) from app.wholesale_payment_allocations where tenant_id=p_tenant and invoice_id=i.id),0)+coalesce((select sum(amount) from app.wholesale_credit_applications where tenant_id=p_tenant and invoice_id=i.id),0))*100)::bigint,'openDebtMinor',(app.wholesale_invoice_open_balance(p_tenant,i.id)*100)::bigint,'valuationSupported',exists(select 1 from app.wholesale_return_line_valuations(p_tenant,i.id)),
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('invoiceLineId',l.id,'name',l.product_name||' / '||l.variant_name,'quantityMilli',(l.quantity*1000)::bigint,'returnedQuantityMilli',(coalesce((select sum(quantity) from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=l.id),0)*1000)::bigint,'unitPriceMinor',(l.unit_price*100)::bigint,'originalTotalMinor',(l.line_total*100)::bigint,'discountMinor',(valuation.discount*100)::bigint,'taxMinor',(valuation.tax*100)::bigint,'priorCreditMinor',(coalesce((select sum(amount) from app.wholesale_credit_note_lines where tenant_id=p_tenant and invoice_line_id=l.id),0)*100)::bigint) order by l.id),'[]'::jsonb) from app.invoice_lines l left join app.wholesale_return_line_valuations(p_tenant,i.id) valuation on valuation.invoice_line_id=l.id where l.tenant_id=p_tenant and l.invoice_id=i.id)) order by i.issued_at desc,i.id),'[]'::jsonb) from app.invoices i where i.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'notes',(select coalesce(jsonb_agg(jsonb_build_object(
   'creditNoteId',n.id,'invoiceId',n.invoice_id,'refundId',n.refund_id,
   'customerId',n.customer_id,'locationId',i.location_id,'reason',n.reason,
   'amountMinor',(n.amount*100)::bigint,'debtReductionMinor',(n.debt_reduction*100)::bigint,
   'issuedCreditMinor',(n.customer_credit*100)::bigint,
   'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=n.tenant_id and k.operation='wholesale_return.post' and k.response_body->>'creditNoteId'=n.id::text),
   'payoutBlocked',app.wholesale_invoice_has_funded_receipts(n.tenant_id,n.invoice_id),
   'availableCreditMinor',(app.wholesale_credit_available(p_tenant,n.id)*100)::bigint,'recordedAt',n.recorded_at,
   'lines',(select coalesce(jsonb_agg(jsonb_build_object(
     'invoiceLineId',line.invoice_line_id,'name',original.product_name||' / '||original.variant_name,
     'quantityMilli',(line.quantity*1000)::bigint,'amountMinor',(line.amount*100)::bigint,'valuation',line.valuation_snapshot,
     'returnToStock',line.return_to_stock) order by line.invoice_line_id),'[]'::jsonb)
     from app.wholesale_credit_note_lines line join app.invoice_lines original
       on original.tenant_id=line.tenant_id and original.id=line.invoice_line_id and original.invoice_id=n.invoice_id
     where line.tenant_id=n.tenant_id and line.credit_note_id=n.id)
 ) order by n.recorded_at desc,n.id),'[]'::jsonb)
 from app.wholesale_credit_notes n join app.invoices i on i.tenant_id=n.tenant_id and i.id=n.invoice_id
 where n.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'applications',(select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=a.tenant_id and k.operation='wholesale_credit.apply' and k.response_body->>'applicationId'=a.id::text),'creditNoteId',a.credit_note_id,'invoiceId',a.invoice_id,'amountMinor',(a.amount*100)::bigint) order by a.recorded_at,a.id),'[]'::jsonb) from app.wholesale_credit_applications a join app.invoices i on i.tenant_id=a.tenant_id and i.id=a.invoice_id where a.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'payouts',(select coalesce(jsonb_agg(jsonb_build_object('payoutId',p.id,'commandKey',(select k.idempotency_key from app.idempotency_records k where k.tenant_id=p.tenant_id and k.operation='wholesale_credit.refund' and k.response_body->>'payoutId'=p.id::text),'creditNoteId',p.credit_note_id,'paymentMethodId',p.payment_method_id,'registerSessionId',p.register_session_id,'amountMinor',(p.amount*100)::bigint,'referenceLastFour',p.reference_last_four) order by p.recorded_at,p.id),'[]'::jsonb) from app.wholesale_credit_payouts p join app.wholesale_credit_notes n on n.tenant_id=p.tenant_id and n.id=p.credit_note_id join app.invoices i on i.tenant_id=n.tenant_id and i.id=n.invoice_id where p.tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)),
 'methods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',method_type) order by name,id),'[]'::jsonb) from app.payment_methods where tenant_id=p_tenant and is_active and method_type in ('cash','e_wallet','bank_transfer') and v_refund),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'locationId',s.location_id,'name',r.name) order by r.name,s.id),'[]'::jsonb) from app.register_sessions s join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id where s.tenant_id=p_tenant and s.status='open' and v_refund and app.can_record_wholesale_payment_at_location(p_actor,p_tenant,s.location_id)));
end;
$$;
commit;
