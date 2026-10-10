import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'

// Fixed loopback-only disposable Supabase target; never accept a remote connection string.
if (process.env.CI !== 'true') throw new Error('Run this check only in disposable database CI.')
const config = {
  host: '127.0.0.1',
  port: 54322,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
  statement_timeout: 15000,
}
const clients = [new pg.Client(config), new pg.Client(config), new pg.Client(config)]
const [first, second, observer] = clients
const [actor, tenant, customer, location, product, variant, price, group] = Array.from({ length: 8 }, () =>
  randomUUID(),
)
await Promise.all(clients.map((client) => client.connect()))
try {
  await first.query('begin')
  await first.query(
    "insert into auth.users(id,email,aud,role,email_confirmed_at) values($1,$2,'authenticated','authenticated',now())",
    [actor, `${actor}@example.invalid`],
  )
  await first.query('insert into app.tenants(id,slug,name) values($1,$2,$3)', [
    tenant,
    `credit-race-${tenant}`,
    'Disposable credit race',
  ])
  await first.query(
    "insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values($1,$2,'active',true)",
    [tenant, actor],
  )
  await first.query(
    "update app.tenant_entitlements set entitled=true,enabled=true where tenant_id=$1 and feature_code='advanced_wholesale'",
    [tenant],
  )
  await first.query(
    "insert into app.customers(id,tenant_id,customer_number,full_name,customer_type,origin,created_by_user_id) values($1,$2,'RACE-001','Race reseller','reseller','backoffice',$3)",
    [customer, tenant, actor],
  )
  await first.query("insert into app.locations(id,tenant_id,code,name) values($1,$2,'MAIN','Main')", [location, tenant])
  await first.query("insert into app.products(id,tenant_id,name,created_by) values($1,$2,'Race shirt',$3)", [
    product,
    tenant,
    actor,
  ])
  await first.query(
    "insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values($1,$2,$3,'Medium','RACE-SKU',499,100,$4)",
    [variant, tenant, product, actor],
  )
  await first.query(
    'insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,reserved,average_unit_cost) values($1,$2,$3,100,0,100)',
    [tenant, location, variant],
  )
  await first.query(
    "insert into app.pricing_groups(id,tenant_id,code,name,threshold_quantity) values($1,$2,'RACE','Race',10)",
    [group, tenant],
  )
  await first.query(
    "insert into app.price_lists(id,tenant_id,code,name,pricing_type,is_default,created_by) values($1,$2,'RACE','Race','wholesale',true,$3)",
    [price, tenant, actor],
  )
  await first.query(
    'insert into app.price_list_entries(tenant_id,price_list_id,pricing_group_id,variant_id,unit_price) values($1,$2,$3,$4,450)',
    [tenant, price, group, variant],
  )
  await first.query('select app.save_wholesale_customer_credit_settings($1,$2,$3::jsonb,$4,$4,$4)', [
    actor,
    tenant,
    JSON.stringify({
      customerId: customer,
      paymentTerm: 'net_7',
      creditLimitMinor: 450000,
      reason: 'Disposable race agreement',
    }),
    'race-credit-settings-001',
  ])
  const orders = []
  for (const number of [1, 2]) {
    const draft = {
      orderNumber: `RACE-${number}`,
      customerId: customer,
      locationId: location,
      priceListId: price,
      pricingType: 'wholesale',
      notes: null,
      lines: [{ variantId: variant, quantityMilli: 10000 }],
    }
    const result = await first.query('select app.save_wholesale_order_draft($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify(draft),
      `race-draft-command-${number}`,
    ])
    orders.push(result.rows[0].response.salesOrderId)
  }
  await first.query('commit')
  const pid = (await second.query('select pg_backend_pid() pid')).rows[0].pid
  async function waitForLock() {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const result = await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])
      if (result.rows[0]?.wait_event_type === 'Lock') return
      await delay(25)
    }
    throw new Error('Concurrent command did not block on the transaction lock.')
  }
  const confirm = (client, order, key) =>
    client.query('select app.confirm_wholesale_order($1,$2,$3,$4,$4,$4)', [actor, tenant, order, key])
  await first.query('begin')
  await confirm(first, orders[0], 'race-confirm-first-001')
  const competing = confirm(second, orders[1], 'race-confirm-second-001').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await competing, 'HCCR1')
  assert.equal(
    (await observer.query('select reserved::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .reserved,
    '10.000',
  )
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from app.sales_orders where tenant_id=$1 and status='confirmed'",
        [tenant],
      )
    ).rows[0].count,
    1,
  )
  const line = (
    await observer.query('select id from app.sales_order_lines where tenant_id=$1 and sales_order_id=$2', [
      tenant,
      orders[0],
    ])
  ).rows[0].id
  const lines = JSON.stringify([{ salesOrderLineId: line, quantityMilli: 10000 }])
  const fulfill = (client) =>
    client.query('select app.fulfill_wholesale_order($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      orders[0],
      lines,
      'race-fulfill-replay-001',
    ])
  await first.query('begin')
  await first.query('select app.save_wholesale_customer_credit_settings($1,$2,$3::jsonb,$4,$4,$4)', [
    actor,
    tenant,
    JSON.stringify({
      customerId: customer,
      paymentTerm: 'net_30',
      creditLimitMinor: 449999,
      reason: 'Disposable lower-limit race',
    }),
    'race-lower-settings-001',
  ])
  const lowered = fulfill(second).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await lowered, 'HCCR1')
  assert.equal(
    (await observer.query('select count(*)::int count from app.invoices where tenant_id=$1', [tenant])).rows[0].count,
    0,
  )
  await first.query('select app.save_wholesale_customer_credit_settings($1,$2,$3::jsonb,$4,$4,$4)', [
    actor,
    tenant,
    JSON.stringify({
      customerId: customer,
      paymentTerm: 'net_30',
      creditLimitMinor: 450000,
      reason: 'Disposable restored limit',
    }),
    'race-restore-settings-001',
  ])
  await first.query('begin')
  const original = await fulfill(first)
  const replay = fulfill(second)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await replay).rows[0].response, original.rows[0].response)
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_invoice_charges where tenant_id=$1', [tenant]))
      .rows[0].count,
    1,
  )
  assert.equal(
    (
      await observer.query('select on_hand::text,reserved::text from app.inventory_balances where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].on_hand,
    '90.000',
  )
  assert.equal(
    (await observer.query('select reserved::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .reserved,
    '0.000',
  )
  console.log(
    'AW3 concurrency passed: competing confirmations cannot oversubscribe credit; fulfillment sees committed lower limits; simultaneous fulfillment retry produces one invoice charge and one stock deduction.',
  )
} finally {
  await Promise.all(clients.map((client) => client.end()))
}
