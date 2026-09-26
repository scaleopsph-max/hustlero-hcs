begin;

insert into app.permissions (code, description)
values ('reports.read', 'View basic tenant sales and inventory reports')
on conflict (code) do update set description = excluded.description;

insert into app.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'reports.read'
from app.roles r
where lower(r.code::text) in ('owner', 'admin', 'manager')
on conflict do nothing;

create function app.initialize_role_reporting_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.code::text) in ('owner', 'admin', 'manager') then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values (new.tenant_id, new.id, 'reports.read') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_role_reporting_permissions() from public, anon, authenticated, hcs_hyperdrive;
create trigger roles_initialize_reporting_permissions
after insert on app.roles for each row execute function app.initialize_role_reporting_permissions();

create function app.load_reporting(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_channel text default 'all'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from app.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_actor_user_id and m.status = 'active'
      and (m.is_owner or exists (
        select 1 from app.membership_roles mr
        join app.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = m.tenant_id and mr.user_id = m.user_id and rp.permission_code = 'reports.read'
      ))
  ) then
    raise exception using errcode = 'HCSD0', message = 'Reporting access is not allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_channel not in ('all', 'pos') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  if p_location_id is not null and not exists (
    select 1 from app.locations where tenant_id = p_tenant_id and id = p_location_id
  ) then
    raise exception using errcode = 'HCSD2', message = 'Reporting location was not found';
  end if;

  select timezone into v_timezone from app.tenants where id = p_tenant_id;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with
  scoped_sales as (
    select s.* from app.sales s
    where s.tenant_id = p_tenant_id and s.completed_at >= v_start and s.completed_at < v_end
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  scoped_refunds as (
    select rf.*, s.location_id, s.employee_id
    from app.refunds rf join app.sales s on s.tenant_id = rf.tenant_id and s.id = rf.sale_id
    where rf.tenant_id = p_tenant_id and rf.completed_at >= v_start and rf.completed_at < v_end
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  summary as (
    select
      coalesce((select sum(total) from scoped_sales), 0) gross_sales,
      coalesce((select sum(amount) from scoped_refunds), 0) refunds,
      coalesce((select sum(discount_total) from scoped_sales), 0) discounts,
      coalesce((select sum(tax_total) from scoped_sales), 0) taxes,
      coalesce((select sum(sl.quantity * coalesce(sl.unit_cost, 0)) from app.sale_lines sl join scoped_sales s on s.id = sl.sale_id and s.tenant_id = sl.tenant_id), 0)
        - coalesce((select sum(ri.quantity * coalesce(sl.unit_cost, 0)) from app.refund_items ri join scoped_refunds rf on rf.id = ri.refund_id and rf.tenant_id = ri.tenant_id join app.sale_lines sl on sl.tenant_id = ri.tenant_id and sl.id = ri.sale_line_id), 0) cogs,
      (select count(*) from scoped_sales) transactions
  ),
  trend_days as (select generate_series(p_from, p_to, interval '1 day')::date day),
  trend_sales as (
    select (s.completed_at at time zone v_timezone)::date day, sum(s.total) gross, count(*) transactions
    from scoped_sales s group by 1
  ),
  trend_refunds as (
    select (rf.completed_at at time zone v_timezone)::date day, sum(rf.amount) refunds
    from scoped_refunds rf group by 1
  ),
  branch_sales as (select location_id, sum(total) gross, count(*) transactions from scoped_sales group by location_id),
  branch_refunds as (select location_id, sum(amount) refunds from scoped_refunds group by location_id),
  branch_cogs as (
    select s.location_id, sum(sl.quantity * coalesce(sl.unit_cost, 0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by s.location_id
  ),
  branch_refund_cogs as (
    select rf.location_id, sum(ri.quantity * coalesce(sl.unit_cost, 0)) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by rf.location_id
  ),
  inventory_rows as (
    select b.location_id, l.name location_name, p.name product_name, v.name variant_name, v.sku::text sku,
      b.on_hand, b.reserved, b.on_hand-b.reserved available, b.in_transit, b.average_unit_cost
    from app.inventory_balances b
    join app.locations l on l.tenant_id=b.tenant_id and l.id=b.location_id
    join app.product_variants v on v.tenant_id=b.tenant_id and v.id=b.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    where b.tenant_id=p_tenant_id and (p_location_id is null or b.location_id=p_location_id)
      and v.is_active and p.status='active'
  ),
  item_sales as (
    select sl.variant_id, max(sl.product_name) product_name, max(sl.variant_name) variant_name, max(sl.sku) sku,
      sum(sl.quantity) quantity, count(distinct s.id) transactions, sum(sl.line_total) gross,
      sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by sl.variant_id
  ),
  item_refunds as (
    select sl.variant_id, sum(ri.quantity) quantity, count(distinct rf.id) transactions, sum(ri.amount) refunds,
      sum(ri.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by sl.variant_id
  ),
  category_sales as (
    select coalesce(c.name,'Uncategorized') label, count(distinct s.id) transactions, sum(sl.line_total) gross,
      sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id
    join app.product_variants v on v.tenant_id=sl.tenant_id and v.id=sl.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    left join app.product_categories c on c.tenant_id=p.tenant_id and c.id=p.category_id group by 1
  ),
  category_refunds as (
    select coalesce(c.name,'Uncategorized') label, sum(ri.amount) refunds, sum(ri.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id
    join app.product_variants v on v.tenant_id=sl.tenant_id and v.id=sl.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    left join app.product_categories c on c.tenant_id=p.tenant_id and c.id=p.category_id group by 1
  ),
  employee_sales as (select employee_id, count(*) transactions, sum(total) gross from scoped_sales group by employee_id),
  employee_refunds as (select employee_id, sum(amount) refunds from scoped_refunds group by employee_id),
  employee_cogs as (
    select s.employee_id, sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by s.employee_id
  ),
  employee_refund_cogs as (
    select rf.employee_id, sum(ri.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by rf.employee_id
  ),
  payment_sales as (
    select pm.method_type, pm.name, sum(sp.amount) gross
    from scoped_sales s join app.sale_payments sp on sp.tenant_id=s.tenant_id and sp.sale_id=s.id
    join app.payment_methods pm on pm.tenant_id=sp.tenant_id and pm.id=sp.payment_method_id group by pm.method_type,pm.name
  ),
  payment_refunds as (
    select pm.method_type, pm.name, sum(pr.amount) refunds
    from scoped_refunds rf join app.payment_reversals pr on pr.tenant_id=rf.tenant_id and pr.refund_id=rf.id
    join app.sale_payments sp on sp.tenant_id=pr.tenant_id and sp.id=pr.sale_payment_id
    join app.payment_methods pm on pm.tenant_id=sp.tenant_id and pm.id=sp.payment_method_id group by pm.method_type,pm.name
  )
  select jsonb_build_object(
    'scope', jsonb_build_object('from',p_from,'to',p_to,'locationId',p_location_id,'channel',p_channel,'timezone',v_timezone,'generatedAt',now()),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'code',l.code::text,'name',l.name) order by l.name) from app.locations l where l.tenant_id=p_tenant_id and l.is_active),'[]'::jsonb),
    'summary', (select jsonb_build_object('grossSalesCentavos',round(gross_sales*100)::bigint,'refundsCentavos',round(refunds*100)::bigint,'netSalesCentavos',round((gross_sales-refunds)*100)::bigint,'cogsCentavos',round(cogs*100)::bigint,'grossProfitCentavos',round((gross_sales-refunds-cogs)*100)::bigint,'transactionCount',transactions::integer,'discountCentavos',round(discounts*100)::bigint,'taxCentavos',round(taxes*100)::bigint) from summary),
    'salesTrend', coalesce((select jsonb_agg(jsonb_build_object('date',d.day,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'transactionCount',coalesce(s.transactions,0)::integer) order by d.day) from trend_days d left join trend_sales s on s.day=d.day left join trend_refunds r on r.day=d.day),'[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('locationId',l.id,'locationName',l.name,'netSalesCentavos',round((coalesce(bs.gross,0)-coalesce(br.refunds,0))*100)::bigint,'grossProfitCentavos',round((coalesce(bs.gross,0)-coalesce(br.refunds,0)-coalesce(bc.cogs,0)+coalesce(brc.cogs,0))*100)::bigint,'transactionCount',coalesce(bs.transactions,0)::integer) order by l.name) from app.locations l left join branch_sales bs on bs.location_id=l.id left join branch_refunds br on br.location_id=l.id left join branch_cogs bc on bc.location_id=l.id left join branch_refund_cogs brc on brc.location_id=l.id where l.tenant_id=p_tenant_id and l.is_active and (p_location_id is null or l.id=p_location_id)),'[]'::jsonb),
    'inventory', jsonb_build_object('skuCount',(select count(*)::integer from inventory_rows),'onHandMilli',(select coalesce(round(sum(on_hand)*1000),0)::bigint from inventory_rows),'reservedMilli',(select coalesce(round(sum(reserved)*1000),0)::bigint from inventory_rows),'availableMilli',(select coalesce(round(sum(available)*1000),0)::bigint from inventory_rows),'inTransitMilli',(select coalesce(round(sum(in_transit)*1000),0)::bigint from inventory_rows),'outOfStockCount',(select count(*)::integer from inventory_rows where available<=0),'valuationCentavos',(select coalesce(round(sum(on_hand*coalesce(average_unit_cost,0))*100),0)::bigint from inventory_rows)),
    'registers', jsonb_build_object('openCount',(select count(*)::integer from app.register_sessions rs join app.registers r on r.tenant_id=rs.tenant_id and r.id=rs.register_id where rs.tenant_id=p_tenant_id and rs.status='open' and (p_location_id is null or r.location_id=p_location_id)),'totalCount',(select count(*)::integer from app.registers r where r.tenant_id=p_tenant_id and r.status='active' and (p_location_id is null or r.location_id=p_location_id))),
    'byItem', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.variant_id,r.variant_id)::text,'label',coalesce(s.product_name,vp.name),'variantName',coalesce(s.variant_name,v.name),'sku',coalesce(s.sku,v.sku::text),'quantityMilli',round((coalesce(s.quantity,0)-coalesce(r.quantity,0))*1000)::bigint,'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(s.cogs,0)-coalesce(r.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(s.cogs,0)+coalesce(r.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from item_sales s full join item_refunds r on r.variant_id=s.variant_id join app.product_variants v on v.tenant_id=p_tenant_id and v.id=coalesce(s.variant_id,r.variant_id) join app.products vp on vp.tenant_id=v.tenant_id and vp.id=v.product_id),'[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.label,r.label),'label',coalesce(s.label,r.label),'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(s.cogs,0)-coalesce(r.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(s.cogs,0)+coalesce(r.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from category_sales s full join category_refunds r on r.label=s.label),'[]'::jsonb),
    'byEmployee', coalesce((select jsonb_agg(jsonb_build_object('key',e.id::text,'label',e.display_name,'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(c.cogs,0)-coalesce(rc.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(c.cogs,0)+coalesce(rc.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from app.employees e left join employee_sales s on s.employee_id=e.id left join employee_refunds r on r.employee_id=e.id left join employee_cogs c on c.employee_id=e.id left join employee_refund_cogs rc on rc.employee_id=e.id where e.tenant_id=p_tenant_id and (s.employee_id is not null or r.employee_id is not null)),'[]'::jsonb),
    'byPaymentType', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.method_type,r.method_type),'label',coalesce(s.name,r.name),'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from payment_sales s full join payment_refunds r on r.method_type=s.method_type and r.name=s.name),'[]'::jsonb),
    'inventoryItems', coalesce((select jsonb_agg(jsonb_build_object('locationId',location_id,'locationName',location_name,'productName',product_name,'variantName',variant_name,'sku',sku,'onHandMilli',round(on_hand*1000)::bigint,'reservedMilli',round(reserved*1000)::bigint,'availableMilli',round(available*1000)::bigint,'inTransitMilli',round(in_transit*1000)::bigint,'averageUnitCostCentavos',case when average_unit_cost is null then null else round(average_unit_cost*100)::bigint end,'valuationCentavos',round(on_hand*coalesce(average_unit_cost,0)*100)::bigint) order by location_name,product_name,variant_name) from inventory_rows),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function app.load_reporting(uuid,uuid,date,date,uuid,text) from public, anon, authenticated;
grant execute on function app.load_reporting(uuid,uuid,date,date,uuid,text) to hcs_hyperdrive;

commit;
