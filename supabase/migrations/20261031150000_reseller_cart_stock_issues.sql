-- When a portal order is refused for stock (HCRP7 or HCRP8), the API asks which cart items are short so the
-- reseller sees exactly what to lower or remove. Available = on hand - reserved - damaged at the portal branch,
-- after expired payment holds give their stock back. Read-only apart from that sweep.
begin;

create function app.reseller_cart_stock_issues(p_auth_user uuid, p_tenant uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_location uuid; v_result jsonb;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception using errcode = 'HCRP3', message = 'Order details are invalid';
  end if;
  perform app.expire_reseller_payment_holds(p_tenant);
  select fulfillment_location_id into v_location from app.reseller_portal_settings where tenant_id = p_tenant;
  select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', variant.id, 'productName', product.name, 'variantName', variant.name,
      'requestedMilli', requested.quantity_milli,
      'availableMilli', greatest(round(coalesce(balance.on_hand - balance.reserved - balance.damaged, 0) * 1000), 0)::bigint)
      order by product.name, variant.name, variant.id), '[]'::jsonb)
    into v_result
  from (
    select (item.value->>'variantId')::uuid variant_id, max((item.value->>'quantityMilli')::numeric) quantity_milli
    from jsonb_array_elements(p_lines) item
    where jsonb_typeof(item.value) = 'object' and item.value->>'variantId' ~* '^[0-9a-f-]{36}$'
      and jsonb_typeof(item.value->'quantityMilli') = 'number'
    group by 1
  ) requested
  join app.product_variants variant on variant.tenant_id = p_tenant and variant.id = requested.variant_id
  join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
  left join app.inventory_balances balance on balance.tenant_id = p_tenant and balance.location_id = v_location
    and balance.variant_id = variant.id
  where variant.track_inventory
    and coalesce(balance.on_hand - balance.reserved - balance.damaged, 0) * 1000 < requested.quantity_milli;
  return jsonb_build_object('stockIssues', v_result);
end;
$$;
revoke all on function app.reseller_cart_stock_issues(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.reseller_cart_stock_issues(uuid, uuid, jsonb) to hcs_hyperdrive;

commit;
