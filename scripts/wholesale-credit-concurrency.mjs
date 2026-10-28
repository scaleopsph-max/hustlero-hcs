import assert from 'node:assert/strict'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
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
    "insert into app.customers(id,tenant_id,customer_number,full_name,email,customer_type,origin,created_by_user_id) values($1,$2,'RACE-001','Race reseller','race@example.invalid','reseller','backoffice',$3)",
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
  const approve = async (action, key, expiry = new Date(Date.now() + 3600000).toISOString()) => {
    const result = await first.query(
      'select app.command_wholesale_credit_override($1,$2,$3,$4::jsonb,$5,$5,$5) response',
      [
        actor,
        tenant,
        'approve',
        JSON.stringify({
          salesOrderId: orders[1],
          action,
          approvedExcessMinor: 450000,
          expiresAt: expiry,
          reason: 'Disposable scoped race approval',
        }),
        key,
      ],
    )
    return result.rows[0].response.overrideId
  }
  const revoke = (client, overrideId, key) =>
    client.query('select app.command_wholesale_credit_override($1,$2,$3,$4::jsonb,$5,$5,$5)', [
      actor,
      tenant,
      'revoke',
      JSON.stringify({ overrideId, reason: 'Disposable race revocation' }),
      key,
    ])
  const confirmOverride = (client, overrideId, key) =>
    client.query('select app.confirm_wholesale_order_with_credit_override($1,$2,$3,$4,$4,$4,$5) response', [
      actor,
      tenant,
      orders[1],
      key,
      overrideId,
    ])
  const revokedApproval = await approve('confirm', 'race-revoke-approval-001')
  await first.query('begin')
  await revoke(first, revokedApproval, 'race-revoke-first-001')
  const deniedConfirm = confirmOverride(second, revokedApproval, 'race-revoked-confirm-001').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await deniedConfirm, 'HCCO6')
  assert.equal(
    (
      await observer.query(
        'select count(*)::int count from app.wholesale_credit_override_consumptions where tenant_id=$1',
        [tenant],
      )
    ).rows[0].count,
    0,
  )
  assert.equal(
    (await observer.query('select reserved::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .reserved,
    '0.000',
  )

  const confirmationApproval = await approve('confirm', 'race-confirm-approval-001')
  await first.query('begin')
  const approvedConfirm = await confirmOverride(first, confirmationApproval, 'race-approved-confirm-001')
  const confirmRetry = confirmOverride(second, confirmationApproval, 'race-approved-confirm-001')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await confirmRetry).rows[0].response, approvedConfirm.rows[0].response)
  assert.equal(
    (
      await observer.query(
        'select count(*)::int count from app.wholesale_credit_override_consumptions where tenant_id=$1',
        [tenant],
      )
    ).rows[0].count,
    1,
  )
  assert.equal(
    (await observer.query('select reserved::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .reserved,
    '10.000',
  )

  const secondLine = (
    await observer.query('select id from app.sales_order_lines where tenant_id=$1 and sales_order_id=$2', [
      tenant,
      orders[1],
    ])
  ).rows[0].id
  const fulfillOverride = (client, overrideId, key) =>
    client.query('select app.fulfill_wholesale_order_with_credit_override($1,$2,$3,$4::jsonb,$5,$5,$5,$6) response', [
      actor,
      tenant,
      orders[1],
      JSON.stringify([{ salesOrderLineId: secondLine, quantityMilli: 10000 }]),
      key,
      overrideId,
    ])
  const expiring = await approve('fulfill', 'race-expiring-approval-001', new Date(Date.now() + 2000).toISOString())
  await first.query('begin')
  await first.query('select id from app.sales_orders where tenant_id=$1 and id=$2 for update', [tenant, orders[1]])
  const expiredFulfill = fulfillOverride(second, expiring, 'race-expired-fulfill-001').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await delay(2300)
  await first.query('commit')
  assert.equal(await expiredFulfill, 'HCCO6')
  assert.equal(
    (await observer.query('select count(*)::int count from app.invoices where tenant_id=$1', [tenant])).rows[0].count,
    1,
  )
  assert.equal(
    (await observer.query('select on_hand::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .on_hand,
    '90.000',
  )

  const fulfillmentApproval = await approve('fulfill', 'race-fulfill-approval-001')
  await first.query('begin')
  const approvedFulfill = await fulfillOverride(first, fulfillmentApproval, 'race-approved-fulfill-001')
  const revocationAfterUse = revoke(second, fulfillmentApproval, 'race-revoke-after-use-001')
  await waitForLock()
  await first.query('commit')
  await revocationAfterUse
  assert.deepEqual(
    (await fulfillOverride(first, fulfillmentApproval, 'race-approved-fulfill-001')).rows[0].response,
    approvedFulfill.rows[0].response,
  )
  assert.equal(
    (
      await observer.query(
        'select count(*)::int count from app.wholesale_credit_override_consumptions where tenant_id=$1',
        [tenant],
      )
    ).rows[0].count,
    2,
  )
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_invoice_charges where tenant_id=$1', [tenant]))
      .rows[0].count,
    2,
  )
  assert.equal(
    (
      await observer.query('select on_hand::text,reserved::text from app.inventory_balances where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].on_hand,
    '80.000',
  )
  assert.equal(
    (await observer.query('select reserved::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .reserved,
    '0.000',
  )
  console.log(
    'AW3 override concurrency passed: revocation-first denies confirmation; simultaneous confirmation retry consumes once; expiry after lock wait rolls back fulfillment; consumption-first preserves history and replay after revocation.',
  )
  console.log(
    'AW3 concurrency passed: competing confirmations cannot oversubscribe credit; fulfillment sees committed lower limits; simultaneous fulfillment retry produces one invoice charge and one stock deduction.',
  )
  const invoiceIds = []
  for (const order of orders)
    invoiceIds.push(
      (await observer.query('select id from app.invoices where tenant_id=$1 and sales_order_id=$2', [tenant, order]))
        .rows[0].id,
    )
  const method = (
    await observer.query("select id from app.payment_methods where tenant_id=$1 and method_type='cash'", [tenant])
  ).rows[0].id
  const payment = (client, key, amountMinor, allocations) =>
    client.query('select app.record_wholesale_payment($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        customerId: customer,
        paymentMethodId: method,
        amountMinor,
        reference: 'Synthetic race received cash',
        allocations,
      }),
      key,
    ])
  const allocations = [
    { invoiceId: invoiceIds[1], amountMinor: 150000 },
    { invoiceId: invoiceIds[0], amountMinor: 450000 },
  ]
  await first.query('begin')
  const receipt = await payment(first, 'race-payment-replay-001', 600000, allocations)
  const receiptRetry = payment(second, 'race-payment-replay-001', 600000, allocations)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await receiptRetry).rows[0].response, receipt.rows[0].response)
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_payments where tenant_id=$1', [tenant]))
      .rows[0].count,
    1,
  )
  assert.equal(
    (
      await observer.query('select count(*)::int count from app.wholesale_payment_allocations where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].count,
    2,
  )
  assert.equal(
    (await observer.query('select app.wholesale_credit_exposure($1,$2)::text exposure', [tenant, customer])).rows[0]
      .exposure,
    '3000.00',
  )
  const remainingAllocation = [{ invoiceId: invoiceIds[1], amountMinor: 300000 }]
  await first.query('begin')
  await payment(first, 'race-payment-winner-001', 300000, remainingAllocation)
  const competingPayment = payment(second, 'race-payment-loser-001', 300000, remainingAllocation).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await competingPayment, 'HCAP5')
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_payments where tenant_id=$1', [tenant]))
      .rows[0].count,
    2,
  )
  assert.equal(
    (await observer.query('select sum(amount)::text total from app.wholesale_payments where tenant_id=$1', [tenant]))
      .rows[0].total,
    '9000.00',
  )
  assert.equal(
    (await observer.query('select app.wholesale_credit_exposure($1,$2)::text exposure', [tenant, customer])).rows[0]
      .exposure,
    '0.00',
  )
  assert.equal(
    (await observer.query('select on_hand::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .on_hand,
    '80.000',
  )
  console.log(
    'AW3 payment concurrency passed: identical multi-invoice receipt retry posts once; competing payments cannot over-allocate the remaining balance; paid debt releases credit without changing inventory.',
  )
  await observer.query('select app.create_basic_fund_setup($1,$2,$3,$3,$3)', [actor, tenant, 'race-fund-setup-001'])
  const fund = (client, receiptId, fundKey) =>
    client.query('select app.allocate_wholesale_payment_funds($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        paymentId: receiptId,
        capitalMinor: 400000,
        operatingMinor: 200000,
        settledConfirmed: true,
        settlementReference: 'Physically settled test cash',
        reason: 'Synthetic fund race allocation',
      }),
      fundKey,
    ])
  const paymentId = receipt.rows[0].response.paymentId
  await first.query('begin')
  const fundResult = await fund(first, paymentId, 'race-fund-replay-001')
  const fundReplay = fund(second, paymentId, 'race-fund-replay-001')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await fundReplay).rows[0].response, fundResult.rows[0].response)
  assert.equal(
    (
      await observer.query('select count(*)::int count from app.wholesale_fund_allocations where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].count,
    1,
  )
  assert.equal(
    (await observer.query('select sum(amount)::text total from app.fund_ledger_entries where tenant_id=$1', [tenant]))
      .rows[0].total,
    '6000.00',
  )
  const secondReceipt = (
    await observer.query('select id from app.wholesale_payments where tenant_id=$1 and amount=3000', [tenant])
  ).rows[0].id
  const allocateSecond = (client, fundKey) =>
    client.query('select app.allocate_wholesale_payment_funds($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        paymentId: secondReceipt,
        capitalMinor: 300000,
        operatingMinor: 0,
        settledConfirmed: true,
        settlementReference: 'Physically settled test cash',
        reason: 'Synthetic competing fund allocation',
      }),
      fundKey,
    ])
  await first.query('begin')
  await allocateSecond(first, 'race-fund-winner-001')
  const duplicateFund = allocateSecond(second, 'race-fund-loser-001').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await duplicateFund, 'HCFD4')
  assert.equal(
    (await observer.query('select sum(amount)::text total from app.fund_ledger_entries where tenant_id=$1', [tenant]))
      .rows[0].total,
    '9000.00',
  )
  console.log(
    'AW3 fund concurrency passed: identical allocation retry posts once; competing receipt allocations cannot double-post funds.',
  )
  await observer.query('select app.save_wholesale_customer_credit_settings($1,$2,$3::jsonb,$4,$4,$4)', [
    actor,
    tenant,
    JSON.stringify({
      customerId: customer,
      paymentTerm: 'prepaid',
      creditLimitMinor: 900000,
      reason: 'Disposable prepaid agreement',
    }),
    'race-paid-settings-001',
  ])
  async function paidOrder(number) {
    const draft = await observer.query('select app.save_wholesale_order_draft($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        orderNumber: `PAID-${number}`,
        customerId: customer,
        locationId: location,
        priceListId: price,
        pricingType: 'wholesale',
        notes: null,
        lines: [{ variantId: variant, quantityMilli: 10000 }],
      }),
      `race-paid-draft-${number}`,
    ])
    const orderId = draft.rows[0].response.salesOrderId
    await confirm(observer, orderId, `race-paid-confirm-${number}`)
    const lineId = (
      await observer.query('select id from app.sales_order_lines where tenant_id=$1 and sales_order_id=$2', [
        tenant,
        orderId,
      ])
    ).rows[0].id
    return { orderId, lineId }
  }
  const paid = (client, order, key) =>
    client.query('select app.fulfill_wholesale_order_paid($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      order.orderId,
      JSON.stringify({
        lines: [{ salesOrderLineId: order.lineId, quantityMilli: 10000 }],
        payment: { paymentMethodId: method, amountMinor: 450000, reference: 'Synthetic prepaid receipt' },
      }),
      key,
    ])
  const prepaid = await paidOrder(1)
  await first.query('begin')
  const paidResult = await paid(first, prepaid, 'race-paid-replay-001')
  const paidReplay = paid(second, prepaid, 'race-paid-replay-001')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await paidReplay).rows[0].response, paidResult.rows[0].response)
  const competingOrder = await paidOrder(2)
  await first.query('begin')
  await paid(first, competingOrder, 'race-paid-winner-001')
  const paidLoser = paid(second, competingOrder, 'race-paid-loser-001').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await paidLoser, 'HCSQ6')
  assert.equal(
    (
      await observer.query('select count(*)::int count from app.wholesale_paid_fulfillments where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].count,
    2,
  )
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_payments where tenant_id=$1', [tenant]))
      .rows[0].count,
    4,
  )
  assert.equal(
    (
      await observer.query('select on_hand::text,reserved::text from app.inventory_balances where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].on_hand,
    '60.000',
  )
  assert.equal(
    (await observer.query('select app.wholesale_credit_exposure($1,$2)::text exposure', [tenant, customer])).rows[0]
      .exposure,
    '0.00',
  )
  console.log(
    'AW3 paid fulfillment concurrency passed: prepaid retry posts one invoice/receipt; competing deliveries cannot double deduct stock or create unpaid debt.',
  )

  // Separate customers isolate each ordering while using the same shared-stock variant.
  async function crossFixture(name, limit = 450000, legacy = false, quantityMilli = 10000) {
    const customerId = randomUUID()
    await observer.query(
      "insert into app.customers(id,tenant_id,customer_number,full_name,email,customer_type,origin,created_by_user_id) values($1,$2,$3,$5,$6,'reseller','backoffice',$4)",
      [customerId, tenant, name, actor, name, `${customerId}@example.invalid`],
    )
    await observer.query('select app.save_wholesale_customer_credit_settings($1,$2,$3::jsonb,$4,$4,$4)', [
      actor,
      tenant,
      JSON.stringify({
        customerId,
        paymentTerm: 'net_7',
        creditLimitMinor: limit,
        reason: 'Synthetic cross-command agreement',
      }),
      `cross-settings-${name}`,
    ])
    const create = async (suffix) => {
      const draft = await observer.query('select app.save_wholesale_order_draft($1,$2,$3::jsonb,$4,$4,$4) response', [
        actor,
        tenant,
        JSON.stringify({
          orderNumber: `${name}-${suffix}`,
          customerId,
          locationId: location,
          priceListId: price,
          pricingType: 'wholesale',
          notes: null,
          lines: [{ variantId: variant, quantityMilli: 10000 }],
        }),
        `cross-draft-${name}-${suffix}`,
      ])
      return draft.rows[0].response.salesOrderId
    }
    const orderId = await create('issued')
    await confirm(observer, orderId, `cross-confirm-${name}`)
    const lineId = (
      await observer.query('select id from app.sales_order_lines where tenant_id=$1 and sales_order_id=$2', [
        tenant,
        orderId,
      ])
    ).rows[0].id
    const result = await observer.query(
      `select app.${legacy ? 'fulfill_wholesale_order_inventory_core' : 'fulfill_wholesale_order'}($1,$2,$3,$4::jsonb,$5,$5,$5) response`,
      [actor, tenant, orderId, JSON.stringify([{ salesOrderLineId: lineId, quantityMilli }]), `cross-issue-${name}`],
    )
    const invoiceId = result.rows[0].response.invoiceId
    if (legacy)
      await observer.query('insert into app.wholesale_legacy_invoices(tenant_id,invoice_id) values($1,$2)', [
        tenant,
        invoiceId,
      ])
    const record = (client, commandKey = `cross-payment-${name}`) =>
      client.query('select app.record_wholesale_payment($1,$2,$3::jsonb,$4,$4,$4) response', [
        actor,
        tenant,
        JSON.stringify({
          customerId,
          paymentMethodId: method,
          amountMinor: quantityMilli * 45,
          reference: 'Synthetic cross-command received cash',
          allocations: [{ invoiceId, amountMinor: quantityMilli * 45 }],
        }),
        commandKey,
      ])
    const open = (client) =>
      client.query('select app.record_wholesale_opening_receivable($1,$2,$3::jsonb,$4,$4,$4) response', [
        actor,
        tenant,
        JSON.stringify({ invoiceId, dueDate: '2026-10-11', reason: 'Synthetic verified unpaid legacy invoice' }),
        `cross-opening-${name}`,
      ])
    const cancel = (client, target = orderId) =>
      client.query('select app.cancel_wholesale_order_remaining($1,$2,$3,$4,$5,$5,$5) response', [
        actor,
        tenant,
        target,
        'Synthetic cancellation of remaining reservation',
        `cross-cancel-${name}-${target}`,
      ])
    return { customerId, orderId, invoiceId, create, record, open, cancel }
  }
  async function crossState(fixture, expectedExposure, expectedReserved = '0.000', expectedBalance = '0.00') {
    const state = (
      await observer.query(
        `select app.wholesale_credit_exposure($1,$2)::text exposure,
      app.wholesale_invoice_open_balance($1,$3)::text balance,
      (select reserved::text from app.inventory_balances where tenant_id=$1 and location_id=$4 and variant_id=$5) reserved,
      (select count(*)::int from app.wholesale_payments where tenant_id=$1 and customer_id=$2) payments,
      (select count(*)::int from app.wholesale_payment_allocations where tenant_id=$1 and invoice_id=$3) allocations`,
        [tenant, fixture.customerId, fixture.invoiceId, location, variant],
      )
    ).rows[0]
    assert.deepEqual(state, {
      exposure: expectedExposure,
      balance: expectedBalance,
      reserved: expectedReserved,
      payments: 1,
      allocations: 1,
    })
    assert.equal(
      (
        await observer.query(
          "select count(*)::int count from audit.audit_events where tenant_id=$1 and action='wholesale_payment.recorded' and entity_id in (select id from app.wholesale_payments where tenant_id=$1 and customer_id=$2)",
          [tenant, fixture.customerId],
        )
      ).rows[0].count,
      1,
    )
    assert.equal(
      (
        await observer.query(
          "select count(*)::int count from integration.event_outbox where tenant_id=$1 and topic='wholesale_payment.recorded' and aggregate_id in (select id from app.wholesale_payments where tenant_id=$1 and customer_id=$2)",
          [tenant, fixture.customerId],
        )
      ).rows[0].count,
      1,
    )
  }

  const paymentFirst = await crossFixture('payment-first')
  const afterPaymentOrder = await paymentFirst.create('next')
  await first.query('begin')
  await paymentFirst.record(first)
  const confirmationAfterPayment = confirm(second, afterPaymentOrder, 'cross-confirm-after-payment')
  await waitForLock()
  await first.query('commit')
  await confirmationAfterPayment
  await crossState(paymentFirst, '4500.00', '10.000')
  await paymentFirst.cancel(observer, afterPaymentOrder)
  await crossState(paymentFirst, '0.00')

  const confirmationFirst = await crossFixture('confirmation-first', 900000)
  const beforePaymentOrder = await confirmationFirst.create('next')
  await first.query('begin')
  await confirm(first, beforePaymentOrder, 'cross-confirm-before-payment')
  const paymentAfterConfirmation = confirmationFirst.record(second)
  await waitForLock()
  await first.query('commit')
  await paymentAfterConfirmation
  await crossState(confirmationFirst, '4500.00', '10.000')
  await confirmationFirst.cancel(observer, beforePaymentOrder)
  await crossState(confirmationFirst, '0.00')

  const openingFirst = await crossFixture('opening-first', 450000, true)
  await first.query('begin')
  const openingResult = await openingFirst.open(first)
  const paymentAfterOpening = openingFirst.record(second)
  await waitForLock()
  await first.query('commit')
  await paymentAfterOpening
  assert.deepEqual((await openingFirst.open(observer)).rows[0].response, openingResult.rows[0].response)
  await crossState(openingFirst, '0.00')

  const unclassifiedFirst = await crossFixture('unclassified-first', 450000, true)
  await first.query('begin')
  // Keep an outer customer lock after the expected failed payment's savepoint rollback,
  // so the opening command is demonstrably overlapping on another database session.
  await first.query('select id from app.customers where tenant_id=$1 and id=$2 for update', [
    tenant,
    unclassifiedFirst.customerId,
  ])
  await first.query('savepoint unclassified_payment')
  assert.equal(
    await unclassifiedFirst.record(first).then(
      () => 'unexpected-success',
      (error) => error.code,
    ),
    'HCAP4',
  )
  await first.query('rollback to savepoint unclassified_payment')
  const openingAfterDeniedPayment = unclassifiedFirst.open(second)
  await waitForLock()
  assert.equal(
    (
      await observer.query(
        'select count(*)::int count from app.wholesale_payments where tenant_id=$1 and customer_id=$2',
        [tenant, unclassifiedFirst.customerId],
      )
    ).rows[0].count,
    0,
  )
  await first.query('commit')
  await openingAfterDeniedPayment
  await unclassifiedFirst.record(observer)
  await crossState(unclassifiedFirst, '0.00')
  for (const fixture of [openingFirst, unclassifiedFirst]) {
    assert.equal(
      (
        await observer.query(
          'select count(*)::int count from app.wholesale_receivable_charges where tenant_id=$1 and invoice_id=$2',
          [tenant, fixture.invoiceId],
        )
      ).rows[0].count,
      1,
    )
  }

  // Cancellation releases only remaining reservations; issued invoice debt is independent.
  // These commands need not block each other, so require the second to finish before
  // the first commits rather than inventing a lock requirement.
  const cancelFirst = await crossFixture('cancel-first', 450000, false, 4000)
  await first.query('begin')
  const cancellation = await cancelFirst.cancel(first)
  assert.equal(cancellation.rows[0].response.releasedQuantityMilli, 6000)
  await cancelFirst.record(second)
  await first.query('commit')
  await crossState(cancelFirst, '0.00')
  const receiptFirst = await crossFixture('receipt-first', 450000, false, 4000)
  await first.query('begin')
  await receiptFirst.record(first)
  await receiptFirst.cancel(second)
  await first.query('commit')
  await crossState(receiptFirst, '0.00')
  for (const fixture of [cancelFirst, receiptFirst]) {
    const state = (
      await observer.query(
        `select orders.status,line.fulfilled_quantity::text fulfilled,line.cancelled_quantity::text cancelled,
      (select count(*)::int from app.sales_order_reservation_ledger where tenant_id=$1 and sales_order_id=$2 and reason='order_cancelled') cancellations
      from app.sales_orders orders join app.sales_order_lines line on line.tenant_id=orders.tenant_id and line.sales_order_id=orders.id
      where orders.tenant_id=$1 and orders.id=$2`,
        [tenant, fixture.orderId],
      )
    ).rows[0]
    assert.deepEqual(state, { status: 'cancelled', fulfilled: '4.000', cancelled: '6.000', cancellations: 1 })
  }
  assert.deepEqual(
    (
      await observer.query('select on_hand::text,reserved::text from app.inventory_balances where tenant_id=$1', [
        tenant,
      ])
    ).rows[0],
    { on_hand: '12.000', reserved: '0.000' },
  )
  console.log(
    'AW3 cross-command concurrency passed: payment-first/confirmation-first, opening-first/unclassified-payment-first, cancellation-first/payment-first; exact balances, released reservations, immutable charges, one receipt/allocation/audit/outbox per command, and reconciled shared stock.',
  )

  // Reuse a fully paid four-unit invoice; all fixtures stay in this disposable CI database.
  const returnLine = (
    await observer.query('select id from app.invoice_lines where tenant_id=$1 and invoice_id=$2', [
      tenant,
      receiptFirst.invoiceId,
    ])
  ).rows[0].id
  const returnBody = {
    invoiceId: receiptFirst.invoiceId,
    reason: 'Disposable concurrent return',
    lines: [{ invoiceLineId: returnLine, quantityMilli: 3000, returnToStock: true }],
  }
  const postReturn = (client, key) =>
    client.query('select app.post_wholesale_return($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify(returnBody),
      key,
    ])
  await first.query('begin')
  const returned = (await postReturn(first, 'aw4-race-return-winner')).rows[0].response
  const excessReturn = postReturn(second, 'aw4-race-return-loser').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await excessReturn, 'HCWR4')
  assert.equal(returned.newCustomerCreditMinor, 135000)
  assert.equal(
    (await observer.query('select on_hand::text from app.inventory_balances where tenant_id=$1', [tenant])).rows[0]
      .on_hand,
    '15.000',
  )

  await first.query('begin')
  await postReturn(first, 'aw4-race-return-winner')
  const returnReplay = postReturn(second, 'aw4-race-return-winner')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await returnReplay).rows[0].response, returned)
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_credit_notes where tenant_id=$1', [tenant]))
      .rows[0].count,
    1,
  )

  const targetOrder = await receiptFirst.create('aw4-target')
  await confirm(observer, targetOrder, 'aw4-race-target-confirm')
  const targetLine = (
    await observer.query('select id from app.sales_order_lines where tenant_id=$1 and sales_order_id=$2', [
      tenant,
      targetOrder,
    ])
  ).rows[0].id
  const targetInvoice = (
    await observer.query('select app.fulfill_wholesale_order($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      targetOrder,
      JSON.stringify([{ salesOrderLineId: targetLine, quantityMilli: 10000 }]),
      'aw4-race-target-issue',
    ])
  ).rows[0].response.invoiceId
  const applyCredit = (client, key, amountMinor) =>
    client.query('select app.command_wholesale_credit($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      'apply',
      JSON.stringify({
        creditNoteId: returned.creditNoteId,
        invoiceId: targetInvoice,
        amountMinor,
        reason: 'Disposable concurrent credit application',
      }),
      key,
    ])
  await first.query('begin')
  await applyCredit(first, 'aw4-race-apply-winner', 90000)
  const excessApplication = applyCredit(second, 'aw4-race-apply-loser', 90000).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await excessApplication, 'HCWR4')

  await first.query('begin')
  const application = (await applyCredit(first, 'aw4-race-apply-replay', 45000)).rows[0].response
  const applicationReplay = applyCredit(second, 'aw4-race-apply-replay', 45000)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await applicationReplay).rows[0].response, application)
  const reconciled = (
    await observer.query(
      `select
    app.wholesale_credit_available($1,$2)::text available,
    app.wholesale_invoice_open_balance($1,$3)::text debt,
    (select count(*)::int from app.wholesale_credit_applications where tenant_id=$1) applications,
    (select count(*)::int from app.wholesale_credit_payouts where tenant_id=$1) payouts,
    (select on_hand::text from app.inventory_balances where tenant_id=$1) stock`,
      [tenant, returned.creditNoteId, targetInvoice],
    )
  ).rows[0]
  assert.deepEqual(reconciled, { available: '0.00', debt: '3150.00', applications: 2, payouts: 0, stock: '5.000' })
  console.log(
    'AW4 concurrency passed: competing over-return and credit overdraw denied; original-key return/application replays post once; exact stock, credit and target debt reconciled.',
  )

  const fundsBeforePayout = (
    await observer.query('select coalesce(sum(amount),0)::text total from app.fund_ledger_entries where tenant_id=$1', [
      tenant,
    ])
  ).rows[0].total
  const paidReturn = async (invoiceId, quantityMilli, key) => {
    const invoiceLineId = (
      await observer.query('select id from app.invoice_lines where tenant_id=$1 and invoice_id=$2', [tenant, invoiceId])
    ).rows[0].id
    return (
      await observer.query('select app.post_wholesale_return($1,$2,$3::jsonb,$4,$4,$4) response', [
        actor,
        tenant,
        JSON.stringify({
          invoiceId,
          reason: 'Disposable payout race return',
          lines: [{ invoiceLineId, quantityMilli, returnToStock: true }],
        }),
        key,
      ])
    ).rows[0].response
  }
  const payoutNote = await paidReturn(cancelFirst.invoiceId, 4000, 'aw4-payout-source-return')
  assert.equal(payoutNote.newCustomerCreditMinor, 180000)
  const payoutEmployee = (
    await observer.query(
      "insert into app.employees(tenant_id,user_id,employee_code,display_name) values($1,$2,'AW4-RACE','AW4 Race Owner') returning id",
      [tenant, actor],
    )
  ).rows[0].id
  await observer.query('insert into app.employee_locations(tenant_id,employee_id,location_id) values($1,$2,$3)', [
    tenant,
    payoutEmployee,
    location,
  ])
  const payoutRegister = (
    await observer.query(
      "insert into app.registers(tenant_id,location_id,code,name) values($1,$2,'AW4-RACE','AW4 Race Register') returning id",
      [tenant, location],
    )
  ).rows[0].id
  const openPayoutSession = async (opening, key) =>
    (
      await observer.query('select app.open_register_session($1,$2,$3,$4,$5,$6,$6,$6) response', [
        actor,
        tenant,
        payoutRegister,
        payoutEmployee,
        opening,
        key,
      ])
    ).rows[0].response.registerSessionId
  const payoutSession = await openPayoutSession(250000, 'aw4-payout-session-open')
  const payout = (client, noteId, sessionId, amountMinor, key) =>
    client.query('select app.command_wholesale_credit($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      'refund',
      JSON.stringify({
        creditNoteId: noteId,
        paymentMethodId: method,
        registerSessionId: sessionId,
        referenceLastFour: null,
        payoutConfirmed: true,
        amountMinor,
        reason: 'Disposable separately authorized payout',
      }),
      key,
    ])
  const closePayoutSession = (client, sessionId, counted, key) =>
    client.query('select app.close_register_session($1,$2,$3,$4,$5,$5,$5) response', [
      actor,
      tenant,
      sessionId,
      counted,
      key,
    ])

  await first.query('begin')
  const payoutResult = (await payout(first, payoutNote.creditNoteId, payoutSession, 120000, 'aw4-payout-race-winner'))
    .rows[0].response
  const excessPayout = payout(second, payoutNote.creditNoteId, payoutSession, 120000, 'aw4-payout-race-loser').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await excessPayout, 'HCWR4')

  await first.query('begin')
  await payout(first, payoutNote.creditNoteId, payoutSession, 120000, 'aw4-payout-race-winner')
  const payoutReplay = payout(second, payoutNote.creditNoteId, payoutSession, 120000, 'aw4-payout-race-winner')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await payoutReplay).rows[0].response, payoutResult)

  // Close must wait for the refund's session lock and count the committed payout.
  await first.query('begin')
  await payout(first, payoutNote.creditNoteId, payoutSession, 60000, 'aw4-payout-before-close')
  const closeAfterPayout = closePayoutSession(second, payoutSession, 70000, 'aw4-close-after-payout')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await closeAfterPayout).rows[0].response, {
    registerSessionId: payoutSession,
    status: 'closed',
    expectedCashCentavos: 70000,
    countedCashCentavos: 70000,
    varianceCentavos: 0,
  })
  // A historical retry may return its original result even after close, never pay again.
  assert.deepEqual(
    (await payout(observer, payoutNote.creditNoteId, payoutSession, 120000, 'aw4-payout-race-winner')).rows[0].response,
    payoutResult,
  )

  const closedFirstNote = await paidReturn(receiptFirst.invoiceId, 1000, 'aw4-close-first-source-return')
  assert.equal(closedFirstNote.newCustomerCreditMinor, 45000)
  const closedFirstSession = await openPayoutSession(100000, 'aw4-close-first-session-open')
  await first.query('begin')
  await closePayoutSession(first, closedFirstSession, 100000, 'aw4-close-before-payout')
  const payoutAfterClose = payout(
    second,
    closedFirstNote.creditNoteId,
    closedFirstSession,
    45000,
    'aw4-payout-after-close-denied',
  ).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await payoutAfterClose, 'HCWR6')
  const payoutState = (
    await observer.query(
      `select
    (select count(*)::int from app.wholesale_credit_payouts where tenant_id=$1) payouts,
    (select sum(amount)::text from app.wholesale_credit_payouts where tenant_id=$1) payout_total,
    (select count(*)::int from app.cash_movements where tenant_id=$1 and source_type='wholesale_credit_payout') cash_rows,
    (select sum(amount)::text from app.cash_movements where tenant_id=$1 and source_type='wholesale_credit_payout') cash_total,
    app.wholesale_credit_available($1,$2)::text paid_note_credit,
    app.wholesale_credit_available($1,$3)::text blocked_note_credit,
    (select count(*)::int from app.register_sessions where tenant_id=$1 and status='open') open_sessions,
    (select count(*)::int from app.register_sessions where tenant_id=$1 and variance<>0) variances,
    (select count(*)::int from audit.audit_events where tenant_id=$1 and action='wholesale_credit.refund') audits,
    (select count(*)::int from integration.event_outbox where tenant_id=$1 and topic='wholesale_credit.refund') events,
    (select count(*)::int from app.idempotency_records where tenant_id=$1 and operation='wholesale_credit.refund'
      and idempotency_key in ('aw4-payout-race-loser','aw4-payout-after-close-denied')) denied_keys,
    (select coalesce(sum(amount),0)::text from app.fund_ledger_entries where tenant_id=$1) funds`,
      [tenant, payoutNote.creditNoteId, closedFirstNote.creditNoteId],
    )
  ).rows[0]
  assert.deepEqual(payoutState, {
    payouts: 2,
    payout_total: '1800.00',
    cash_rows: 2,
    cash_total: '-1800.00',
    paid_note_credit: '0.00',
    blocked_note_credit: '450.00',
    open_sessions: 0,
    variances: 0,
    audits: 2,
    events: 2,
    denied_keys: 0,
    funds: fundsBeforePayout,
  })
  console.log(
    'AW4 payout concurrency passed: competing payout overdraw denied; same-key replay pays once; refund-first close counts committed cash; close-first refund denied; closed-session historical replay creates no second payout; credit/cash/audit/outbox/funds reconcile.',
  )

  // Application and payout must compete for the same credit, not separate balances.
  const mixedSession = await openPayoutSession(100000, 'aw4-mixed-session-open')
  const mixedApply = (client, amountMinor, key) =>
    client.query('select app.command_wholesale_credit($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      'apply',
      JSON.stringify({
        creditNoteId: closedFirstNote.creditNoteId,
        invoiceId: targetInvoice,
        amountMinor,
        reason: 'Disposable credit application versus payout',
      }),
      key,
    ])
  await first.query('begin')
  await mixedApply(first, 30000, 'aw4-mixed-apply-first')
  const payoutAfterApplication = payout(
    second,
    closedFirstNote.creditNoteId,
    mixedSession,
    30000,
    'aw4-mixed-payout-denied',
  ).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await payoutAfterApplication, 'HCWR4')

  await first.query('begin')
  await payout(first, closedFirstNote.creditNoteId, mixedSession, 10000, 'aw4-mixed-payout-first')
  const applicationAfterPayout = mixedApply(second, 10000, 'aw4-mixed-apply-denied').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await applicationAfterPayout, 'HCWR4')
  await mixedApply(observer, 5000, 'aw4-mixed-credit-remainder')
  assert.deepEqual(
    (await closePayoutSession(observer, mixedSession, 90000, 'aw4-mixed-session-close')).rows[0].response,
    {
      registerSessionId: mixedSession,
      status: 'closed',
      expectedCashCentavos: 90000,
      countedCashCentavos: 90000,
      varianceCentavos: 0,
    },
  )
  assert.deepEqual(
    (
      await observer.query(
        `select
    app.wholesale_credit_available($1,$2)::text credit,
    app.wholesale_invoice_open_balance($1,$3)::text debt,
    (select sum(amount)::text from app.wholesale_credit_applications where tenant_id=$1 and credit_note_id=$2) applied,
    (select sum(amount)::text from app.wholesale_credit_payouts where tenant_id=$1 and credit_note_id=$2) paid,
    (select count(*)::int from app.idempotency_records where tenant_id=$1
      and idempotency_key in ('aw4-mixed-payout-denied','aw4-mixed-apply-denied')) denied_keys`,
        [tenant, closedFirstNote.creditNoteId, targetInvoice],
      )
    ).rows[0],
    {
      credit: '0.00',
      debt: '2800.00',
      applied: '350.00',
      paid: '100.00',
      denied_keys: 0,
    },
  )

  const targetInvoiceLine = (
    await observer.query('select id from app.invoice_lines where tenant_id=$1 and invoice_id=$2', [
      tenant,
      targetInvoice,
    ])
  ).rows[0].id
  const returnTarget = (client, key) =>
    client.query('select app.post_wholesale_return($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        invoiceId: targetInvoice,
        reason: 'Disposable payment versus return',
        lines: [{ invoiceLineId: targetInvoiceLine, quantityMilli: 1000, returnToStock: true }],
      }),
      key,
    ])
  const payTarget = (client, amountMinor, key) =>
    client.query('select app.record_wholesale_payment($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        customerId: receiptFirst.customerId,
        paymentMethodId: method,
        amountMinor,
        reference: 'Synthetic payment versus return',
        allocations: [{ invoiceId: targetInvoice, amountMinor }],
      }),
      key,
    ])
  // Both transaction orderings must re-read the locked invoice's current balance.
  await first.query('begin')
  await payTarget(first, 90000, 'aw4-payment-before-return')
  const returnAfterPayment = returnTarget(second, 'aw4-return-after-payment')
  await waitForLock()
  await first.query('commit')
  const afterPayment = (await returnAfterPayment).rows[0].response
  assert.equal(afterPayment.debtReductionMinor, 45000)
  assert.equal(afterPayment.newCustomerCreditMinor, 0)
  assert.equal(afterPayment.openDebtMinor, 145000)

  await first.query('begin')
  const beforePayment = (await returnTarget(first, 'aw4-return-before-payment')).rows[0].response
  assert.equal(beforePayment.openDebtMinor, 100000)
  const stalePayment = payTarget(second, 145000, 'aw4-stale-payment-denied').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await stalePayment, 'HCAP5')
  await payTarget(observer, 100000, 'aw4-corrected-payment')
  const mixedState = (
    await observer.query(
      `select
    app.wholesale_invoice_open_balance($1,$2)::text debt,
    (select sum(amount)::text from app.wholesale_payment_allocations where tenant_id=$1 and invoice_id=$2) receipts,
    (select sum(amount)::text from app.wholesale_credit_applications where tenant_id=$1 and invoice_id=$2) applications,
    (select sum(amount)::text from app.wholesale_credit_notes where tenant_id=$1 and invoice_id=$2) returns,
    (select sum(customer_credit)::text from app.wholesale_credit_notes where tenant_id=$1 and invoice_id=$2) new_credit,
    (select count(*)::int from app.wholesale_credit_notes where tenant_id=$1 and invoice_id=$2) return_count,
    (select count(*)::int from app.wholesale_payment_allocations where tenant_id=$1 and invoice_id=$2) receipt_count,
    (select count(*)::int from app.idempotency_records where tenant_id=$1 and idempotency_key='aw4-stale-payment-denied') denied_keys,
    (select on_hand::text from app.inventory_balances where tenant_id=$1) stock,
    (select count(*)::int from app.register_sessions where tenant_id=$1 and status='open') open_sessions,
    (select count(*)::int from app.cash_movements where tenant_id=$1 and source_type='wholesale_credit_payout') cash_rows,
    (select sum(amount)::text from app.cash_movements where tenant_id=$1 and source_type='wholesale_credit_payout') cash_total,
    (select count(*)::int from audit.audit_events where tenant_id=$1 and request_id=any($3::text[])) audits,
    (select count(*)::int from integration.event_outbox e join audit.audit_events a
      on a.tenant_id=e.tenant_id and a.entity_id=e.aggregate_id and a.action=e.topic
      where a.tenant_id=$1 and a.request_id=any($3::text[])) events,
    (select coalesce(sum(amount),0)::text from app.fund_ledger_entries where tenant_id=$1) funds`,
      [
        tenant,
        targetInvoice,
        [
          'aw4-mixed-apply-first',
          'aw4-mixed-payout-first',
          'aw4-mixed-credit-remainder',
          'aw4-payment-before-return',
          'aw4-return-after-payment',
          'aw4-return-before-payment',
          'aw4-corrected-payment',
        ],
      ],
    )
  ).rows[0]
  assert.deepEqual(mixedState, {
    debt: '0.00',
    receipts: '1900.00',
    applications: '1700.00',
    returns: '900.00',
    new_credit: '0.00',
    return_count: 2,
    receipt_count: 2,
    denied_keys: 0,
    stock: '12.000',
    open_sessions: 0,
    cash_rows: 3,
    cash_total: '-1900.00',
    audits: 7,
    events: 7,
    funds: fundsBeforePayout,
  })
  console.log(
    'AW4 cross-command concurrency passed: application-first/payout-first credit overdraw denied; payment-first return reconciles; return-first stale overpayment rejected; corrected payment settles exactly; stock, credit, cash and funds reconcile.',
  )

  const guardedNote = await paidReturn(targetInvoice, 1000, 'aw4-security-source-return')
  const guardedOrder = await receiptFirst.create('aw4-security-target')
  await confirm(observer, guardedOrder, 'aw4-security-target-confirm')
  const guardedLine = (
    await observer.query('select id from app.sales_order_lines where tenant_id=$1 and sales_order_id=$2', [
      tenant,
      guardedOrder,
    ])
  ).rows[0].id
  const guardedInvoice = (
    await observer.query('select app.fulfill_wholesale_order($1,$2,$3,$4::jsonb,$5,$5,$5) response', [
      actor,
      tenant,
      guardedOrder,
      JSON.stringify([{ salesOrderLineId: guardedLine, quantityMilli: 10000 }]),
      'aw4-security-target-issue',
    ])
  ).rows[0].response.invoiceId
  const guardedSession = await openPayoutSession(100000, 'aw4-security-session-open')
  const guardedApply = (client, key) =>
    client.query("select app.command_wholesale_credit($1,$2,'apply',$3::jsonb,$4,$4,$4) response", [
      actor,
      tenant,
      JSON.stringify({
        creditNoteId: guardedNote.creditNoteId,
        invoiceId: guardedInvoice,
        amountMinor: 10000,
        reason: 'Disposable queued authorization regression',
      }),
      key,
    ])
  const guardedCommands = {
    apply: guardedApply,
    refund: (client, key) => payout(client, guardedNote.creditNoteId, guardedSession, 10000, key),
    return: returnTarget,
  }
  const securitySnapshot = async () =>
    (
      await observer.query(
        `select jsonb_build_object(
    'notes',(select count(*) from app.wholesale_credit_notes where tenant_id=$1),
    'applications',(select count(*) from app.wholesale_credit_applications where tenant_id=$1),
    'payouts',(select count(*) from app.wholesale_credit_payouts where tenant_id=$1),
    'refunds',(select count(*) from app.refunds where tenant_id=$1),
    'movements',(select count(*) from app.inventory_movements where tenant_id=$1),
    'cash',(select count(*) from app.cash_movements where tenant_id=$1),
    'funds',(select coalesce(sum(amount),0) from app.fund_ledger_entries where tenant_id=$1),
    'keys',(select count(*) from app.idempotency_records where tenant_id=$1),
    'audits',(select count(*) from audit.audit_events where tenant_id=$1),
    'events',(select count(*) from integration.event_outbox where tenant_id=$1),
    'stock',(select on_hand from app.inventory_balances where tenant_id=$1)
  ) state`,
        [tenant],
      )
    ).rows[0].state
  for (const [change, revoke, restore, expected] of [
    [
      'suspend',
      "update app.tenants set status='suspended' where id=$1",
      "update app.tenants set status='active' where id=$1",
      'HCWR0',
    ],
    [
      'disable',
      "update app.tenant_entitlements set enabled=false where tenant_id=$1 and feature_code='advanced_wholesale'",
      "update app.tenant_entitlements set enabled=true where tenant_id=$1 and feature_code='advanced_wholesale'",
      'HCSQ0',
    ],
    [
      'membership',
      `update app.tenant_memberships set status='deactivated' where tenant_id=$1 and user_id='${actor}'`,
      `update app.tenant_memberships set status='active' where tenant_id=$1 and user_id='${actor}'`,
      'HCAR1',
    ],
  ]) {
    for (const [operation, command] of Object.entries(guardedCommands)) {
      const before = await securitySnapshot()
      await first.query('begin')
      // Revoke before admission, but leave it uncommitted so the old guard sees stale active state.
      await first.query(revoke, [tenant])
      await first.query('select 1 from app.customers where tenant_id=$1 and id=$2 for update', [
        tenant,
        receiptFirst.customerId,
      ])
      const queued = command(second, `aw4-security-${change}-${operation}`).then(
        () => 'unexpected-success',
        (error) => error.code,
      )
      await waitForLock()
      await first.query('commit')
      assert.equal(await queued, expected, `${operation} must deny committed ${change} after its lock wait`)
      assert.deepEqual(await securitySnapshot(), before, `${operation} denial must leave all ledgers unchanged`)
      await observer.query(restore, [tenant])
    }
  }
  const [staff, staffRole, staffEmployee] = [randomUUID(), randomUUID(), randomUUID()]
  await observer.query('insert into auth.users(id,email) values($1,$2)', [staff, `${staff}@example.invalid`])
  await observer.query(
    "insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values($1,$2,'active',false)",
    [tenant, staff],
  )
  await observer.query("insert into app.roles(id,tenant_id,code,name) values($1,$2,'AW4-GUARD','AW4 guard tester')", [
    staffRole,
    tenant,
  ])
  for (const permission of [
    'wholesale_orders.read',
    'wholesale_returns.post',
    'wholesale_credits.apply',
    'wholesale_credits.refund',
  ]) {
    await observer.query('insert into app.role_permissions(tenant_id,role_id,permission_code) values($1,$2,$3)', [
      tenant,
      staffRole,
      permission,
    ])
  }
  await observer.query('insert into app.membership_roles(tenant_id,user_id,role_id) values($1,$2,$3)', [
    tenant,
    staff,
    staffRole,
  ])
  await observer.query(
    "insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values($1,$2,$3,'AW4-GUARD','AW4 guard tester')",
    [staffEmployee, tenant, staff],
  )
  await observer.query('insert into app.employee_locations(tenant_id,employee_id,location_id) values($1,$2,$3)', [
    tenant,
    staffEmployee,
    location,
  ])
  // Use credit application and return for branch/permission races; payout cash operation has its own employee/session rules.
  for (const operation of ['apply', 'return']) {
    const permission = operation === 'return' ? 'wholesale_returns.post' : 'wholesale_credits.apply'
    const staffCommand = (key) =>
      operation === 'return'
        ? second.query('select app.post_wholesale_return($1,$2,$3::jsonb,$4,$4,$4)', [
            staff,
            tenant,
            JSON.stringify({
              invoiceId: targetInvoice,
              reason: 'Disposable branch authorization regression',
              lines: [{ invoiceLineId: targetInvoiceLine, quantityMilli: 1000, returnToStock: true }],
            }),
            key,
          ])
        : second.query("select app.command_wholesale_credit($1,$2,'apply',$3::jsonb,$4,$4,$4)", [
            staff,
            tenant,
            JSON.stringify({
              creditNoteId: guardedNote.creditNoteId,
              invoiceId: guardedInvoice,
              amountMinor: 10000,
              reason: 'Disposable branch authorization regression',
            }),
            key,
          ])
    for (const [change, revoke, restore, parameters, expected] of [
      [
        'permission',
        'delete from app.role_permissions where tenant_id=$1 and role_id=$2 and permission_code=$3',
        'insert into app.role_permissions(tenant_id,role_id,permission_code) values($1,$2,$3)',
        [tenant, staffRole, permission],
        'HCWR0',
      ],
      [
        'assignment',
        'delete from app.employee_locations where tenant_id=$1 and employee_id=$2 and location_id=$3',
        'insert into app.employee_locations(tenant_id,employee_id,location_id) values($1,$2,$3)',
        [tenant, staffEmployee, location],
        'HCWR2',
      ],
      [
        'employee',
        "update app.employees set status='deactivated' where tenant_id=$1 and id=$2",
        "update app.employees set status='active' where tenant_id=$1 and id=$2",
        [tenant, staffEmployee],
        'HCWR2',
      ],
      [
        'location',
        'update app.locations set is_active=false where tenant_id=$1 and id=$2',
        'update app.locations set is_active=true where tenant_id=$1 and id=$2',
        [tenant, location],
        'HCWR2',
      ],
    ]) {
      const before = await securitySnapshot()
      await first.query('begin')
      await first.query(revoke, parameters)
      await first.query('select 1 from app.customers where tenant_id=$1 and id=$2 for update', [
        tenant,
        receiptFirst.customerId,
      ])
      const queued = staffCommand(`aw4-security-${change}-${operation}`).then(
        () => 'unexpected-success',
        (error) => error.code,
      )
      await waitForLock()
      await first.query('commit')
      assert.equal(await queued, expected, `${operation} must deny committed ${change}`)
      assert.deepEqual(await securitySnapshot(), before)
      await observer.query(restore, parameters)
    }
  }
  // Once branch admission wins, later deactivation cannot commit during an inventory wait.
  const observerPid = (await observer.query('select pg_backend_pid() pid')).rows[0].pid
  for (const [scope, revoke, restore, parameters] of [
    [
      'location',
      'update app.locations set is_active=false where tenant_id=$1 and id=$2',
      'update app.locations set is_active=true where tenant_id=$1 and id=$2',
      [tenant, location],
    ],
    [
      'assignment',
      'delete from app.employee_locations where tenant_id=$1 and employee_id=$2 and location_id=$3',
      'insert into app.employee_locations(tenant_id,employee_id,location_id) values($1,$2,$3)',
      [tenant, staffEmployee, location],
    ],
  ]) {
    await first.query('begin')
    await first.query(
      'select 1 from app.inventory_balances where tenant_id=$1 and location_id=$2 and variant_id=$3 for update',
      [tenant, location, variant],
    )
    const branchAdmittedReturn = second.query('select app.post_wholesale_return($1,$2,$3::jsonb,$4,$4,$4)', [
      staff,
      tenant,
      JSON.stringify({
        invoiceId: targetInvoice,
        reason: 'Disposable admitted branch return',
        lines: [{ invoiceLineId: targetInvoiceLine, quantityMilli: 1000, returnToStock: true }],
      }),
      `aw4-branch-${scope}-admission-first`,
    ])
    await waitForLock()
    const deactivation = observer.query(revoke, parameters)
    let deactivationBlocked = false
    const branchDeadline = Date.now() + 10000
    while (Date.now() < branchDeadline) {
      if (
        (await first.query('select exists(select 1 from pg_locks where pid=$1 and not granted) blocked', [observerPid]))
          .rows[0].blocked
      ) {
        deactivationBlocked = true
        break
      }
      await delay(25)
    }
    assert.equal(
      deactivationBlocked,
      true,
      `${scope} revocation must wait behind the admitted return, even during inventory wait`,
    )
    await first.query('commit')
    await branchAdmittedReturn
    await deactivation
    await observer.query(restore, parameters)
  }
  // Expiry can advance while authorization rows remain locked; recheck even on replay.
  for (const [operation, command] of Object.entries({
    ...guardedCommands,
    replay: (client) => postReturn(client, 'aw4-race-return-winner'),
  })) {
    await observer.query(
      "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '1 second' where tenant_id=$1 and feature_code='advanced_wholesale'",
      [tenant],
    )
    const before = await securitySnapshot()
    await first.query('begin')
    await first.query('select 1 from app.customers where tenant_id=$1 and id=$2 for update', [
      tenant,
      receiptFirst.customerId,
    ])
    const queued = command(second, `aw4-security-expiry-${operation}`).then(
      () => 'unexpected-success',
      (error) => error.code,
    )
    await waitForLock()
    while (
      !(
        await observer.query(
          "select ends_at<=clock_timestamp() expired from app.tenant_entitlements where tenant_id=$1 and feature_code='advanced_wholesale'",
          [tenant],
        )
      ).rows[0].expired
    )
      await delay(25)
    await first.query('commit')
    assert.equal(await queued, 'HCSQ0', `${operation} must deny expiry during customer-lock wait`)
    assert.deepEqual(await securitySnapshot(), before)
    await observer.query(
      "update app.tenant_entitlements set ends_at=null where tenant_id=$1 and feature_code='advanced_wholesale'",
      [tenant],
    )
  }
  // When posting wins admission, suspension waits until the atomic command commits.
  await first.query('begin')
  await guardedApply(first, 'aw4-security-command-first')
  const suspension = second.query("update app.tenants set status='suspended' where id=$1", [tenant])
  await waitForLock()
  assert.equal((await observer.query('select status from app.tenants where id=$1', [tenant])).rows[0].status, 'active')
  await first.query('commit')
  await suspension
  await observer.query("update app.tenants set status='active' where id=$1", [tenant])
  await first.query('begin')
  await first.query(
    'select 1 from app.inventory_balances where tenant_id=$1 and location_id=$2 and variant_id=$3 for update',
    [tenant, location, variant],
  )
  const waitedReturn = returnTarget(second, 'aw4-effective-after-stock-wait')
  await waitForLock()
  const cutoff = (await observer.query('select clock_timestamp()::text cutoff')).rows[0].cutoff
  await first.query('commit')
  const waitedNote = (await waitedReturn).rows[0].response.creditNoteId
  assert.deepEqual(
    (
      await observer.query(
        `select
    n.recorded_at>=$3::timestamptz after_wait,
    n.recorded_at=r.completed_at and n.recorded_at=r.created_at and n.recorded_at=i.recorded_at
      and n.recorded_at=m.occurred_at and n.recorded_at=m.created_at
      and n.recorded_at=a.occurred_at and n.recorded_at=e.created_at and n.recorded_at=e.available_at same_event,
    (r.completed_at at time zone 'Asia/Manila')::date=(n.recorded_at at time zone 'Asia/Manila')::date same_day,
    (r.completed_at<$3::timestamptz)=(n.recorded_at<$3::timestamptz) same_cutoff
    from app.wholesale_credit_notes n join app.refunds r on r.tenant_id=n.tenant_id and r.id=n.refund_id
    join app.wholesale_customer_credit_issues i on i.tenant_id=n.tenant_id and i.credit_note_id=n.id
    join app.inventory_movements m on m.tenant_id=n.tenant_id and m.source_type='wholesale_credit_note' and m.source_reference=n.id::text
    join audit.audit_events a on a.tenant_id=n.tenant_id and a.entity_id=n.id and a.action='wholesale_return.posted'
    join integration.event_outbox e on e.tenant_id=n.tenant_id and e.aggregate_id=n.id and e.topic='wholesale_return.posted'
    where n.tenant_id=$1 and n.id=$2`,
        [tenant, waitedNote, cutoff],
      )
    ).rows[0],
    {
      after_wait: true,
      same_event: true,
      same_day: true,
      same_cutoff: true,
    },
  )
  assert.equal(
    (
      await observer.query(
        `select bool_and(p.recorded_at=c.occurred_at and p.recorded_at=a.occurred_at and p.recorded_at=e.created_at) aligned
    from app.wholesale_credit_payouts p join app.cash_movements c on c.tenant_id=p.tenant_id and c.source_type='wholesale_credit_payout' and c.source_id=p.id
    join audit.audit_events a on a.tenant_id=p.tenant_id and a.entity_id=p.id and a.action='wholesale_credit.refund'
    join integration.event_outbox e on e.tenant_id=p.tenant_id and e.aggregate_id=p.id and e.topic='wholesale_credit.refund'
    where p.tenant_id=$1`,
        [tenant],
      )
    ).rows[0].aligned,
    true,
  )
  await closePayoutSession(observer, guardedSession, 100000, 'aw4-security-session-close')
  console.log(
    'AW4 queued authorization passed: suspension/entitlement/membership revocation deny queued return/application/payout without writes; wallclock expiry denies commands/replay after wait; command-first suspension serializes after posting.',
  )
  console.log(
    'AW4 effective time passed: real inventory-lock wait finishes before linked reversal/note/credit/stock/audit/outbox effective time; Manila dates and strict cutoffs agree; payout/cash/audit/outbox timestamps align.',
  )
  // Run reversal races last so earlier fund invariants retain their original baseline.
  const reverseFunds = (client, receiptId, key) =>
    client.query('select app.reverse_wholesale_payment_funds($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        paymentId: receiptId,
        reason: 'Disposable exact original split reversal',
        reversalConfirmed: true,
      }),
      key,
    ])
  await first.query('begin')
  const reversalWinner = (await reverseFunds(first, paymentId, 'aw4-fund-reversal-race')).rows[0].response
  const reversalReplay = reverseFunds(second, paymentId, 'aw4-fund-reversal-race')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await reversalReplay).rows[0].response, reversalWinner)
  await assert.rejects(
    reverseFunds(observer, paymentId, 'aw4-fund-reversal-other-key'),
    (error) => error.code === 'HCFD6',
  )
  assert.equal(
    (await observer.query('select count(*)::int count from app.wholesale_fund_reversals where tenant_id=$1', [tenant]))
      .rows[0].count,
    1,
  )
  assert.equal(
    (await observer.query('select sum(amount)::text amount from app.fund_ledger_entries where tenant_id=$1', [tenant]))
      .rows[0].amount,
    '3000.00',
  )

  await first.query('begin')
  await first.query('select 1 from app.fund_accounts where tenant_id=$1 order by id for update', [tenant])
  const waitedReversal = reverseFunds(second, secondReceipt, 'aw4-fund-reversal-after-wait')
  await waitForLock()
  const reversalCutoff = (await observer.query('select clock_timestamp()::text cutoff')).rows[0].cutoff
  await first.query('commit')
  const waitedReversalId = (await waitedReversal).rows[0].response.reversalId
  assert.equal(
    (
      await observer.query(
        'select recorded_at>=$3::timestamptz after_wait from app.wholesale_fund_reversals where tenant_id=$1 and id=$2',
        [tenant, waitedReversalId, reversalCutoff],
      )
    ).rows[0].after_wait,
    true,
  )
  assert.equal(
    (await observer.query('select sum(amount)::text amount from app.fund_ledger_entries where tenant_id=$1', [tenant]))
      .rows[0].amount,
    '0.00',
  )
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from app.fund_ledger_entries where tenant_id=$1 and source_type='wholesale_fund_reversal'",
        [tenant],
      )
    ).rows[0].count,
    3,
  )
  console.log(
    'AW4 fund reversal concurrency passed: overlapping same-key replay and different-key duplicate denial; fund-account wait precedes common event time; original splits net to zero exactly once.',
  )
  const categoryCommand = (client, body, key) =>
    client.query('select app.manage_catalog_category($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify(body),
      key,
    ])
  const selectedProduct = (client, categoryId, suffix) =>
    client.query('select app.create_catalog_product_selected_category($1,$2,$3::jsonb,$4,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify({
        name: `Category ${suffix}`,
        categoryId,
        variantName: 'Default',
        sku: `CATEGORY-${suffix}`,
        retailPriceMinor: 100,
        unitCostMinor: null,
        trackInventory: false,
        barcodes: [],
      }),
      `category-product-${suffix}`,
    ])
  const newCategory = async (suffix) =>
    (await categoryCommand(observer, { action: 'create', name: `Category ${suffix}` }, `category-create-${suffix}`))
      .rows[0].response.categoryId
  const archiveFirstCategory = await newCategory('archive-first')
  await first.query('begin')
  await categoryCommand(first, { action: 'archive', categoryId: archiveFirstCategory }, 'category-archive-first')
  const afterArchive = selectedProduct(second, archiveFirstCategory, 'ARCHIVE-FIRST').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await afterArchive, 'HCS11')

  const assignFirstCategory = await newCategory('assign-first')
  await first.query('begin')
  const categoryProduct = (await selectedProduct(first, assignFirstCategory, 'ASSIGN-FIRST')).rows[0].response.productId
  const afterAssign = categoryCommand(
    second,
    { action: 'archive', categoryId: assignFirstCategory },
    'category-after-assign',
  ).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await afterAssign, 'HCCT2')
  assert.equal(
    (await observer.query('select category_id from app.products where id=$1', [categoryProduct])).rows[0].category_id,
    assignFirstCategory,
  )

  const renameCategory = await newCategory('rename-first')
  await first.query('begin')
  await categoryCommand(
    first,
    { action: 'rename', categoryId: renameCategory, name: 'Renamed while assigning' },
    'category-rename-first',
  )
  const afterRename = selectedProduct(second, renameCategory, 'RENAME-FIRST')
  await waitForLock()
  await first.query('commit')
  const renamedProduct = (await afterRename).rows[0].response.productId
  assert.equal(
    (await observer.query('select category_id from app.products where id=$1', [renamedProduct])).rows[0].category_id,
    renameCategory,
  )
  assert.equal(
    (
      await observer.query('select count(*)::int count from app.product_categories where tenant_id=$1 and name=$2', [
        tenant,
        'Category rename-first',
      ])
    ).rows[0].count,
    0,
  )

  await first.query('begin')
  const sameCategoryBody = { action: 'create', name: 'Same key category' }
  const sameCategoryKey = 'category-concurrent-replay'
  const firstCategoryResponse = (await categoryCommand(first, sameCategoryBody, sameCategoryKey)).rows[0].response
  const sameCategoryReplay = categoryCommand(second, sameCategoryBody, sameCategoryKey)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await sameCategoryReplay).rows[0].response, firstCategoryResponse)
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from audit.audit_events where tenant_id=$1 and entity_id=$2 and action='catalog.category.create'",
        [tenant, firstCategoryResponse.categoryId],
      )
    ).rows[0].count,
    1,
  )

  await first.query('begin')
  await first.query("update app.tenants set status='suspended' where id=$1", [tenant])
  const suspendedCategory = categoryCommand(
    second,
    { action: 'create', name: 'Must not exist' },
    'category-suspended-wait',
  ).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await suspendedCategory, 'HCS09')
  await observer.query("update app.tenants set status='active' where id=$1", [tenant])

  const expiryCategory = await newCategory('expiry-wait')
  await observer.query(
    "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '1 second' where tenant_id=$1 and feature_code='catalog'",
    [tenant],
  )
  await first.query('begin')
  await first.query('select 1 from app.product_categories where id=$1 for update', [expiryCategory])
  const expiredCategory = selectedProduct(second, expiryCategory, 'EXPIRED-WAIT').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await delay(1100)
  await first.query('commit')
  assert.equal(await expiredCategory, 'HCS10')
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from app.products where tenant_id=$1 and name='Category EXPIRED-WAIT'",
        [tenant],
      )
    ).rows[0].count,
    0,
  )
  for (const operation of ['create', 'update']) {
    const replayKey = operation === 'create' ? 'category-product-ASSIGN-FIRST' : 'category-update-expiry-replay'
    const updateBody = { name: 'Replay product', categoryId: assignFirstCategory, description: null }
    await observer.query(
      "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '5 seconds' where tenant_id=$1 and feature_code='catalog'",
      [tenant],
    )
    if (operation === 'update')
      await observer.query('select app.update_catalog_product_selected_category($1,$2,$3,$4::jsonb,$5,$5,$5)', [
        actor,
        tenant,
        categoryProduct,
        JSON.stringify(updateBody),
        replayKey,
      ])
    await observer.query(
      "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '1 second' where tenant_id=$1 and feature_code='catalog'",
      [tenant],
    )
    await first.query('begin')
    await first.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${tenant}:catalog.product.${operation}:${replayKey}`,
    ])
    const replay = (
      operation === 'create'
        ? selectedProduct(second, assignFirstCategory, 'ASSIGN-FIRST')
        : second.query('select app.update_catalog_product_selected_category($1,$2,$3,$4::jsonb,$5,$5,$5)', [
            actor,
            tenant,
            categoryProduct,
            JSON.stringify(updateBody),
            replayKey,
          ])
    ).then(
      () => 'unexpected-success',
      (error) => error.code,
    )
    await waitForLock()
    await delay(1100)
    await first.query('commit')
    assert.equal(await replay, 'HCS10', `${operation} historical replay must reject expiry after request-key wait`)
  }
  console.log(
    'Catalog category concurrency passed: archive/assignment admission order, ID-preserving rename, one-effect same-key replay, queued suspension, wallclock expiry and expired create/update historical replay deny writes.',
  )
  await observer.query(
    "update app.tenant_entitlements set ends_at=null where tenant_id=$1 and feature_code='catalog'",
    [tenant],
  )
  const importRaw = {
    filename: 'concurrent-catalog.csv',
    rows: [{ product_name: 'Job only', sku: 'JOB-ONLY', retail_price: '1.00' }],
  }
  const importPlan = [{ rowNumber: 2, issues: [], action: 'create_product', sku: 'JOB-ONLY', retailPriceMinor: 100 }]
  const importKey = 'catalog-import-concurrent-save'
  const saveImport = (client) =>
    client.query('select app.save_catalog_import_job($1,$2,$3::jsonb,$4::jsonb,$5,$5) response', [
      actor,
      tenant,
      JSON.stringify(importRaw),
      JSON.stringify(importPlan),
      importKey,
    ])
  await first.query('begin')
  const importSaved = (await saveImport(first)).rows[0].response
  const importReplay = saveImport(second)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await importReplay).rows[0].response, importSaved)
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from audit.audit_events where tenant_id=$1 and entity_id=$2 and action='catalog.import.prepared'",
        [tenant, importSaved.jobId],
      )
    ).rows[0].count,
    1,
  )
  const cancelImport = (client) =>
    client.query('select app.cancel_catalog_import_job($1,$2,$3,$4) response', [
      actor,
      tenant,
      importSaved.jobId,
      'catalog-import-concurrent-cancel',
    ])
  await first.query('begin')
  await cancelImport(first)
  const cancelReplay = cancelImport(second)
  await waitForLock()
  await first.query('commit')
  assert.equal((await cancelReplay).rows[0].response.state, 'cancelled')
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from audit.audit_events where tenant_id=$1 and entity_id=$2 and action='catalog.import.cancelled'",
        [tenant, importSaved.jobId],
      )
    ).rows[0].count,
    1,
  )
  await observer.query(
    "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '1 second' where tenant_id=$1 and feature_code='catalog'",
    [tenant],
  )
  await first.query('begin')
  await first.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${tenant}:catalog.import.save:${importKey}`,
  ])
  const expiredImport = saveImport(second).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await delay(1100)
  await first.query('commit')
  assert.equal(await expiredImport, 'HCS10')
  assert.equal(
    (
      await observer.query("select count(*)::int count from app.products where tenant_id=$1 and name='Job only'", [
        tenant,
      ])
    ).rows[0].count,
    0,
  )
  console.log(
    'Catalog import job concurrency passed: simultaneous save and cancellation emit once, expiry after request-key wait denies historical save replay, no product posting.',
  )
  await observer.query(
    "update app.tenant_entitlements set ends_at=null where tenant_id=$1 and feature_code='catalog'",
    [tenant],
  )
  const executionRaw = {
    filename: 'execution-race.csv',
    rows: [{ product_name: 'Execution Race', sku: 'EXECUTION-RACE', retail_price: '49.99', unit_cost: '20.01' }],
  }
  const executionPlan = [
    {
      rowNumber: 2,
      issues: [],
      action: 'create_product',
      productId: null,
      variantId: null,
      productSku: 'EXECUTION-RACE',
      name: 'Execution Race',
      description: null,
      categoryId: null,
      categoryName: null,
      variantName: 'Default',
      sku: 'EXECUTION-RACE',
      barcodes: [],
      retailPriceMinor: 4999,
      unitCostMinor: 2001,
      trackInventory: true,
    },
  ]
  const prepareExecution = async (raw, plan, key) =>
    (
      await observer.query('select app.save_catalog_import_job($1,$2,$3::jsonb,$4::jsonb,$5,$5) response', [
        actor,
        tenant,
        JSON.stringify(raw),
        JSON.stringify(plan),
        key,
      ])
    ).rows[0].response.jobId
  const executionJob = await prepareExecution(executionRaw, executionPlan, 'execution-race-prepared-001')
  const executionHash = (
    await observer.query('select app.review_catalog_import($1,$2,$3) response', [actor, tenant, executionJob])
  ).rows[0].response.hash
  const startExecution = (client) =>
    client.query('select app.start_catalog_import($1,$2,$3,$4,$5,$5) response', [
      actor,
      tenant,
      executionJob,
      executionHash,
      'execution-race-confirm-key',
    ])
  await first.query('begin')
  const firstExecution = (await startExecution(first)).rows[0].response
  const startReplay = startExecution(second)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await startReplay).rows[0].response, firstExecution)
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from audit.audit_events where tenant_id=$1 and entity_id=$2 and action='catalog.import.confirmed'",
        [tenant, firstExecution.execution.id],
      )
    ).rows[0].count,
    1,
  )
  const stepExecution = (client, job = executionJob) =>
    client.query('select app.process_catalog_import_group($1,$2,$3,0,$4) response', [
      actor,
      tenant,
      job,
      'execution-race-step',
    ])
  await first.query('begin')
  const firstStep = (await stepExecution(first)).rows[0].response
  const stepReplay = stepExecution(second)
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await stepReplay).rows[0].response, firstStep)
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from app.product_variants where tenant_id=$1 and sku='EXECUTION-RACE'",
        [tenant],
      )
    ).rows[0].count,
    1,
  )
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from audit.audit_events where tenant_id=$1 and entity_id=$2 and action='catalog.import.group_processed'",
        [tenant, firstExecution.execution.id],
      )
    ).rows[0].count,
    1,
  )
  const executionTarget = firstStep.execution.results[0]
  const stalePlan = [
    {
      ...executionPlan[0],
      action: 'update_variant',
      productId: executionTarget.productId,
      variantId: executionTarget.variantId,
      retailPriceMinor: 4501,
    },
  ]
  const staleJob = await prepareExecution(
    { ...executionRaw, rows: [{ ...executionRaw.rows[0], retail_price: '45.01' }] },
    stalePlan,
    'execution-race-stale-001',
  )
  const staleHash = (
    await observer.query('select app.review_catalog_import($1,$2,$3) response', [actor, tenant, staleJob])
  ).rows[0].response.hash
  await observer.query('select app.start_catalog_import($1,$2,$3,$4,$5,$5)', [
    actor,
    tenant,
    staleJob,
    staleHash,
    'execution-race-stale-confirm',
  ])
  await first.query('begin')
  await first.query('update app.product_variants set retail_price=55.01 where tenant_id=$1 and id=$2', [
    tenant,
    executionTarget.variantId,
  ])
  const staleStep = stepExecution(second, staleJob)
  await waitForLock()
  await first.query('commit')
  const staleResult = (await staleStep).rows[0].response.execution
  assert.equal(staleResult.state, 'completed_with_errors')
  assert.equal(staleResult.results[0].errorCode, 'HCIS1')
  assert.equal(
    (
      await observer.query('select retail_price::text value from app.product_variants where id=$1', [
        executionTarget.variantId,
      ])
    ).rows[0].value,
    '55.01',
  )
  await observer.query(
    "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '1 second' where tenant_id=$1 and feature_code='catalog'",
    [tenant],
  )
  await first.query('begin')
  await first.query('select 1 from app.catalog_import_jobs where id=$1 for update', [executionJob])
  const expiredStep = stepExecution(second).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await delay(1100)
  await first.query('commit')
  assert.equal(await expiredStep, 'HCS10')
  await observer.query(
    "update app.tenant_entitlements set ends_at=null where tenant_id=$1 and feature_code='catalog'",
    [tenant],
  )
  await first.query('begin')
  await first.query("update app.tenants set status='suspended' where id=$1", [tenant])
  const suspendedStep = stepExecution(second).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await suspendedStep, 'HCS09')
  await observer.query("update app.tenants set status='active' where id=$1", [tenant])
  console.log(
    'Catalog import execution concurrency passed: confirmation and same-index posting emit once, post-wait price edits become failed results without overwrite, expired and suspended historical replay denied.',
  )
  // Retail discount metadata is a separate private management surface. No sales
  // are posted here; use the same disposable loopback fixture and lock observer.
  const discountCommand = (client, body, key) =>
    client.query('select app.manage_retail_discount($1,$2,$3::jsonb,$4,$4) response', [
      actor,
      tenant,
      JSON.stringify(body),
      key,
    ])
  const discountBody = {
    action: 'create',
    name: 'Concurrent retail promotion',
    value: { kind: 'fixed', amountMinor: 100 },
    status: 'inactive',
  }
  await first.query('begin')
  const createdDiscount = (await discountCommand(first, discountBody, 'discount-concurrent-create')).rows[0].response
  const discountReplay = discountCommand(second, discountBody, 'discount-concurrent-create')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await discountReplay).rows[0].response, createdDiscount)
  assert.equal(
    (
      await observer.query(
        'select count(*)::int count from app.retail_discount_versions where tenant_id=$1 and discount_id=$2',
        [tenant, createdDiscount.id],
      )
    ).rows[0].count,
    1,
  )

  const editDiscount = {
    action: 'update',
    discountId: createdDiscount.id,
    expectedRevision: 1,
    name: 'Updated retail promotion',
    value: { kind: 'percent', rateBps: 1250 },
    status: 'active',
  }
  await first.query('begin')
  await discountCommand(first, editDiscount, 'discount-concurrent-edit-one')
  const staleDiscount = discountCommand(second, editDiscount, 'discount-concurrent-edit-two').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await staleDiscount, 'HCDI4')
  assert.equal(
    (
      await observer.query(
        'select count(*)::int count from app.retail_discount_versions where tenant_id=$1 and discount_id=$2',
        [tenant, createdDiscount.id],
      )
    ).rows[0].count,
    2,
  )

  await first.query('begin')
  await first.query("update app.tenants set status='suspended' where id=$1", [tenant])
  const suspendedDiscount = discountCommand(second, discountBody, 'discount-concurrent-create').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await suspendedDiscount, 'HCDI0')
  await observer.query("update app.tenants set status='active' where id=$1", [tenant])

  await observer.query(
    "update app.tenant_entitlements set ends_at=clock_timestamp()+interval '1 second' where tenant_id=$1 and feature_code='sales'",
    [tenant],
  )
  await first.query('begin')
  await first.query('select 1 from app.retail_discounts where tenant_id=$1 and id=$2 for update', [
    tenant,
    createdDiscount.id,
  ])
  const expiredDiscount = discountCommand(
    second,
    { ...editDiscount, expectedRevision: 2 },
    'discount-expired-edit',
  ).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await delay(1100)
  await first.query('commit')
  assert.equal(await expiredDiscount, 'HCDI1')
  assert.equal(
    (
      await observer.query('select revision from app.retail_discounts where tenant_id=$1 and id=$2', [
        tenant,
        createdDiscount.id,
      ])
    ).rows[0].revision,
    2,
  )
  await observer.query("update app.tenant_entitlements set ends_at=null where tenant_id=$1 and feature_code='sales'", [
    tenant,
  ])
  console.log(
    'Retail discount concurrency passed: same-key create emits once, stale competing edit denied, queued suspension and row-lock expiry deny completed replay/new effects.',
  )
  // Real discounted POS commands on the same disposable loopback database.
  const [posEmployee, posRegister, posDevice, posProduct, posVariant] = Array.from({ length: 5 }, () => randomUUID())
  const posHash = randomUUID().replaceAll('-', '').repeat(2)
  const deviceHash = randomUUID().replaceAll('-', '').repeat(2)
  await observer.query(
    "insert into app.employees(id,tenant_id,employee_code,display_name) values($1,$2,'DISCOUNT-RACE','Discount race cashier')",
    [posEmployee, tenant],
  )
  await observer.query('insert into app.employee_locations(tenant_id,employee_id,location_id) values($1,$2,$3)', [
    tenant,
    posEmployee,
    location,
  ])
  const posRole = (await observer.query("select id from app.roles where tenant_id=$1 and code='cashier'", [tenant]))
    .rows[0].id
  await observer.query('insert into app.employee_roles(tenant_id,employee_id,role_id) values($1,$2,$3)', [
    tenant,
    posEmployee,
    posRole,
  ])
  await observer.query(
    "insert into app.registers(id,tenant_id,location_id,name,code) values($1,$2,$3,'Discount race register','DISCOUNT-RACE')",
    [posRegister, tenant, location],
  )
  await observer.query(
    "insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values($1,$2,$3,$4,'Discount race device','active',$5,clock_timestamp(),$6)",
    [posDevice, tenant, posRegister, location, deviceHash, actor],
  )
  await observer.query(
    "insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 hour')",
    [tenant, posDevice, posRegister, location, posEmployee, posHash],
  )
  await observer.query(
    "insert into app.products(id,tenant_id,name,created_by) values($1,$2,'Discount race stock',$3)",
    [posProduct, tenant, actor],
  )
  await observer.query(
    "insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,track_inventory,created_by) values($1,$2,$3,'Each','POS-DISCOUNT-RACE',100,50,true,$4)",
    [posVariant, tenant, posProduct, actor],
  )
  await observer.query(
    'insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values($1,$2,$3,10,50)',
    [tenant, location, posVariant],
  )
  const posConfig = (
    await observer.query(
      'select app.manage_retail_discount($1,$2,\'{"action":"create","name":"POS Race Discount","value":{"kind":"fixed","amountMinor":100},"status":"active"}\', \'pos-discount-race-config\',\'pos-race\') response',
      [actor, tenant],
    )
  ).rows[0].response
  const posOpen = (
    await observer.query('select app.open_pos_register_session($1,100000,$2,$2,$2) response', [
      posHash,
      'pos-discount-race-open',
    ])
  ).rows[0].response
  const cashMethod = (
    await observer.query(
      "select id from app.payment_methods where tenant_id=$1 and method_type='cash' and is_active limit 1",
      [tenant],
    )
  ).rows[0].id
  const posSelection = { discountId: posConfig.id, expectedRevision: 1 }
  const posSale = (client, key, selection = posSelection, sessionHash = posHash) =>
    client.query(
      "select app.complete_pos_discounted_sale($1,$2::jsonb,$3::jsonb,null,'retail',$4::jsonb,$5,$5) response",
      [
        sessionHash,
        JSON.stringify([{ variantId: posVariant, quantityMilli: 1000 }]),
        JSON.stringify([{ paymentMethodId: cashMethod, amountCentavos: 9900, tenderedCentavos: 10000 }]),
        JSON.stringify(selection),
        key,
      ],
    )
  const posSnapshot = async () =>
    (
      await observer.query(
        `select jsonb_build_object(
    'sales',(select count(*) from app.sales where tenant_id=$1),
    'snapshots',(select count(*) from app.pos_sale_discount_snapshots where tenant_id=$1),
    'payments',(select count(*) from app.sale_payments where tenant_id=$1),
    'cash',(select coalesce(sum(amount),0) from app.cash_movements where tenant_id=$1 and movement_type='cash_sale'),
    'stock',(select round(on_hand*1000) from app.inventory_balances where tenant_id=$1 and location_id=$2 and variant_id=$3),
    'movements',(select count(*) from app.inventory_movements where tenant_id=$1 and variant_id=$3),
    'requests',(select count(*) from app.idempotency_records where tenant_id=$1 and operation='pos-sale.complete'),
    'receiptSequence',(select coalesce(sum(last_number),0) from app.receipt_counters where tenant_id=$1)
  ) state`,
        [tenant, location, posVariant],
      )
    ).rows[0].state
  const beforePos = await posSnapshot()
  await first.query('begin')
  const firstPos = (await posSale(first, 'pos-discount-race-sale')).rows[0].response
  const posReplay = posSale(second, 'pos-discount-race-sale')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await posReplay).rows[0].response, firstPos)
  const afterPos = await posSnapshot()
  assert.equal(afterPos.sales, beforePos.sales + 1)
  assert.equal(afterPos.snapshots, beforePos.snapshots + 1)
  assert.equal(afterPos.stock, 9000)
  assert.equal(firstPos.totalCentavos, 9900)
  await first.query('begin')
  await first.query('select app.manage_retail_discount($1,$2,$3::jsonb,$4,$4)', [
    actor,
    tenant,
    JSON.stringify({
      action: 'update',
      discountId: posConfig.id,
      expectedRevision: 1,
      name: 'POS Race Updated',
      value: { kind: 'fixed', amountMinor: 100 },
      status: 'active',
    }),
    'pos-discount-race-edit',
  ])
  const stalePos = posSale(second, 'pos-discount-race-stale').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await stalePos, 'HCDP1')
  assert.deepEqual(await posSnapshot(), afterPos)
  await first.query('begin')
  await first.query(
    "delete from app.role_permissions where tenant_id=$1 and role_id=$2 and permission_code='discounts.apply'",
    [tenant, posRole],
  )
  const revokedPos = posSale(second, 'pos-discount-race-sale').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await revokedPos, 'HCS93')
  assert.deepEqual(await posSnapshot(), afterPos)
  await observer.query(
    "insert into app.role_permissions(tenant_id,role_id,permission_code) values($1,$2,'discounts.apply')",
    [tenant, posRole],
  )
  assert.deepEqual((await posSale(observer, 'pos-discount-race-sale')).rows[0].response, firstPos)
  await observer.query(
    "update app.pos_employee_sessions set expires_at=clock_timestamp()+interval '1 second' where token_hash=$1",
    [posHash],
  )
  await first.query('begin')
  await first.query('select 1 from app.register_sessions where tenant_id=$1 and id=$2 for update', [
    tenant,
    posOpen.registerSessionId,
  ])
  const expiredPos = posSale(second, 'pos-discount-race-expired', { ...posSelection, expectedRevision: 2 }).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await delay(1100)
  await first.query('commit')
  assert.equal(await expiredPos, 'HCS90')
  assert.deepEqual(await posSnapshot(), afterPos)
  await observer.query(
    "update app.pos_employee_sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=$1",
    [posHash],
  )
  await first.query('begin')
  await first.query("update app.tenants set status='suspended' where id=$1", [tenant])
  const suspendedPos = posSale(second, 'pos-discount-race-sale').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await suspendedPos, 'HCS90')
  assert.deepEqual(await posSnapshot(), afterPos)
  console.log(
    'POS discount concurrency passed: same-key single net sale, queued definition edit, revoked cashier replay, expired register-lock waiter and suspended tenant all preserve exact financial/stock effects.',
  )
  await observer.query("update app.tenants set status='active' where id=$1", [tenant])
  const reversePos = (client, key, saleId = firstPos.saleId) =>
    client.query(
      "select app.reverse_sale($1,$2,$3,'void',null,'Disposable net discount reversal',$4,'ignored-client-hash',$4) response",
      [actor, tenant, saleId, key],
    )
  const refundSnapshot = async () =>
    (
      await observer.query(
        `select jsonb_build_object(
    'refunds',(select count(*) from app.refunds where tenant_id=$1),
    'refundAmount',(select coalesce(sum(amount),0) from app.refunds where tenant_id=$1),
    'reversals',(select count(*) from app.payment_reversals where tenant_id=$1),
    'cash',(select coalesce(sum(amount),0) from app.cash_movements where tenant_id=$1 and movement_type='cash_refund'),
    'stock',(select on_hand from app.inventory_balances where tenant_id=$1 and location_id=$2 and variant_id=$3),
    'stockMovements',(select count(*) from app.inventory_movements where tenant_id=$1 and variant_id=$3),
    'requests',(select count(*) from app.idempotency_records where tenant_id=$1 and operation='sale.void')
  ) state`,
        [tenant, location, posVariant],
      )
    ).rows[0].state
  const beforeRefund = await refundSnapshot()
  await first.query('begin')
  const firstRefund = (await reversePos(first, 'pos-refund-same-key')).rows[0].response
  const sameRefund = reversePos(second, 'pos-refund-same-key')
  await waitForLock()
  await first.query('commit')
  assert.deepEqual((await sameRefund).rows[0].response, firstRefund)
  assert.equal(firstRefund.amountCentavos, 9900)
  const afterRefund = await refundSnapshot()
  assert.equal(afterRefund.refunds, beforeRefund.refunds + 1)
  assert.equal(afterRefund.reversals, beforeRefund.reversals + 1)
  assert.equal(afterRefund.stock, beforeRefund.stock + 1)
  assert.equal(afterRefund.cash, beforeRefund.cash - 99)
  const refundFixtureSale = async (key) => {
    // Tenant suspension permanently revokes the earlier POS session. Each new
    // positive fixture uses a fresh synthetic sign-in, never revives old tokens.
    const freshHash = randomUUID().replaceAll('-', '').repeat(2)
    await observer.query(
      "insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 hour')",
      [tenant, posDevice, posRegister, location, posEmployee, freshHash],
    )
    return (await posSale(observer, key, { ...posSelection, expectedRevision: 2 }, freshHash)).rows[0].response
  }
  const secondRefundSale = await refundFixtureSale('pos-refund-race-second-sale')
  await first.query('begin')
  await reversePos(first, 'pos-refund-distinct-first', secondRefundSale.saleId)
  const competingRefund = reversePos(second, 'pos-refund-distinct-second', secondRefundSale.saleId).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await competingRefund, 'HCSA3')
  const afterCompetition = await refundSnapshot()
  assert.equal(afterCompetition.refunds, afterRefund.refunds + 1)
  assert.equal(afterCompetition.stock, afterRefund.stock)
  await first.query('begin')
  await first.query("update app.tenants set status='suspended' where id=$1", [tenant])
  const suspendedRefund = reversePos(second, 'pos-refund-same-key').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await suspendedRefund, 'HCSA0')
  assert.deepEqual(await refundSnapshot(), afterCompetition)
  await observer.query("update app.tenants set status='active' where id=$1", [tenant])
  const closingRefundSale = await refundFixtureSale('pos-refund-register-sale')
  const beforeClose = await refundSnapshot()
  await first.query('begin')
  await first.query(
    "update app.register_sessions set status='closed',expected_cash=0,counted_cash=0,variance=0,closed_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [tenant, posOpen.registerSessionId],
  )
  const closingRefund = reversePos(second, 'pos-refund-closing-denial', closingRefundSale.saleId).then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await closingRefund, 'HCSA6')
  assert.deepEqual(await refundSnapshot(), beforeClose)
  assert.deepEqual((await reversePos(observer, 'pos-refund-same-key')).rows[0].response, firstRefund)
  await first.query('begin')
  await first.query("update app.tenant_memberships set status='suspended' where tenant_id=$1 and user_id=$2", [
    tenant,
    actor,
  ])
  const revokedRefund = reversePos(second, 'pos-refund-same-key').then(
    () => 'unexpected-success',
    (error) => error.code,
  )
  await waitForLock()
  await first.query('commit')
  assert.equal(await revokedRefund, 'HCSA0')
  assert.deepEqual(await refundSnapshot(), beforeClose)
  console.log(
    'Discounted refund concurrency passed: same-key single payout/restock, competing distinct-key denial, queued tenant suspension, closing-register denial, and revoked-membership replay denial.',
  )
} finally {
  // Release any held fixture transaction before closing another session waiting on it.
  await first.query('rollback').catch(() => {})
  await second.query('rollback').catch(() => {})
  await Promise.all(clients.map((client) => client.end()))
}
