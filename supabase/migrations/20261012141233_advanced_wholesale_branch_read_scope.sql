begin;

-- Keep the established permission checks private; public API reads add branch scope.
create function app.can_read_wholesale_location(p_actor uuid, p_tenant uuid, p_location uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.tenant_memberships m
    join app.locations l on l.tenant_id = m.tenant_id and l.id = p_location
    where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active'
      and (m.is_owner or (l.is_active and exists (
        select 1 from app.employees e join app.employee_locations el
          on el.tenant_id = e.tenant_id and el.employee_id = e.id
        where e.tenant_id = p_tenant and e.user_id = p_actor and e.status = 'active'
          and el.location_id = l.id
      )))
  );
$$;

create function app.scope_wholesale_rows(p_actor uuid, p_tenant uuid, p_rows jsonb, p_location_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
  from jsonb_array_elements(p_rows) with ordinality item(value, ordinality)
  where app.can_read_wholesale_location(p_actor, p_tenant, (item.value->>p_location_key)::uuid);
$$;
revoke all on function app.can_read_wholesale_location(uuid,uuid,uuid),
  app.scope_wholesale_rows(uuid,uuid,jsonb,text) from public, anon, authenticated, hcs_hyperdrive;

alter function app.load_wholesale_order_context(uuid,uuid) rename to wholesale_order_context_unscoped;
alter function app.list_wholesale_invoices(uuid,uuid) rename to wholesale_invoices_unscoped;
alter function app.load_wholesale_receivables(uuid,uuid) rename to wholesale_receivables_unscoped;
alter function app.load_wholesale_credit_overrides(uuid,uuid) rename to wholesale_overrides_unscoped;
alter function app.load_wholesale_payments(uuid,uuid) rename to wholesale_payments_unscoped;
alter function app.load_wholesale_statement(uuid,uuid,date,uuid,uuid) rename to wholesale_statement_unscoped;
revoke all on function app.wholesale_order_context_unscoped(uuid,uuid),
  app.wholesale_invoices_unscoped(uuid,uuid), app.wholesale_receivables_unscoped(uuid,uuid),
  app.wholesale_overrides_unscoped(uuid,uuid), app.wholesale_payments_unscoped(uuid,uuid),
  app.wholesale_statement_unscoped(uuid,uuid,date,uuid,uuid)
  from public, anon, authenticated, hcs_hyperdrive;

create function app.load_wholesale_order_context(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := app.wholesale_order_context_unscoped(p_actor_user_id, p_tenant_id);
  return v_result || jsonb_build_object(
    'locations', app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'locations','id'),
    'inventory', app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'inventory','locationId'),
    'orders', app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,v_result->'orders','locationId')
  );
end;
$$;

create function app.list_wholesale_invoices(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app.scope_wholesale_rows(p_actor_user_id,p_tenant_id,
    app.wholesale_invoices_unscoped(p_actor_user_id,p_tenant_id),'locationId');
$$;

create function app.load_wholesale_receivables(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := app.wholesale_receivables_unscoped(p_actor,p_tenant);
  return jsonb_set(v_result,'{invoices}',app.scope_wholesale_rows(p_actor,p_tenant,v_result->'invoices','locationId'));
end;
$$;

create function app.load_wholesale_credit_overrides(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_rows jsonb;
begin
  v_result := app.wholesale_overrides_unscoped(p_actor,p_tenant);
  select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into v_rows
  from jsonb_array_elements(v_result->'overrides') with ordinality item(value,ordinality)
  join app.sales_orders o on o.tenant_id=p_tenant and o.id=(item.value->>'salesOrderId')::uuid
  where app.can_read_wholesale_location(p_actor,p_tenant,o.location_id);
  return jsonb_set(v_result,'{overrides}',v_rows);
end;
$$;

create function app.load_wholesale_payments(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_rows jsonb;
begin
  v_result := app.wholesale_payments_unscoped(p_actor,p_tenant);
  if exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor
    and status='active' and is_owner) then return v_result; end if;
  -- Do not expose a whole receipt or its total when any allocation is outside scope.
  select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into v_rows
  from jsonb_array_elements(v_result->'payments') with ordinality item(value,ordinality)
  where exists (
    select 1 from app.wholesale_payment_allocations a
    where a.tenant_id=p_tenant and a.payment_id=(item.value->>'paymentId')::uuid
  ) and not exists (
    select 1 from app.wholesale_payment_allocations a join app.invoices i
      on i.tenant_id=a.tenant_id and i.id=a.invoice_id
    where a.tenant_id=p_tenant and a.payment_id=(item.value->>'paymentId')::uuid
      and not app.can_read_wholesale_location(p_actor,p_tenant,i.location_id)
  );
  return jsonb_set(v_result,'{payments}',v_rows);
end;
$$;

create function app.load_wholesale_statement(p_actor uuid, p_tenant uuid, p_date date,
  p_customer uuid default null, p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_invoices jsonb; v_entries jsonb; v_summary jsonb;
begin
  -- Run the established auth/filter validation before exposing any projection.
  v_result := app.wholesale_statement_unscoped(p_actor,p_tenant,p_date,p_customer,p_location);
  if exists(select 1 from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor
    and status='active' and is_owner) then return v_result; end if;
  if p_location is not null and not app.can_read_wholesale_location(p_actor,p_tenant,p_location) then
    raise exception using errcode='HCSD2',message='Reporting scope was not found';
  end if;
  v_invoices := app.scope_wholesale_rows(p_actor,p_tenant,v_result->'invoices','locationId');
  select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb) into v_entries
  from jsonb_array_elements(v_result->'entries') with ordinality e(value,ordinality)
  where exists(select 1 from jsonb_array_elements(v_invoices) i where i->>'invoiceId'=e.value->>'invoiceId');
  select jsonb_build_object(
    'balanceMinor',coalesce(sum((i->>'balanceMinor')::bigint),0),
    'currentMinor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='current'),0),
    'days1To30Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='1-30'),0),
    'days31To60Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='31-60'),0),
    'days61To90Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='61-90'),0),
    'over90Minor',coalesce(sum((i->>'balanceMinor')::bigint) filter(where i->>'band'='over-90'),0),
    'unclassifiedCount',count(*) filter(where i->>'classification'='unclassified'),
    'unclassifiedMinor',coalesce(sum(inv.total*100) filter(where i->>'classification'='unclassified'),0)::bigint
  ) into v_summary from jsonb_array_elements(v_invoices) i
    join app.invoices inv on inv.tenant_id=p_tenant and inv.id=(i->>'invoiceId')::uuid;
  return v_result || jsonb_build_object('invoices',v_invoices,'entries',v_entries,'summary',v_summary,
    'locations',app.scope_wholesale_rows(p_actor,p_tenant,v_result->'locations','id'));
end;
$$;

revoke all on function app.load_wholesale_order_context(uuid,uuid),app.list_wholesale_invoices(uuid,uuid),
  app.load_wholesale_receivables(uuid,uuid),app.load_wholesale_credit_overrides(uuid,uuid),
  app.load_wholesale_payments(uuid,uuid),app.load_wholesale_statement(uuid,uuid,date,uuid,uuid)
  from public,anon,authenticated;
grant execute on function app.load_wholesale_order_context(uuid,uuid),app.list_wholesale_invoices(uuid,uuid),
  app.load_wholesale_receivables(uuid,uuid),app.load_wholesale_credit_overrides(uuid,uuid),
  app.load_wholesale_payments(uuid,uuid),app.load_wholesale_statement(uuid,uuid,date,uuid,uuid) to hcs_hyperdrive;

create or replace function app.load_wholesale_settlement_report(p_actor uuid,p_tenant uuid,p_from date,p_to date,p_location uuid default null)
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
 if p_location is not null and not app.can_read_wholesale_location(p_actor,p_tenant,p_location) then
   raise exception using errcode='HCSD2',message='Reporting location was not found'; end if;
 select timezone into v_timezone from app.tenants where id=p_tenant;
 v_start:=p_from::timestamp at time zone v_timezone;
 v_end:=least((p_to+1)::timestamp at time zone v_timezone,statement_timestamp());
 with invoices as (
   select * from app.invoices where tenant_id=p_tenant and issued_at<v_end and app.can_read_wholesale_location(p_actor,p_tenant,location_id) and (p_location is null or location_id=p_location)
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
   'asOf',v_end,'generatedAt',statement_timestamp()),'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) from app.locations where tenant_id=p_tenant and app.can_read_wholesale_location(p_actor,p_tenant,id)),
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
