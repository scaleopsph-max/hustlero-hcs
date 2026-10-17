begin;

-- Customer identity and points balance remain shared; branch sale history does not.
create or replace function app.list_customers(p_actor_user_id uuid, p_tenant_id uuid, p_search text default '', p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_search text := lower(btrim(coalesce(p_search, ''))); v_can_manage boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.read'))) then
    raise exception using errcode='HCSB0',message='Customer access is not allowed';
  end if;
  select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.update'))) into v_can_manage;
  return jsonb_build_object(
    'canManage',v_can_manage,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'code',g.code::text,'name',g.name,'kind',g.kind,'isActive',g.is_active) order by g.is_system_default desc,g.name) from app.customer_groups g where g.tenant_id=p_tenant_id),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'customerNumber',c.customer_number::text,'fullName',c.full_name,'email',c.email::text,'phone',c.phone,
      'customerType',c.customer_type,'groupName',g.name,'status',c.status,'origin',c.origin,
      'totalSpendCentavos',round(coalesce(x.total_spend,0)*100)::bigint,'visitCount',coalesce(x.visit_count,0),
      'lastVisitAt',x.last_visit_at,'createdAt',c.created_at
    ) order by coalesce(x.last_visit_at,c.created_at) desc,c.id)
    from (select * from app.customers c0 where c0.tenant_id=p_tenant_id and (v_search='' or lower(c0.full_name) like '%'||v_search||'%' or lower(c0.customer_number::text) like '%'||v_search||'%' or lower(coalesce(c0.email::text,'')) like '%'||v_search||'%' or lower(coalesce(c0.phone,'')) like '%'||v_search||'%') order by created_at desc,id limit least(greatest(p_limit,1),200)) c
    left join app.customer_groups g on g.tenant_id=c.tenant_id and g.id=c.customer_group_id
    left join lateral (select sum(greatest(s.total-coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0),0)) total_spend,count(*)::integer visit_count,max(s.completed_at) last_visit_at from app.sales s where s.tenant_id=c.tenant_id and s.customer_id=c.id and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,s.location_id) and s.status<>'voided') x on true),'[]'::jsonb)
  );
end;
$$;

create or replace function app.load_customer(p_actor_user_id uuid,p_tenant_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_customer app.customers%rowtype; v_can_manage boolean;
begin
  if not exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.read'))) then raise exception using errcode='HCSB0',message='Customer access is not allowed'; end if;
  select * into v_customer from app.customers where tenant_id=p_tenant_id and id=p_customer_id;
  if not found then raise exception using errcode='HCSB1',message='Customer was not found'; end if;
  select exists(select 1 from app.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_actor_user_id and m.status='active' and (m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id where mr.tenant_id=m.tenant_id and mr.user_id=m.user_id and rp.permission_code='customers.update'))) into v_can_manage;
  return jsonb_build_object(
    'id',v_customer.id,'customerNumber',v_customer.customer_number::text,'fullName',v_customer.full_name,
    'email',v_customer.email::text,'phone',v_customer.phone,'customerGroupId',v_customer.customer_group_id,
    'customerType',v_customer.customer_type,'emailMarketingConsent',v_customer.email_marketing_consent,
    'smsMarketingConsent',v_customer.sms_marketing_consent,'consentUpdatedAt',v_customer.consent_updated_at,
    'status',v_customer.status,'origin',v_customer.origin,'createdAt',v_customer.created_at,'updatedAt',v_customer.updated_at,
    'canManage',v_can_manage,
    'totalSpendCentavos',round(coalesce((select sum(greatest(s.total-coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0),0)) from app.sales s where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,s.location_id) and s.status<>'voided'),0)*100)::bigint,
    'visitCount',(select count(*)::integer from app.sales s where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,s.location_id) and s.status<>'voided'),
    'loyalty',jsonb_build_object(
      'enabled',coalesce((select enabled from app.loyalty_policies where tenant_id=p_tenant_id),false),
      'balancePoints',coalesce((select balance_points from app.loyalty_accounts where tenant_id=p_tenant_id and customer_id=p_customer_id),0),
      'lifetimeEarnedPoints',coalesce((select lifetime_earned_points from app.loyalty_accounts where tenant_id=p_tenant_id and customer_id=p_customer_id),0),
      'lifetimeReversedPoints',coalesce((select lifetime_reversed_points from app.loyalty_accounts where tenant_id=p_tenant_id and customer_id=p_customer_id),0),
      'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.transaction_type,'pointsDelta',t.points_delta,'balanceAfterPoints',t.balance_after_points,'receiptNumber',s.receipt_number,'occurredAt',t.occurred_at) order by t.occurred_at desc,t.id) from app.loyalty_transactions t join app.sales s on s.tenant_id=t.tenant_id and s.id=t.sale_id where t.tenant_id=p_tenant_id and t.customer_id=p_customer_id and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,s.location_id)),'[]'::jsonb)
    ),
    'purchases',coalesce((select jsonb_agg(jsonb_build_object('saleId',s.id,'receiptNumber',s.receipt_number,'status',s.status,'locationName',l.name,'totalCentavos',round(s.total*100)::bigint,'refundedCentavos',round(coalesce((select sum(r.amount) from app.refunds r where r.tenant_id=s.tenant_id and r.sale_id=s.id and r.status='completed'),0)*100)::bigint,'completedAt',s.completed_at) order by s.completed_at desc,s.id) from app.sales s join app.locations l on l.tenant_id=s.tenant_id and l.id=s.location_id where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id and app.can_read_wholesale_location(p_actor_user_id,p_tenant_id,s.location_id)),'[]'::jsonb),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'actorName',coalesce(e.display_name,m_user.email::text,'Business user'),'createdAt',n.created_at) order by n.created_at desc,n.id) from app.customer_notes n left join app.employees e on e.tenant_id=n.tenant_id and e.id=n.created_by_employee_id left join auth.users m_user on m_user.id=n.created_by_user_id where n.tenant_id=p_tenant_id and n.customer_id=p_customer_id),'[]'::jsonb)
  );
end;
$$;

commit;
