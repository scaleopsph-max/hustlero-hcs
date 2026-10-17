begin;

-- Keep the existing business calculations behind scoped, non-public entry points.
alter function app.load_sale_receipt(uuid,uuid,uuid) rename to sale_receipt_scope_core;
alter function app.load_sale_archive_record(uuid,uuid,uuid) rename to sale_archive_record_scope_core;
alter function app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text) rename to reverse_sale_scope_core;
revoke all on function app.sale_receipt_scope_core(uuid,uuid,uuid),
  app.sale_archive_record_scope_core(uuid,uuid,uuid),
  app.reverse_sale_scope_core(uuid,uuid,uuid,text,jsonb,text,text,text,text)
  from public, anon, authenticated, hcs_hyperdrive;

create function app.require_sale_location_access(p_actor uuid, p_tenant uuid, p_sale uuid, p_permission text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_location uuid;
begin
  if not exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id=p_tenant and m.user_id=p_actor and m.status='active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp
          on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
        where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code=p_permission
      ))
  ) then raise exception using errcode='HCSA0', message='Sales access is not allowed'; end if;
  select location_id into v_location from app.sales where tenant_id=p_tenant and id=p_sale;
  -- Unknown, foreign-tenant and unassigned-branch IDs have the same response.
  if not found or not app.can_read_wholesale_location(p_actor,p_tenant,v_location) then
    raise exception using errcode='HCSA1', message='Sale was not found';
  end if;
end;
$$;
revoke all on function app.require_sale_location_access(uuid,uuid,uuid,text)
  from public, anon, authenticated, hcs_hyperdrive;

create function app.load_sale_receipt(p_actor_user_id uuid, p_tenant_id uuid, p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_sale_location_access(p_actor_user_id,p_tenant_id,p_sale_id,'sales.read');
  return app.sale_receipt_scope_core(p_actor_user_id,p_tenant_id,p_sale_id);
end;
$$;

create function app.load_sale_archive_record(p_actor_user_id uuid, p_tenant_id uuid, p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_sale_location_access(p_actor_user_id,p_tenant_id,p_sale_id,'sales.read');
  return app.sale_archive_record_scope_core(p_actor_user_id,p_tenant_id,p_sale_id);
end;
$$;

create function app.reverse_sale(p_actor_user_id uuid,p_tenant_id uuid,p_sale_id uuid,p_reversal_type text,
  p_lines jsonb,p_reason text,p_idempotency_key text,p_request_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing_sale text;
begin
  if p_reversal_type is null or p_reversal_type not in ('refund','void') then
    raise exception using errcode='HCSA2', message='Sale reversal is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text||':sale.'||p_reversal_type||':'||p_idempotency_key,0));
  -- Revalidate current permission/assignment before any cached response is read.
  perform app.require_sale_location_access(p_actor_user_id,p_tenant_id,p_sale_id,'sales.'||p_reversal_type);
  select response_body->>'saleId' into v_existing_sale from app.idempotency_records
    where tenant_id=p_tenant_id and operation='sale.'||p_reversal_type
      and idempotency_key=p_idempotency_key and completed_at is not null;
  if found and v_existing_sale is distinct from p_sale_id::text then
    raise exception using errcode='HCS08', message='Idempotency key conflict';
  end if;
  return app.reverse_sale_scope_core(p_actor_user_id,p_tenant_id,p_sale_id,p_reversal_type,
    p_lines,p_reason,p_idempotency_key,p_request_hash,p_request_id);
end;
$$;

create or replace function app.list_sales_archive(p_actor_user_id uuid, p_tenant_id uuid, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (
    select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id
      and m.status='active' and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp
          on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
        where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='sales.read'
      ))
  ) then raise exception using errcode='HCSA0', message='Sales access is not allowed'; end if;
  return jsonb_build_object('sales',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',sale.id,'receiptNumber',sale.receipt_number,'channel',sale.channel,
      'invoiceId',invoice.id,'salesOrderId',invoice.sales_order_id,'status',sale.status,
      'locationName',location.name,'registerName',coalesce(register.name,'Back Office'),
      'employeeName',coalesce(employee.display_name,actor.email::text,'Business user'),
      'itemCount',(select coalesce(sum(line.quantity),0) from app.sale_lines line
        where line.tenant_id=sale.tenant_id and line.sale_id=sale.id),
      'totalCentavos',round(sale.total*100)::bigint,
      'refundedCentavos',round(coalesce(refunds.amount,0)*100)::bigint,
      'netCentavos',round((sale.total-coalesce(refunds.amount,0))*100)::bigint,
      'completedAt',sale.completed_at
    ) order by sale.completed_at desc,sale.id)
    from (select * from app.sales s where s.tenant_id=p_tenant_id
      and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,s.location_id)
      order by s.completed_at desc,s.id limit least(greatest(p_limit,1),200)) sale
    join app.locations location on location.tenant_id=sale.tenant_id and location.id=sale.location_id
    left join app.registers register on register.tenant_id=sale.tenant_id and register.id=sale.register_id
    left join app.employees employee on employee.tenant_id=sale.tenant_id and employee.id=sale.employee_id
    left join auth.users actor on actor.id=sale.completed_by_user_id
    left join app.invoices invoice on invoice.tenant_id=sale.tenant_id and invoice.sale_id=sale.id
    left join lateral (select sum(r.amount) amount from app.refunds r
      where r.tenant_id=sale.tenant_id and r.sale_id=sale.id) refunds on true
  ),'[]'::jsonb));
end;
$$;

-- Preserve the older POS-only projection and its pre-limit visibility boundary.
create or replace function app.list_sales(p_actor_user_id uuid,p_tenant_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id
      and m.status='active' and (m.is_owner or exists (
        select 1 from app.membership_roles mr join app.role_permissions rp
          on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
        where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='sales.read'
      ))
  ) then raise exception using errcode='HCSA0', message='Sales access is not allowed'; end if;
  return jsonb_build_object('sales',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,'receiptNumber',s.receipt_number,'status',s.status,'locationName',l.name,
      'registerName',r.name,'employeeName',e.display_name,
      'itemCount',(select coalesce(sum(sl.quantity),0) from app.sale_lines sl
        where sl.tenant_id=s.tenant_id and sl.sale_id=s.id),
      'totalCentavos',round(s.total*100)::bigint,
      'refundedCentavos',round(coalesce(rf.amount,0)*100)::bigint,
      'netCentavos',round((s.total-coalesce(rf.amount,0))*100)::bigint,'completedAt',s.completed_at
    ) order by s.completed_at desc,s.id)
    from (select * from app.sales sale where sale.tenant_id=p_tenant_id
      and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,sale.location_id)
      order by sale.completed_at desc,sale.id limit least(greatest(p_limit,1),200)) s
    join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id
    join app.registers r on r.tenant_id=s.tenant_id and r.id=s.register_id
    join app.employees e on e.tenant_id=s.tenant_id and e.id=s.employee_id
    left join lateral (select sum(refund.amount) amount from app.refunds refund
      where refund.tenant_id=s.tenant_id and refund.sale_id=s.id) rf on true
  ),'[]'::jsonb));
end;
$$;

revoke all on function app.load_sale_receipt(uuid,uuid,uuid), app.load_sale_archive_record(uuid,uuid,uuid),
  app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text),
  app.list_sales(uuid,uuid,integer), app.list_sales_archive(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function app.load_sale_receipt(uuid,uuid,uuid), app.load_sale_archive_record(uuid,uuid,uuid),
  app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text),
  app.list_sales(uuid,uuid,integer), app.list_sales_archive(uuid,uuid,integer) to hcs_hyperdrive;

commit;
