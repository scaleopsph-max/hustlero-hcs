begin;

create index subscription_plans_created_by_idx
  on platform.subscription_plans(created_by, created_at desc, id);

create index fund_accounts_created_by_idx
  on app.fund_accounts(tenant_id, created_by, created_at desc, id);

commit;
