begin;

create index register_sessions_location_idx on app.register_sessions (tenant_id, location_id, opened_at desc);
create index register_sessions_employee_idx on app.register_sessions (tenant_id, employee_id, opened_at desc);
create index register_sessions_opened_by_idx on app.register_sessions (tenant_id, opened_by_user_id) where opened_by_user_id is not null;
create index register_sessions_closed_by_idx on app.register_sessions (tenant_id, closed_by_user_id) where closed_by_user_id is not null;
create index cash_movements_location_idx on app.cash_movements (tenant_id, location_id, occurred_at desc);
create index cash_movements_actor_user_idx on app.cash_movements (tenant_id, actor_user_id) where actor_user_id is not null;
create index cash_movements_actor_employee_idx on app.cash_movements (tenant_id, actor_employee_id) where actor_employee_id is not null;

commit;
