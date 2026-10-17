begin;

alter table app.inventory_import_batches
  add column posted_by uuid references auth.users (id) on delete restrict,
  add column reconciled_by uuid references auth.users (id) on delete restrict;

create index inventory_import_batches_posted_by_idx
  on app.inventory_import_batches (posted_by, posted_at desc) where posted_by is not null;
create index inventory_import_batches_reconciled_by_idx
  on app.inventory_import_batches (reconciled_by, reconciled_at desc) where reconciled_by is not null;

alter table app.inventory_import_batches
  add constraint inventory_import_batches_actor_dates check (
    (posted_at is null and posted_by is null or posted_at is not null and posted_by is not null)
    and (reconciled_at is null and reconciled_by is null or reconciled_at is not null and reconciled_by is not null)
  );

create function app.reject_posted_inventory_import_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from app.inventory_import_batches batch
    where batch.tenant_id = old.tenant_id and batch.id = old.batch_id and batch.status <> 'previewed'
  ) then
    raise exception using errcode = 'HCS31', message = 'Posted inventory import rows are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger inventory_import_rows_protect_posted
before update or delete on app.inventory_import_rows
for each row execute function app.reject_posted_inventory_import_row_mutation();

create function app.post_inventory_import(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_batch_id uuid,
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
  v_batch app.inventory_import_batches%rowtype;
  v_row app.inventory_import_rows%rowtype;
  v_response jsonb;
  v_movement_count integer := 0;
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions role_permission
          on role_permission.tenant_id = membership_role.tenant_id
         and role_permission.role_id = membership_role.role_id
        where membership_role.tenant_id = membership.tenant_id
          and membership_role.user_id = membership.user_id
          and role_permission.permission_code = 'inventory.manage'
      ))
  ) then
    raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed';
  end if;

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'inventory'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.import.post:' || p_batch_id::text, 0)
  );
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'inventory.import.post' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key conflict';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'inventory.import.post', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours');
  end if;

  select * into v_batch from app.inventory_import_batches
  where tenant_id = p_tenant_id and id = p_batch_id for update;
  if not found then raise exception using errcode = 'HCS32', message = 'Inventory import batch was not found'; end if;
  if v_batch.status <> 'previewed' then
    raise exception using errcode = 'HCS33', message = 'Inventory import batch cannot be posted in its current state';
  end if;
  if v_batch.row_count = 0 or v_batch.accepted_count <> v_batch.row_count or v_batch.rejected_count <> 0 then
    raise exception using errcode = 'HCS34', message = 'Resolve every rejected inventory row before posting';
  end if;

  if exists (
    select 1 from app.inventory_import_rows row
    where row.tenant_id = p_tenant_id and row.batch_id = p_batch_id
      and (row.status <> 'accepted' or row.location_id is null or row.variant_id is null
        or row.quantity_on_hand is null or row.unit_cost is null)
  ) then
    raise exception using errcode = 'HCS34', message = 'Resolve every rejected inventory row before posting';
  end if;

  if exists (
    select 1 from app.inventory_import_rows row
    where row.tenant_id = p_tenant_id and row.batch_id = p_batch_id
      and (exists (
        select 1 from app.inventory_movements movement
        where movement.tenant_id = row.tenant_id and movement.location_id = row.location_id
          and movement.variant_id = row.variant_id
      ) or exists (
        select 1 from app.inventory_balances balance
        where balance.tenant_id = row.tenant_id and balance.location_id = row.location_id
          and balance.variant_id = row.variant_id
      ))
  ) then
    raise exception using errcode = 'HCS35', message = 'Inventory changed after preview; upload and validate a new file';
  end if;

  for v_row in
    select * from app.inventory_import_rows
    where tenant_id = p_tenant_id and batch_id = p_batch_id and status = 'accepted'
    order by row_number for update
  loop
    insert into app.inventory_balances (
      tenant_id, location_id, variant_id, on_hand, reserved, in_transit, damaged,
      average_unit_cost, version, updated_at
    ) values (
      p_tenant_id, v_row.location_id, v_row.variant_id, v_row.quantity_on_hand,
      coalesce(v_row.reserved_quantity, 0), coalesce(v_row.in_transit_quantity, 0),
      coalesce(v_row.damaged_quantity, 0), v_row.unit_cost, 1, v_batch.cutover_at
    );

    if v_row.quantity_on_hand > 0 then
      insert into app.inventory_movements (
        tenant_id, location_id, variant_id, movement_type, quantity, unit_cost,
        source_type, source_reference, actor_user_id, occurred_at
      ) values (
        p_tenant_id, v_row.location_id, v_row.variant_id, 'OPENING_BALANCE',
        v_row.quantity_on_hand, v_row.unit_cost, 'inventory_import_batch',
        p_batch_id::text || ':' || v_row.row_number::text, p_actor_user_id, v_batch.cutover_at
      );
      v_movement_count := v_movement_count + 1;
    end if;

    if v_row.reorder_level is not null then
      insert into app.inventory_reorder_policies (
        tenant_id, location_id, variant_id, reorder_level, is_active, updated_by
      ) values (
        p_tenant_id, v_row.location_id, v_row.variant_id, v_row.reorder_level, true, p_actor_user_id
      ) on conflict (tenant_id, location_id, variant_id) do update set
        reorder_level = excluded.reorder_level, is_active = true, updated_by = excluded.updated_by;
      perform app.sync_inventory_reorder_alert(p_tenant_id, v_row.location_id, v_row.variant_id);
    end if;
  end loop;

  update app.inventory_import_batches set
    status = 'posted', posted_at = now(), posted_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_batch_id
  returning * into v_batch;

  v_response := pg_catalog.jsonb_build_object(
    'batchId', v_batch.id, 'status', v_batch.status, 'postedAt', v_batch.posted_at,
    'movementCount', v_movement_count, 'balanceCount', v_batch.accepted_count,
    'summary', pg_catalog.jsonb_build_object(
      'rowCount', v_batch.row_count, 'totalQuantityMilli', pg_catalog.round(v_batch.total_quantity * 1000)::bigint,
      'totalValuationMinor', pg_catalog.round(v_batch.total_valuation * 100)::bigint
    )
  );
  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'inventory.import.posted',
    'inventory_import_batch', p_batch_id, v_response
  );
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'inventory.import.posted', 'inventory_import_batch', p_batch_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response,
    completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'inventory.import.post' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.reconcile_inventory_import(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_batch_id uuid,
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
  v_batch app.inventory_import_batches%rowtype;
  v_mismatch_count integer;
  v_actual_quantity numeric(18,3);
  v_actual_valuation numeric(18,2);
  v_response jsonb;
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id and membership.user_id = p_actor_user_id
      and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions role_permission
          on role_permission.tenant_id = membership_role.tenant_id
         and role_permission.role_id = membership_role.role_id
        where membership_role.tenant_id = membership.tenant_id
          and membership_role.user_id = membership.user_id
          and role_permission.permission_code = 'inventory.manage'
      ))
  ) then
    raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.import.reconcile:' || p_batch_id::text, 0)
  );
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'inventory.import.reconcile' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key conflict';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'inventory.import.reconcile', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours');
  end if;

  select * into v_batch from app.inventory_import_batches
  where tenant_id = p_tenant_id and id = p_batch_id for update;
  if not found then raise exception using errcode = 'HCS32', message = 'Inventory import batch was not found'; end if;
  if v_batch.status <> 'posted' then
    raise exception using errcode = 'HCS36', message = 'Only a posted inventory import can be reconciled';
  end if;

  select count(*)::integer,
    coalesce(sum(balance.on_hand), 0)::numeric(18,3),
    coalesce(sum(balance.on_hand * balance.average_unit_cost), 0)::numeric(18,2)
    into v_mismatch_count, v_actual_quantity, v_actual_valuation
  from app.inventory_import_rows row
  left join app.inventory_balances balance
    on balance.tenant_id = row.tenant_id and balance.location_id = row.location_id
   and balance.variant_id = row.variant_id
  where row.tenant_id = p_tenant_id and row.batch_id = p_batch_id and row.status = 'accepted'
    and (
      balance.variant_id is null or balance.on_hand <> row.quantity_on_hand
      or balance.reserved <> coalesce(row.reserved_quantity, 0)
      or balance.in_transit <> coalesce(row.in_transit_quantity, 0)
      or balance.damaged <> coalesce(row.damaged_quantity, 0)
      or balance.average_unit_cost is distinct from row.unit_cost
      or (row.quantity_on_hand > 0 and not exists (
        select 1 from app.inventory_movements movement
        where movement.tenant_id = row.tenant_id and movement.location_id = row.location_id
          and movement.variant_id = row.variant_id and movement.movement_type = 'OPENING_BALANCE'
          and movement.source_type = 'inventory_import_batch'
          and movement.source_reference = p_batch_id::text || ':' || row.row_number::text
          and movement.quantity = row.quantity_on_hand and movement.unit_cost is not distinct from row.unit_cost
      ))
    );

  select coalesce(sum(balance.on_hand), 0)::numeric(18,3),
    coalesce(sum(balance.on_hand * balance.average_unit_cost), 0)::numeric(18,2)
    into v_actual_quantity, v_actual_valuation
  from app.inventory_import_rows row
  join app.inventory_balances balance
    on balance.tenant_id = row.tenant_id and balance.location_id = row.location_id
   and balance.variant_id = row.variant_id
  where row.tenant_id = p_tenant_id and row.batch_id = p_batch_id and row.status = 'accepted';

  if v_mismatch_count > 0 or v_actual_quantity <> v_batch.total_quantity
    or v_actual_valuation <> v_batch.total_valuation then
    raise exception using errcode = 'HCS37', message = 'Posted inventory does not match the approved import totals';
  end if;

  update app.inventory_import_batches set
    status = 'reconciled', reconciled_at = now(), reconciled_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_batch_id
  returning * into v_batch;

  v_response := pg_catalog.jsonb_build_object(
    'batchId', v_batch.id, 'status', v_batch.status, 'reconciledAt', v_batch.reconciled_at,
    'matches', true, 'rowCount', v_batch.accepted_count,
    'expectedQuantityMilli', pg_catalog.round(v_batch.total_quantity * 1000)::bigint,
    'actualQuantityMilli', pg_catalog.round(v_actual_quantity * 1000)::bigint,
    'expectedValuationMinor', pg_catalog.round(v_batch.total_valuation * 100)::bigint,
    'actualValuationMinor', pg_catalog.round(v_actual_valuation * 100)::bigint
  );
  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'inventory.import.reconciled',
    'inventory_import_batch', p_batch_id, v_response
  );
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'inventory.import.reconciled', 'inventory_import_batch', p_batch_id, v_response);
  update app.idempotency_records set response_status = 200, response_body = v_response,
    completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'inventory.import.reconcile' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create function app.is_location_inventory_cutover_ready(p_tenant_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from app.tenant_entitlements entitlement
      join app.features feature on feature.code = entitlement.feature_code
      where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'inventory'
        and entitlement.entitled and entitlement.enabled and feature.platform_available
        and (entitlement.starts_at is null or entitlement.starts_at <= now())
        and (entitlement.ends_at is null or entitlement.ends_at > now())
    ) then true
    when not exists (
      select 1 from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where variant.tenant_id = p_tenant_id and variant.is_active and variant.track_inventory
        and product.status = 'active'
    ) then true
    when exists (
      select 1 from app.inventory_import_rows row
      join app.inventory_import_batches batch
        on batch.tenant_id = row.tenant_id and batch.id = row.batch_id
      where row.tenant_id = p_tenant_id and row.location_id = p_location_id
    ) then exists (
      select 1 from app.inventory_import_rows row
      join app.inventory_import_batches batch
        on batch.tenant_id = row.tenant_id and batch.id = row.batch_id
      where row.tenant_id = p_tenant_id and row.location_id = p_location_id
        and batch.status = 'reconciled'
    )
    else exists (
      select 1 from app.inventory_movements movement
      where movement.tenant_id = p_tenant_id and movement.location_id = p_location_id
    ) or exists (
      select 1 from app.inventory_balances balance
      where balance.tenant_id = p_tenant_id and balance.location_id = p_location_id
    )
  end;
$$;

create or replace function app.complete_pos_cash_sale_with_customer(
  p_session_token_hash text, p_lines jsonb, p_cash_received_centavos bigint, p_customer_id uuid,
  p_idempotency_key text, p_request_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pos app.pos_employee_sessions%rowtype; v_customer app.customers%rowtype; v_response jsonb; v_sale_id uuid;
  v_existing_customer_id uuid; v_policy app.loyalty_policies%rowtype; v_points bigint:=0; v_balance bigint;
  v_loyalty_transaction_id uuid;
begin
  select s.* into v_pos from app.pos_employee_sessions s join app.pos_devices d on d.tenant_id=s.tenant_id and d.id=s.device_id and d.status='active' where s.token_hash=p_session_token_hash and s.revoked_at is null and s.expires_at>now();
  if v_pos.id is null then raise exception using errcode='HCS90',message='POS session is invalid or expired'; end if;
  if not app.is_location_inventory_cutover_ready(v_pos.tenant_id, v_pos.location_id) then
    raise exception using errcode='HCSC0',message='Opening inventory must be posted and reconciled before sales can begin';
  end if;
  if p_customer_id is not null then
    select * into v_customer from app.customers where tenant_id=v_pos.tenant_id and id=p_customer_id and status='active';
    if not found then raise exception using errcode='HCSB1',message='Customer was not found'; end if;
  end if;
  v_response:=app.complete_pos_cash_sale(p_session_token_hash,p_lines,p_cash_received_centavos,p_idempotency_key,p_request_hash,p_request_id);
  v_sale_id:=(v_response->>'saleId')::uuid;
  if p_customer_id is not null then
    select customer_id into v_existing_customer_id from app.sales where tenant_id=v_pos.tenant_id and id=v_sale_id for update;
    if v_existing_customer_id is not null and v_existing_customer_id<>p_customer_id then raise exception using errcode='HCS08',message='Idempotency key conflict'; end if;
    if v_existing_customer_id is null then
      update app.sales set customer_id=p_customer_id where tenant_id=v_pos.tenant_id and id=v_sale_id;
      insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'sale.customer_linked','sale',v_sale_id,v_pos.location_id,jsonb_build_object('customerId',p_customer_id));
      insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'sale.customer_linked','sale',v_sale_id,jsonb_build_object('saleId',v_sale_id,'customerId',p_customer_id));
      select * into v_policy from app.loyalty_policies where tenant_id=v_pos.tenant_id;
      if v_policy.enabled then
        v_points:=floor((v_response->>'totalCentavos')::bigint / round(v_policy.spend_per_point*100)::bigint)::bigint;
        if v_points>0 then
          v_loyalty_transaction_id:=gen_random_uuid();
          insert into app.loyalty_transactions(id,tenant_id,customer_id,transaction_type,points_delta,balance_after_points,spend_per_point_centavos,sale_id,actor_employee_id,occurred_at)
          values(v_loyalty_transaction_id,v_pos.tenant_id,p_customer_id,'sale_earn',v_points,0,round(v_policy.spend_per_point*100)::bigint,v_sale_id,v_pos.employee_id,(v_response->>'completedAt')::timestamptz);
          insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,location_id,metadata) values(v_pos.tenant_id,p_request_id,'pos_employee',v_pos.employee_id,'loyalty.points_earned','loyalty_transaction',v_loyalty_transaction_id,v_pos.location_id,jsonb_build_object('saleId',v_sale_id,'customerId',p_customer_id,'points',v_points));
          insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload) values(v_pos.tenant_id,'loyalty.points_earned','customer',p_customer_id,jsonb_build_object('transactionId',v_loyalty_transaction_id,'saleId',v_sale_id,'customerId',p_customer_id,'points',v_points));
        end if;
      end if;
    end if;
    select coalesce(points_delta,0) into v_points from app.loyalty_transactions where tenant_id=v_pos.tenant_id and sale_id=v_sale_id and transaction_type='sale_earn';
    v_points:=coalesce(v_points,0);
    select coalesce(balance_points,0) into v_balance from app.loyalty_accounts where tenant_id=v_pos.tenant_id and customer_id=p_customer_id;
    v_balance:=coalesce(v_balance,0);
    v_response:=v_response||jsonb_build_object('customerId',p_customer_id,'customerName',v_customer.full_name,'loyaltyEarnedPoints',v_points,'loyaltyBalancePoints',v_balance);
  else
    v_response:=v_response||jsonb_build_object('customerId',null,'customerName',null,'loyaltyEarnedPoints',0,'loyaltyBalancePoints',null);
  end if;
  return v_response;
end;
$$;

revoke all on function app.reject_posted_inventory_import_row_mutation() from public, anon, authenticated, hcs_hyperdrive;
revoke all on function app.post_inventory_import(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function app.reconcile_inventory_import(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function app.is_location_inventory_cutover_ready(uuid,uuid) from public, anon, authenticated, hcs_hyperdrive;
revoke execute on function app.complete_pos_cash_sale(text,jsonb,bigint,text,text,text) from hcs_hyperdrive;
grant execute on function app.post_inventory_import(uuid,uuid,uuid,text,text,text) to hcs_hyperdrive;
grant execute on function app.reconcile_inventory_import(uuid,uuid,uuid,text,text,text) to hcs_hyperdrive;

commit;
