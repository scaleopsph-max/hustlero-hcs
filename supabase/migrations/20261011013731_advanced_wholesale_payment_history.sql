begin;
create function app.load_wholesale_payments(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_can_record boolean; v_invoices jsonb; v_methods jsonb; v_payments jsonb;
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select member.is_owner or exists(select 1 from app.membership_roles mr
   join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
   where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='wholesale_payments.record')
 into v_can_record from app.tenant_memberships member where member.tenant_id=p_tenant and member.user_id=p_actor and member.status='active';
 v_can_record:=coalesce(v_can_record,false) and exists(select 1 from app.tenants where id=p_tenant and status='active');
 select coalesce(jsonb_agg(invoice || jsonb_build_object('canAllocate',v_can_record and
   app.can_record_wholesale_payment_at_location(p_actor,p_tenant,(invoice->>'locationId')::uuid))),'[]'::jsonb)
 into v_invoices from jsonb_array_elements(app.load_wholesale_receivables(p_actor,p_tenant)->'invoices') invoice;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb)
 into v_methods from app.payment_methods where tenant_id=p_tenant and is_active;
 select coalesce(jsonb_agg(jsonb_build_object('paymentId',payment.id,'customerId',payment.customer_id,
  'customerName',customer.full_name,'paymentMethodName',method.name,'amountMinor',(payment.amount*100)::bigint,
  'reference',payment.reference,'recordedAt',payment.recorded_at,'allocations',(
   select jsonb_agg(jsonb_build_object('invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,
     'amountMinor',(allocation.amount*100)::bigint) order by invoice.invoice_number,invoice.id)
   from app.wholesale_payment_allocations allocation join app.invoices invoice
   on invoice.tenant_id=allocation.tenant_id and invoice.id=allocation.invoice_id
   where allocation.tenant_id=p_tenant and allocation.payment_id=payment.id
  )) order by payment.recorded_at desc,payment.id),'[]'::jsonb)
 into v_payments from app.wholesale_payments payment join app.customers customer
 on customer.tenant_id=payment.tenant_id and customer.id=payment.customer_id
 join app.payment_methods method on method.tenant_id=payment.tenant_id and method.id=payment.payment_method_id
 where payment.tenant_id=p_tenant;
 return jsonb_build_object('canRecord',v_can_record,'invoices',v_invoices,'paymentMethods',v_methods,'payments',v_payments);
end;
$$;
revoke all on function app.load_wholesale_payments(uuid,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_payments(uuid,uuid) to hcs_hyperdrive;
commit;
