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
} finally {
  // Release any held fixture transaction before closing another session waiting on it.
  await first.query('rollback').catch(() => {})
  await second.query('rollback').catch(() => {})
  await Promise.all(clients.map((client) => client.end()))
}
