-- Close register from the POS (owner direction 2026-11-13).
--   * Blind count: the cashier enters the counted cash first; expected cash and the variance come back only after.
--   * Only the employee who opened the session closes it from the POS. Owners can still close from the Back Office.
--   * Any variance still closes the drawer, as an "exception" the owner resolves; the existing alert rule flags it.
begin;

alter table app.register_sessions
  add column closed_by_employee_id uuid,
  add column close_note text check (close_note is null or char_length(close_note) between 1 and 500),
  add constraint register_sessions_closed_by_employee_fk foreign key (tenant_id, closed_by_employee_id)
    references app.employees (tenant_id, id);

-- What the drawer and the other payment methods took during one session, for the close summary.
create function app.register_session_summary_json(p_tenant uuid, p_session uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cash', jsonb_build_object(
      'openingCentavos', round(coalesce(sum(m.amount) filter (where m.movement_type = 'opening_cash'), 0) * 100)::bigint,
      'salesCentavos', round(coalesce(sum(m.amount) filter (where m.movement_type = 'cash_sale'), 0) * 100)::bigint,
      'refundsCentavos', round(coalesce(sum(m.amount) filter (where m.movement_type = 'cash_refund'), 0) * 100)::bigint,
      'otherCentavos', round(coalesce(sum(m.amount) filter (where m.movement_type in
        ('cash_in', 'cash_out', 'shift_expense', 'adjustment')), 0) * 100)::bigint),
    'nonCash', coalesce((
      select jsonb_agg(jsonb_build_object('method', x.name, 'amountCentavos', x.total) order by x.name)
      from (
        select pm.name, round(sum(sp.amount) * 100)::bigint total
        from app.sales s
        join app.sale_payments sp on sp.tenant_id = s.tenant_id and sp.sale_id = s.id and sp.status = 'completed'
        join app.payment_methods pm on pm.tenant_id = sp.tenant_id and pm.id = sp.payment_method_id and pm.method_type <> 'cash'
        where s.tenant_id = p_tenant and s.register_session_id = p_session
        group by pm.name) x), '[]'::jsonb),
    'salesCount', (select count(*) from app.sales s where s.tenant_id = p_tenant and s.register_session_id = p_session
      and s.status <> 'voided'))
  from app.cash_movements m
  where m.tenant_id = p_tenant and m.register_session_id = p_session and m.movement_type <> 'close_variance';
$$;
revoke all on function app.register_session_summary_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

create function app.close_pos_register_session(p_session_token_hash text, p_counted_cash_centavos bigint, p_note text,
  p_idempotency_key text, p_request_hash text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_existing app.idempotency_records%rowtype;
  v_session app.register_sessions%rowtype;
  v_expected numeric(18,2);
  v_counted numeric(18,2);
  v_variance numeric(18,2);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
  v_response jsonb;
begin
  if p_counted_cash_centavos is null or p_counted_cash_centavos < 0 or p_counted_cash_centavos > 100000000000
    or char_length(coalesce(v_note, '')) > 500 then
    raise exception using errcode = 'HCRG1', message = 'Counted cash or note is invalid';
  end if;
  select s.* into v_pos from app.pos_employee_sessions s
  join app.pos_devices d on d.tenant_id = s.tenant_id and d.id = s.device_id and d.status = 'active'
  where s.token_hash = p_session_token_hash and s.revoked_at is null and s.expires_at > now();
  if v_pos.id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
  if not exists (select 1 from app.employee_roles er join app.role_permissions rp on rp.tenant_id = er.tenant_id and rp.role_id = er.role_id
      where er.tenant_id = v_pos.tenant_id and er.employee_id = v_pos.employee_id and rp.permission_code = 'registers.operate') then
    raise exception using errcode = 'HCS93', message = 'Employee cannot operate registers';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text || ':pos-register.close:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = v_pos.tenant_id and operation = 'pos-register.close' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at)
    values (v_pos.tenant_id, 'pos-register.close', p_idempotency_key, p_request_hash, now() + interval '24 hours');
  end if;

  select * into v_session from app.register_sessions
  where tenant_id = v_pos.tenant_id and register_id = v_pos.register_id and status = 'open' for update;
  if v_session.id is null then raise exception using errcode = 'HCRG2', message = 'This register is not open'; end if;
  if v_session.employee_id <> v_pos.employee_id then
    raise exception using errcode = 'HCRG3', message = 'Only the employee who opened this register can close it';
  end if;

  select coalesce(sum(amount), 0) into v_expected from app.cash_movements
  where tenant_id = v_pos.tenant_id and register_session_id = v_session.id and movement_type <> 'close_variance';
  v_counted := p_counted_cash_centavos::numeric / 100;
  v_variance := v_counted - v_expected;
  v_status := case when v_variance = 0 then 'closed' else 'exception' end;

  update app.register_sessions set status = v_status, expected_cash = v_expected, counted_cash = v_counted,
    variance = v_variance, closed_at = now(), closed_by_employee_id = v_pos.employee_id, close_note = v_note,
    updated_at = now()
  where tenant_id = v_pos.tenant_id and id = v_session.id;
  if v_variance <> 0 then
    insert into app.cash_movements (tenant_id, register_session_id, location_id, movement_type, amount, source_type,
      source_id, reason, actor_employee_id)
    values (v_pos.tenant_id, v_session.id, v_session.location_id, 'close_variance', v_variance, 'register_session',
      v_session.id, coalesce(v_note, 'Counted cash variance at register close'), v_pos.employee_id);
  end if;

  v_response := jsonb_build_object(
    'registerSessionId', v_session.id, 'status', v_status, 'openedAt', v_session.opened_at, 'closedAt', now(),
    'expectedCashCentavos', round(v_expected * 100)::bigint, 'countedCashCentavos', p_counted_cash_centavos,
    'varianceCentavos', round(v_variance * 100)::bigint)
    || app.register_session_summary_json(v_pos.tenant_id, v_session.id);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'register.closed', 'register_session', v_session.id,
    v_session.location_id, v_response - 'nonCash' - 'cash' || jsonb_build_object('note', v_note));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (v_pos.tenant_id, 'register.closed', 'register_session', v_session.id, v_response - 'nonCash' - 'cash');
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now()
  where tenant_id = v_pos.tenant_id and operation = 'pos-register.close' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;
revoke all on function app.close_pos_register_session(text, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function app.close_pos_register_session(text, bigint, text, text, text, text) to hcs_hyperdrive;

commit;
