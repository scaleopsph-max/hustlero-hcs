-- Draft wholesale orders can be cancelled (owner request 2026-11-13: a draft that could not be confirmed had
-- no way out). A draft reserved nothing, so nothing is released; the order stays as cancelled for history.
begin;

create or replace function app.cancel_wholesale_order_remaining(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_sales_order_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_order app.sales_orders%rowtype;
  v_line app.sales_order_lines%rowtype;
  v_remaining numeric(18,3);
  v_released numeric(18,3) := 0;
  v_response jsonb;
begin
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = 'HCSQ2', message = 'A cancellation reason is required'; end if;
  if not exists (select 1 from app.tenant_entitlements entitlement join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'advanced_wholesale'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())) then
    raise exception using errcode = 'HCSQ0', message = 'Advanced wholesale is not enabled';
  end if;
  if not exists (select 1 from app.tenant_memberships membership where membership.tenant_id = p_tenant_id
    and membership.user_id = p_actor_user_id and membership.status = 'active' and (membership.is_owner or exists (
      select 1 from app.membership_roles membership_role join app.role_permissions permission
        on permission.tenant_id = membership_role.tenant_id and permission.role_id = membership_role.role_id
      where membership_role.tenant_id = membership.tenant_id and membership_role.user_id = membership.user_id
        and permission.permission_code = 'wholesale_orders.manage'))) then
    raise exception using errcode = 'HCSQ1', message = 'Wholesale order management is not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':wholesale-order:cancel:' || p_sales_order_id::text, 0));
  select * into v_existing from app.idempotency_records where tenant_id = p_tenant_id
    and operation = 'wholesale_order.cancel' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'wholesale_order.cancel', p_idempotency_key, p_request_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;
  select * into v_order from app.sales_orders where tenant_id = p_tenant_id and id = p_sales_order_id for update;
  if not found then raise exception using errcode = 'HCSQ7', message = 'The wholesale order was not found'; end if;
  -- A draft reserved nothing, so cancelling it only closes it (kept for history, never deleted).
  if v_order.status not in ('draft', 'confirmed', 'partially_fulfilled') then
    raise exception using errcode = 'HCSQ6', message = 'Only draft or confirmed orders with remaining quantity can be cancelled';
  end if;
  if v_order.status <> 'draft' then
  for v_line in select * from app.sales_order_lines where tenant_id = p_tenant_id and sales_order_id = p_sales_order_id
    order by id for update loop
    v_remaining := v_line.ordered_quantity - v_line.fulfilled_quantity - v_line.cancelled_quantity;
    if v_remaining > 0 then
      update app.inventory_balances set reserved = reserved - v_remaining, version = version + 1, updated_at = now()
      where tenant_id = p_tenant_id and location_id = v_order.location_id and variant_id = v_line.variant_id
        and reserved >= v_remaining;
      if not found then raise exception using errcode = 'HCQ11', message = 'The reservation balance is inconsistent'; end if;
      update app.sales_order_lines set cancelled_quantity = cancelled_quantity + v_remaining
      where tenant_id = p_tenant_id and id = v_line.id;
      insert into app.sales_order_reservation_ledger (
        tenant_id, sales_order_id, sales_order_line_id, location_id, variant_id, quantity_delta, reason, actor_user_id
      ) values (
        p_tenant_id, p_sales_order_id, v_line.id, v_order.location_id, v_line.variant_id,
        -v_remaining, 'order_cancelled', p_actor_user_id
      );
      v_released := v_released + v_remaining;
    end if;
  end loop;
  if v_released <= 0 then raise exception using errcode = 'HCSQ6', message = 'The order has no remaining quantity to cancel'; end if;
  end if;
  update app.sales_orders set status = 'cancelled', cancelled_at = now(),
    -- Drafts have no customer snapshot yet; keep who the order was for, as confirmation would.
    customer_number_snapshot = coalesce(customer_number_snapshot,
      (select c.customer_number::text from app.customers c where c.tenant_id = p_tenant_id and c.id = v_order.customer_id)),
    customer_name_snapshot = coalesce(customer_name_snapshot,
      (select c.full_name from app.customers c where c.tenant_id = p_tenant_id and c.id = v_order.customer_id))
  where tenant_id = p_tenant_id and id = p_sales_order_id;
  v_response := jsonb_build_object('salesOrderId', p_sales_order_id, 'status', 'cancelled',
    'releasedQuantityMilli', round(v_released * 1000)::bigint);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'sales_order.cancelled',
    'sales_order', p_sales_order_id, btrim(p_reason), v_response);
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'sales_order.cancelled', 'sales_order', p_sales_order_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'wholesale_order.cancel' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

commit;
