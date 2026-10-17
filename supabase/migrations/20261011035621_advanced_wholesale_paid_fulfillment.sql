begin;
alter table app.wholesale_invoice_charges drop constraint wholesale_invoice_charges_payment_term_check;
alter table app.wholesale_invoice_charges add constraint wholesale_invoice_charges_payment_term_check check(payment_term in ('prepaid','cod','net_7','net_15','net_30'));
create table app.wholesale_paid_fulfillments (
 tenant_id uuid not null, invoice_id uuid not null, sales_order_id uuid not null, payment_id uuid not null,
 idempotency_key text not null, request_hash text not null, actor_user_id uuid not null,
 response_body jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,invoice_id), unique(tenant_id,idempotency_key), unique(tenant_id,payment_id),
 foreign key(tenant_id,invoice_id) references app.invoices(tenant_id,id) on delete restrict,
 foreign key(tenant_id,sales_order_id) references app.sales_orders(tenant_id,id) on delete restrict,
 foreign key(tenant_id,payment_id) references app.wholesale_payments(tenant_id,id) on delete restrict,
 foreign key(tenant_id,actor_user_id) references app.tenant_memberships(tenant_id,user_id) on delete restrict
);
create index wholesale_paid_fulfillments_order_idx on app.wholesale_paid_fulfillments(tenant_id,sales_order_id);
create index wholesale_paid_fulfillments_actor_idx on app.wholesale_paid_fulfillments(tenant_id,actor_user_id);
alter table app.wholesale_paid_fulfillments enable row level security;
revoke all on app.wholesale_paid_fulfillments from public,anon,authenticated,hcs_hyperdrive;
create trigger wholesale_paid_fulfillments_immutable before update or delete on app.wholesale_paid_fulfillments for each row execute function app.reject_invoice_mutation();
create function app.fulfill_wholesale_order_paid(p_actor uuid,p_tenant uuid,p_order uuid,p_payload jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order app.sales_orders%rowtype; v_term text; v_paid app.wholesale_paid_fulfillments%rowtype;
 v_invoice app.invoices%rowtype; v_response jsonb; v_payment jsonb; v_receipt jsonb; v_amount numeric; v_method uuid; v_due date; v_lines jsonb;
begin
 perform app.assert_wholesale_order_credit_access(p_actor,p_tenant);
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='HCSP1',message='Invalid paid fulfillment'; end if;
 if not(p_payload ?& array['lines','payment']) or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('lines','payment'))
 or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_typeof(p_payload->'payment') is distinct from 'object'
 or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null or nullif(p_request_id,'') is null
 then raise exception using errcode='HCSP1',message='Invalid paid fulfillment'; end if;
 v_payment:=p_payload->'payment';
 if not(v_payment ?& array['paymentMethodId','amountMinor','reference'])
 or exists(select 1 from jsonb_object_keys(v_payment) k where k not in ('paymentMethodId','amountMinor','reference'))
 or jsonb_typeof(v_payment->'paymentMethodId') is distinct from 'string' or jsonb_typeof(v_payment->'amountMinor') is distinct from 'number'
 or jsonb_typeof(v_payment->'reference') is distinct from 'string' or length(btrim(v_payment->>'reference')) not between 1 and 100
 then raise exception using errcode='HCSP1',message='Invalid paid fulfillment'; end if;
 begin v_amount:=(v_payment->>'amountMinor')::numeric; v_method:=(v_payment->>'paymentMethodId')::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='HCSP1',message='Invalid paid fulfillment'; end;
 if v_amount<=0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception using errcode='HCSP1',message='Invalid paid fulfillment'; end if;
 select * into v_order from app.sales_orders where tenant_id=p_tenant and id=p_order for update;
 if not found then raise exception using errcode='HCSQ7',message='The wholesale order was not found'; end if;
 perform 1 from app.customers where tenant_id=p_tenant and id=v_order.customer_id and status='active' and customer_type='reseller' for update;
 if not found then raise exception using errcode='HCSQ3',message='An active reseller customer is required'; end if;
 perform app.assert_wholesale_order_credit_access(p_actor,p_tenant);
 if not app.can_record_wholesale_payment_at_location(p_actor,p_tenant,v_order.location_id)
 or not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active'
 and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
 where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_payments.record')))
 then raise exception using errcode='HCAP1',message='Wholesale payment permission is required'; end if;
 select * into v_paid from app.wholesale_paid_fulfillments where tenant_id=p_tenant and idempotency_key=p_key;
 if found then
   if v_paid.sales_order_id<>p_order or v_paid.actor_user_id<>p_actor or v_paid.request_hash<>p_hash then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
   return v_paid.response_body;
 end if;
 select payment_term into v_term from app.wholesale_order_credit_snapshots where tenant_id=p_tenant and sales_order_id=p_order;
 if v_term is null then raise exception using errcode='HCCR2',message='Explicit customer credit settings are required'; end if;
 if v_term not in ('prepaid','cod') then raise exception using errcode='HCSP2',message='Paid fulfillment requires prepaid or COD terms'; end if;
 select jsonb_agg(item.value order by line.variant_id,item.value->>'salesOrderLineId') into v_lines
 from jsonb_array_elements(p_payload->'lines') item left join app.sales_order_lines line on line.tenant_id=p_tenant and line.sales_order_id=p_order and line.id::text=item.value->>'salesOrderLineId';
 v_response:=app.fulfill_wholesale_order_inventory_core(p_actor,p_tenant,p_order,coalesce(v_lines,'[]'::jsonb),p_key,p_hash,p_request_id);
 select * into v_invoice from app.invoices where tenant_id=p_tenant and id=(v_response->>'invoiceId')::uuid;
 if v_invoice.total*100<>v_amount then raise exception using errcode='HCSP3',message='Full exact invoice payment is required'; end if;
 select (v_invoice.issued_at at time zone coalesce(l.timezone,t.timezone))::date into v_due from app.locations l join app.tenants t on t.id=l.tenant_id where l.tenant_id=p_tenant and l.id=v_invoice.location_id;
 insert into app.wholesale_invoice_charges(tenant_id,invoice_id,customer_id,sales_order_id,amount,payment_term,due_date)
 values(p_tenant,v_invoice.id,v_invoice.customer_id,p_order,v_invoice.total,v_term,v_due);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_receivable.charged','invoice',v_invoice.id,jsonb_build_object('amountMinor',v_amount,'dueDate',v_due,'paymentTerm',v_term));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'wholesale_receivable.charged','invoice',v_invoice.id,jsonb_build_object('amountMinor',v_amount,'dueDate',v_due));
 v_receipt:=app.record_wholesale_payment(p_actor,p_tenant,jsonb_build_object('customerId',v_order.customer_id,'paymentMethodId',v_method,'amountMinor',v_amount,'reference',v_payment->>'reference',
 'allocations',jsonb_build_array(jsonb_build_object('invoiceId',v_invoice.id,'amountMinor',v_amount))),
 'paid_'||encode(extensions.digest(p_key,'sha256'),'hex'),p_hash,p_request_id);
 insert into app.wholesale_paid_fulfillments(tenant_id,invoice_id,sales_order_id,payment_id,idempotency_key,request_hash,actor_user_id,response_body)
 values(p_tenant,v_invoice.id,p_order,(v_receipt->>'paymentId')::uuid,p_key,p_hash,p_actor,v_response);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'wholesale_paid_fulfillment.completed','invoice',v_invoice.id,jsonb_build_object('paymentId',v_receipt->>'paymentId','paymentTerm',v_term,'amountMinor',v_amount));
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'wholesale_paid_fulfillment.completed','invoice',v_invoice.id,v_response||jsonb_build_object('paymentId',v_receipt->>'paymentId'));
 return v_response;
end;
$$;
revoke all on function app.fulfill_wholesale_order_paid(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.fulfill_wholesale_order_paid(uuid,uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;
commit;
