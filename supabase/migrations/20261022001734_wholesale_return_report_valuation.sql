-- Keep item/category totals on the same original payable basis as wholesale credits.
begin;
create function app.wholesale_reporting_line_payable(p_tenant uuid,p_sale_line uuid)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare v_invoice uuid; v_amount numeric;
begin
 select invoice_id into v_invoice from app.invoice_lines where tenant_id=p_tenant and sale_line_id=p_sale_line;
 if found then
   select valuation.payable into v_amount from app.invoice_lines line
   join lateral app.wholesale_return_line_valuations(line.tenant_id,line.invoice_id) valuation on valuation.invoice_line_id=line.id
   where line.tenant_id=p_tenant and line.sale_line_id=p_sale_line;
   if not found then raise exception using errcode='HCSD3',message='Original wholesale valuation requires reconciliation'; end if;
   return v_amount;
 end if;
 if exists(select 1 from app.sale_lines line join app.sales sale on sale.tenant_id=line.tenant_id and sale.id=line.sale_id
 where line.tenant_id=p_tenant and line.id=p_sale_line and sale.channel='wholesale')
 then raise exception using errcode='HCSD3',message='Wholesale invoice linkage requires reconciliation'; end if;
 select line_total into v_amount from app.sale_lines where tenant_id=p_tenant and id=p_sale_line;
 return v_amount;
end;
$$;
revoke all on function app.wholesale_reporting_line_payable(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create or replace function app.load_reporting(
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
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_channel not in ('all', 'pos', 'wholesale') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  if p_location_id is not null and not exists (
    select 1 from app.locations where tenant_id = p_tenant_id and id = p_location_id
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, id)
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
      and (p_channel = 'all' or s.channel = p_channel)
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, s.location_id)
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  scoped_refunds as (
    select rf.*, s.location_id, s.employee_id
    from app.refunds rf join app.sales s on s.tenant_id = rf.tenant_id and s.id = rf.sale_id
    where rf.tenant_id = p_tenant_id and rf.completed_at >= v_start and rf.completed_at < v_end
      and (p_channel = 'all' or s.channel = p_channel)
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, s.location_id)
      and (p_location_id is null or s.location_id = p_location_id)
  ),
  summary as (
    select
      coalesce((select sum(total) from scoped_sales), 0) gross_sales,
      coalesce((select sum(amount) from scoped_refunds), 0) refunds,
      coalesce((select sum(discount_total) from scoped_sales), 0) discounts,
      coalesce((select sum(tax_total) from scoped_sales), 0) taxes,
      coalesce((select sum(sl.quantity * coalesce(sl.unit_cost, 0)) from app.sale_lines sl join scoped_sales s on s.id = sl.sale_id and s.tenant_id = sl.tenant_id), 0)
        - coalesce((select sum(case when ri.returned_to_stock then ri.quantity * coalesce(sl.unit_cost, 0) else 0 end) from app.refund_items ri join scoped_refunds rf on rf.id = ri.refund_id and rf.tenant_id = ri.tenant_id join app.sale_lines sl on sl.tenant_id = ri.tenant_id and sl.id = ri.sale_line_id), 0) cogs,
      (select count(*) from scoped_sales) transactions
  ),
  trend_days as (select generate_series(p_from, p_to, interval '1 day')::date business_date),
  trend_sales as (
    select (s.completed_at at time zone v_timezone)::date business_date, sum(s.total) gross, count(*) transactions
    from scoped_sales s group by 1
  ),
  trend_refunds as (
    select (rf.completed_at at time zone v_timezone)::date business_date, sum(rf.amount) refunds
    from scoped_refunds rf group by 1
  ),
  branch_sales as (select location_id, sum(total) gross, count(*) transactions from scoped_sales group by location_id),
  branch_refunds as (select location_id, sum(amount) refunds from scoped_refunds group by location_id),
  branch_cogs as (
    select s.location_id, sum(sl.quantity * coalesce(sl.unit_cost, 0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by s.location_id
  ),
  branch_refund_cogs as (
    select rf.location_id, sum(case when ri.returned_to_stock then ri.quantity * coalesce(sl.unit_cost, 0) else 0 end) cogs
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
    where b.tenant_id=p_tenant_id and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, b.location_id) and (p_location_id is null or b.location_id=p_location_id)
      and v.is_active and p.status='active'
  ),
  item_sales as (
    select sl.variant_id, max(sl.product_name) product_name, max(sl.variant_name) variant_name, max(sl.sku) sku,
      sum(sl.quantity) quantity, count(distinct s.id) transactions, sum(app.wholesale_reporting_line_payable(sl.tenant_id,sl.id)) gross,
      sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id group by sl.variant_id
  ),
  item_refunds as (
    select sl.variant_id, sum(ri.quantity) quantity, count(distinct rf.id) transactions, sum(ri.amount) refunds,
      sum(case when ri.returned_to_stock then ri.quantity*coalesce(sl.unit_cost,0) else 0 end) cogs
    from scoped_refunds rf join app.refund_items ri on ri.tenant_id=rf.tenant_id and ri.refund_id=rf.id
    join app.sale_lines sl on sl.tenant_id=ri.tenant_id and sl.id=ri.sale_line_id group by sl.variant_id
  ),
  category_sales as (
    select coalesce(c.name,'Uncategorized') label, count(distinct s.id) transactions, sum(app.wholesale_reporting_line_payable(sl.tenant_id,sl.id)) gross,
      sum(sl.quantity*coalesce(sl.unit_cost,0)) cogs
    from scoped_sales s join app.sale_lines sl on sl.tenant_id=s.tenant_id and sl.sale_id=s.id
    join app.product_variants v on v.tenant_id=sl.tenant_id and v.id=sl.variant_id
    join app.products p on p.tenant_id=v.tenant_id and p.id=v.product_id
    left join app.product_categories c on c.tenant_id=p.tenant_id and c.id=p.category_id group by 1
  ),
  category_refunds as (
    select coalesce(c.name,'Uncategorized') label, sum(ri.amount) refunds, sum(case when ri.returned_to_stock then ri.quantity*coalesce(sl.unit_cost,0) else 0 end) cogs
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
    select rf.employee_id, sum(case when ri.returned_to_stock then ri.quantity*coalesce(sl.unit_cost,0) else 0 end) cogs
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
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'code',l.code::text,'name',l.name) order by l.name) from app.locations l where l.tenant_id=p_tenant_id and l.is_active and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, l.id)),'[]'::jsonb),
    'summary', (select jsonb_build_object('grossSalesCentavos',round(gross_sales*100)::bigint,'refundsCentavos',round(refunds*100)::bigint,'netSalesCentavos',round((gross_sales-refunds)*100)::bigint,'cogsCentavos',round(cogs*100)::bigint,'grossProfitCentavos',round((gross_sales-refunds-cogs)*100)::bigint,'transactionCount',transactions::integer,'discountCentavos',round(discounts*100)::bigint,'taxCentavos',round(taxes*100)::bigint) from summary),
    'salesTrend', coalesce((select jsonb_agg(jsonb_build_object('date',d.business_date,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'transactionCount',coalesce(s.transactions,0)::integer) order by d.business_date) from trend_days d left join trend_sales s on s.business_date=d.business_date left join trend_refunds r on r.business_date=d.business_date),'[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('locationId',l.id,'locationName',l.name,'netSalesCentavos',round((coalesce(bs.gross,0)-coalesce(br.refunds,0))*100)::bigint,'grossProfitCentavos',round((coalesce(bs.gross,0)-coalesce(br.refunds,0)-coalesce(bc.cogs,0)+coalesce(brc.cogs,0))*100)::bigint,'transactionCount',coalesce(bs.transactions,0)::integer) order by l.name) from app.locations l left join branch_sales bs on bs.location_id=l.id left join branch_refunds br on br.location_id=l.id left join branch_cogs bc on bc.location_id=l.id left join branch_refund_cogs brc on brc.location_id=l.id where l.tenant_id=p_tenant_id and l.is_active and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, l.id) and (p_location_id is null or l.id=p_location_id)),'[]'::jsonb),
    'inventory', jsonb_build_object('skuCount',(select count(*)::integer from inventory_rows),'onHandMilli',(select coalesce(round(sum(on_hand)*1000),0)::bigint from inventory_rows),'reservedMilli',(select coalesce(round(sum(reserved)*1000),0)::bigint from inventory_rows),'availableMilli',(select coalesce(round(sum(available)*1000),0)::bigint from inventory_rows),'inTransitMilli',(select coalesce(round(sum(in_transit)*1000),0)::bigint from inventory_rows),'outOfStockCount',(select count(*)::integer from inventory_rows where available<=0),'valuationCentavos',(select coalesce(round(sum(on_hand*coalesce(average_unit_cost,0))*100),0)::bigint from inventory_rows)),
    'registers', jsonb_build_object('openCount',(select count(*)::integer from app.register_sessions rs join app.registers r on r.tenant_id=rs.tenant_id and r.id=rs.register_id where rs.tenant_id=p_tenant_id and rs.status='open' and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, rs.location_id) and (p_location_id is null or r.location_id=p_location_id)),'totalCount',(select count(*)::integer from app.registers r where r.tenant_id=p_tenant_id and r.status='active' and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, r.location_id) and (p_location_id is null or r.location_id=p_location_id))),
    'byItem', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.variant_id,r.variant_id)::text,'label',coalesce(s.product_name,vp.name),'variantName',coalesce(s.variant_name,v.name),'sku',coalesce(s.sku,v.sku::text),'quantityMilli',round((coalesce(s.quantity,0)-coalesce(r.quantity,0))*1000)::bigint,'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(s.cogs,0)-coalesce(r.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(s.cogs,0)+coalesce(r.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from item_sales s full join item_refunds r on r.variant_id=s.variant_id join app.product_variants v on v.tenant_id=p_tenant_id and v.id=coalesce(s.variant_id,r.variant_id) join app.products vp on vp.tenant_id=v.tenant_id and vp.id=v.product_id),'[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.label,r.label),'label',coalesce(s.label,r.label),'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(s.cogs,0)-coalesce(r.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(s.cogs,0)+coalesce(r.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from category_sales s full join category_refunds r on r.label=s.label),'[]'::jsonb),
    'byEmployee', coalesce((select jsonb_agg(jsonb_build_object('key',e.id::text,'label',e.display_name,'transactionCount',coalesce(s.transactions,0)::integer,'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint,'cogsCentavos',round((coalesce(c.cogs,0)-coalesce(rc.cogs,0))*100)::bigint,'grossProfitCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0)-coalesce(c.cogs,0)+coalesce(rc.cogs,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from app.employees e left join employee_sales s on s.employee_id=e.id left join employee_refunds r on r.employee_id=e.id left join employee_cogs c on c.employee_id=e.id left join employee_refund_cogs rc on rc.employee_id=e.id where e.tenant_id=p_tenant_id and (s.employee_id is not null or r.employee_id is not null)),'[]'::jsonb),
    'byPaymentType', coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(s.method_type,r.method_type),'label',coalesce(s.name,r.name),'grossSalesCentavos',round(coalesce(s.gross,0)*100)::bigint,'refundsCentavos',round(coalesce(r.refunds,0)*100)::bigint,'netSalesCentavos',round((coalesce(s.gross,0)-coalesce(r.refunds,0))*100)::bigint) order by coalesce(s.gross,0)-coalesce(r.refunds,0) desc) from payment_sales s full join payment_refunds r on r.method_type=s.method_type and r.name=s.name),'[]'::jsonb),
    'inventoryItems', coalesce((select jsonb_agg(jsonb_build_object('locationId',location_id,'locationName',location_name,'productName',product_name,'variantName',variant_name,'sku',sku,'onHandMilli',round(on_hand*1000)::bigint,'reservedMilli',round(reserved*1000)::bigint,'availableMilli',round(available*1000)::bigint,'inTransitMilli',round(in_transit*1000)::bigint,'averageUnitCostCentavos',case when average_unit_cost is null then null else round(average_unit_cost*100)::bigint end,'valuationCentavos',round(on_hand*coalesce(average_unit_cost,0)*100)::bigint) order by location_name,product_name,variant_name) from inventory_rows),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function app.load_reporting_by_channel(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_channel text default 'all'
) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
declare
  v_context jsonb;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_sales_context jsonb;
begin
  if p_channel not in ('all', 'pos', 'wholesale') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  v_context := app.load_reporting_with_inventory_policy(
    p_actor_user_id, p_tenant_id, p_from, p_to, p_location_id, p_channel
  );
  select timezone into v_timezone from app.tenants where id = p_tenant_id;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with
  scoped_sales as (
    select sale.* from app.sales sale
    where sale.tenant_id = p_tenant_id and (p_channel = 'all' or sale.channel = p_channel)
      and sale.completed_at >= v_start and sale.completed_at < v_end
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, sale.location_id)
      and (p_location_id is null or sale.location_id = p_location_id)
  ),
  scoped_refunds as (
    select refund.*, sale.location_id, sale.employee_id, sale.completed_by_user_id
    from app.refunds refund
    join app.sales sale on sale.tenant_id = refund.tenant_id and sale.id = refund.sale_id
    where refund.tenant_id = p_tenant_id and (p_channel = 'all' or sale.channel = p_channel)
      and refund.completed_at >= v_start and refund.completed_at < v_end
      and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, sale.location_id)
      and (p_location_id is null or sale.location_id = p_location_id)
  ),
  summary as (
    select
      coalesce((select sum(total) from scoped_sales), 0) gross_sales,
      coalesce((select sum(amount) from scoped_refunds), 0) refunds,
      coalesce((select sum(discount_total) from scoped_sales), 0) discounts,
      coalesce((select sum(tax_total) from scoped_sales), 0) taxes,
      coalesce((select sum(line.quantity * coalesce(line.unit_cost, 0))
        from app.sale_lines line join scoped_sales sale
          on sale.id = line.sale_id and sale.tenant_id = line.tenant_id), 0)
      - coalesce((select sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end)
        from app.refund_items item join scoped_refunds refund
          on refund.id = item.refund_id and refund.tenant_id = item.tenant_id
        join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id), 0) cogs,
      (select count(*) from scoped_sales) transactions
  ),
  trend_days as (select generate_series(p_from, p_to, interval '1 day')::date business_date),
  trend_sales as (
    select (sale.completed_at at time zone v_timezone)::date business_date,
      sum(sale.total) gross, count(*) transactions
    from scoped_sales sale group by 1
  ),
  trend_refunds as (
    select (refund.completed_at at time zone v_timezone)::date business_date, sum(refund.amount) refunds
    from scoped_refunds refund group by 1
  ),
  branch_sales as (
    select location_id, sum(total) gross, count(*) transactions from scoped_sales group by location_id
  ),
  branch_refunds as (
    select location_id, sum(amount) refunds from scoped_refunds group by location_id
  ),
  branch_cogs as (
    select sale.location_id, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by sale.location_id
  ),
  branch_refund_cogs as (
    select refund.location_id, sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    group by refund.location_id
  ),
  item_sales as (
    select line.variant_id, max(line.product_name) product_name, max(line.variant_name) variant_name,
      max(line.sku) sku, sum(line.quantity) quantity, count(distinct sale.id) transactions,
      sum(app.wholesale_reporting_line_payable(line.tenant_id,line.id)) gross, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by line.variant_id
  ),
  item_refunds as (
    select line.variant_id, sum(item.quantity) quantity, count(distinct refund.id) transactions,
      sum(item.amount) refunds, sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    group by line.variant_id
  ),
  category_sales as (
    select coalesce(category.name, 'Uncategorized') label, count(distinct sale.id) transactions,
      sum(app.wholesale_reporting_line_payable(line.tenant_id,line.id)) gross, sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id
    join app.product_variants variant on variant.tenant_id = line.tenant_id and variant.id = line.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    left join app.product_categories category
      on category.tenant_id = product.tenant_id and category.id = product.category_id group by 1
  ),
  category_refunds as (
    select coalesce(category.name, 'Uncategorized') label, sum(item.amount) refunds,
      sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id
    join app.product_variants variant on variant.tenant_id = line.tenant_id and variant.id = line.variant_id
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    left join app.product_categories category
      on category.tenant_id = product.tenant_id and category.id = product.category_id group by 1
  ),
  actor_sales as (
    select coalesce(sale.employee_id, sale.completed_by_user_id) actor_id,
      count(*) transactions, sum(sale.total) gross
    from scoped_sales sale group by 1
  ),
  actor_refunds as (
    select coalesce(refund.employee_id, refund.completed_by_user_id) actor_id, sum(refund.amount) refunds
    from scoped_refunds refund group by 1
  ),
  actor_cogs as (
    select coalesce(sale.employee_id, sale.completed_by_user_id) actor_id,
      sum(line.quantity * coalesce(line.unit_cost, 0)) cogs
    from scoped_sales sale join app.sale_lines line
      on line.tenant_id = sale.tenant_id and line.sale_id = sale.id group by 1
  ),
  actor_refund_cogs as (
    select coalesce(refund.employee_id, refund.completed_by_user_id) actor_id,
      sum(case when item.returned_to_stock then item.quantity * coalesce(line.unit_cost, 0) else 0 end) cogs
    from scoped_refunds refund join app.refund_items item
      on item.tenant_id = refund.tenant_id and item.refund_id = refund.id
    join app.sale_lines line on line.tenant_id = item.tenant_id and line.id = item.sale_line_id group by 1
  ),
  actor_labels as (
    select actor_id, coalesce(employee.display_name, user_account.email::text, 'Business user') label
    from (select actor_id from actor_sales union select actor_id from actor_refunds) actor
    left join app.employees employee on employee.tenant_id = p_tenant_id and employee.id = actor.actor_id
    left join auth.users user_account on user_account.id = actor.actor_id
  ),
  payment_sales as (
    select method.method_type, method.name, sum(payment.amount) gross
    from scoped_sales sale join app.sale_payments payment
      on payment.tenant_id = sale.tenant_id and payment.sale_id = sale.id
    join app.payment_methods method
      on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
    group by method.method_type, method.name
  ),
  payment_refunds as (
    select method.method_type, method.name, sum(reversal.amount) refunds
    from scoped_refunds refund join app.payment_reversals reversal
      on reversal.tenant_id = refund.tenant_id and reversal.refund_id = refund.id
    join app.sale_payments payment
      on payment.tenant_id = reversal.tenant_id and payment.id = reversal.sale_payment_id
    join app.payment_methods method
      on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
    group by method.method_type, method.name
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'grossSalesCentavos', round(gross_sales * 100)::bigint,
      'refundsCentavos', round(refunds * 100)::bigint,
      'netSalesCentavos', round((gross_sales - refunds) * 100)::bigint,
      'cogsCentavos', round(cogs * 100)::bigint,
      'grossProfitCentavos', round((gross_sales - refunds - cogs) * 100)::bigint,
      'transactionCount', transactions::integer,
      'discountCentavos', round(discounts * 100)::bigint,
      'taxCentavos', round(taxes * 100)::bigint
    ) from summary),
    'salesTrend', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day.business_date,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer
    ) order by day.business_date) from trend_days day
      left join trend_sales sale on sale.business_date = day.business_date
      left join trend_refunds refund on refund.business_date = day.business_date), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object(
      'locationId', location.id,
      'locationName', location.name,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(cost.cogs, 0) + coalesce(refund_cost.cogs, 0)) * 100)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer
    ) order by location.name) from app.locations location
      left join branch_sales sale on sale.location_id = location.id
      left join branch_refunds refund on refund.location_id = location.id
      left join branch_cogs cost on cost.location_id = location.id
      left join branch_refund_cogs refund_cost on refund_cost.location_id = location.id
      where location.tenant_id = p_tenant_id and location.is_active
        and app.can_read_wholesale_location(p_actor_user_id, p_tenant_id, location.id)
        and (p_location_id is null or location.id = p_location_id)), '[]'::jsonb),
    'byItem', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.variant_id, refund.variant_id)::text,
      'label', coalesce(sale.product_name, product.name),
      'variantName', coalesce(sale.variant_name, variant.name),
      'sku', coalesce(sale.sku, variant.sku::text),
      'quantityMilli', round((coalesce(sale.quantity, 0) - coalesce(refund.quantity, 0)) * 1000)::bigint,
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(sale.cogs, 0) - coalesce(refund.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(sale.cogs, 0) + coalesce(refund.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from item_sales sale full join item_refunds refund on refund.variant_id = sale.variant_id
      join app.product_variants variant
        on variant.tenant_id = p_tenant_id and variant.id = coalesce(sale.variant_id, refund.variant_id)
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id), '[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.label, refund.label), 'label', coalesce(sale.label, refund.label),
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(sale.cogs, 0) - coalesce(refund.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(sale.cogs, 0) + coalesce(refund.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from category_sales sale full join category_refunds refund on refund.label = sale.label), '[]'::jsonb),
    'byEmployee', coalesce((select jsonb_agg(jsonb_build_object(
      'key', label.actor_id::text, 'label', label.label,
      'transactionCount', coalesce(sale.transactions, 0)::integer,
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint,
      'cogsCentavos', round((coalesce(cost.cogs, 0) - coalesce(refund_cost.cogs, 0)) * 100)::bigint,
      'grossProfitCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)
        - coalesce(cost.cogs, 0) + coalesce(refund_cost.cogs, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from actor_labels label
      left join actor_sales sale on sale.actor_id = label.actor_id
      left join actor_refunds refund on refund.actor_id = label.actor_id
      left join actor_cogs cost on cost.actor_id = label.actor_id
      left join actor_refund_cogs refund_cost on refund_cost.actor_id = label.actor_id), '[]'::jsonb),
    'byPaymentType', coalesce((select jsonb_agg(jsonb_build_object(
      'key', coalesce(sale.method_type, refund.method_type),
      'label', coalesce(sale.name, refund.name),
      'grossSalesCentavos', round(coalesce(sale.gross, 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(refund.refunds, 0) * 100)::bigint,
      'netSalesCentavos', round((coalesce(sale.gross, 0) - coalesce(refund.refunds, 0)) * 100)::bigint
    ) order by coalesce(sale.gross, 0) - coalesce(refund.refunds, 0) desc)
      from payment_sales sale full join payment_refunds refund
        on refund.method_type = sale.method_type and refund.name = sale.name), '[]'::jsonb)
  ) into v_sales_context;

  return v_context
    || v_sales_context
    || jsonb_build_object('scope', (v_context -> 'scope') || jsonb_build_object('channel', p_channel));
end;
$$;

commit;
