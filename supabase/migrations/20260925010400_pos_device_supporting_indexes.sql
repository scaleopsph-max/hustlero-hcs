begin;

create index pos_devices_tenant_location_idx
  on app.pos_devices (tenant_id, location_id);

create index pos_employee_sessions_location_idx
  on app.pos_employee_sessions (tenant_id, location_id);

create index pos_employee_sessions_register_idx
  on app.pos_employee_sessions (tenant_id, register_id);

commit;
