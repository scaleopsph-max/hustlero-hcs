begin;
create function app.load_wholesale_statement(p_actor uuid,p_tenant uuid,p_date date,p_customer uuid default null,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_timezone text; v_end timestamptz; v_result jsonb;
begin
 if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active' and(m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='reports.read'))) then raise exception using errcode='HCSD0',message='Reporting access is not allowed'; end if;
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select timezone into v_timezone from app.tenants where id=p_tenant;
 if p_date is null or p_date>(statement_timestamp() at time zone v_timezone)::date then raise exception using errcode='HCSD1',message='Reporting filters are invalid'; end if;
 if p_customer is not null and not exists(select 1 from app.customers where tenant_id=p_tenant and id=p_customer) then raise exception using errcode='HCSD2',message='Reporting scope was not found'; end if;
 if p_location is not null and not exists(select 1 from app.locations where tenant_id=p_tenant and id=p_location) then raise exception using errcode='HCSD2',message='Reporting scope was not found'; end if;
 v_end:=least((p_date+1)::timestamp at time zone v_timezone,statement_timestamp());
 with invoices as(select i.*,((v_end-interval '1 microsecond') at time zone coalesce(l.timezone,v_timezone))::date business_date from app.invoices i join app.locations l on l.tenant_id=i.tenant_id and l.id=i.location_id where i.tenant_id=p_tenant and i.issued_at<v_end and(p_customer is null or i.customer_id=p_customer) and(p_location is null or i.location_id=p_location)),
 charges as(select invoice_id,amount,due_date,recorded_at,'opening'::text kind from app.wholesale_receivable_charges where tenant_id=p_tenant and recorded_at<v_end union all select invoice_id,amount,due_date,recorded_at,'invoice' from app.wholesale_invoice_charges where tenant_id=p_tenant and recorded_at<v_end),
 allocations as(select a.invoice_id,a.amount,p.id payment_id,p.recorded_at,p.reference from app.wholesale_payment_allocations a join app.wholesale_payments p on p.tenant_id=a.tenant_id and p.id=a.payment_id join invoices i on i.id=a.invoice_id where a.tenant_id=p_tenant and p.recorded_at<v_end),
 paid as(select invoice_id,sum(amount) amount from allocations group by invoice_id),
 balances as(select i.*,c.kind,c.amount charged,c.due_date,c.amount-coalesce(p.amount,0) balance,coalesce(p.amount,0) paid,case when c.invoice_id is null then null else greatest(i.business_date-c.due_date,0) end overdue from invoices i left join charges c on c.invoice_id=i.id left join paid p on p.invoice_id=i.id),
 aged as(select *,case when charged is null then 'unclassified' when overdue=0 then 'current' when overdue<=30 then '1-30' when overdue<=60 then '31-60' when overdue<=90 then '61-90' else 'over-90' end band from balances),
 entries as(select 'charge:'||i.id::text entry_id,c.recorded_at,i.id invoice_id,i.invoice_number::text invoice_number,i.customer_name_snapshot customer_name,c.kind,i.invoice_number::text reference,c.amount debit,0::numeric credit from charges c join invoices i on i.id=c.invoice_id
 union all select 'payment:'||a.payment_id::text||':'||i.id::text,a.recorded_at,i.id,i.invoice_number::text,i.customer_name_snapshot,'payment',a.reference,0,a.amount from allocations a join invoices i on i.id=a.invoice_id)
 select jsonb_build_object('scope',jsonb_build_object('asOfDate',p_date,'asOf',v_end,'generatedAt',statement_timestamp(),'timezone',v_timezone,'customerId',p_customer,'locationId',p_location),
 'customers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by full_name,id),'[]'::jsonb) from app.customers where tenant_id=p_tenant),
 'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) from app.locations where tenant_id=p_tenant),
 'summary',jsonb_build_object('balanceMinor',(coalesce((select sum(balance) from aged),0)*100)::bigint,'currentMinor',(coalesce((select sum(balance) from aged where band='current'),0)*100)::bigint,'days1To30Minor',(coalesce((select sum(balance) from aged where band='1-30'),0)*100)::bigint,'days31To60Minor',(coalesce((select sum(balance) from aged where band='31-60'),0)*100)::bigint,'days61To90Minor',(coalesce((select sum(balance) from aged where band='61-90'),0)*100)::bigint,'over90Minor',(coalesce((select sum(balance) from aged where band='over-90'),0)*100)::bigint,'unclassifiedCount',(select count(*) from aged where charged is null),'unclassifiedMinor',(coalesce((select sum(total) from aged where charged is null),0)*100)::bigint),
 'invoices',(select coalesce(jsonb_agg(jsonb_build_object('invoiceId',id,'invoiceNumber',invoice_number::text,'saleId',sale_id,'customerId',customer_id,'customerName',customer_name_snapshot,'locationId',location_id,'locationName',location_name_snapshot,'businessDate',business_date,'classification',coalesce(kind,'unclassified'),'chargedMinor',(charged*100)::bigint,'paidMinor',(paid*100)::bigint,'balanceMinor',(balance*100)::bigint,'dueDate',due_date,'daysOverdue',overdue,'band',band) order by due_date nulls last,issued_at,id),'[]'::jsonb) from aged),
 'entries',(select coalesce(jsonb_agg(jsonb_build_object('entryId',entry_id,'recordedAt',recorded_at,'invoiceId',invoice_id,'invoiceNumber',invoice_number,'customerName',customer_name,'kind',kind,'reference',reference,'debitMinor',(debit*100)::bigint,'creditMinor',(credit*100)::bigint) order by recorded_at,entry_id),'[]'::jsonb) from entries)) into v_result;
 return v_result;
end;
$$;
revoke all on function app.load_wholesale_statement(uuid,uuid,date,uuid,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_statement(uuid,uuid,date,uuid,uuid) to hcs_hyperdrive;
commit;
