begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(not has_function_privilege(
  'anon', 'app.update_catalog_product(uuid,uuid,uuid,text,text,text,text,text,text)', 'EXECUTE'
), 'anon cannot update products directly');
select ok(has_function_privilege(
  'hcs_hyperdrive', 'app.update_catalog_product(uuid,uuid,uuid,text,text,text,text,text,text)', 'EXECUTE'
), 'API login can call product update');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('15000000-0000-4000-8000-000000000001', 'product-edit-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('25000000-0000-4000-8000-000000000001', 'product-edit', 'Product Edit');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('25000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'active', true, now());

select lives_ok(
  $$select app.create_catalog_product(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    'Basic Tee', null, 'Shirts', 'Black / Small', 'EDIT-TEE-S', 999, 600, true,
    array['480000000201'], 'product-edit-base', 'product-edit-base-hash', 'product-edit-base-request'
  )$$,
  'owner can create the product to edit'
);
select lives_ok(
  $$select app.update_catalog_product(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    'Premium Tee', 'Updated description', 'Premium Shirts',
    'product-edit-update', 'product-edit-update-hash', 'product-edit-update-request'
  )$$,
  'owner can update the product master'
);
select is((select name from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'), 'Premium Tee', 'product name is updated');
select is((select description from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'), 'Updated description', 'description is updated');
select is((select category.name from app.products product join app.product_categories category on category.id = product.category_id where product.tenant_id = '25000000-0000-4000-8000-000000000001'), 'Premium Shirts', 'category is updated');
select is((select count(*)::integer from audit.audit_events where tenant_id = '25000000-0000-4000-8000-000000000001' and action = 'catalog.product.updated'), 1, 'product update is audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '25000000-0000-4000-8000-000000000001' and topic = 'catalog.product.updated'), 1, 'product update emits an outbox event');

select * from finish();
rollback;
