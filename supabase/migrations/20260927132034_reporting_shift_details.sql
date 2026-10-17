begin;

create function app.load_shift_report(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_channel text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1
    from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
      and (
        membership.is_owner
        or exists (
          select 1
          from app.membership_roles membership_role
          join app.role_permissions role_permission
            on role_permission.tenant_id = membership_role.tenant_id
           and role_permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id
            and role_permission.permission_code = 'reports.read'
        )
      )
  ) then
    raise exception using errcode = 'HCSD0', message = 'Reporting access is not allowed';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366
    or p_channel not in ('all', 'pos') then
    raise exception using errcode = 'HCSD1', message = 'Reporting filters are invalid';
  end if;
  if p_location_id is not null and not exists (
    select 1 from app.locations where tenant_id = p_tenant_id and id = p_location_id
  ) then
    raise exception using errcode = 'HCSD2', message = 'Reporting location was not found';
  end if;

  select tenant.timezone into v_timezone from app.tenants tenant where tenant.id = p_tenant_id;
  v_start := p_from::timestamp at time zone v_timezone;
  v_end := (p_to + 1)::timestamp at time zone v_timezone;

  with scoped_sessions as (
    select session.*
    from app.register_sessions session
    where session.tenant_id = p_tenant_id
      and session.opened_at >= v_start
      and session.opened_at < v_end
      and (p_location_id is null or session.location_id = p_location_id)
  ),
  session_sales as (
    select sale.register_session_id,
      count(*)::integer transaction_count,
      coalesce(sum(sale.total), 0) gross_sales
    from app.sales sale
    join scoped_sessions session on session.id = sale.register_session_id
    where sale.tenant_id = p_tenant_id
    group by sale.register_session_id
  ),
  session_refunds as (
    select sale.register_session_id, coalesce(sum(refund.amount), 0) refunds
    from app.refunds refund
    join app.sales sale on sale.tenant_id = refund.tenant_id and sale.id = refund.sale_id
    join scoped_sessions session on session.id = sale.register_session_id
    where refund.tenant_id = p_tenant_id
    group by sale.register_session_id
  ),
  rows as (
    select session.id, session.register_id, register.name register_name,
      session.location_id, location.name location_name,
      session.employee_id, employee.display_name employee_name,
      session.status, session.opened_at, session.closed_at,
      session.opening_cash, session.expected_cash, session.counted_cash, session.variance,
      coalesce(sales.gross_sales, 0) gross_sales,
      coalesce(refunds.refunds, 0) refunds,
      coalesce(sales.transaction_count, 0) transaction_count
    from scoped_sessions session
    join app.registers register
      on register.tenant_id = session.tenant_id and register.id = session.register_id
    join app.locations location
      on location.tenant_id = session.tenant_id and location.id = session.location_id
    join app.employees employee
      on employee.tenant_id = session.tenant_id and employee.id = session.employee_id
    left join session_sales sales on sales.register_session_id = session.id
    left join session_refunds refunds on refunds.register_session_id = session.id
  )
  select jsonb_build_object(
    'scope', jsonb_build_object(
      'from', p_from, 'to', p_to, 'locationId', p_location_id, 'channel', p_channel,
      'timezone', v_timezone, 'generatedAt', now()
    ),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('id', location.id, 'code', location.code::text, 'name', location.name) order by location.name)
      from app.locations location where location.tenant_id = p_tenant_id and location.is_active
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'sessionCount', (select count(*)::integer from rows),
      'openCount', (select count(*)::integer from rows where status = 'open'),
      'closedCount', (select count(*)::integer from rows where status = 'closed'),
      'exceptionCount', (select count(*)::integer from rows where status = 'exception'),
      'netSalesCentavos', (select coalesce(round(sum(gross_sales - refunds) * 100), 0)::bigint from rows),
      'expectedCashCentavos', (select coalesce(round(sum(expected_cash) * 100), 0)::bigint from rows where expected_cash is not null),
      'countedCashCentavos', (select coalesce(round(sum(counted_cash) * 100), 0)::bigint from rows where counted_cash is not null),
      'varianceCentavos', (select coalesce(round(sum(variance) * 100), 0)::bigint from rows where variance is not null)
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id, 'registerId', row.register_id, 'registerName', row.register_name,
        'locationId', row.location_id, 'locationName', row.location_name,
        'employeeId', row.employee_id, 'employeeName', row.employee_name,
        'status', row.status, 'openedAt', row.opened_at, 'closedAt', row.closed_at,
        'openingCashCentavos', round(row.opening_cash * 100)::bigint,
        'expectedCashCentavos', case when row.expected_cash is null then null else round(row.expected_cash * 100)::bigint end,
        'countedCashCentavos', case when row.counted_cash is null then null else round(row.counted_cash * 100)::bigint end,
        'varianceCentavos', case when row.variance is null then null else round(row.variance * 100)::bigint end,
        'grossSalesCentavos', round(row.gross_sales * 100)::bigint,
        'refundsCentavos', round(row.refunds * 100)::bigint,
        'netSalesCentavos', round((row.gross_sales - row.refunds) * 100)::bigint,
        'transactionCount', row.transaction_count
      ) order by row.opened_at desc)
      from rows row
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function app.load_shift_report(uuid,uuid,date,date,uuid,text)
from public, anon, authenticated;
grant execute on function app.load_shift_report(uuid,uuid,date,date,uuid,text)
to hcs_hyperdrive;

commit;
