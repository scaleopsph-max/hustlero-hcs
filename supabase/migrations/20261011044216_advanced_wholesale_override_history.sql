begin;
create or replace function app.load_wholesale_credit_overrides(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_response jsonb; v_as_of timestamptz:=clock_timestamp();
begin
 perform app.assert_wholesale_receivable_access(p_actor,p_tenant,false);
 select jsonb_build_object('asOf',v_as_of,'canApprove',app.can_approve_wholesale_credit(p_actor,p_tenant) and app.can_manage_wholesale_credit_settings(p_actor,p_tenant),
 'overrides',coalesce(jsonb_agg(jsonb_build_object(
 'overrideId',approval.id,'salesOrderId',approval.sales_order_id,'orderNumber',orders.order_number,'customerId',approval.customer_id,
 'action',approval.action,'approvedExcessMinor',(approval.approved_excess*100)::bigint,'expiresAt',approval.expires_at,'reason',approval.reason,
 'approvedBy',approval.approved_by,'approvedAt',approval.approved_at,'revokedBy',revocation.revoked_by,'revokedAt',revocation.revoked_at,'revokeReason',revocation.reason,
 'status',case when consumption.override_id is not null then 'consumed' when revocation.override_id is not null then 'revoked' when approval.expires_at<=v_as_of then 'expired' else 'approved' end,
 'consumption',case when consumption.override_id is null then null else jsonb_build_object('consumedBy',consumption.consumed_by,'consumedAt',consumption.consumed_at,
 'excessMinor',(consumption.excess*100)::bigint,'exposureMinor',(consumption.exposure*100)::bigint,'creditLimitMinor',(consumption.credit_limit*100)::bigint) end)
 order by approval.approved_at desc,approval.id),'[]'::jsonb)) into v_response
 from app.wholesale_credit_overrides approval
 join app.sales_orders orders on orders.tenant_id=approval.tenant_id and orders.id=approval.sales_order_id
 left join app.wholesale_credit_override_revocations revocation on revocation.tenant_id=approval.tenant_id and revocation.override_id=approval.id
 left join app.wholesale_credit_override_consumptions consumption on consumption.tenant_id=approval.tenant_id and consumption.override_id=approval.id
 where approval.tenant_id=p_tenant;
 return v_response;
end;
$$;
revoke all on function app.load_wholesale_credit_overrides(uuid,uuid) from public,anon,authenticated;
grant execute on function app.load_wholesale_credit_overrides(uuid,uuid) to hcs_hyperdrive;
commit;
