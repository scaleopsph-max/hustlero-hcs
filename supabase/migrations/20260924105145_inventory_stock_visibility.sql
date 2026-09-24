begin;

create function app.list_inventory_stock(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_is_owner boolean;
  v_employee_id uuid;
  v_selected_location_id uuid;
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
          and role_permission.permission_code in ('inventory.read', 'inventory.manage')
      )
    );
  if not found then
    raise exception using errcode = 'HCS17', message = 'Inventory access is not allowed';
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

  select location.id into v_selected_location_id
  from app.locations location
  where location.tenant_id = p_tenant_id
    and location.is_active
    and (v_is_owner or exists (
      select 1 from app.employee_locations employee_location
      where employee_location.tenant_id = p_tenant_id
        and employee_location.employee_id = v_employee_id
        and employee_location.location_id = location.id
    ))
    and (p_location_id is null or location.id = p_location_id)
  order by location.created_at, location.id
  limit 1;
  if v_selected_location_id is null then
    raise exception using errcode = 'HCS19', message = 'Inventory location was not found';
  end if;

  return pg_catalog.jsonb_build_object(
    'locations', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', location.id, 'code', location.code::text, 'name', location.name)
        order by location.created_at, location.id
      )
      from app.locations location
      where location.tenant_id = p_tenant_id and location.is_active
        and (v_is_owner or exists (
          select 1 from app.employee_locations employee_location
          where employee_location.tenant_id = p_tenant_id
            and employee_location.employee_id = v_employee_id
            and employee_location.location_id = location.id
        ))
    ), '[]'::jsonb),
    'selectedLocationId', v_selected_location_id,
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'productId', product.id,
          'productName', product.name,
          'variantId', variant.id,
          'variantName', variant.name,
          'sku', variant.sku::text,
          'barcodeCount', (select count(*)::integer from app.product_barcodes barcode
            where barcode.tenant_id = variant.tenant_id and barcode.variant_id = variant.id),
          'onHand', coalesce(balance.on_hand, 0)::text,
          'reserved', coalesce(balance.reserved, 0)::text,
          'available', (coalesce(balance.on_hand, 0) - coalesce(balance.reserved, 0))::text,
          'inTransit', coalesce(balance.in_transit, 0)::text,
          'damaged', coalesce(balance.damaged, 0)::text,
          'averageUnitCost', balance.average_unit_cost::text,
          'hasBalance', balance.variant_id is not null
        ) order by lower(product.name), lower(variant.name), variant.id
      )
      from app.product_variants variant
      join app.products product
        on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      left join app.inventory_balances balance
        on balance.tenant_id = variant.tenant_id
       and balance.location_id = v_selected_location_id
       and balance.variant_id = variant.id
      where variant.tenant_id = p_tenant_id
        and variant.is_active and variant.track_inventory
        and product.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create function app.list_inventory_movements(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_location_id uuid,
  p_variant_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_is_owner boolean;
  v_employee_id uuid;
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
          and role_permission.permission_code in ('inventory.read', 'inventory.manage')
      )
    );
  if not found then
    raise exception using errcode = 'HCS17', message = 'Inventory access is not allowed';
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

  if p_limit < 1 or p_limit > 200 then
    raise exception using errcode = 'HCS20', message = 'Inventory movement limit is invalid';
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

  if p_variant_id is not null and not exists (
    select 1 from app.product_variants variant
    where variant.tenant_id = p_tenant_id and variant.id = p_variant_id
  ) then
    raise exception using errcode = 'HCS21', message = 'Inventory variant was not found';
  end if;

  return pg_catalog.jsonb_build_object(
    'locationId', p_location_id,
    'items', coalesce((
      with movement_balances as (
        select movement.*,
          sum(movement.quantity) over (
            partition by movement.tenant_id, movement.location_id, movement.variant_id
            order by movement.occurred_at, movement.created_at, movement.id
            rows between unbounded preceding and current row
          ) as balance_after
        from app.inventory_movements movement
        where movement.tenant_id = p_tenant_id
          and movement.location_id = p_location_id
          and (p_variant_id is null or movement.variant_id = p_variant_id)
      )
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', movement.id,
          'productId', product.id,
          'productName', product.name,
          'variantId', variant.id,
          'variantName', variant.name,
          'sku', variant.sku::text,
          'movementType', movement.movement_type,
          'quantity', movement.quantity::text,
          'unitCost', movement.unit_cost::text,
          'sourceType', movement.source_type,
          'sourceReference', movement.source_reference,
          'actorLabel', coalesce(employee.display_name, case when membership.is_owner then 'Business owner' else 'System' end),
          'occurredAt', movement.occurred_at,
          'balanceAfter', movement.balance_after::text
        ) order by movement.occurred_at desc, movement.created_at desc, movement.id desc
      )
      from (
        select * from movement_balances
        order by occurred_at desc, created_at desc, id desc
        limit p_limit
      ) movement
      join app.product_variants variant
        on variant.tenant_id = movement.tenant_id and variant.id = movement.variant_id
      join app.products product
        on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      left join app.employees employee
        on employee.tenant_id = movement.tenant_id and employee.user_id = movement.actor_user_id
      left join app.tenant_memberships membership
        on membership.tenant_id = movement.tenant_id and membership.user_id = movement.actor_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app.list_inventory_stock(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function app.list_inventory_stock(uuid,uuid,uuid) to hcs_hyperdrive;
revoke all on function app.list_inventory_movements(uuid,uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function app.list_inventory_movements(uuid,uuid,uuid,uuid,integer) to hcs_hyperdrive;

commit;
