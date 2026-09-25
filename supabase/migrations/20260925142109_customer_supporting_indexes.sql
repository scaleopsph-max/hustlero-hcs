begin;

create index customer_notes_created_by_user_idx
  on app.customer_notes (tenant_id, created_by_user_id)
  where created_by_user_id is not null;
create index customer_notes_created_by_employee_idx
  on app.customer_notes (tenant_id, created_by_employee_id)
  where created_by_employee_id is not null;
create index customers_created_by_user_idx
  on app.customers (tenant_id, created_by_user_id)
  where created_by_user_id is not null;
create index customers_created_by_employee_idx
  on app.customers (tenant_id, created_by_employee_id)
  where created_by_employee_id is not null;
create index customers_origin_location_idx
  on app.customers (tenant_id, origin_location_id)
  where origin_location_id is not null;

commit;
