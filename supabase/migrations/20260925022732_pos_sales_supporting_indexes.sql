begin;

create index sales_register_idx on app.sales (tenant_id, register_id, completed_at desc);
create index sales_employee_idx on app.sales (tenant_id, employee_id, completed_at desc);

commit;
