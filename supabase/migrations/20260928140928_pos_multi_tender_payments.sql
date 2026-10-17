begin;

create function app.complete_pos_sale(
  p_session_token_hash text,
  p_lines jsonb,
  p_payments jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_register_session app.register_sessions%rowtype;
  v_existing app.idempotency_records%rowtype;
  v_line jsonb;
  v_payment jsonb;
  v_variant record;
  v_balance app.inventory_balances%rowtype;
  v_method app.payment_methods%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_business_date date;
  v_receipt_seq bigint;
  v_receipt text;
  v_subtotal numeric(18,2) := 0;
  v_quantity numeric(18,3);
  v_line_total numeric(18,2);
  v_payment_total numeric(18,2);
  v_amount numeric(18,2);
  v_tendered numeric(18,2);
  v_change numeric(18,2);
  v_cash_received_centavos bigint := 0;
  v_change_centavos bigint := 0;
  v_payment_response jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception using errcode = 'HCS94', message = 'Sale lines are invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where (line->>'variantId') is null or (line->>'quantityMilli') is null
      or (line->>'quantityMilli') !~ '^[1-9][0-9]*$'
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) line group by line->>'variantId' having count(*) > 1
  ) then
    raise exception using errcode = 'HCS94', message = 'Sale lines are invalid';
  end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 or jsonb_array_length(p_payments) > 10 then
    raise exception using errcode = 'HCS94', message = 'Sale payments are invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payments) payment
    where (payment->>'paymentMethodId') is null
      or (payment->>'paymentMethodId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (payment->>'amountCentavos') is null or (payment->>'amountCentavos') !~ '^[1-9][0-9]*$'
      or (payment->>'tenderedCentavos') is null or (payment->>'tenderedCentavos') !~ '^[1-9][0-9]*$'
  ) or exists (
    select 1 from jsonb_array_elements(p_payments) payment
    group by payment->>'paymentMethodId' having count(*) > 1
  ) then
    raise exception using errcode = 'HCS94', message = 'Sale payments are invalid';
  end if;

  select session.* into v_pos
  from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id = session.tenant_id and device.id = session.device_id and device.status = 'active'
  where session.token_hash = p_session_token_hash and session.revoked_at is null and session.expires_at > now();
  if v_pos.id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
  if not exists (
    select 1 from app.employee_roles employee_role
    join app.role_permissions permission on permission.tenant_id = employee_role.tenant_id and permission.role_id = employee_role.role_id
    where employee_role.tenant_id = v_pos.tenant_id and employee_role.employee_id = v_pos.employee_id
      and permission.permission_code = 'sales.create'
  ) then raise exception using errcode = 'HCS93', message = 'Employee cannot complete sales'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_pos.tenant_id::text || ':pos-sale.complete:' || p_idempotency_key, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = v_pos.tenant_id and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, expires_at)
    values (v_pos.tenant_id, 'pos-sale.complete', p_idempotency_key, p_request_hash, now() + interval '24 hours');
  end if;

  select * into v_register_session from app.register_sessions
  where tenant_id = v_pos.tenant_id and register_id = v_pos.register_id and employee_id = v_pos.employee_id and status = 'open'
  for update;
  if v_register_session.id is null then raise exception using errcode = 'HCS95', message = 'Open register session is required'; end if;

  select (now() at time zone coalesce(location.timezone, tenant.timezone, 'Asia/Manila'))::date into v_business_date
  from app.locations location join app.tenants tenant on tenant.id = location.tenant_id
  where location.tenant_id = v_pos.tenant_id and location.id = v_pos.location_id;
  insert into app.receipt_counters (tenant_id, location_id, business_date, last_number)
  values (v_pos.tenant_id, v_pos.location_id, v_business_date, 1)
  on conflict (tenant_id, location_id, business_date) do update
    set last_number = app.receipt_counters.last_number + 1, updated_at = now()
  returning last_number into v_receipt_seq;
  select upper(location.code::text) || '-' || to_char(v_business_date, 'YYYYMMDD') || '-' || lpad(v_receipt_seq::text, 6, '0')
  into v_receipt from app.locations location
  where location.tenant_id = v_pos.tenant_id and location.id = v_pos.location_id;
  insert into app.sales (id, tenant_id, location_id, register_id, register_session_id, employee_id, receipt_number, subtotal, total)
  values (v_sale_id, v_pos.tenant_id, v_pos.location_id, v_pos.register_id, v_register_session.id, v_pos.employee_id, v_receipt, 0, 0);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := ((v_line->>'quantityMilli')::bigint)::numeric / 1000;
    select variant.id, variant.product_id, variant.name variant_name, variant.sku::text sku, variant.retail_price,
      variant.unit_cost, variant.track_inventory, product.name product_name into v_variant
    from app.product_variants variant
    join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
    where variant.tenant_id = v_pos.tenant_id and variant.id = (v_line->>'variantId')::uuid
      and variant.is_active and product.status = 'active'
    for update of variant;
    if v_variant.id is null then raise exception using errcode = 'HCS97', message = 'Product variant is unavailable'; end if;
    if v_variant.track_inventory then
      select * into v_balance from app.inventory_balances
      where tenant_id = v_pos.tenant_id and location_id = v_pos.location_id and variant_id = v_variant.id for update;
      if v_balance.variant_id is null or (v_balance.on_hand - v_balance.reserved - v_balance.damaged) < v_quantity then
        raise exception using errcode = 'HCS98', message = 'Insufficient available stock';
      end if;
    end if;
    v_line_total := round(v_variant.retail_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into app.sale_lines (id, tenant_id, sale_id, variant_id, product_name, variant_name, sku, quantity, unit_price, unit_cost, line_total)
    values (gen_random_uuid(), v_pos.tenant_id, v_sale_id, v_variant.id, v_variant.product_name, v_variant.variant_name,
      v_variant.sku, v_quantity, v_variant.retail_price, v_variant.unit_cost, v_line_total);
    if v_variant.track_inventory then
      update app.inventory_balances set on_hand = on_hand - v_quantity, version = version + 1, updated_at = now()
      where tenant_id = v_pos.tenant_id and location_id = v_pos.location_id and variant_id = v_variant.id;
      insert into app.inventory_movements (tenant_id, location_id, variant_id, movement_type, quantity, unit_cost, source_type, source_reference, occurred_at)
      values (v_pos.tenant_id, v_pos.location_id, v_variant.id, 'SALE', -v_quantity,
        coalesce(v_balance.average_unit_cost, v_variant.unit_cost), 'sale', v_sale_id::text, now());
    end if;
  end loop;

  select sum((payment->>'amountCentavos')::bigint)::numeric / 100 into v_payment_total
  from jsonb_array_elements(p_payments) payment;
  if v_payment_total <> v_subtotal then
    raise exception using errcode = 'HCS99', message = 'Payment allocation must equal the sale total';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payments) loop
    select * into v_method from app.payment_methods
    where tenant_id = v_pos.tenant_id and id = (v_payment->>'paymentMethodId')::uuid and is_active for share;
    if not found then raise exception using errcode = 'HCS96', message = 'An active payment method is required'; end if;
    v_amount := (v_payment->>'amountCentavos')::bigint::numeric / 100;
    v_tendered := (v_payment->>'tenderedCentavos')::bigint::numeric / 100;
    if v_method.method_type = 'cash' then
      if v_tendered < v_amount then raise exception using errcode = 'HCS99', message = 'Cash received is less than its payment amount'; end if;
    elsif v_tendered <> v_amount then
      raise exception using errcode = 'HCS99', message = 'Non-cash tender must equal its payment amount';
    end if;
    v_change := v_tendered - v_amount;
    insert into app.sale_payments (tenant_id, sale_id, payment_method_id, amount, tendered_amount, change_amount)
    values (v_pos.tenant_id, v_sale_id, v_method.id, v_amount, v_tendered, v_change);
    if v_method.method_type = 'cash' then
      insert into app.cash_movements (tenant_id, register_session_id, location_id, movement_type, amount, source_type, source_id, actor_employee_id)
      values (v_pos.tenant_id, v_register_session.id, v_pos.location_id, 'cash_sale', v_amount, 'sale', v_sale_id, v_pos.employee_id);
      v_cash_received_centavos := v_cash_received_centavos + round(v_tendered * 100)::bigint;
      v_change_centavos := v_change_centavos + round(v_change * 100)::bigint;
    end if;
    v_payment_response := v_payment_response || jsonb_build_array(jsonb_build_object(
      'paymentMethodId', v_method.id,
      'methodName', v_method.name,
      'methodType', v_method.method_type,
      'amountCentavos', round(v_amount * 100)::bigint,
      'tenderedCentavos', round(v_tendered * 100)::bigint,
      'changeCentavos', round(v_change * 100)::bigint
    ));
  end loop;

  update app.sales set subtotal = v_subtotal, total = v_subtotal where tenant_id = v_pos.tenant_id and id = v_sale_id;
  v_response := jsonb_build_object(
    'saleId', v_sale_id,
    'receiptNumber', v_receipt,
    'status', 'completed',
    'subtotalCentavos', round(v_subtotal * 100)::bigint,
    'totalCentavos', round(v_subtotal * 100)::bigint,
    'cashReceivedCentavos', v_cash_received_centavos,
    'changeCentavos', v_change_centavos,
    'payments', v_payment_response,
    'completedAt', now()
  );
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
  values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'sale.completed', 'sale', v_sale_id, v_pos.location_id, v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (v_pos.tenant_id, 'sale.completed', 'sale', v_sale_id, v_response);
  update app.idempotency_records set response_status = 201, response_body = v_response, completed_at = now()
  where tenant_id = v_pos.tenant_id and operation = 'pos-sale.complete' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.complete_pos_sale_with_customer(
  p_session_token_hash text,
  p_lines jsonb,
  p_payments jsonb,
  p_customer_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype;
  v_customer app.customers%rowtype;
  v_response jsonb;
  v_sale_id uuid;
  v_existing_customer_id uuid;
  v_policy app.loyalty_policies%rowtype;
  v_points bigint := 0;
  v_balance bigint;
  v_loyalty_transaction_id uuid;
begin
  select session.* into v_pos
  from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id = session.tenant_id and device.id = session.device_id and device.status = 'active'
  where session.token_hash = p_session_token_hash and session.revoked_at is null and session.expires_at > now();
  if v_pos.id is null then raise exception using errcode = 'HCS90', message = 'POS session is invalid or expired'; end if;
  if not app.is_location_inventory_cutover_ready(v_pos.tenant_id, v_pos.location_id) then
    raise exception using errcode = 'HCSC0', message = 'Opening inventory must be posted and reconciled before sales can begin';
  end if;
  if p_customer_id is not null then
    select * into v_customer from app.customers
    where tenant_id = v_pos.tenant_id and id = p_customer_id and status = 'active';
    if not found then raise exception using errcode = 'HCSB1', message = 'Customer was not found'; end if;
  end if;

  v_response := app.complete_pos_sale(
    p_session_token_hash, p_lines, p_payments, p_idempotency_key, p_request_hash, p_request_id
  );
  v_sale_id := (v_response->>'saleId')::uuid;
  if p_customer_id is not null then
    select customer_id into v_existing_customer_id from app.sales
    where tenant_id = v_pos.tenant_id and id = v_sale_id for update;
    if v_existing_customer_id is not null and v_existing_customer_id <> p_customer_id then
      raise exception using errcode = 'HCS08', message = 'Idempotency key conflict';
    end if;
    if v_existing_customer_id is null then
      update app.sales set customer_id = p_customer_id where tenant_id = v_pos.tenant_id and id = v_sale_id;
      insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
      values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'sale.customer_linked', 'sale', v_sale_id,
        v_pos.location_id, jsonb_build_object('customerId', p_customer_id));
      insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
      values (v_pos.tenant_id, 'sale.customer_linked', 'sale', v_sale_id,
        jsonb_build_object('saleId', v_sale_id, 'customerId', p_customer_id));
      select * into v_policy from app.loyalty_policies where tenant_id = v_pos.tenant_id;
      if v_policy.enabled then
        v_points := floor((v_response->>'totalCentavos')::bigint / round(v_policy.spend_per_point * 100)::bigint)::bigint;
        if v_points > 0 then
          v_loyalty_transaction_id := gen_random_uuid();
          insert into app.loyalty_transactions (
            id, tenant_id, customer_id, transaction_type, points_delta, balance_after_points,
            spend_per_point_centavos, sale_id, actor_employee_id, occurred_at
          ) values (
            v_loyalty_transaction_id, v_pos.tenant_id, p_customer_id, 'sale_earn', v_points, 0,
            round(v_policy.spend_per_point * 100)::bigint, v_sale_id, v_pos.employee_id,
            (v_response->>'completedAt')::timestamptz
          );
          insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
          values (v_pos.tenant_id, p_request_id, 'pos_employee', v_pos.employee_id, 'loyalty.points_earned',
            'loyalty_transaction', v_loyalty_transaction_id, v_pos.location_id,
            jsonb_build_object('saleId', v_sale_id, 'customerId', p_customer_id, 'points', v_points));
          insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
          values (v_pos.tenant_id, 'loyalty.points_earned', 'customer', p_customer_id,
            jsonb_build_object('transactionId', v_loyalty_transaction_id, 'saleId', v_sale_id,
              'customerId', p_customer_id, 'points', v_points));
        end if;
      end if;
    end if;
    select coalesce(points_delta, 0) into v_points from app.loyalty_transactions
    where tenant_id = v_pos.tenant_id and sale_id = v_sale_id and transaction_type = 'sale_earn';
    v_points := coalesce(v_points, 0);
    select coalesce(balance_points, 0) into v_balance from app.loyalty_accounts
    where tenant_id = v_pos.tenant_id and customer_id = p_customer_id;
    v_balance := coalesce(v_balance, 0);
    v_response := v_response || jsonb_build_object(
      'customerId', p_customer_id,
      'customerName', v_customer.full_name,
      'loyaltyEarnedPoints', v_points,
      'loyaltyBalancePoints', v_balance
    );
  else
    v_response := v_response || jsonb_build_object(
      'customerId', null,
      'customerName', null,
      'loyaltyEarnedPoints', 0,
      'loyaltyBalancePoints', null
    );
  end if;
  return v_response;
end;
$$;

create or replace function app.load_sale_receipt_with_customer(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_sale_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_receipt jsonb;
  v_payment_count integer;
  v_all_cash boolean;
begin
  v_receipt := app.load_sale_receipt(p_actor_user_id, p_tenant_id, p_sale_id);
  select count(*)::integer, coalesce(bool_and(method.method_type = 'cash'), false)
  into v_payment_count, v_all_cash
  from app.sale_payments payment
  join app.payment_methods method
    on method.tenant_id = payment.tenant_id and method.id = payment.payment_method_id
  where payment.tenant_id = p_tenant_id and payment.sale_id = p_sale_id;

  if coalesce((v_receipt->>'canReverse')::boolean, false) and (v_payment_count <> 1 or not v_all_cash) then
    v_receipt := v_receipt || jsonb_build_object(
      'canReverse', false,
      'reversalBlockedReason', 'Split and non-cash refunds require a dedicated payment return flow.'
    );
  end if;

  return v_receipt
    || coalesce(
      (
        select jsonb_build_object(
          'customerId', customer.id,
          'customerName', customer.full_name,
          'customerNumber', customer.customer_number::text
        )
        from app.sales sale
        join app.customers customer
          on customer.tenant_id = sale.tenant_id and customer.id = sale.customer_id
        where sale.tenant_id = p_tenant_id and sale.id = p_sale_id
      ),
      jsonb_build_object('customerId', null, 'customerName', null, 'customerNumber', null)
    )
    || jsonb_build_object(
      'loyaltyEarnedPoints', coalesce((
        select sum(greatest(points_delta, 0)) from app.loyalty_transactions
        where tenant_id = p_tenant_id and sale_id = p_sale_id
      ), 0),
      'loyaltyReversedPoints', coalesce((
        select -sum(least(points_delta, 0)) from app.loyalty_transactions
        where tenant_id = p_tenant_id and sale_id = p_sale_id
      ), 0)
    );
end;
$$;

revoke all on function app.complete_pos_sale(text, jsonb, jsonb, text, text, text)
  from public, anon, authenticated, hcs_hyperdrive;
revoke all on function app.complete_pos_sale_with_customer(text, jsonb, jsonb, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function app.complete_pos_sale_with_customer(text, jsonb, jsonb, uuid, text, text, text)
  to hcs_hyperdrive;
revoke all on function app.load_sale_receipt_with_customer(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.load_sale_receipt_with_customer(uuid, uuid, uuid)
  to hcs_hyperdrive;

commit;
