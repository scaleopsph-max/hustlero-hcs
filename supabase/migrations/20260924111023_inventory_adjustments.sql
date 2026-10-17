begin;

create function app.record_inventory_adjustment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_variant_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
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
  v_is_owner boolean;
  v_employee_id uuid;
  v_balance app.inventory_balances%rowtype;
  v_variant_exists boolean;
  v_effective_cost numeric(18, 2);
  v_new_on_hand numeric(18, 3);
  v_new_average numeric(18, 2);
  v_movement_id uuid;
  v_response jsonb;
begin
  select membership.is_owner, employee.id
    into v_is_owner, v_employee_id
  from app.tenant_memberships membership
  left join app.employees employee
    on employee.tenant_id = membership.tenant_id
   and employee.user_id = membership.user_id
   and employee.status = 'active'
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
          and role_permission.permission_code = 'inventory.manage'
      )
    );
  if not found then
    raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed';
  end if;

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id
      and entitlement.feature_code = 'inventory'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable';
  end if;

  if p_quantity is null or p_quantity = 0 or p_quantity <> round(p_quantity, 3)
     or p_quantity > 999999999.999 or p_quantity < -999999999.999
     or p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost <> round(p_unit_cost, 2))
     or p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 240 then
    raise exception using errcode = 'HCS20', message = 'Inventory adjustment is invalid';
  end if;

  if not exists (
    select 1 from app.locations location
    where location.tenant_id = p_tenant_id and location.id = p_location_id and location.is_active
      and (v_is_owner or exists (
        select 1 from app.employee_locations employee_location
        where employee_location.tenant_id = p_tenant_id
          and employee_location.employee_id = v_employee_id
          and employee_location.location_id = location.id
      ))
  ) then
    raise exception using errcode = 'HCS19', message = 'Inventory location was not found';
  end if;

  select true into v_variant_exists
  from app.product_variants variant
  join app.products product
    on product.tenant_id = variant.tenant_id and product.id = variant.product_id
  where variant.tenant_id = p_tenant_id and variant.id = p_variant_id
    and variant.is_active and variant.track_inventory and product.status = 'active';
  if not found then
    raise exception using errcode = 'HCS21', message = 'Inventory variant was not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.adjustment:' || p_location_id::text || ':' || p_variant_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.adjustment.request:' || p_idempotency_key, 0)
  );

  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id
    and operation = 'inventory.adjustment.record'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key was reused with different adjustment';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (
      tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at
    ) values (
      p_tenant_id, 'inventory.adjustment.record', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  select * into v_balance
  from app.inventory_balances balance
  where balance.tenant_id = p_tenant_id
    and balance.location_id = p_location_id
    and balance.variant_id = p_variant_id
  for update;
  if not found then
    raise exception using errcode = 'HCS22', message = 'Opening inventory must be recorded before an adjustment';
  end if;

  v_new_on_hand := v_balance.on_hand + p_quantity;
  if v_new_on_hand < 0 or v_new_on_hand < v_balance.reserved then
    raise exception using errcode = 'HCS22', message = 'Adjustment would make available stock negative';
  end if;

  v_effective_cost := coalesce(p_unit_cost, v_balance.average_unit_cost);
  if p_quantity > 0 and p_unit_cost is not null then
    v_new_average := round((
      coalesce(v_balance.on_hand, 0) * coalesce(v_balance.average_unit_cost, p_unit_cost)
      + p_quantity * p_unit_cost
    ) / v_new_on_hand, 2);
  else
    v_new_average := case when v_new_on_hand = 0 then null else v_balance.average_unit_cost end;
  end if;

  insert into app.inventory_movements (
    tenant_id, location_id, variant_id, movement_type, quantity, unit_cost,
    source_type, source_reference, actor_user_id
  ) values (
    p_tenant_id, p_location_id, p_variant_id, 'ADJUSTMENT',
    p_quantity, v_effective_cost, 'manual_inventory_adjustment', p_idempotency_key, p_actor_user_id
  ) returning id into v_movement_id;

  update app.inventory_balances
  set on_hand = v_new_on_hand,
      average_unit_cost = v_new_average,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id
    and location_id = p_location_id
    and variant_id = p_variant_id;

  v_response := pg_catalog.jsonb_build_object(
    'movementId', v_movement_id,
    'locationId', p_location_id,
    'variantId', p_variant_id,
    'quantityMilli', round(p_quantity * 1000)::bigint,
    'onHandMilli', round(v_new_on_hand * 1000)::bigint,
    'status', 'recorded'
  );

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, location_id, reason, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'inventory.adjustment.recorded', 'inventory_movement', v_movement_id, p_location_id, btrim(p_reason),
    pg_catalog.jsonb_build_object('quantity', p_quantity, 'unitCost', v_effective_cost, 'onHand', v_new_on_hand)
  );

  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'inventory.adjustment.recorded', 'inventory_movement', v_movement_id, v_response);

  update app.idempotency_records
  set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id
    and operation = 'inventory.adjustment.record'
    and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

revoke all on function app.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,text)
from public, anon, authenticated;
grant execute on function app.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,text)
to hcs_hyperdrive;

commit;
