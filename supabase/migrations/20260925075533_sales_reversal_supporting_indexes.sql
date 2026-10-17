begin;

create index refunds_completed_by_idx on app.refunds (tenant_id, completed_by);
create index payment_reversals_refund_idx on app.payment_reversals (tenant_id, refund_id);

commit;
