import {
  approvalCenterSchema,
  approvalDecisionResponseSchema,
  approvalPolicyUpdateResponseSchema,
  apiErrorResponseSchema,
  catalogProductCreateResponseSchema,
  catalogProductUpdateResponseSchema,
  catalogResponseSchema,
  catalogVariantCreateResponseSchema,
  catalogVariantDeactivateResponseSchema,
  catalogVariantUpdateResponseSchema,
  healthResponseSchema,
  inventoryAdjustmentCreateResponseSchema,
  inventoryMovementContextSchema,
  inventoryStockContextSchema,
  openingInventoryContextSchema,
  openingInventoryCreateResponseSchema,
  purchaseOrderCreateResponseSchema,
  purchaseReceiptResponseSchema,
  purchasingContextSchema,
  supplierCreateResponseSchema,
  transferContextSchema,
  transferCreateResponseSchema,
  employeeCreateResponseSchema,
  paymentMethodCreateResponseSchema,
  posDeviceActivateResponseSchema,
  posDeviceActivationCreateResponseSchema,
  posDeviceContextSchema,
  posPinLoginResponseSchema,
  posCashSaleCompleteResponseSchema,
  posRegisterOpenResponseSchema,
  posSalesContextSchema,
  salesContextSchema,
  saleReceiptDetailSchema,
  saleReversalResponseSchema,
  registerOperationsContextSchema,
  registerSessionCloseResponseSchema,
  registerSessionOpenResponseSchema,
  workforceContextSchema,
  onboardingResponseSchema,
  sessionContextResponseSchema,
  customerCreateResponseSchema,
  customerDetailSchema,
  customerNoteResponseSchema,
  customerUpdateResponseSchema,
  customersContextSchema,
  posCustomerCreateResponseSchema,
  posCustomerSearchResponseSchema,
  loyaltyContextSchema,
  loyaltyPolicyUpdateResponseSchema,
  dashboardContextSchema,
  inventoryReportContextSchema,
  salesReportContextSchema,
  alertCenterSchema,
  alertStatusUpdateResponseSchema,
  auditActivityContextSchema,
  notificationCenterSchema,
  notificationReadResponseSchema,
  notificationsReadAllResponseSchema,
  type AlertStatusUpdateRequest,
  type LoyaltyPolicyUpdateRequest,
} from '@hcs/contracts'
import { describe, expect, it, vi } from 'vitest'

import { app, createApp } from './app'

const bindings = { ENVIRONMENT: 'test' }
const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const locationId = '30000000-0000-4000-8000-000000000001'
const bootstrapTenant = vi.fn(async () => ({ tenantId, mainLocationId: locationId, status: 'setup' as const }))
const featureOptions = [
  { code: 'catalog' as const, name: 'Products and catalog', enabled: true, required: true },
  { code: 'sales' as const, name: 'Sales and checkout', enabled: true, required: true },
  { code: 'reports' as const, name: 'Basic reports', enabled: true, required: true },
  { code: 'inventory' as const, name: 'Inventory tracking', enabled: false, required: false },
]
const loadOnboarding = vi.fn(async () => ({
  hasMainLocation: true,
  hasProducts: false,
  hasOpeningInventory: false,
  businessQuestionsComplete: false,
  featureSelectionComplete: false,
  businessProfile: null,
  featureOptions,
}))
const updateOnboarding = vi.fn(async (_userId, _tenantId, request) => ({
  step: request.step,
  status: 'complete' as const,
  ...(request.step === 'feature_selection' ? { enabledFeatures: request.enabledFeatures } : {}),
}))
const loadCatalog = vi.fn(async () => ({ categories: [], products: [] }))
const createCatalogProduct = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const createCatalogVariant = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000002',
  status: 'created' as const,
}))
const updateCatalogProduct = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  status: 'updated' as const,
}))
const updateCatalogVariant = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000002',
  status: 'updated' as const,
}))
const deactivateCatalogVariant = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000002',
  status: 'deactivated' as const,
}))
const loadOpeningInventory = vi.fn(async () => ({
  locations: [{ id: locationId, code: 'MAIN', name: 'Main Store' }],
  selectedLocationId: locationId,
  items: [
    {
      productId: '40000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantId: '50000000-0000-4000-8000-000000000001',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      defaultUnitCostMinor: 55_000,
      openingUnitCostMinor: null,
      openingQuantityMilli: 0,
      onHandMilli: 0,
      opened: false,
    },
  ],
}))
const recordOpeningInventory = vi.fn(async () => ({
  locationId,
  movementCount: 1,
  status: 'recorded' as const,
}))
const loadInventoryStock = vi.fn(async () => ({
  locations: [{ id: locationId, code: 'MAIN', name: 'Main Store' }],
  selectedLocationId: locationId,
  items: [
    {
      productId: '40000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantId: '50000000-0000-4000-8000-000000000001',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      barcodeCount: 1,
      onHandMilli: 12_500,
      reservedMilli: 500,
      availableMilli: 12_000,
      inTransitMilli: 0,
      damagedMilli: 0,
      averageUnitCostMinor: 55_000,
      hasBalance: true,
    },
  ],
}))
const loadInventoryMovements = vi.fn(async () => ({
  locationId,
  items: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      productId: '40000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantId: '50000000-0000-4000-8000-000000000001',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      movementType: 'OPENING_BALANCE' as const,
      quantityMilli: 12_500,
      unitCostMinor: 55_000,
      sourceType: 'onboarding_opening_inventory',
      sourceReference: 'opening-inventory-001',
      actorLabel: 'Business owner',
      occurredAt: '2026-09-24T10:00:00.000Z',
      balanceAfterMilli: 12_500,
    },
  ],
}))
const recordInventoryAdjustment = vi.fn(async () => ({
  movementId: '60000000-0000-4000-8000-000000000001',
  locationId,
  variantId: '50000000-0000-4000-8000-000000000001',
  quantityMilli: -500,
  onHandMilli: 11_500,
  status: 'recorded' as const,
}))
const loadApprovalCenter = vi.fn(async () => ({
  canManage: false,
  inventoryAdjustmentThresholdMilli: 10_000,
  requests: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      subjectType: 'inventory_adjustment' as const,
      status: 'pending' as const,
      locationId,
      locationName: 'Main Store',
      variantId: '50000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      quantityMilli: -12_000,
      unitCostMinor: null,
      reason: 'Cycle count correction',
      requestedByLabel: 'Business owner',
      requestedAt: '2026-09-24T10:00:00.000Z',
      decidedByLabel: null,
      decidedAt: null,
      decisionNote: null,
    },
  ],
}))
const updateApprovalPolicy = vi.fn(async (_userId, _tenantId, request) => ({
  inventoryAdjustmentThresholdMilli: request.inventoryAdjustmentThresholdMilli,
  status: 'updated' as const,
}))
const decideApprovalRequest = vi.fn(async (_userId, _tenantId, approvalRequestId, request) => ({
  approvalRequestId,
  movementId: request.decision === 'approved' ? '60000000-0000-4000-8000-000000000002' : null,
  status: request.decision,
}))
const loadPurchasing = vi.fn(async () => ({ suppliers: [], locations: [], variants: [], orders: [] }))
const createSupplier = vi.fn(async () => ({
  supplierId: '80000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const createPurchaseOrder = vi.fn(async () => ({
  purchaseOrderId: '90000000-0000-4000-8000-000000000001',
  status: 'draft' as const,
  lineCount: 1,
}))
const sendPurchaseOrder = vi.fn(async (_userId, _tenantId, purchaseOrderId) => ({
  purchaseOrderId,
  status: 'ordered' as const,
}))
const receivePurchaseOrder = vi.fn(async (_userId, _tenantId, purchaseOrderId) => ({
  purchaseReceiptId: 'a0000000-0000-4000-8000-000000000001',
  purchaseOrderId,
  status: 'received' as const,
  lineCount: 1,
}))
const loadTransfers = vi.fn(async () => ({ locations: [], variants: [], transfers: [] }))
const createTransfer = vi.fn(async () => ({
  stockTransferId: 'b0000000-0000-4000-8000-000000000001',
  status: 'draft' as const,
  itemCount: 1,
}))
const dispatchTransfer = vi.fn(async (_userId, _tenantId, id) => ({
  stockTransferId: id,
  status: 'dispatched' as const,
}))
const receiveTransfer = vi.fn(async (_userId, _tenantId, id) => ({
  stockTransferId: id,
  status: 'received' as const,
  itemCount: 1,
}))
const loadWorkforce = vi.fn(async () => ({ locations: [], roles: [], employees: [], registers: [] }))
const createLocation = vi.fn(async () => ({ locationId, status: 'created' as const }))
const createEmployee = vi.fn(async () => ({
  employeeId: 'c0000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const createRegister = vi.fn(async () => ({
  registerId: 'd0000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const loadRegisterOperations = vi.fn(async () => ({
  paymentMethods: [],
  employees: [],
  registers: [],
  recentSessions: [],
}))
const createPaymentMethod = vi.fn(async () => ({
  paymentMethodId: 'e0000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const openRegisterSession = vi.fn(async () => ({
  registerSessionId: 'f0000000-0000-4000-8000-000000000001',
  status: 'open' as const,
}))
const closeRegisterSession = vi.fn(async (_userId, _tenantId, sessionId, request) => ({
  registerSessionId: sessionId,
  status: 'closed' as const,
  expectedCashCentavos: request.countedCashCentavos,
  countedCashCentavos: request.countedCashCentavos,
  varianceCentavos: 0,
}))
const deviceId = '11000000-0000-4000-8000-000000000001'
const registerId = 'd0000000-0000-4000-8000-000000000001'
const employeeId = 'c0000000-0000-4000-8000-000000000001'
const loadPosDevices = vi.fn(async () => ({
  registers: [
    {
      id: registerId,
      code: 'REG-1',
      name: 'Register 1',
      locationId,
      locationName: 'Main Store',
      status: 'active' as const,
    },
  ],
  devices: [],
}))
const createPosDeviceActivation = vi.fn(async () => ({
  deviceId,
  activationExpiresAt: '2026-09-25T01:15:00.000Z',
  status: 'pending' as const,
}))
const activatePosDevice = vi.fn(async () => ({
  status: 'active' as const,
  device: {
    id: deviceId,
    name: 'Front counter POS',
    tenantName: 'Sample Store',
    locationId,
    locationName: 'Main Store',
    registerId,
    registerName: 'Register 1',
  },
}))
const authenticatePosEmployee = vi.fn(async () => ({
  status: 'authenticated' as const,
  expiresAt: '2026-09-25T13:00:00.000Z',
  employee: { id: employeeId, employeeCode: 'EMP-001', displayName: 'Cashier One' },
  device: {
    id: deviceId,
    name: 'Front counter POS',
    tenantId,
    tenantName: 'Sample Store',
    locationId,
    locationName: 'Main Store',
    registerId,
    registerName: 'Register 1',
  },
}))
const posContext = {
  employee: { id: employeeId, employeeCode: 'EMP-001', displayName: 'Cashier One' },
  device: {
    id: deviceId,
    name: 'Front counter POS',
    tenantId,
    tenantName: 'Sample Store',
    locationId,
    locationName: 'Main Store',
    registerId,
    registerName: 'Register 1',
  },
  registerSession: null,
  categories: ['Shirts'],
  items: [
    {
      variantId: '50000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      barcode: '12345',
      category: 'Shirts',
      retailPriceCentavos: 89900,
      availableMilli: 10000,
      trackInventory: true,
    },
  ],
  paymentMethods: [{ id: 'e0000000-0000-4000-8000-000000000001', code: 'cash', name: 'Cash', type: 'cash' as const }],
}
const loadPosSalesContext = vi.fn(async (_sessionTokenHash: string, _bindings: unknown) => posContext)
const openPosRegisterSession = vi.fn(async () => ({
  registerSessionId: 'f0000000-0000-4000-8000-000000000001',
  status: 'open' as const,
  openedAt: '2026-09-25T02:00:00.000Z',
  openingCashCentavos: 100000,
}))
const completePosCashSale = vi.fn(async () => ({
  saleId: '12000000-0000-4000-8000-000000000001',
  receiptNumber: 'MAIN-20260925-000001',
  status: 'completed' as const,
  subtotalCentavos: 89900,
  totalCentavos: 89900,
  cashReceivedCentavos: 100000,
  changeCentavos: 10100,
  completedAt: '2026-09-25T02:05:00.000Z',
  loyaltyEarnedPoints: 0,
  loyaltyBalancePoints: null,
}))
const loadSales = vi.fn(async () => ({ sales: [] }))
const saleReceipt = {
  id: '12000000-0000-4000-8000-000000000001',
  receiptNumber: 'MAIN-20260925-000001',
  status: 'completed' as const,
  locationName: 'Main Store',
  registerName: 'Register 1',
  employeeName: 'Cashier One',
  loyaltyEarnedPoints: 0,
  loyaltyReversedPoints: 0,
  completedAt: '2026-09-25T02:05:00.000Z',
  subtotalCentavos: 89_900,
  discountCentavos: 0,
  taxCentavos: 0,
  totalCentavos: 89_900,
  refundedCentavos: 0,
  refundableCentavos: 89_900,
  canReverse: true,
  reversalBlockedReason: null,
  lines: [
    {
      id: '13000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      quantityMilli: 1000,
      refundedQuantityMilli: 0,
      refundableQuantityMilli: 1000,
      unitPriceCentavos: 89_900,
      lineTotalCentavos: 89_900,
    },
  ],
  payments: [
    {
      id: '14000000-0000-4000-8000-000000000001',
      methodName: 'Cash',
      methodType: 'cash' as const,
      amountCentavos: 89_900,
      tenderedCentavos: 100_000,
      changeCentavos: 10_100,
      refundedCentavos: 0,
    },
  ],
  reversals: [],
}
const loadSaleReceipt = vi.fn(async () => saleReceipt)
const refundSale = vi.fn(async () => ({
  reversalId: '15000000-0000-4000-8000-000000000001',
  saleId: saleReceipt.id,
  receiptNumber: saleReceipt.receiptNumber,
  type: 'refund' as const,
  saleStatus: 'refunded' as const,
  amountCentavos: 89_900,
  completedAt: '2026-09-25T03:00:00.000Z',
}))
const voidSale = vi.fn(async () => ({
  reversalId: '16000000-0000-4000-8000-000000000001',
  saleId: saleReceipt.id,
  receiptNumber: saleReceipt.receiptNumber,
  type: 'void' as const,
  saleStatus: 'voided' as const,
  amountCentavos: 89_900,
  completedAt: '2026-09-25T03:00:00.000Z',
}))
const customerId = '17000000-0000-4000-8000-000000000001'
const customerGroupId = '18000000-0000-4000-8000-000000000001'
const customerContext = {
  canManage: true,
  groups: [
    { id: customerGroupId, code: 'retail', name: 'Retail customers', kind: 'standard' as const, isActive: true },
  ],
  customers: [],
}
const loadCustomers = vi.fn(async () => customerContext)
const customerDetail = {
  id: customerId,
  customerNumber: 'CUST-000001',
  fullName: 'Maria Santos',
  email: 'maria@example.com',
  phone: null,
  customerGroupId,
  customerType: 'standard' as const,
  emailMarketingConsent: false,
  smsMarketingConsent: false,
  consentUpdatedAt: null,
  status: 'active' as const,
  origin: 'backoffice' as const,
  createdAt: '2026-09-25T04:00:00.000Z',
  updatedAt: '2026-09-25T04:00:00.000Z',
  canManage: true,
  totalSpendCentavos: 0,
  visitCount: 0,
  loyalty: {
    enabled: false,
    balancePoints: 0,
    lifetimeEarnedPoints: 0,
    lifetimeReversedPoints: 0,
    transactions: [],
  },
  purchases: [],
  notes: [],
}
const loadCustomer = vi.fn(async () => customerDetail)
const createCustomer = vi.fn(async () => ({ customerId, customerNumber: 'CUST-000001', status: 'created' as const }))
const updateCustomer = vi.fn(async () => ({ customerId, status: 'updated' as const }))
const addCustomerNote = vi.fn(async () => ({
  noteId: '19000000-0000-4000-8000-000000000002',
  customerId,
  status: 'created' as const,
}))
const searchPosCustomers = vi.fn(async () => ({ customers: [] }))
const createPosCustomer = vi.fn(async () => ({
  customerId,
  customerNumber: 'CUST-000001',
  fullName: 'Maria Santos',
  email: 'maria@example.com',
  phone: null,
  customerType: 'standard' as const,
  loyaltyEnabled: false,
  loyaltyBalancePoints: 0,
  status: 'created' as const,
}))
const loyaltyContext = {
  policy: { enabled: false, spendPerPointCentavos: null, updatedAt: '2026-09-25T04:00:00.000Z' },
  canManage: true,
  summary: { memberCount: 0, outstandingPoints: 0, lifetimeEarnedPoints: 0, lifetimeReversedPoints: 0 },
  recentTransactions: [],
}
const loadLoyalty = vi.fn(async () => loyaltyContext)
const updateLoyaltyPolicy = vi.fn(async (_userId, _tenantId, request: LoyaltyPolicyUpdateRequest) => ({
  enabled: request.enabled,
  spendPerPointCentavos: request.spendPerPointCentavos,
  status: 'updated' as const,
}))
const reportScope = {
  from: '2026-09-01',
  to: '2026-09-25',
  locationId: null,
  channel: 'all' as const,
  timezone: 'Asia/Manila',
  generatedAt: '2026-09-25T05:00:00.000Z',
}
const reportSummary = {
  grossSalesCentavos: 100_000,
  refundsCentavos: 10_000,
  netSalesCentavos: 90_000,
  cogsCentavos: 40_000,
  grossProfitCentavos: 50_000,
  transactionCount: 2,
  discountCentavos: 0,
  taxCentavos: 0,
}
const reportLocations = [{ id: locationId, code: 'MAIN', name: 'Main Store' }]
const dashboardContext = {
  scope: reportScope,
  locations: reportLocations,
  summary: reportSummary,
  salesTrend: [{ date: '2026-09-25', netSalesCentavos: 90_000, transactionCount: 2 }],
  branches: [
    {
      locationId,
      locationName: 'Main Store',
      netSalesCentavos: 90_000,
      grossProfitCentavos: 50_000,
      transactionCount: 2,
    },
  ],
  inventory: {
    skuCount: 1,
    onHandMilli: 10_000,
    availableMilli: 10_000,
    outOfStockCount: 0,
    valuationCentavos: 40_000,
  },
  registers: { openCount: 1, totalCount: 1 },
}
const salesReportContext = {
  scope: reportScope,
  locations: reportLocations,
  summary: reportSummary,
  byItem: [],
  byCategory: [],
  byEmployee: [],
  byPaymentType: [],
}
const inventoryReportContext = {
  scope: reportScope,
  locations: reportLocations,
  summary: {
    skuCount: 1,
    onHandMilli: 10_000,
    reservedMilli: 0,
    availableMilli: 10_000,
    inTransitMilli: 0,
    outOfStockCount: 0,
    valuationCentavos: 40_000,
  },
  items: [],
}
const loadDashboard = vi.fn(async () => dashboardContext)
const loadSalesReport = vi.fn(async () => salesReportContext)
const loadInventoryReport = vi.fn(async () => inventoryReportContext)
const alertId = 'e0000000-0000-4000-8000-000000000001'
const alertCenter = {
  canManage: true,
  counts: { open: 1, acknowledged: 0, resolved: 0, dismissed: 0 },
  alerts: [
    {
      id: alertId,
      category: 'inventory' as const,
      severity: 'warning' as const,
      status: 'open' as const,
      title: 'Out of stock',
      message: 'Triple Black / XL is out of stock at Main Store.',
      entityType: 'product_variant',
      entityId: '50000000-0000-4000-8000-000000000001',
      locationId,
      locationName: 'Main Store',
      firstDetectedAt: '2026-09-25T05:00:00.000Z',
      lastDetectedAt: '2026-09-25T05:00:00.000Z',
      acknowledgedAt: null,
      resolvedAt: null,
      dismissedAt: null,
      note: null,
      metadata: { availableMilli: 0 },
    },
  ],
}
const auditActivity = {
  locations: reportLocations,
  items: [
    {
      id: 'e1000000-0000-4000-8000-000000000001',
      requestId: 'request-001',
      actorType: 'tenant_user' as const,
      actorId: userId,
      actorLabel: 'Owner',
      action: 'alert.status_updated',
      entityType: 'risk_alert',
      entityId: alertId,
      locationId,
      locationName: 'Main Store',
      reason: 'Reviewed by owner',
      metadata: { fromStatus: 'open', toStatus: 'acknowledged' },
      occurredAt: '2026-09-25T05:10:00.000Z',
    },
  ],
  total: 1,
  hasMore: false,
}
const loadAlertCenter = vi.fn(async () => alertCenter)
const updateAlertStatus = vi.fn(async (_userId, _tenantId, nextAlertId, request: AlertStatusUpdateRequest) => ({
  alertId: nextAlertId,
  status: request.status,
}))
const loadAuditActivity = vi.fn(async () => auditActivity)
const notificationId = 'e2000000-0000-4000-8000-000000000001'
const notificationCenter = {
  unreadCount: 1,
  total: 1,
  hasMore: false,
  items: [
    {
      id: notificationId,
      category: 'alert' as const,
      severity: 'warning' as const,
      title: 'Out of stock',
      message: 'Triple Black / XL is out of stock at Main Store.',
      linkedEntityType: 'risk_alert',
      linkedEntityId: alertId,
      locationId,
      locationName: 'Main Store',
      href: '/alerts',
      groupKey: 'alert:inventory',
      delivery: { inApp: 'delivered' as const, email: 'not_configured' as const },
      readAt: null,
      metadata: { alertStatus: 'open' },
      createdAt: '2026-09-25T05:00:00.000Z',
    },
  ],
}
const loadNotificationCenter = vi.fn(async () => notificationCenter)
const updateNotificationReadState = vi.fn(async (_userId, _tenantId, nextNotificationId, read: boolean) => ({
  notificationId: nextNotificationId,
  read,
  unreadCount: read ? 0 : 1,
}))
const markAllNotificationsRead = vi.fn(async () => ({ markedCount: 1, unreadCount: 0 }))

const authenticatedApp = createApp({
  verifyAccessToken: async (token) => (token === 'valid-token' ? { userId } : null),
  loadSessionAccess: async (requestedUserId) => {
    expect(requestedUserId).toBe(userId)

    return [
      {
        tenantId,
        tenantSlug: 'sample-store',
        tenantName: 'Sample Store',
        isOwner: true,
        employeeId: null,
        locationIds: [locationId],
        permissions: ['inventory.read'],
        entitlements: ['inventory'],
      },
    ]
  },
  bootstrapTenant,
  loadOnboarding,
  updateOnboarding,
  loadCatalog,
  createCatalogProduct,
  createCatalogVariant,
  updateCatalogProduct,
  updateCatalogVariant,
  deactivateCatalogVariant,
  loadInventoryStock,
  loadInventoryMovements,
  recordInventoryAdjustment,
  loadOpeningInventory,
  recordOpeningInventory,
  loadApprovalCenter,
  updateApprovalPolicy,
  decideApprovalRequest,
  loadPurchasing,
  createSupplier,
  createPurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  loadTransfers,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  loadWorkforce,
  createLocation,
  createEmployee,
  createRegister,
  loadRegisterOperations,
  createPaymentMethod,
  openRegisterSession,
  closeRegisterSession,
  loadPosDevices,
  createPosDeviceActivation,
  activatePosDevice,
  authenticatePosEmployee,
  loadPosSalesContext,
  openPosRegisterSession,
  completePosCashSale,
  loadSales,
  loadSaleReceipt,
  refundSale,
  voidSale,
  loadCustomers,
  loadCustomer,
  createCustomer,
  updateCustomer,
  addCustomerNote,
  searchPosCustomers,
  createPosCustomer,
  loadLoyalty,
  updateLoyaltyPolicy,
  loadDashboard,
  loadSalesReport,
  loadInventoryReport,
  loadAlertCenter,
  updateAlertStatus,
  loadAuditActivity,
  loadNotificationCenter,
  updateNotificationReadState,
  markAllNotificationsRead,
})

const businessDetails = {
  name: 'Sample Store',
  slug: 'sample-store',
  mainLocation: { code: 'MAIN', name: 'Main Store' },
}

function postBusiness(body: unknown, key = 'onboarding-request-001') {
  return authenticatedApp.request(
    '/v1/tenants',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    },
    bindings,
  )
}

describe('API', () => {
  it('returns a contract-valid health response', async () => {
    const response = await app.request('/health', {}, bindings)
    const payload: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(healthResponseSchema.safeParse(payload).success).toBe(true)
  })

  it('uses the standard error envelope for unknown routes', async () => {
    const response = await app.request('/missing', {}, bindings)
    const payload = await response.json<{ error: { code: string; requestId: string } }>()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('NOT_FOUND')
    expect(payload.error.requestId).toBeTruthy()
  })

  it('rejects a missing bearer token without querying tenant access', async () => {
    const response = await authenticatedApp.request('/v1/me', {}, bindings)
    const payload: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(apiErrorResponseSchema.parse(payload).error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('rejects a malformed authorization header', async () => {
    const response = await authenticatedApp.request(
      '/v1/me',
      { headers: { authorization: 'Basic not-a-bearer-token' } },
      bindings,
    )
    const payload: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(apiErrorResponseSchema.parse(payload).error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('rejects an invalid bearer token', async () => {
    const response = await authenticatedApp.request(
      '/v1/me',
      { headers: { authorization: 'Bearer invalid-token' } },
      bindings,
    )
    const payload: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(apiErrorResponseSchema.parse(payload).error.code).toBe('INVALID_ACCESS_TOKEN')
  })

  it('returns only server-resolved tenant and branch access', async () => {
    const response = await authenticatedApp.request(
      '/v1/me',
      {
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'client-supplied-value-is-ignored',
        },
      },
      bindings,
    )
    const payload: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(sessionContextResponseSchema.parse(payload)).toEqual({
      userId,
      tenants: [
        {
          tenantId,
          tenantSlug: 'sample-store',
          tenantName: 'Sample Store',
          isOwner: true,
          employeeId: null,
          locationIds: [locationId],
          permissions: ['inventory.read'],
          entitlements: ['inventory'],
        },
      ],
    })
  })

  it('requires authentication and a valid idempotency key before business creation', async () => {
    const unauthenticated = await authenticatedApp.request('/v1/tenants', { method: 'POST' }, bindings)
    expect(unauthenticated.status).toBe(401)

    const missingKey = await authenticatedApp.request(
      '/v1/tenants',
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid-token' },
      },
      bindings,
    )
    expect(apiErrorResponseSchema.parse(await missingKey.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('validates business input and calls the atomic bootstrap command with server identity', async () => {
    bootstrapTenant.mockClear()
    expect((await postBusiness({ ...businessDetails, slug: 'Bad Slug' })).status).toBe(400)
    expect(bootstrapTenant).not.toHaveBeenCalled()

    const response = await postBusiness(businessDetails)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ tenantId, mainLocationId: locationId })
    expect(bootstrapTenant).toHaveBeenCalledWith(
      userId,
      { ...businessDetails, baseCurrency: 'PHP', timezone: 'Asia/Manila' },
      'onboarding-request-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('resolves setup status only for an owned tenant', async () => {
    const response = await authenticatedApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId },
      },
      bindings,
    )
    expect(response.status).toBe(200)
    const payload = onboardingResponseSchema.parse(await response.json())
    expect(payload.readyToSell).toBe(false)
    expect(payload.steps[0]).toEqual({ code: 'business', status: 'complete' })
    expect(payload.steps[1]).toEqual({ code: 'main_location', status: 'complete' })
    expect(payload.steps.at(-1)).toEqual({ code: 'test_sale', status: 'pending' })

    const foreignTenant = await authenticatedApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      },
      bindings,
    )
    expect(foreignTenant.status).toBe(403)
    expect(apiErrorResponseSchema.parse(await foreignTenant.json()).error.code).toBe('ONBOARDING_ACCESS_DENIED')
  })

  it('requires explicit tenant selection for multi-business owners', async () => {
    const multiTenantApp = createApp({
      verifyAccessToken: async () => ({ userId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'first',
          tenantName: 'First',
          isOwner: true,
          employeeId: null,
          locationIds: [],
          permissions: [],
          entitlements: [],
        },
        {
          tenantId: '20000000-0000-4000-8000-000000000002',
          tenantSlug: 'second',
          tenantName: 'Second',
          isOwner: true,
          employeeId: null,
          locationIds: [],
          permissions: [],
          entitlements: [],
        },
      ],
      bootstrapTenant,
      loadOnboarding,
      updateOnboarding,
      loadCatalog,
      createCatalogProduct,
      createCatalogVariant,
      updateCatalogProduct,
      updateCatalogVariant,
      deactivateCatalogVariant,
      loadInventoryStock,
      loadInventoryMovements,
      recordInventoryAdjustment,
      loadOpeningInventory,
      recordOpeningInventory,
      loadApprovalCenter,
      updateApprovalPolicy,
      decideApprovalRequest,
      loadPurchasing,
      createSupplier,
      createPurchaseOrder,
      sendPurchaseOrder,
      receivePurchaseOrder,
      loadTransfers,
      createTransfer,
      dispatchTransfer,
      receiveTransfer,
      loadWorkforce,
      createLocation,
      createEmployee,
      createRegister,
      loadRegisterOperations,
      createPaymentMethod,
      openRegisterSession,
      closeRegisterSession,
      loadPosDevices,
      createPosDeviceActivation,
      activatePosDevice,
      authenticatePosEmployee,
      loadPosSalesContext,
      openPosRegisterSession,
      completePosCashSale,
      loadSales,
      loadSaleReceipt,
      refundSale,
      voidSale,
      loadCustomers,
      loadCustomer,
      createCustomer,
      updateCustomer,
      addCustomerNote,
      searchPosCustomers,
      createPosCustomer,
      loadLoyalty,
      updateLoyaltyPolicy,
      loadDashboard,
      loadSalesReport,
      loadInventoryReport,
      loadAlertCenter,
      updateAlertStatus,
      loadAuditActivity,
      loadNotificationCenter,
      updateNotificationReadState,
      markAllNotificationsRead,
    })
    const response = await multiTenantApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token' },
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('TENANT_SELECTION_REQUIRED')
  })

  it('does not allow non-owners to view owner setup', async () => {
    const employeeApp = createApp({
      verifyAccessToken: async () => ({ userId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'sample-store',
          tenantName: 'Sample Store',
          isOwner: false,
          employeeId: null,
          locationIds: [],
          permissions: [],
          entitlements: [],
        },
      ],
      bootstrapTenant,
      loadOnboarding,
      updateOnboarding,
      loadCatalog,
      createCatalogProduct,
      createCatalogVariant,
      updateCatalogProduct,
      updateCatalogVariant,
      deactivateCatalogVariant,
      loadInventoryStock,
      loadInventoryMovements,
      recordInventoryAdjustment,
      loadOpeningInventory,
      recordOpeningInventory,
      loadApprovalCenter,
      updateApprovalPolicy,
      decideApprovalRequest,
      loadPurchasing,
      createSupplier,
      createPurchaseOrder,
      sendPurchaseOrder,
      receivePurchaseOrder,
      loadTransfers,
      createTransfer,
      dispatchTransfer,
      receiveTransfer,
      loadWorkforce,
      createLocation,
      createEmployee,
      createRegister,
      loadRegisterOperations,
      createPaymentMethod,
      openRegisterSession,
      closeRegisterSession,
      loadPosDevices,
      createPosDeviceActivation,
      activatePosDevice,
      authenticatePosEmployee,
      loadPosSalesContext,
      openPosRegisterSession,
      completePosCashSale,
      loadSales,
      loadSaleReceipt,
      refundSale,
      voidSale,
      loadCustomers,
      loadCustomer,
      createCustomer,
      updateCustomer,
      addCustomerNote,
      searchPosCustomers,
      createPosCustomer,
      loadLoyalty,
      updateLoyaltyPolicy,
      loadDashboard,
      loadSalesReport,
      loadInventoryReport,
      loadAlertCenter,
      updateAlertStatus,
      loadAuditActivity,
      loadNotificationCenter,
      updateNotificationReadState,
      markAllNotificationsRead,
    })
    const response = await employeeApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId },
      },
      bindings,
    )
    expect(response.status).toBe(403)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('ONBOARDING_ACCESS_DENIED')
  })

  it('allows CORS only from the configured Back Office origin', async () => {
    const allowed = await authenticatedApp.request(
      '/v1/me',
      {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3001', 'access-control-request-method': 'GET' },
      },
      { ...bindings, BACKOFFICE_ORIGIN: 'http://localhost:3001' },
    )
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3001')

    const denied = await authenticatedApp.request(
      '/v1/me',
      {
        method: 'OPTIONS',
        headers: { origin: 'https://untrusted.example', 'access-control-request-method': 'GET' },
      },
      { ...bindings, BACKOFFICE_ORIGIN: 'http://localhost:3001' },
    )
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('validates and saves business setup questions for the server-resolved owner', async () => {
    updateOnboarding.mockClear()
    const invalid = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ step: 'business_questions', businessType: 'unknown' }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)
    expect(updateOnboarding).not.toHaveBeenCalled()

    const request = {
      step: 'business_questions' as const,
      businessType: 'retail' as const,
      salesChannels: ['in_store' as const],
      tracksInventory: true,
      productSetupMethod: 'manual' as const,
    }
    const response = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(updateOnboarding).toHaveBeenCalledWith(userId, tenantId, request, expect.any(String), bindings)
  })

  it('saves only selectable feature codes', async () => {
    const invalid = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ step: 'feature_selection', enabledFeatures: ['online_store'] }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)

    const response = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ step: 'feature_selection', enabledFeatures: ['inventory', 'customers'] }),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      step: 'feature_selection',
      status: 'complete',
      enabledFeatures: ['inventory', 'customers'],
    })
  })

  it('returns a contract-valid catalog for the server-resolved tenant', async () => {
    loadCatalog.mockClear()
    const response = await authenticatedApp.request(
      '/v1/catalog',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadCatalog).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('requires valid product details and an idempotency key', async () => {
    createCatalogProduct.mockClear()
    const missingKey = await authenticatedApp.request(
      '/v1/catalog/products',
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({}),
      },
      bindings,
    )
    expect(apiErrorResponseSchema.parse(await missingKey.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const invalid = await authenticatedApp.request(
      '/v1/catalog/products',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-request-001',
        },
        body: JSON.stringify({ name: 'Coffee', sku: 'bad sku', retailPriceMinor: 12000 }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)
    expect(createCatalogProduct).not.toHaveBeenCalled()
  })

  it('creates a product using server identity and integer minor-unit money', async () => {
    createCatalogProduct.mockClear()
    const request = {
      name: 'Iced Coffee',
      description: 'House blend',
      categoryName: 'Drinks',
      variantName: 'Regular',
      sku: 'COF-001',
      retailPriceMinor: 12_050,
      unitCostMinor: 5_525,
      trackInventory: true,
      barcodes: ['480000000001'],
    }
    const response = await authenticatedApp.request(
      '/v1/catalog/products',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-request-002',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(catalogProductCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createCatalogProduct).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'catalog-request-002',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('adds a variant to an existing product using the server-resolved tenant', async () => {
    createCatalogVariant.mockClear()
    const request = {
      variantName: 'Black / XL',
      sku: 'TSH-BLK-XL',
      retailPriceMinor: 99_900,
      unitCostMinor: 65_000,
      trackInventory: true,
      barcodes: ['480000000099'],
    }
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(catalogVariantCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createCatalogVariant).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      request,
      'catalog-variant-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('updates the product master using the server-resolved tenant', async () => {
    updateCatalogProduct.mockClear()
    const request = { name: 'Triple Black', categoryName: 'Shirts', description: 'Core shirt line' }
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001',
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-product-update-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogProductUpdateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(updateCatalogProduct).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      request,
      'catalog-product-update-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('updates a variant using server identity and integer minor-unit money', async () => {
    updateCatalogVariant.mockClear()
    const request = {
      variantName: 'Black / Medium',
      sku: 'TSH-BLK-M',
      retailPriceMinor: 89_900,
      unitCostMinor: 55_000,
      trackInventory: true,
      barcodes: ['480000000088'],
    }
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants/50000000-0000-4000-8000-000000000002',
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-update-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogVariantUpdateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(updateCatalogVariant).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      request,
      'catalog-variant-update-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('deactivates a variant without accepting tenant identity from the body', async () => {
    deactivateCatalogVariant.mockClear()
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants/50000000-0000-4000-8000-000000000002',
      {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-delete-001',
        },
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogVariantDeactivateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(deactivateCatalogVariant).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'catalog-variant-delete-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('returns a conflict when deactivation would remove the last active variant', async () => {
    deactivateCatalogVariant.mockRejectedValueOnce(Object.assign(new Error('last variant'), { code: 'HCS13' }))
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants/50000000-0000-4000-8000-000000000002',
      {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-delete-last',
        },
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('LAST_ACTIVE_VARIANT')
  })

  it('loads live stock for the server-resolved tenant and requested location', async () => {
    loadInventoryStock.mockClear()
    const response = await authenticatedApp.request(
      `/v1/inventory/stock?locationId=${locationId}`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(inventoryStockContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadInventoryStock).toHaveBeenCalledWith(userId, tenantId, locationId, bindings)
  })

  it('loads the approval center for the server-resolved tenant', async () => {
    loadApprovalCenter.mockClear()
    const response = await authenticatedApp.request(
      '/v1/approvals',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(approvalCenterSchema.parse(await response.json()).canManage).toBe(true)
    expect(loadApprovalCenter).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('updates the inventory adjustment approval threshold', async () => {
    updateApprovalPolicy.mockClear()
    const request = { inventoryAdjustmentThresholdMilli: 25_000 }
    const response = await authenticatedApp.request(
      '/v1/approvals/policy',
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'approval-policy-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(approvalPolicyUpdateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(updateApprovalPolicy).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'approval-policy-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('approves a pending request through an idempotent decision command', async () => {
    decideApprovalRequest.mockClear()
    const approvalRequestId = '70000000-0000-4000-8000-000000000001'
    const request = { decision: 'approved', note: null }
    const response = await authenticatedApp.request(
      `/v1/approvals/${approvalRequestId}/decision`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'approval-decision-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(approvalDecisionResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(decideApprovalRequest).toHaveBeenCalledWith(
      userId,
      tenantId,
      approvalRequestId,
      request,
      'approval-decision-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('loads movement history with server-validated filters', async () => {
    loadInventoryMovements.mockClear()
    const variantId = '50000000-0000-4000-8000-000000000001'
    const response = await authenticatedApp.request(
      `/v1/inventory/movements?locationId=${locationId}&variantId=${variantId}&limit=50`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(inventoryMovementContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadInventoryMovements).toHaveBeenCalledWith(userId, tenantId, locationId, variantId, 50, bindings)
  })

  it('rejects movement requests without a valid location', async () => {
    loadInventoryMovements.mockClear()
    const response = await authenticatedApp.request(
      '/v1/inventory/movements?locationId=not-a-location',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(loadInventoryMovements).not.toHaveBeenCalled()
  })

  it('records an inventory adjustment with a reason and integer units', async () => {
    recordInventoryAdjustment.mockClear()
    const request = {
      locationId,
      variantId: '50000000-0000-4000-8000-000000000001',
      quantityMilli: -500,
      unitCostMinor: null,
      reason: 'Damaged during receiving',
    }
    const response = await authenticatedApp.request(
      '/v1/inventory/adjustments',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'inventory-adjustment-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(inventoryAdjustmentCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(recordInventoryAdjustment).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'inventory-adjustment-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('rejects an adjustment without a non-zero quantity or reason', async () => {
    recordInventoryAdjustment.mockClear()
    const response = await authenticatedApp.request(
      '/v1/inventory/adjustments',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'inventory-adjustment-002',
        },
        body: JSON.stringify({
          locationId,
          variantId: '50000000-0000-4000-8000-000000000001',
          quantityMilli: 0,
          reason: '',
        }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(recordInventoryAdjustment).not.toHaveBeenCalled()
  })

  it('loads opening inventory for the server-resolved tenant and requested location', async () => {
    loadOpeningInventory.mockClear()
    const response = await authenticatedApp.request(
      `/v1/inventory/opening-balances?locationId=${locationId}`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(openingInventoryContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadOpeningInventory).toHaveBeenCalledWith(userId, tenantId, locationId, bindings)
  })

  it('records opening inventory using integer quantity and money units', async () => {
    recordOpeningInventory.mockClear()
    const request = {
      locationId,
      entries: [
        {
          variantId: '50000000-0000-4000-8000-000000000001',
          quantityMilli: 12_000,
          unitCostMinor: 55_000,
        },
      ],
    }
    const response = await authenticatedApp.request(
      '/v1/inventory/opening-balances',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'opening-inventory-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(openingInventoryCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(recordOpeningInventory).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'opening-inventory-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('rejects empty opening inventory before reaching the database', async () => {
    recordOpeningInventory.mockClear()
    const response = await authenticatedApp.request(
      '/v1/inventory/opening-balances',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'opening-inventory-empty',
        },
        body: JSON.stringify({ locationId, entries: [] }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(recordOpeningInventory).not.toHaveBeenCalled()
  })

  it('loads purchasing context for the server-resolved tenant', async () => {
    loadPurchasing.mockClear()
    const response = await authenticatedApp.request(
      '/v1/purchasing',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(purchasingContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadPurchasing).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates supplier and purchase order with idempotency headers', async () => {
    createSupplier.mockClear()
    createPurchaseOrder.mockClear()
    const supplier = await authenticatedApp.request(
      '/v1/purchasing/suppliers',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'supplier-create-001',
        },
        body: JSON.stringify({ name: 'Acme Wholesale', contactName: null, contactPhone: null, contactEmail: null }),
      },
      bindings,
    )
    expect(supplier.status).toBe(201)
    expect(supplierCreateResponseSchema.safeParse(await supplier.json()).success).toBe(true)
    const orderRequest = {
      supplierId: '80000000-0000-4000-8000-000000000001',
      locationId,
      orderNumber: 'PO-0001',
      expectedAt: null,
      notes: null,
      lines: [{ variantId: '50000000-0000-4000-8000-000000000001', quantityMilli: 2_000, unitCostMinor: 55_000 }],
    }
    const order = await authenticatedApp.request(
      '/v1/purchasing/orders',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'purchase-order-create-001',
        },
        body: JSON.stringify(orderRequest),
      },
      bindings,
    )
    expect(order.status).toBe(201)
    expect(purchaseOrderCreateResponseSchema.safeParse(await order.json()).success).toBe(true)
  })

  it('rejects purchase receipt payloads without positive lines', async () => {
    receivePurchaseOrder.mockClear()
    const response = await authenticatedApp.request(
      '/v1/purchasing/orders/90000000-0000-4000-8000-000000000001/receive',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'purchase-receipt-empty',
        },
        body: JSON.stringify({ lines: [], deliveryReference: null }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(receivePurchaseOrder).not.toHaveBeenCalled()
    expect(purchaseReceiptResponseSchema.safeParse(await response.json()).success).toBe(false)
  })

  it('loads transfer context for the server-resolved tenant', async () => {
    loadTransfers.mockClear()
    const response = await authenticatedApp.request(
      '/v1/transfers',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(transferContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadTransfers).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates a draft transfer with integer quantity units', async () => {
    createTransfer.mockClear()
    const request = {
      transferNumber: 'TR-0001',
      sourceLocationId: locationId,
      destinationLocationId: '30000000-0000-4000-8000-000000000002',
      items: [{ variantId: '50000000-0000-4000-8000-000000000001', quantityMilli: 2_000 }],
    }
    const response = await authenticatedApp.request(
      '/v1/transfers',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'transfer-create-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(transferCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createTransfer).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'transfer-create-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('loads workforce setup for the server-resolved tenant', async () => {
    loadWorkforce.mockClear()
    const response = await authenticatedApp.request(
      '/v1/workforce',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(workforceContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadWorkforce).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates an employee without including the PIN in the request hash', async () => {
    createEmployee.mockClear()
    const request = {
      employeeCode: 'EMP-001',
      displayName: 'Cashier One',
      roleId: 'e0000000-0000-4000-8000-000000000001',
      locationIds: [locationId],
      pin: '1234',
    }
    const response = await authenticatedApp.request(
      '/v1/workforce/employees',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'employee-create-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(employeeCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createEmployee).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'employee-create-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('loads payment methods and register sessions for the server-resolved tenant', async () => {
    loadRegisterOperations.mockClear()
    const response = await authenticatedApp.request(
      '/v1/register-operations',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(registerOperationsContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadRegisterOperations).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates a payment method with an idempotent command', async () => {
    createPaymentMethod.mockClear()
    const request = { code: 'qr_ph', name: 'QR Ph', methodType: 'e_wallet' as const }
    const response = await authenticatedApp.request(
      '/v1/payment-methods',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'payment-method-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(paymentMethodCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createPaymentMethod).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'payment-method-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('opens and closes a register session using integer centavos', async () => {
    openRegisterSession.mockClear()
    closeRegisterSession.mockClear()
    const sessionId = 'f0000000-0000-4000-8000-000000000001'
    const openRequest = {
      registerId: 'd0000000-0000-4000-8000-000000000001',
      employeeId: 'c0000000-0000-4000-8000-000000000001',
      openingCashCentavos: 50_000,
    }
    const opened = await authenticatedApp.request(
      '/v1/register-sessions/open',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'register-open-001',
        },
        body: JSON.stringify(openRequest),
      },
      bindings,
    )
    expect(opened.status).toBe(201)
    expect(registerSessionOpenResponseSchema.safeParse(await opened.json()).success).toBe(true)

    const closed = await authenticatedApp.request(
      `/v1/register-sessions/${sessionId}/close`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'register-close-001',
        },
        body: JSON.stringify({ countedCashCentavos: 50_000 }),
      },
      bindings,
    )
    expect(closed.status).toBe(200)
    expect(registerSessionCloseResponseSchema.safeParse(await closed.json()).success).toBe(true)
  })

  it('lists POS devices only for the server-resolved tenant', async () => {
    loadPosDevices.mockClear()
    const response = await authenticatedApp.request(
      '/v1/pos/devices',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(posDeviceContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadPosDevices).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates a one-time POS activation code without sending the raw code to Postgres', async () => {
    createPosDeviceActivation.mockClear()
    const response = await authenticatedApp.request(
      '/v1/pos/devices/activation-codes',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({ registerId, name: 'Front counter POS' }),
      },
      bindings,
    )
    const payload = posDeviceActivationCreateResponseSchema.parse(await response.json())
    expect(response.status).toBe(201)
    expect(payload.activationCode).toMatch(/^[A-F0-9]{12}$/)
    expect(createPosDeviceActivation).toHaveBeenCalledWith(
      userId,
      tenantId,
      { registerId, name: 'Front counter POS' },
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('activates a POS device and returns an opaque device token', async () => {
    activatePosDevice.mockClear()
    const response = await authenticatedApp.request(
      '/v1/pos/devices/activate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activationCode: 'ABCDEF123456' }),
      },
      bindings,
    )
    const payload = posDeviceActivateResponseSchema.parse(await response.json())
    expect(response.status).toBe(200)
    expect(payload.deviceToken).toMatch(/^[a-f0-9]{64}$/)
    expect(activatePosDevice).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('requires a registered device token and hashes it before PIN authentication', async () => {
    authenticatePosEmployee.mockClear()
    const missingDevice = await authenticatedApp.request(
      '/v1/pos/sessions/pin-login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeCode: 'EMP-001', pin: '1234' }),
      },
      bindings,
    )
    expect(missingDevice.status).toBe(401)
    expect(authenticatePosEmployee).not.toHaveBeenCalled()

    const deviceToken = 'a'.repeat(64)
    const response = await authenticatedApp.request(
      '/v1/pos/sessions/pin-login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pos-device-token': deviceToken },
        body: JSON.stringify({ employeeCode: 'EMP-001', pin: '1234' }),
      },
      bindings,
    )
    const payload = posPinLoginResponseSchema.parse(await response.json())
    expect(response.status).toBe(200)
    expect(payload.sessionToken).toMatch(/^[a-f0-9]{64}$/)
    expect(authenticatePosEmployee).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      { employeeCode: 'EMP-001', pin: '1234' },
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('requires a POS employee session before loading the live catalog', async () => {
    loadPosSalesContext.mockClear()
    const missing = await authenticatedApp.request('/v1/pos/context', {}, bindings)
    expect(missing.status).toBe(401)
    expect(loadPosSalesContext).not.toHaveBeenCalled()

    const sessionToken = 'b'.repeat(64)
    const response = await authenticatedApp.request(
      '/v1/pos/context',
      { headers: { 'x-pos-session-token': sessionToken } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(posSalesContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadPosSalesContext).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), bindings)
    expect(loadPosSalesContext.mock.calls.at(-1)?.[0]).not.toBe(sessionToken)
  })

  it('opens the device register with an idempotent POS command', async () => {
    openPosRegisterSession.mockClear()
    const response = await authenticatedApp.request(
      '/v1/pos/register-sessions/open',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pos-session-token': 'c'.repeat(64),
          'idempotency-key': 'pos-register-open-001',
        },
        body: JSON.stringify({ openingCashCentavos: 100_000 }),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(posRegisterOpenResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(openPosRegisterSession).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      { openingCashCentavos: 100_000 },
      'pos-register-open-001',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('completes a cash sale without accepting client prices or totals', async () => {
    completePosCashSale.mockClear()
    const request = {
      lines: [{ variantId: '50000000-0000-4000-8000-000000000001', quantityMilli: 1000 }],
      cashReceivedCentavos: 100_000,
    }
    const response = await authenticatedApp.request(
      '/v1/pos/sales/complete',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pos-session-token': 'd'.repeat(64),
          'idempotency-key': 'pos-cash-sale-0001',
        },
        body: JSON.stringify({ ...request, totalCentavos: 1, unitPriceCentavos: 1 }),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(posCashSaleCompleteResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(completePosCashSale).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      request,
      'pos-cash-sale-0001',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('lists tenant sales for an authenticated Back Office user', async () => {
    loadSales.mockClear()
    const response = await authenticatedApp.request(
      '/v1/sales',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(salesContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadSales).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('loads an immutable receipt detail for an authenticated Back Office user', async () => {
    loadSaleReceipt.mockClear()
    const response = await authenticatedApp.request(
      `/v1/sales/${saleReceipt.id}`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(saleReceiptDetailSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadSaleReceipt).toHaveBeenCalledWith(userId, tenantId, saleReceipt.id, bindings)
  })

  it('submits only line quantities and a reason for a sale refund', async () => {
    refundSale.mockClear()
    const request = {
      reason: 'Customer returned the item',
      lines: [{ saleLineId: saleReceipt.lines[0]!.id, quantityMilli: 1000, returnToStock: true }],
    }
    const response = await authenticatedApp.request(
      `/v1/sales/${saleReceipt.id}/refunds`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
          'idempotency-key': 'sale-refund-000001',
        },
        body: JSON.stringify({ ...request, amountCentavos: 1 }),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(saleReversalResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(refundSale).toHaveBeenCalledWith(
      userId,
      tenantId,
      saleReceipt.id,
      request,
      'sale-refund-000001',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('voids a completed sale with an idempotent reason-only command', async () => {
    voidSale.mockClear()
    const request = { reason: 'Duplicate transaction' }
    const response = await authenticatedApp.request(
      `/v1/sales/${saleReceipt.id}/void`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
          'idempotency-key': 'sale-void-0000001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(saleReversalResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(voidSale).toHaveBeenCalledWith(
      userId,
      tenantId,
      saleReceipt.id,
      request,
      'sale-void-0000001',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('lists and loads tenant customer profiles', async () => {
    loadCustomers.mockClear()
    loadCustomer.mockClear()
    const list = await authenticatedApp.request(
      '/v1/customers?q=maria',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(list.status).toBe(200)
    expect(customersContextSchema.safeParse(await list.json()).success).toBe(true)
    expect(loadCustomers).toHaveBeenCalledWith(userId, tenantId, 'maria', bindings)

    const detail = await authenticatedApp.request(
      `/v1/customers/${customerId}`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(detail.status).toBe(200)
    expect(customerDetailSchema.safeParse(await detail.json()).success).toBe(true)
    expect(loadCustomer).toHaveBeenCalledWith(userId, tenantId, customerId, bindings)
  })

  it('loads and updates the tenant loyalty policy', async () => {
    loadLoyalty.mockClear()
    updateLoyaltyPolicy.mockClear()
    const headers = { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId }
    const loaded = await authenticatedApp.request('/v1/loyalty', { headers }, bindings)
    expect(loaded.status).toBe(200)
    expect(loyaltyContextSchema.safeParse(await loaded.json()).success).toBe(true)
    expect(loadLoyalty).toHaveBeenCalledWith(userId, tenantId, bindings)

    const request = { enabled: true, spendPerPointCentavos: 10_000 }
    const updated = await authenticatedApp.request(
      '/v1/loyalty/policy',
      {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': 'loyalty-policy-0001' },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(updated.status).toBe(200)
    expect(loyaltyPolicyUpdateResponseSchema.safeParse(await updated.json()).success).toBe(true)
    expect(updateLoyaltyPolicy).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'loyalty-policy-0001',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('loads reconciled dashboard, sales, and inventory reports with server-resolved tenancy', async () => {
    const query = '?from=2026-09-01&to=2026-09-25&channel=all'
    const headers = { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId }
    const dashboard = await authenticatedApp.request(`/v1/dashboard${query}`, { headers }, bindings)
    const sales = await authenticatedApp.request(`/v1/reports/sales${query}`, { headers }, bindings)
    const inventory = await authenticatedApp.request(`/v1/reports/inventory${query}`, { headers }, bindings)

    expect(dashboard.status).toBe(200)
    expect(sales.status).toBe(200)
    expect(inventory.status).toBe(200)
    expect(dashboardContextSchema.safeParse(await dashboard.json()).success).toBe(true)
    expect(salesReportContextSchema.safeParse(await sales.json()).success).toBe(true)
    expect(inventoryReportContextSchema.safeParse(await inventory.json()).success).toBe(true)
    const filter = { from: '2026-09-01', to: '2026-09-25', locationId: null, channel: 'all' }
    expect(loadDashboard).toHaveBeenCalledWith(userId, tenantId, filter, bindings)
    expect(loadSalesReport).toHaveBeenCalledWith(userId, tenantId, filter, bindings)
    expect(loadInventoryReport).toHaveBeenCalledWith(userId, tenantId, filter, bindings)
  })

  it('rejects invalid reporting filters before querying the database', async () => {
    loadDashboard.mockClear()
    const response = await authenticatedApp.request(
      '/v1/dashboard?from=invalid&to=2026-09-25&channel=all',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('INVALID_REPORT_FILTERS')
    expect(loadDashboard).not.toHaveBeenCalled()
  })

  it('loads the tenant alert center and updates an alert lifecycle state', async () => {
    const headers = { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId }
    const loaded = await authenticatedApp.request('/v1/alerts', { headers }, bindings)
    expect(loaded.status).toBe(200)
    expect(alertCenterSchema.safeParse(await loaded.json()).success).toBe(true)
    expect(loadAlertCenter).toHaveBeenCalledWith(userId, tenantId, bindings)

    const request = { status: 'acknowledged' as const, note: 'Reviewed by owner' }
    const updated = await authenticatedApp.request(
      `/v1/alerts/${alertId}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(updated.status).toBe(200)
    expect(alertStatusUpdateResponseSchema.safeParse(await updated.json()).success).toBe(true)
    expect(updateAlertStatus).toHaveBeenCalledWith(userId, tenantId, alertId, request, expect.any(String), bindings)
  })

  it('loads filtered audit activity and rejects invalid audit dates', async () => {
    const headers = { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId }
    const loaded = await authenticatedApp.request(
      '/v1/audit-activity?from=2026-09-01&to=2026-09-25&search=alert&limit=50&offset=0',
      { headers },
      bindings,
    )
    expect(loaded.status).toBe(200)
    expect(auditActivityContextSchema.safeParse(await loaded.json()).success).toBe(true)
    expect(loadAuditActivity).toHaveBeenCalledWith(
      userId,
      tenantId,
      {
        from: '2026-09-01',
        to: '2026-09-25',
        locationId: null,
        actorType: null,
        action: null,
        entityType: null,
        search: 'alert',
        limit: 50,
        offset: 0,
      },
      bindings,
    )

    loadAuditActivity.mockClear()
    const invalid = await authenticatedApp.request(
      '/v1/audit-activity?from=invalid&to=2026-09-25',
      { headers },
      bindings,
    )
    expect(invalid.status).toBe(400)
    expect(apiErrorResponseSchema.parse(await invalid.json()).error.code).toBe('INVALID_AUDIT_FILTERS')
    expect(loadAuditActivity).not.toHaveBeenCalled()
  })

  it('loads personal notifications and updates read state independently', async () => {
    const headers = { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId }
    const loaded = await authenticatedApp.request(
      '/v1/notifications?unreadOnly=true&limit=20&offset=0',
      { headers },
      bindings,
    )
    expect(loaded.status).toBe(200)
    expect(notificationCenterSchema.safeParse(await loaded.json()).success).toBe(true)
    expect(loadNotificationCenter).toHaveBeenCalledWith(
      userId,
      tenantId,
      { unreadOnly: true, limit: 20, offset: 0 },
      bindings,
    )

    const updated = await authenticatedApp.request(
      `/v1/notifications/${notificationId}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ read: true }),
      },
      bindings,
    )
    expect(updated.status).toBe(200)
    expect(notificationReadResponseSchema.safeParse(await updated.json()).success).toBe(true)
    expect(updateNotificationReadState).toHaveBeenCalledWith(userId, tenantId, notificationId, true, bindings)
  })

  it('marks every personal notification as read', async () => {
    const response = await authenticatedApp.request(
      '/v1/notifications/read-all',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId },
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(notificationsReadAllResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(markAllNotificationsRead).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates, updates, and annotates a customer with idempotent commands', async () => {
    const createRequest = {
      fullName: 'Maria Santos',
      email: 'maria@example.com',
      phone: null,
      customerGroupId,
      customerType: 'standard',
      emailMarketingConsent: false,
      smsMarketingConsent: false,
    }
    const created = await authenticatedApp.request(
      '/v1/customers',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
          'idempotency-key': 'customer-create-0001',
        },
        body: JSON.stringify(createRequest),
      },
      bindings,
    )
    expect(created.status).toBe(201)
    expect(customerCreateResponseSchema.safeParse(await created.json()).success).toBe(true)

    const updateRequest = { ...createRequest, customerGroupId, status: 'active' }
    const updated = await authenticatedApp.request(
      `/v1/customers/${customerId}`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
          'idempotency-key': 'customer-update-0001',
        },
        body: JSON.stringify(updateRequest),
      },
      bindings,
    )
    expect(updated.status).toBe(200)
    expect(customerUpdateResponseSchema.safeParse(await updated.json()).success).toBe(true)

    const noted = await authenticatedApp.request(
      `/v1/customers/${customerId}/notes`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
          'idempotency-key': 'customer-note-000001',
        },
        body: JSON.stringify({ note: 'Prefers SMS order updates.' }),
      },
      bindings,
    )
    expect(noted.status).toBe(201)
    expect(customerNoteResponseSchema.safeParse(await noted.json()).success).toBe(true)
  })

  it('searches and creates POS-originated customers from the employee session', async () => {
    const headers = { 'x-pos-session-token': 'e'.repeat(64) }
    const search = await authenticatedApp.request('/v1/pos/customers?q=maria', { headers }, bindings)
    expect(search.status).toBe(200)
    expect(posCustomerSearchResponseSchema.safeParse(await search.json()).success).toBe(true)
    const created = await authenticatedApp.request(
      '/v1/pos/customers',
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': 'pos-customer-00001' },
        body: JSON.stringify({
          fullName: 'Maria Santos',
          email: 'maria@example.com',
          phone: null,
          emailMarketingConsent: false,
          smsMarketingConsent: false,
        }),
      },
      bindings,
    )
    expect(created.status).toBe(201)
    expect(posCustomerCreateResponseSchema.safeParse(await created.json()).success).toBe(true)
  })
})
