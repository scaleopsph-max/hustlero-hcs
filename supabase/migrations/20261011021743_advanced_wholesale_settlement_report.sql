begin;
create function app.load_wholesale_settlement_report(p_actor uuid,p_tenant uuid,p_from date,p_to date,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz; v_result jsonb;
begin
 if not exists(select 1 from app.tenant_memberships member where member.tenant_id=p_tenant and member.user_id=p_actor
   and member.status='active' and (member.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp
   on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='reports.read')))
 then raise exception using errcode='HCSD0',message='Reporting access is not allowed'; end if;
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then
   raise exception using errcode='HCSD1',message='Reporting filters are invalid'; end if;
 if p_location is not null and not exists(select 1 from app.locations where tenant_id=p_tenant and id=p_location) then
   raise exception using errcode='HCSD2',message='Reporting location was not found'; end if;
 select timezone into v_timezone from app.tenants where id=p_tenant;
 v_start:=p_from::timestamp at time zone v_timezone;
 v_end:=least((p_to+1)::timestamp at time zone v_timezone,statement_timestamp());
 with invoices as (
   select * from app.invoices where tenant_id=p_tenant and issued_at<v_end and (p_location is null or location_id=p_location)
 ), charges as (
   select invoice_id,amount,recorded_at,'opening'::text kind from app.wholesale_receivable_charges where tenant_id=p_tenant and recorded_at<v_end
   union all select invoice_id,amount,recorded_at,'invoice' from app.wholesale_invoice_charges where tenant_id=p_tenant and recorded_at<v_end
 ), allocations as (
   select allocation.invoice_id,allocation.amount,payment.id payment_id,payment.payment_method_id,payment.recorded_at
   from app.wholesale_payment_allocations allocation join app.wholesale_payments payment
   on payment.tenant_id=allocation.tenant_id and payment.id=allocation.payment_id
   join invoices invoice on invoice.id=allocation.invoice_id
   where allocation.tenant_id=p_tenant and payment.recorded_at<v_end
 ), paid as (select invoice_id,sum(amount) amount from allocations group by invoice_id),
 closing as (select invoice.id,invoice.total,charge.amount-coalesce(paid.amount,0) balance
   from invoices invoice left join charges charge on charge.invoice_id=invoice.id left join paid on paid.invoice_id=invoice.id),
 period_receipts as (select * from allocations where recorded_at>=v_start),
 methods as (select method.id,method.name,method.method_type,sum(receipt.amount) amount,count(distinct receipt.payment_id) receipts
   from period_receipts receipt join app.payment_methods method on method.tenant_id=p_tenant and method.id=receipt.payment_method_id
   group by method.id,method.name,method.method_type)
 select jsonb_build_object('scope',jsonb_build_object('from',p_from,'to',p_to,'locationId',p_location,'timezone',v_timezone,
   'asOf',v_end,'generatedAt',statement_timestamp()),'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) from app.locations where tenant_id=p_tenant),
   'summary',jsonb_build_object('issuedMinor',(coalesce((select sum(total) from invoices where issued_at>=v_start),0)*100)::bigint,
   'invoiceCount',(select count(*) from invoices where issued_at>=v_start),
   'recordedReceiptsMinor',(coalesce((select sum(amount) from period_receipts),0)*100)::bigint,
   'receiptCount',(select count(distinct payment_id) from period_receipts),
   'openingChargesMinor',(coalesce((select sum(charge.amount) from charges charge join invoices invoice on invoice.id=charge.invoice_id where charge.kind='opening' and charge.recorded_at>=v_start),0)*100)::bigint,
   'closingReceivablesMinor',(coalesce((select sum(balance) from closing),0)*100)::bigint,
   'unclassifiedCount',(select count(*) from closing where balance is null),
   'unclassifiedMinor',(coalesce((select sum(total) from closing where balance is null),0)*100)::bigint),
   'byPaymentMethod',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'methodType',method_type,'amountMinor',(amount*100)::bigint,'receiptCount',receipts) order by name,id),'[]'::jsonb) from methods)) into v_result;
 return v_result;
end;
$$;
revoke all on function app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid) to hcs_hyperdrive;
commit;
