/**
 * Marketing copy for hustlercentral.com. All claims come from the product spec.
 * Rules: no invented statistics, testimonials or prices. Unknown facts stay as [PLACEHOLDER] until the team supplies them.
 */
export const receipt = {
  header: 'Main Branch, Register 1',
  number: 'HCS-000482',
  lines: [
    { name: 'Cold brew 500 ml', qty: '2 × ₱140.00', amount: '₱280.00' },
    { name: 'Ube pandesal, pack of 6', qty: '1 × ₱95.00', amount: '₱95.00' },
    { name: 'Brown sugar 1 kg', qty: '1 × ₱78.00', amount: '₱78.00' },
  ],
  total: '₱453.00',
  cash: '₱500.00',
  change: '₱47.00',
  updates: [
    { label: 'Stock:', text: 'cold brew −2, ube pandesal −1, brown sugar −1 at Main Branch.' },
    { label: 'Cash drawer:', text: '₱453.00 added to Register 1.' },
    { label: 'Cost:', text: "saved at today's average cost, so old reports never shift." },
    { label: 'Reports:', text: 'gross profit updated on the dashboard.' },
  ],
}

export const verbs = [
  {
    name: 'Sell',
    text: 'Ring up sales at the counter with barcode scan, split payments, and wholesale prices that apply themselves when a customer buys enough.',
  },
  {
    name: 'Control',
    text: 'Keep one stock count per location, changed only by recorded movements. Nothing edits a balance directly.',
  },
  {
    name: 'Protect',
    text: 'Refunds, voids and big discounts wait for a manager PIN. A completed sale is reversed, never deleted.',
  },
  {
    name: 'Analyze',
    text: 'Gross profit uses the cost at the time of sale, so last month stays true even after your supplier raises prices.',
  },
  {
    name: 'Execute',
    text: 'Raise purchase orders, restock branches and send transfers, then check what actually arrived.',
  },
  {
    name: 'Grow',
    text: 'Add branches, a warehouse, an online store and marketplaces when the business is ready, not before.',
  },
]

export const posPoints = [
  'Employee PIN sign-in on a registered device',
  'Open and close the register with a cash count',
  'Refunds, returns, exchanges and voids with manager approval',
  'Offline and syncing status always visible',
]
export const boPoints = [
  'Products, variants, barcodes and movement history',
  'Purchasing, suppliers, transfers and receiving',
  'Daily business close and fund tracking',
  'Approvals, alerts, reports and a full audit trail',
]

export const freeCore = [
  'POS with employee PIN access',
  'Products and basic inventory',
  'Basic sales and gross profit reports',
  'Customers, with optional loyalty',
  'Capital/COGS Fund and Operating Fund',
  'Expenses and daily business close',
  'Basic approvals, alerts and audit trail',
  'Basic import and export',
  'Owner, Admin, Manager, Cashier and Inventory Staff roles',
]

/** price stays a placeholder until pricing is decided. */
export const modules = [
  { name: 'Advanced Inventory', text: 'Deeper stock analytics and controls.', price: '[PRICE]' },
  { name: 'Warehouse', text: 'Central receiving and restocking for branches.', price: '[PRICE]' },
  { name: 'Time Clock', text: 'Clock in, breaks and attendance hours.', price: '[PRICE]' },
  { name: 'Online Store', text: 'Sell on your own storefront from the same stock.', price: '[PRICE]' },
  { name: 'Shopee and TikTok Shop', text: 'Marketplace orders and settlements in one place.', price: '[PRICE]' },
  { name: 'Advanced Wholesale', text: 'Sales orders, payment terms and partial fulfillment.', price: '[PRICE]' },
  { name: 'Finance Pro', text: 'Custom funds, tax reserve and bank reconciliation.', price: '[PRICE]' },
  { name: 'Advanced Reporting', text: 'Saved and scheduled reports with custom exports.', price: '[PRICE]' },
]

export const doubts = [
  {
    q: 'What if someone changes an old sale?',
    a: 'They cannot. A completed sale is never overwritten or deleted. A refund, return or void creates a linked reversal, and the original stays in your history.',
  },
  {
    q: 'What if the internet drops at the counter?',
    a: 'The register keeps selling and shows Offline or Syncing on screen the whole time. Each sale is sent once, even if the connection flickers.',
  },
  {
    q: 'What if the cash drawer is short?',
    a: 'Closing the register compares counted cash to expected cash. A large difference needs a manager to approve and raises an alert. The register never closes quietly.',
  },
]

export const steps = [
  { title: 'Create your business', text: 'Add your business and your main location.' },
  { title: 'Add products and stock', text: 'Type them in or import a CSV, then set opening stock.' },
  { title: 'Set up payments and funds', text: 'Choose payment methods and your Capital/COGS and Operating funds.' },
  { title: 'Add your team', text: 'Create employees with PINs and link a register.' },
  { title: 'Ring a test sale', text: 'Run a guided sale, then go live.' },
]

export const quotePlaceholder = {
  quote: '[Customer quote goes here after your first pilot stores go live]',
  attribution: '[Store name, branch and location]',
}
