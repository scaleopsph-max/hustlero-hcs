import {
  approvalCenterSchema,
  approvalDecisionRequestSchema,
  approvalDecisionResponseSchema,
  approvalPolicyUpdateRequestSchema,
  approvalPolicyUpdateResponseSchema,
  purchaseOrderCreateRequestSchema,
  purchaseOrderCreateResponseSchema,
  purchaseOrderSendResponseSchema,
  purchaseReceiptRequestSchema,
  purchaseReceiptResponseSchema,
  purchasingContextSchema,
  supplierCreateRequestSchema,
  supplierCreateResponseSchema,
  transferContextSchema,
  transferCreateRequestSchema,
  transferCreateResponseSchema,
  transferDispatchResponseSchema,
  transferReceiveRequestSchema,
  transferReceiveResponseSchema,
  employeeCreateRequestSchema,
  employeeCreateResponseSchema,
  locationCreateRequestSchema,
  locationCreateResponseSchema,
  registerCreateRequestSchema,
  registerCreateResponseSchema,
  workforceContextSchema,
  paymentMethodCreateRequestSchema,
  paymentMethodCreateResponseSchema,
  posDeviceActivateRequestSchema,
  posDeviceActivateResponseSchema,
  posDeviceActivationCreateRequestSchema,
  posDeviceActivationCreateResponseSchema,
  posDeviceContextSchema,
  posPinLoginRequestSchema,
  posPinLoginResponseSchema,
  posCashSaleCompleteRequestSchema,
  posCashSaleCompleteResponseSchema,
  posRegisterOpenRequestSchema,
  posRegisterOpenResponseSchema,
  posSalesContextSchema,
  salesContextSchema,
  saleReceiptDetailSchema,
  saleRefundRequestSchema,
  saleVoidRequestSchema,
  saleReversalResponseSchema,
  registerOperationsContextSchema,
  registerSessionCloseRequestSchema,
  registerSessionCloseResponseSchema,
  registerSessionOpenRequestSchema,
  registerSessionOpenResponseSchema,
  apiErrorResponseSchema,
  catalogProductCreateRequestSchema,
  catalogProductCreateResponseSchema,
  catalogProductUpdateRequestSchema,
  catalogProductUpdateResponseSchema,
  catalogResponseSchema,
  catalogVariantCreateRequestSchema,
  catalogVariantCreateResponseSchema,
  catalogVariantDeactivateResponseSchema,
  catalogVariantUpdateRequestSchema,
  catalogVariantUpdateResponseSchema,
  healthResponseSchema,
  inventoryAdjustmentCreateRequestSchema,
  inventoryAdjustmentCreateResponseSchema,
  inventoryMovementContextSchema,
  inventoryStockContextSchema,
  openingInventoryContextSchema,
  openingInventoryCreateRequestSchema,
  openingInventoryCreateResponseSchema,
  onboardingResponseSchema,
  onboardingUpdateRequestSchema,
  onboardingUpdateResponseSchema,
  sessionContextResponseSchema,
  tenantBootstrapRequestSchema,
  tenantBootstrapResponseSchema,
  customerCreateRequestSchema,
  customerCreateResponseSchema,
  customerDetailSchema,
  customerNoteRequestSchema,
  customerNoteResponseSchema,
  customerUpdateRequestSchema,
  customerUpdateResponseSchema,
  customersContextSchema,
  posCustomerCreateRequestSchema,
  posCustomerCreateResponseSchema,
  posCustomerSearchResponseSchema,
  loyaltyContextSchema,
  loyaltyPolicyUpdateRequestSchema,
  loyaltyPolicyUpdateResponseSchema,
} from '@hcs/contracts'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'

import { readBearerToken, verifySupabaseAccessToken, type AccessTokenVerifier } from './auth'
import {
  activatePosDeviceInPostgres,
  authenticatePosEmployeeInPostgres,
  createPosDeviceActivationInPostgres,
  loadPosDevicesFromPostgres,
  type PosDeviceActivator,
  type PosDeviceActivationCreator,
  type PosDeviceLoader,
  type PosEmployeePinAuthenticator,
} from './pos-auth-repository'
import {
  completePosCashSaleInPostgres,
  loadPosSalesContextFromPostgres,
  loadSalesFromPostgres,
  loadSaleReceiptFromPostgres,
  refundSaleInPostgres,
  voidSaleInPostgres,
  openPosRegisterSessionInPostgres,
  type PosCashSaleCompleter,
  type PosRegisterSessionOpener,
  type PosSalesContextLoader,
  type SalesLoader,
  type SaleReceiptLoader,
  type SaleRefunder,
  type SaleVoider,
} from './pos-sales-repository'
import {
  decideApprovalRequestInPostgres,
  loadApprovalCenterFromPostgres,
  updateApprovalPolicyInPostgres,
  type ApprovalCenterLoader,
  type ApprovalPolicyUpdater,
  type ApprovalRequestDecider,
} from './approval-repository'
import {
  createCatalogProductInPostgres,
  createCatalogVariantInPostgres,
  deactivateCatalogVariantInPostgres,
  loadCatalogFromPostgres,
  updateCatalogProductInPostgres,
  updateCatalogVariantInPostgres,
  type CatalogLoader,
  type CatalogProductCreator,
  type CatalogVariantCreator,
  type CatalogVariantDeactivator,
  type CatalogVariantUpdater,
  type CatalogProductUpdater,
} from './catalog-repository'
import { type Bindings, readEnvironment } from './env'
import {
  addCustomerNoteInPostgres,
  createCustomerInPostgres,
  createPosCustomerInPostgres,
  loadCustomerFromPostgres,
  loadCustomersFromPostgres,
  searchPosCustomersFromPostgres,
  updateCustomerInPostgres,
  type CustomerCreator,
  type CustomerLoader,
  type CustomerNoteCreator,
  type CustomersLoader,
  type CustomerUpdater,
  type PosCustomerCreator,
  type PosCustomersSearcher,
} from './customer-repository'
import {
  loadLoyaltyFromPostgres,
  updateLoyaltyPolicyInPostgres,
  type LoyaltyLoader,
  type LoyaltyPolicyUpdater,
} from './loyalty-repository'
import {
  loadInventoryMovementsFromPostgres,
  loadInventoryStockFromPostgres,
  loadOpeningInventoryFromPostgres,
  recordInventoryAdjustmentInPostgres,
  recordOpeningInventoryInPostgres,
  type InventoryMovementLoader,
  type InventoryStockLoader,
  type InventoryAdjustmentRecorder,
  type OpeningInventoryLoader,
  type OpeningInventoryRecorder,
} from './inventory-repository'
import {
  bootstrapTenantInPostgres,
  loadOnboardingFromPostgres,
  updateOnboardingInPostgres,
  type OnboardingLoader,
  type OnboardingUpdater,
  type TenantBootstrapper,
} from './onboarding-repository'
import { loadSessionAccessFromPostgres, type SessionAccessLoader } from './session-repository'
import {
  closeRegisterSessionInPostgres,
  createPaymentMethodInPostgres,
  loadRegisterOperationsFromPostgres,
  openRegisterSessionInPostgres,
  type PaymentMethodCreator,
  type RegisterOperationsLoader,
  type RegisterSessionCloser,
  type RegisterSessionOpener,
} from './register-repository'
import {
  createPurchaseOrderInPostgres,
  createSupplierInPostgres,
  loadPurchasingFromPostgres,
  receivePurchaseOrderInPostgres,
  sendPurchaseOrderInPostgres,
  type PurchaseOrderCreator,
  type PurchaseOrderReceiver,
  type PurchaseOrderSender,
  type PurchasingLoader,
  type SupplierCreator,
} from './purchasing-repository'
import {
  createTransferInPostgres,
  dispatchTransferInPostgres,
  loadTransfersFromPostgres,
  receiveTransferInPostgres,
  type TransferCreator,
  type TransferDispatcher,
  type TransferLoader,
  type TransferReceiver,
} from './transfers-repository'
import {
  createEmployeeInPostgres,
  createLocationInPostgres,
  createRegisterInPostgres,
  loadWorkforceFromPostgres,
  type EmployeeCreator,
  type LocationCreator,
  type RegisterCreator,
  type WorkforceLoader,
} from './workforce-repository'

interface AppDependencies {
  verifyAccessToken: AccessTokenVerifier
  loadSessionAccess: SessionAccessLoader
  bootstrapTenant: TenantBootstrapper
  loadOnboarding: OnboardingLoader
  updateOnboarding: OnboardingUpdater
  loadCatalog: CatalogLoader
  createCatalogProduct: CatalogProductCreator
  createCatalogVariant: CatalogVariantCreator
  updateCatalogProduct: CatalogProductUpdater
  updateCatalogVariant: CatalogVariantUpdater
  deactivateCatalogVariant: CatalogVariantDeactivator
  loadInventoryStock: InventoryStockLoader
  loadInventoryMovements: InventoryMovementLoader
  recordInventoryAdjustment: InventoryAdjustmentRecorder
  loadOpeningInventory: OpeningInventoryLoader
  recordOpeningInventory: OpeningInventoryRecorder
  loadApprovalCenter: ApprovalCenterLoader
  updateApprovalPolicy: ApprovalPolicyUpdater
  decideApprovalRequest: ApprovalRequestDecider
  loadPurchasing: PurchasingLoader
  createSupplier: SupplierCreator
  createPurchaseOrder: PurchaseOrderCreator
  sendPurchaseOrder: PurchaseOrderSender
  receivePurchaseOrder: PurchaseOrderReceiver
  loadTransfers: TransferLoader
  createTransfer: TransferCreator
  dispatchTransfer: TransferDispatcher
  receiveTransfer: TransferReceiver
  loadWorkforce: WorkforceLoader
  createLocation: LocationCreator
  createEmployee: EmployeeCreator
  createRegister: RegisterCreator
  loadRegisterOperations: RegisterOperationsLoader
  createPaymentMethod: PaymentMethodCreator
  openRegisterSession: RegisterSessionOpener
  closeRegisterSession: RegisterSessionCloser
  loadPosDevices: PosDeviceLoader
  createPosDeviceActivation: PosDeviceActivationCreator
  activatePosDevice: PosDeviceActivator
  authenticatePosEmployee: PosEmployeePinAuthenticator
  loadPosSalesContext: PosSalesContextLoader
  openPosRegisterSession: PosRegisterSessionOpener
  completePosCashSale: PosCashSaleCompleter
  loadSales: SalesLoader
  loadSaleReceipt: SaleReceiptLoader
  refundSale: SaleRefunder
  voidSale: SaleVoider
  loadCustomers: CustomersLoader
  loadCustomer: CustomerLoader
  createCustomer: CustomerCreator
  updateCustomer: CustomerUpdater
  addCustomerNote: CustomerNoteCreator
  searchPosCustomers: PosCustomersSearcher
  createPosCustomer: PosCustomerCreator
  loadLoyalty: LoyaltyLoader
  updateLoyaltyPolicy: LoyaltyPolicyUpdater
}

const defaultDependencies: AppDependencies = {
  verifyAccessToken: verifySupabaseAccessToken,
  loadSessionAccess: loadSessionAccessFromPostgres,
  bootstrapTenant: bootstrapTenantInPostgres,
  loadOnboarding: loadOnboardingFromPostgres,
  updateOnboarding: updateOnboardingInPostgres,
  loadCatalog: loadCatalogFromPostgres,
  createCatalogProduct: createCatalogProductInPostgres,
  createCatalogVariant: createCatalogVariantInPostgres,
  updateCatalogProduct: updateCatalogProductInPostgres,
  updateCatalogVariant: updateCatalogVariantInPostgres,
  deactivateCatalogVariant: deactivateCatalogVariantInPostgres,
  loadInventoryStock: loadInventoryStockFromPostgres,
  loadInventoryMovements: loadInventoryMovementsFromPostgres,
  recordInventoryAdjustment: recordInventoryAdjustmentInPostgres,
  loadOpeningInventory: loadOpeningInventoryFromPostgres,
  recordOpeningInventory: recordOpeningInventoryInPostgres,
  loadApprovalCenter: loadApprovalCenterFromPostgres,
  updateApprovalPolicy: updateApprovalPolicyInPostgres,
  decideApprovalRequest: decideApprovalRequestInPostgres,
  loadPurchasing: loadPurchasingFromPostgres,
  createSupplier: createSupplierInPostgres,
  createPurchaseOrder: createPurchaseOrderInPostgres,
  sendPurchaseOrder: sendPurchaseOrderInPostgres,
  receivePurchaseOrder: receivePurchaseOrderInPostgres,
  loadTransfers: loadTransfersFromPostgres,
  createTransfer: createTransferInPostgres,
  dispatchTransfer: dispatchTransferInPostgres,
  receiveTransfer: receiveTransferInPostgres,
  loadWorkforce: loadWorkforceFromPostgres,
  createLocation: createLocationInPostgres,
  createEmployee: createEmployeeInPostgres,
  createRegister: createRegisterInPostgres,
  loadRegisterOperations: loadRegisterOperationsFromPostgres,
  createPaymentMethod: createPaymentMethodInPostgres,
  openRegisterSession: openRegisterSessionInPostgres,
  closeRegisterSession: closeRegisterSessionInPostgres,
  loadPosDevices: loadPosDevicesFromPostgres,
  createPosDeviceActivation: createPosDeviceActivationInPostgres,
  activatePosDevice: activatePosDeviceInPostgres,
  authenticatePosEmployee: authenticatePosEmployeeInPostgres,
  loadPosSalesContext: loadPosSalesContextFromPostgres,
  openPosRegisterSession: openPosRegisterSessionInPostgres,
  completePosCashSale: completePosCashSaleInPostgres,
  loadSales: loadSalesFromPostgres,
  loadSaleReceipt: loadSaleReceiptFromPostgres,
  refundSale: refundSaleInPostgres,
  voidSale: voidSaleInPostgres,
  loadCustomers: loadCustomersFromPostgres,
  loadCustomer: loadCustomerFromPostgres,
  createCustomer: createCustomerInPostgres,
  updateCustomer: updateCustomerInPostgres,
  addCustomerNote: addCustomerNoteInPostgres,
  searchPosCustomers: searchPosCustomersFromPostgres,
  createPosCustomer: createPosCustomerInPostgres,
  loadLoyalty: loadLoyaltyFromPostgres,
  updateLoyaltyPolicy: updateLoyaltyPolicyInPostgres,
}

function postgresErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }

  return null
}

async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createApp(dependencies: AppDependencies = defaultDependencies) {
  const app = new Hono<{ Bindings: Bindings }>()

  app.use('*', requestId())
  app.use(
    '/v1/*',
    cors({
      origin: (origin, context) =>
        origin === context.env.BACKOFFICE_ORIGIN || origin === context.env.POS_ORIGIN ? origin : '',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Tenant-Id',
        'X-POS-Device-Token',
        'X-POS-Session-Token',
      ],
    }),
  )

  app.get('/health', (context) => {
    const payload = healthResponseSchema.parse({
      service: 'hustlero-hcs-api',
      status: 'ok',
      environment: readEnvironment(context.env),
      requestId: context.get('requestId'),
      timestamp: new Date().toISOString(),
    })

    return context.json(payload)
  })

  app.get('/v1/me', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))

    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'A valid bearer access token is required.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const authenticatedUser = await dependencies.verifyAccessToken(accessToken, context.env)

    if (!authenticatedUser) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(authenticatedUser.userId, context.env)
    const payload = sessionContextResponseSchema.parse({
      userId: authenticatedUser.userId,
      tenants,
    })

    return context.json(payload)
  })

  app.post('/v1/tenants', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before creating a business.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = tenantBootstrapRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_BUSINESS_DETAILS',
            message: 'Check the business and main location details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.bootstrapTenant(
        user.userId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )

      return context.json(tenantBootstrapResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS01') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different business details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'BUSINESS_SLUG_TAKEN',
              message: 'This business URL identifier is already in use.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS02') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'ACCOUNT_NOT_FOUND',
              message: 'Your account is no longer available. Sign in again.',
              requestId: context.get('requestId'),
            },
          }),
          401,
        )
      }

      throw error
    }
  })

  app.get('/v1/catalog', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view products.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to view its products.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    try {
      return context.json(
        catalogResponseSchema.parse(await dependencies.loadCatalog(user.userId, tenant.tenantId, context.env)),
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      throw error
    }
  })

  app.post('/v1/catalog/products', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before adding a product.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before adding a product.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = catalogProductCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PRODUCT_DETAILS',
            message: 'Check the product, SKU, barcode, and price details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.createCatalogProduct(
        user.userId,
        tenant.tenantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogProductCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different product details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'DUPLICATE_SKU_OR_BARCODE',
              message: 'The SKU or barcode is already used by another product.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS11') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_PRODUCT_DETAILS',
              message: 'Check the product, SKU, barcode, and price details.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      }
      throw error
    }
  })

  app.post('/v1/catalog/products/:productId/variants', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before adding a product variant.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    const productId = context.req.param('productId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'The product reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before adding a product variant.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = catalogVariantCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'Check the variant, SKU, barcode, and price details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.createCatalogVariant(
        user.userId,
        tenant.tenantId,
        productId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogVariantCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different variant details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'DUPLICATE_SKU_OR_BARCODE',
              message: 'The SKU or barcode is already used by another variant.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS11' || code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS12' ? 'PRODUCT_NOT_FOUND' : 'INVALID_VARIANT_DETAILS',
              message:
                code === 'HCS12' ? 'The product was not found.' : 'Check the variant, SKU, barcode, and price details.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS12' ? 404 : 400,
        )
      }
      throw error
    }
  })

  app.patch('/v1/catalog/products/:productId/variants/:variantId', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before editing a product variant.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const productId = context.req.param('productId')
    const variantId = context.req.param('variantId')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(productId) || !uuidPattern.test(variantId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'The product or variant reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before editing a product variant.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const body: unknown = await context.req.json().catch(() => null)
    const parsed = catalogVariantUpdateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'Check the variant, SKU, barcode, and price details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.updateCatalogVariant(
        user.userId,
        tenant.tenantId,
        productId,
        variantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogVariantUpdateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === '23505' ? 'DUPLICATE_SKU_OR_BARCODE' : 'IDEMPOTENCY_KEY_CONFLICT',
              message:
                code === '23505'
                  ? 'The SKU or barcode is already used by another variant.'
                  : 'This request key was already used for different variant details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS11' || code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS12' ? 'VARIANT_NOT_FOUND' : 'INVALID_VARIANT_DETAILS',
              message: code === 'HCS12' ? 'The product variant was not found.' : 'Check the variant details.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS12' ? 404 : 400,
        )
      }
      throw error
    }
  })

  app.delete('/v1/catalog/products/:productId/variants/:variantId', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before removing a product variant.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const productId = context.req.param('productId')
    const variantId = context.req.param('variantId')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(productId) || !uuidPattern.test(variantId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'The product or variant reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before removing a product variant.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    try {
      const identity = { productId, variantId }
      const response = await dependencies.deactivateCatalogVariant(
        user.userId,
        tenant.tenantId,
        productId,
        variantId,
        idempotencyKey,
        await requestHash(identity),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogVariantDeactivateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS13') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS13' ? 'LAST_ACTIVE_VARIANT' : 'IDEMPOTENCY_KEY_CONFLICT',
              message:
                code === 'HCS13'
                  ? 'A product must keep at least one active variant.'
                  : 'This request key was already used for a different variant.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VARIANT_NOT_FOUND',
              message: 'The product variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      throw error
    }
  })

  app.patch('/v1/catalog/products/:productId', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before editing a product.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const productId = context.req.param('productId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PRODUCT_DETAILS',
            message: 'The product reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before editing a product.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const body: unknown = await context.req.json().catch(() => null)
    const parsed = catalogProductUpdateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PRODUCT_DETAILS',
            message: 'Check the product name, category, and description.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.updateCatalogProduct(
        user.userId,
        tenant.tenantId,
        productId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogProductUpdateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different product details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS11' || code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS12' ? 'PRODUCT_NOT_FOUND' : 'INVALID_PRODUCT_DETAILS',
              message:
                code === 'HCS12' ? 'The product was not found.' : 'Check the product name, category, and description.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS12' ? 404 : 400,
        )
      }
      throw error
    }
  })

  const resolvePurchasingTenant = async (context: Context<{ Bindings: Bindings }>) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) return null
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) return null
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    const tenant = requestedTenantId
      ? tenants.find((entry) => entry.tenantId === requestedTenantId)
      : tenants.length === 1
        ? tenants[0]
        : undefined
    return tenant ? { userId: user.userId, tenantId: tenant.tenantId } : null
  }

  app.get('/v1/purchasing', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'PURCHASING_ACCESS_DENIED',
            message: 'Sign in and select a business to view purchasing.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        purchasingContextSchema.parse(
          await dependencies.loadPurchasing(resolved.userId, resolved.tenantId, context.env),
        ),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCS30')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'PURCHASING_ACCESS_DENIED',
              message: 'You do not have purchasing permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  app.post('/v1/purchasing/suppliers', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'PURCHASING_ACCESS_DENIED',
            message: 'Sign in and select a business before adding a supplier.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const parsed = supplierCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_SUPPLIER',
            message: 'Check the supplier details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.createSupplier(
        resolved.userId,
        resolved.tenantId,
        parsed.data,
        key,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(supplierCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was used for another supplier.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS30')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'PURCHASING_ACCESS_DENIED',
              message: 'You do not have purchasing permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS32')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'DUPLICATE_SUPPLIER',
              message: 'An active supplier with this name already exists.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.post('/v1/purchasing/orders', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'PURCHASING_ACCESS_DENIED',
            message: 'Sign in and select a business before creating a purchase order.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const parsed = purchaseOrderCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PURCHASE_ORDER',
            message: 'Check the supplier, location, and order lines.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.createPurchaseOrder(
        resolved.userId,
        resolved.tenantId,
        parsed.data,
        key,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(purchaseOrderCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was used for another purchase order.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS30' || code === 'HCS34')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS34' ? 'PURCHASING_REFERENCE_NOT_FOUND' : 'PURCHASING_ACCESS_DENIED',
              message:
                code === 'HCS34' ? 'The supplier or location was not found.' : 'You do not have purchasing permission.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS34' ? 404 : 403,
        )
      if (code === 'HCS35')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'DUPLICATE_PURCHASE_ORDER',
              message: 'The order number or product line is already used.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.post('/v1/purchasing/orders/:purchaseOrderId/send', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    const id = context.req.param('purchaseOrderId')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'PURCHASING_ACCESS_DENIED',
            message: 'Sign in and select a business before sending an order.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.sendPurchaseOrder(
        resolved.userId,
        resolved.tenantId,
        id,
        key,
        await requestHash({ id }),
        context.get('requestId'),
        context.env,
      )
      return context.json(purchaseOrderSendResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS37')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS08' ? 'IDEMPOTENCY_KEY_CONFLICT' : 'PURCHASE_ORDER_STATE_CONFLICT',
              message:
                code === 'HCS08'
                  ? 'This request key was used for another order action.'
                  : 'Only draft purchase orders can be sent.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS36')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'PURCHASE_ORDER_NOT_FOUND',
              message: 'Purchase order was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      throw error
    }
  })

  app.post('/v1/purchasing/orders/:purchaseOrderId/receive', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    const id = context.req.param('purchaseOrderId')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'PURCHASING_ACCESS_DENIED',
            message: 'Sign in and select a business before receiving stock.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const parsed = purchaseReceiptRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_RECEIPT',
            message: 'Enter at least one positive receiving quantity.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.receivePurchaseOrder(
        resolved.userId,
        resolved.tenantId,
        id,
        parsed.data,
        key,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(purchaseReceiptResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS40')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS08' ? 'IDEMPOTENCY_KEY_CONFLICT' : 'RECEIPT_EXCEEDS_ORDER',
              message:
                code === 'HCS08'
                  ? 'This request key was used for another receipt.'
                  : 'Receipt exceeds the remaining ordered quantity.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS36' || code === 'HCS39')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'PURCHASE_ORDER_NOT_FOUND',
              message: 'The purchase order or line was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      throw error
    }
  })

  app.get('/v1/transfers', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TRANSFER_ACCESS_DENIED',
            message: 'Sign in and select a business to view transfers.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        transferContextSchema.parse(await dependencies.loadTransfers(resolved.userId, resolved.tenantId, context.env)),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCS50')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_ACCESS_DENIED',
              message: 'You do not have transfer permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  app.post('/v1/transfers', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TRANSFER_ACCESS_DENIED',
            message: 'Sign in and select a business before creating a transfer.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const parsed = transferCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_TRANSFER',
            message: 'Check the transfer locations and items.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        transferCreateResponseSchema.parse(
          await dependencies.createTransfer(
            resolved.userId,
            resolved.tenantId,
            parsed.data,
            key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS50')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_ACCESS_DENIED',
              message: 'You do not have transfer permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS52' || code === 'HCS53')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_REFERENCE_NOT_FOUND',
              message: 'The location or variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      if (code === 'HCS08' || code === 'HCS54')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_CONFLICT',
              message: 'The transfer number or idempotency key is already in use.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.post('/v1/transfers/:transferId/dispatch', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    const id = context.req.param('transferId')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TRANSFER_ACCESS_DENIED',
            message: 'Sign in and select a business before dispatching.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        transferDispatchResponseSchema.parse(
          await dependencies.dispatchTransfer(
            resolved.userId,
            resolved.tenantId,
            id,
            key,
            await requestHash({ id }),
            context.get('requestId'),
            context.env,
          ),
        ),
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS57')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INSUFFICIENT_SOURCE_STOCK',
              message: 'Source stock is insufficient.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS55' || code === 'HCS56')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_STATE_CONFLICT',
              message: 'Transfer was not found or is not a draft.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.post('/v1/transfers/:transferId/receive', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    const id = context.req.param('transferId')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TRANSFER_ACCESS_DENIED',
            message: 'Sign in and select a business before receiving.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const parsed = transferReceiveRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_TRANSFER_RECEIPT',
            message: 'Enter at least one positive receiving quantity.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        transferReceiveResponseSchema.parse(
          await dependencies.receiveTransfer(
            resolved.userId,
            resolved.tenantId,
            id,
            parsed.data,
            key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS59')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_RECEIPT_EXCEEDS_QUANTITY',
              message: 'Receipt exceeds the transfer quantity.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS55' || code === 'HCS58')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'TRANSFER_NOT_RECEIVABLE',
              message: 'Transfer or item was not found or is not ready.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      throw error
    }
  })

  app.get('/v1/workforce', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'WORKFORCE_ACCESS_DENIED',
            message: 'Sign in and select a business to view workforce setup.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        workforceContextSchema.parse(await dependencies.loadWorkforce(resolved.userId, resolved.tenantId, context.env)),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCS60')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'WORKFORCE_ACCESS_DENIED',
              message: 'You do not have workforce permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  const workforceCommand = async (
    context: Context<{ Bindings: Bindings }>,
    kind: 'location' | 'employee' | 'register',
  ) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'WORKFORCE_ACCESS_DENIED',
            message: 'Sign in and select a business first.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const body: unknown = await context.req.json().catch(() => null)
    try {
      if (kind === 'location') {
        const parsed = locationCreateRequestSchema.safeParse(body)
        if (!parsed.success)
          return context.json(
            apiErrorResponseSchema.parse({
              error: {
                code: 'INVALID_LOCATION',
                message: 'Check the location details.',
                requestId: context.get('requestId'),
              },
            }),
            400,
          )
        return context.json(
          locationCreateResponseSchema.parse(
            await dependencies.createLocation(
              resolved.userId,
              resolved.tenantId,
              parsed.data,
              key,
              await requestHash(parsed.data),
              context.get('requestId'),
              context.env,
            ),
          ),
          201,
        )
      }
      if (kind === 'employee') {
        const parsed = employeeCreateRequestSchema.safeParse(body)
        if (!parsed.success)
          return context.json(
            apiErrorResponseSchema.parse({
              error: {
                code: 'INVALID_EMPLOYEE',
                message: 'Check employee, role, branches, and the 4 to 6 digit PIN.',
                requestId: context.get('requestId'),
              },
            }),
            400,
          )
        return context.json(
          employeeCreateResponseSchema.parse(
            await dependencies.createEmployee(
              resolved.userId,
              resolved.tenantId,
              parsed.data,
              key,
              await requestHash({ ...parsed.data, pin: '[REDACTED]' }),
              context.get('requestId'),
              context.env,
            ),
          ),
          201,
        )
      }
      const parsed = registerCreateRequestSchema.safeParse(body)
      if (!parsed.success)
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_REGISTER',
              message: 'Check the register and location details.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      return context.json(
        registerCreateResponseSchema.parse(
          await dependencies.createRegister(
            resolved.userId,
            resolved.tenantId,
            parsed.data,
            key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS60')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'WORKFORCE_ACCESS_DENIED',
              message: 'Owner access is required.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (['HCS62', 'HCS65', 'HCS67'].includes(code ?? ''))
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'WORKFORCE_CONFLICT',
              message: 'That code is already in use.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (['HCS64', 'HCS66'].includes(code ?? ''))
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'WORKFORCE_REFERENCE_NOT_FOUND',
              message: 'The selected role or location was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      throw error
    }
  }
  app.post('/v1/workforce/locations', (context) => workforceCommand(context, 'location'))
  app.post('/v1/workforce/employees', (context) => workforceCommand(context, 'employee'))
  app.post('/v1/workforce/registers', (context) => workforceCommand(context, 'register'))

  app.get('/v1/register-operations', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'REGISTER_ACCESS_DENIED',
            message: 'Sign in and select a business to view register operations.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        registerOperationsContextSchema.parse(
          await dependencies.loadRegisterOperations(resolved.userId, resolved.tenantId, context.env),
        ),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCS71')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_ACCESS_DENIED',
              message: 'You do not have register operations permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  const registerCommandContext = async (context: Context<{ Bindings: Bindings }>) => {
    const resolved = await resolvePurchasingTenant(context)
    const key = context.req.header('idempotency-key')
    if (!resolved)
      return {
        error: context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_ACCESS_DENIED',
              message: 'Sign in and select a business first.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        ),
      }
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return {
        error: context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_REQUIRED',
              message: 'A valid Idempotency-Key is required.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        ),
      }
    return { resolved, key }
  }

  app.post('/v1/payment-methods', async (context) => {
    const command = await registerCommandContext(context)
    if ('error' in command) return command.error
    const parsed = paymentMethodCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PAYMENT_METHOD',
            message: 'Check the payment method details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        paymentMethodCreateResponseSchema.parse(
          await dependencies.createPaymentMethod(
            command.resolved.userId,
            command.resolved.tenantId,
            parsed.data,
            command.key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS71')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_ACCESS_DENIED',
              message: 'Owner access is required.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS73')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'PAYMENT_METHOD_CONFLICT',
              message: 'That payment method code is already in use.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.post('/v1/register-sessions/open', async (context) => {
    const command = await registerCommandContext(context)
    if ('error' in command) return command.error
    const parsed = registerSessionOpenRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_REGISTER_OPEN',
            message: 'Select a register, assigned employee, and valid opening cash.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        registerSessionOpenResponseSchema.parse(
          await dependencies.openRegisterSession(
            command.resolved.userId,
            command.resolved.tenantId,
            parsed.data,
            command.key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS71')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_ACCESS_DENIED',
              message: 'Owner access is required.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS77')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_ALREADY_OPEN',
              message: 'This register already has an open session.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS75' || code === 'HCS76')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_REFERENCE_INVALID',
              message: 'The register or assigned employee is unavailable.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      throw error
    }
  })

  app.post('/v1/register-sessions/:sessionId/close', async (context) => {
    const command = await registerCommandContext(context)
    if ('error' in command) return command.error
    const sessionId = context.req.param('sessionId')
    const parsed = registerSessionCloseRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId) ||
      !parsed.success
    )
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_REGISTER_CLOSE',
            message: 'Provide a valid session and counted cash.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        registerSessionCloseResponseSchema.parse(
          await dependencies.closeRegisterSession(
            command.resolved.userId,
            command.resolved.tenantId,
            sessionId,
            parsed.data,
            command.key,
            await requestHash({ sessionId, ...parsed.data }),
            context.get('requestId'),
            context.env,
          ),
        ),
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS71')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_ACCESS_DENIED',
              message: 'Owner access is required.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS78')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_SESSION_NOT_OPEN',
              message: 'The register session is no longer open.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.get('/v1/pos/devices', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_DEVICE_ACCESS_DENIED',
            message: 'Sign in and select a business to view POS devices.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        posDeviceContextSchema.parse(
          await dependencies.loadPosDevices(resolved.userId, resolved.tenantId, context.env),
        ),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCS80')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'POS_DEVICE_ACCESS_DENIED',
              message: 'You do not have POS device permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  app.post('/v1/pos/devices/activation-codes', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_DEVICE_ACCESS_DENIED',
            message: 'Sign in and select a business before creating a device activation.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    const parsed = posDeviceActivationCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_POS_DEVICE',
            message: 'Select an active register and enter a device name.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const activationCode = randomHex(6).toUpperCase()
    try {
      const record = await dependencies.createPosDeviceActivation(
        resolved.userId,
        resolved.tenantId,
        parsed.data,
        await sha256(activationCode),
        context.get('requestId'),
        context.env,
      )
      return context.json(posDeviceActivationCreateResponseSchema.parse({ ...record, activationCode }), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS80')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'POS_DEVICE_ACCESS_DENIED',
              message: 'Owner access is required.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS82')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'REGISTER_UNAVAILABLE',
              message: 'The selected register is unavailable.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      throw error
    }
  })

  app.post('/v1/pos/devices/activate', async (context) => {
    const parsed = posDeviceActivateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'DEVICE_ACTIVATION_INVALID',
            message: 'Enter a valid 12-character activation code.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const deviceToken = randomHex(32)
    const record = await dependencies.activatePosDevice(
      await sha256(parsed.data.activationCode),
      await sha256(deviceToken),
      context.get('requestId'),
      context.env,
    )
    if (record.status === 'invalid')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'DEVICE_ACTIVATION_INVALID',
            message: 'This activation code is invalid, expired, or already used.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    return context.json(posDeviceActivateResponseSchema.parse({ deviceToken, device: record.device }))
  })

  app.post('/v1/pos/sessions/pin-login', async (context) => {
    const deviceToken = context.req.header('x-pos-device-token')
    const parsed = posPinLoginRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!deviceToken || !/^[a-f0-9]{64}$/.test(deviceToken) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_LOGIN_INVALID',
            message: 'Check the employee code and PIN.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const sessionToken = randomHex(32)
    const record = await dependencies.authenticatePosEmployee(
      await sha256(deviceToken),
      parsed.data,
      await sha256(sessionToken),
      context.get('requestId'),
      context.env,
    )
    if (record.status === 'locked')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_LOGIN_LOCKED',
            message: `Too many failed attempts. Try again after ${new Date(record.lockedUntil).toLocaleTimeString('en-PH')}.`,
            requestId: context.get('requestId'),
          },
        }),
        429,
      )
    if (record.status === 'invalid')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_LOGIN_INVALID',
            message: 'Check the employee code and PIN.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    return context.json(
      posPinLoginResponseSchema.parse({
        sessionToken,
        expiresAt: record.expiresAt,
        employee: record.employee,
        device: record.device,
      }),
    )
  })

  const readPosSessionHash = async (context: Context<{ Bindings: Bindings }>) => {
    const token = context.req.header('x-pos-session-token')
    return token && /^[a-f0-9]{64}$/.test(token) ? sha256(token) : null
  }

  const posError = (context: Context<{ Bindings: Bindings }>, error: unknown) => {
    const code = postgresErrorCode(error)
    const requestId = context.get('requestId')
    if (code === 'HCS90')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'POS_SESSION_INVALID', message: 'Sign in to the POS again.', requestId },
        }),
        401,
      )
    if (code === 'HCS08')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This request key was already used for a different command.',
            requestId,
          },
        }),
        409,
      )
    if (code === 'HCS92')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'REGISTER_ALREADY_OPEN',
            message: 'This register is already open by another employee.',
            requestId,
          },
        }),
        409,
      )
    if (code === 'HCS93')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'POS_ACCESS_DENIED', message: 'Your role cannot perform this action.', requestId },
        }),
        403,
      )
    if (code === 'HCSB1')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'The selected customer is unavailable.', requestId },
        }),
        404,
      )
    if (code === 'HCSB2')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'INVALID_CUSTOMER', message: 'Check the customer name and contact details.', requestId },
        }),
        400,
      )
    if (code === 'HCSB3')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'CUSTOMER_ALREADY_EXISTS', message: 'That email or phone is already in use.', requestId },
        }),
        409,
      )
    if (code === 'HCS95')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'REGISTER_NOT_OPEN', message: 'Open this register before completing a sale.', requestId },
        }),
        409,
      )
    if (code === 'HCS98')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 'One or more items no longer have enough available stock.',
            requestId,
          },
        }),
        409,
      )
    if (code && ['HCS91', 'HCS94', 'HCS97', 'HCS99'].includes(code))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_POS_SALE',
            message: error instanceof Error ? error.message : 'Check the sale details.',
            requestId,
          },
        }),
        400,
      )
    if (code === 'HCS96')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CASH_PAYMENT_UNAVAILABLE',
            message: 'Configure an active cash payment method first.',
            requestId,
          },
        }),
        409,
      )
    throw error
  }

  app.get('/v1/pos/context', async (context) => {
    const sessionHash = await readPosSessionHash(context)
    if (!sessionHash)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_SESSION_REQUIRED',
            message: 'Sign in to the POS first.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    try {
      return context.json(posSalesContextSchema.parse(await dependencies.loadPosSalesContext(sessionHash, context.env)))
    } catch (error) {
      return posError(context, error)
    }
  })

  app.get('/v1/pos/customers', async (context) => {
    const sessionHash = await readPosSessionHash(context)
    if (!sessionHash)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_SESSION_REQUIRED',
            message: 'Sign in to the POS first.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    try {
      return context.json(
        posCustomerSearchResponseSchema.parse(
          await dependencies.searchPosCustomers(sessionHash, context.req.query('q') ?? '', context.env),
        ),
      )
    } catch (error) {
      return posError(context, error)
    }
  })

  app.post('/v1/pos/customers', async (context) => {
    const sessionHash = await readPosSessionHash(context)
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = posCustomerCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!sessionHash)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_SESSION_REQUIRED',
            message: 'Sign in to the POS first.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_CUSTOMER',
            message: 'Enter a name and at least one contact method.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        posCustomerCreateResponseSchema.parse(
          await dependencies.createPosCustomer(
            sessionHash,
            parsed.data,
            idempotencyKey,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      return posError(context, error)
    }
  })

  app.post('/v1/pos/register-sessions/open', async (context) => {
    const sessionHash = await readPosSessionHash(context)
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = posRegisterOpenRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!sessionHash)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_SESSION_REQUIRED',
            message: 'Sign in to the POS first.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_REGISTER_OPEN',
            message: 'Enter valid starting cash and retry.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.openPosRegisterSession(
        sessionHash,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(posRegisterOpenResponseSchema.parse(response), 201)
    } catch (error) {
      return posError(context, error)
    }
  })

  app.post('/v1/pos/sales/complete', async (context) => {
    const sessionHash = await readPosSessionHash(context)
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = posCashSaleCompleteRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!sessionHash)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'POS_SESSION_REQUIRED',
            message: 'Sign in to the POS first.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_POS_SALE',
            message: 'Check the cart and cash received.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.completePosCashSale(
        sessionHash,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(posCashSaleCompleteResponseSchema.parse(response), 201)
    } catch (error) {
      return posError(context, error)
    }
  })

  const loyaltyError = (context: Context<{ Bindings: Bindings }>, error: unknown) => {
    const code = postgresErrorCode(error)
    const requestId = context.get('requestId')
    if (code === 'HCSC0')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'LOYALTY_ACCESS_DENIED', message: 'Your role cannot perform this loyalty action.', requestId },
        }),
        403,
      )
    if (code === 'HCSC2')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'INVALID_LOYALTY_POLICY', message: 'Check the loyalty policy settings.', requestId },
        }),
        400,
      )
    if (code === 'HCS08')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This request key was already used for another loyalty action.',
            requestId,
          },
        }),
        409,
      )
    throw error
  }

  app.get('/v1/loyalty', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'LOYALTY_ACCESS_DENIED',
            message: 'Sign in and select a business to view loyalty.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        loyaltyContextSchema.parse(await dependencies.loadLoyalty(resolved.userId, resolved.tenantId, context.env)),
      )
    } catch (error) {
      return loyaltyError(context, error)
    }
  })

  app.patch('/v1/loyalty/policy', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = loyaltyPolicyUpdateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'LOYALTY_ACCESS_DENIED',
            message: 'Sign in and select a business.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_LOYALTY_POLICY',
            message: 'Set a positive spend amount before enabling loyalty.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        loyaltyPolicyUpdateResponseSchema.parse(
          await dependencies.updateLoyaltyPolicy(
            resolved.userId,
            resolved.tenantId,
            parsed.data,
            idempotencyKey,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
      )
    } catch (error) {
      return loyaltyError(context, error)
    }
  })

  const customerError = (context: Context<{ Bindings: Bindings }>, error: unknown) => {
    const code = postgresErrorCode(error)
    const requestId = context.get('requestId')
    if (code === 'HCSB0')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_ACCESS_DENIED',
            message: 'Your role cannot perform this customer action.',
            requestId,
          },
        }),
        403,
      )
    if (code === 'HCSB1')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'The customer was not found.', requestId },
        }),
        404,
      )
    if (code === 'HCSB2')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_CUSTOMER',
            message: error instanceof Error ? error.message : 'Check the customer details.',
            requestId,
          },
        }),
        400,
      )
    if (code === 'HCSB3')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'CUSTOMER_ALREADY_EXISTS', message: 'That email or phone is already in use.', requestId },
        }),
        409,
      )
    if (code === 'HCS08')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This request key was already used for another customer action.',
            requestId,
          },
        }),
        409,
      )
    throw error
  }

  const customerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  app.get('/v1/customers', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_ACCESS_DENIED',
            message: 'Sign in and select a business to view customers.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        customersContextSchema.parse(
          await dependencies.loadCustomers(
            resolved.userId,
            resolved.tenantId,
            context.req.query('q') ?? '',
            context.env,
          ),
        ),
      )
    } catch (error) {
      return customerError(context, error)
    }
  })

  app.post('/v1/customers', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = customerCreateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_ACCESS_DENIED',
            message: 'Sign in and select a business.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_CUSTOMER',
            message: 'Enter a valid customer name and contact method.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        customerCreateResponseSchema.parse(
          await dependencies.createCustomer(
            resolved.userId,
            resolved.tenantId,
            parsed.data,
            idempotencyKey,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      return customerError(context, error)
    }
  })

  app.get('/v1/customers/:customerId', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const customerId = context.req.param('customerId')
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_ACCESS_DENIED',
            message: 'Sign in and select a business.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!customerIdPattern.test(customerId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'The customer was not found.',
            requestId: context.get('requestId'),
          },
        }),
        404,
      )
    try {
      return context.json(
        customerDetailSchema.parse(
          await dependencies.loadCustomer(resolved.userId, resolved.tenantId, customerId, context.env),
        ),
      )
    } catch (error) {
      return customerError(context, error)
    }
  })

  app.patch('/v1/customers/:customerId', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const customerId = context.req.param('customerId')
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = customerUpdateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_ACCESS_DENIED',
            message: 'Sign in and select a business.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!customerIdPattern.test(customerId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'The customer was not found.',
            requestId: context.get('requestId'),
          },
        }),
        404,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_CUSTOMER',
            message: 'Check the customer details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        customerUpdateResponseSchema.parse(
          await dependencies.updateCustomer(
            resolved.userId,
            resolved.tenantId,
            customerId,
            parsed.data,
            idempotencyKey,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
      )
    } catch (error) {
      return customerError(context, error)
    }
  })

  app.post('/v1/customers/:customerId/notes', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const customerId = context.req.param('customerId')
    const idempotencyKey = context.req.header('idempotency-key')
    const parsed = customerNoteRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_ACCESS_DENIED',
            message: 'Sign in and select a business.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!customerIdPattern.test(customerId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'The customer was not found.',
            requestId: context.get('requestId'),
          },
        }),
        404,
      )
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_CUSTOMER_NOTE',
            message: 'Enter a customer note.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        customerNoteResponseSchema.parse(
          await dependencies.addCustomerNote(
            resolved.userId,
            resolved.tenantId,
            customerId,
            parsed.data,
            idempotencyKey,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      return customerError(context, error)
    }
  })

  app.get('/v1/sales', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'SALES_ACCESS_DENIED',
            message: 'Sign in and select a business to view sales.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    try {
      return context.json(
        salesContextSchema.parse(await dependencies.loadSales(resolved.userId, resolved.tenantId, context.env)),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCSA0')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'SALES_ACCESS_DENIED',
              message: 'You do not have permission to view sales.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  const saleReversalError = (context: Context<{ Bindings: Bindings }>, error: unknown) => {
    const code = postgresErrorCode(error)
    const requestId = context.get('requestId')
    if (code === 'HCSA0')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'SALES_ACCESS_DENIED', message: 'Your role cannot reverse this sale.', requestId },
        }),
        403,
      )
    if (code === 'HCSA1' || code === 'HCSA4')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'SALE_NOT_FOUND', message: 'The receipt or sale line was not found.', requestId },
        }),
        404,
      )
    if (code === 'HCSA2')
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'INVALID_SALE_REVERSAL', message: 'Check the reason and refund quantities.', requestId },
        }),
        400,
      )
    if (code === 'HCS08')
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This request key was already used for another reversal.',
            requestId,
          },
        }),
        409,
      )
    if (code && ['HCSA3', 'HCSA5', 'HCSA6', 'HCSA7'].includes(code))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'SALE_REVERSAL_CONFLICT',
            message: error instanceof Error ? error.message : 'This receipt cannot be reversed.',
            requestId,
          },
        }),
        409,
      )
    throw error
  }

  app.get('/v1/sales/:saleId', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const saleId = context.req.param('saleId')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'SALES_ACCESS_DENIED',
            message: 'Sign in and select a business to view this receipt.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!uuidPattern.test(saleId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'SALE_NOT_FOUND', message: 'The receipt was not found.', requestId: context.get('requestId') },
        }),
        404,
      )
    try {
      return context.json(
        saleReceiptDetailSchema.parse(
          await dependencies.loadSaleReceipt(resolved.userId, resolved.tenantId, saleId, context.env),
        ),
      )
    } catch (error) {
      return saleReversalError(context, error)
    }
  })

  app.post('/v1/sales/:saleId/refunds', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const saleId = context.req.param('saleId')
    const key = context.req.header('idempotency-key')
    const parsed = saleRefundRequestSchema.safeParse(await context.req.json().catch(() => null))
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'SALES_ACCESS_DENIED',
            message: 'Sign in and select a business before refunding a sale.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!uuidPattern.test(saleId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'SALE_NOT_FOUND', message: 'The receipt was not found.', requestId: context.get('requestId') },
        }),
        404,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_SALE_REFUND',
            message: 'Select a valid quantity and enter a reason.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        saleReversalResponseSchema.parse(
          await dependencies.refundSale(
            resolved.userId,
            resolved.tenantId,
            saleId,
            parsed.data,
            key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      return saleReversalError(context, error)
    }
  })

  app.post('/v1/sales/:saleId/void', async (context) => {
    const resolved = await resolvePurchasingTenant(context)
    const saleId = context.req.param('saleId')
    const key = context.req.header('idempotency-key')
    const parsed = saleVoidRequestSchema.safeParse(await context.req.json().catch(() => null))
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!resolved)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'SALES_ACCESS_DENIED',
            message: 'Sign in and select a business before voiding a sale.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    if (!uuidPattern.test(saleId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: { code: 'SALE_NOT_FOUND', message: 'The receipt was not found.', requestId: context.get('requestId') },
        }),
        404,
      )
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key) || !parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_SALE_VOID',
            message: 'Enter a valid void reason.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      return context.json(
        saleReversalResponseSchema.parse(
          await dependencies.voidSale(
            resolved.userId,
            resolved.tenantId,
            saleId,
            parsed.data,
            key,
            await requestHash(parsed.data),
            context.get('requestId'),
            context.env,
          ),
        ),
        201,
      )
    } catch (error) {
      return saleReversalError(context, error)
    }
  })

  app.get('/v1/approvals', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view approvals.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    const tenant = requestedTenantId
      ? tenants.find((entry) => entry.tenantId === requestedTenantId)
      : tenants.length === 1
        ? tenants[0]
        : undefined
    if (!tenant)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: requestedTenantId ? 'APPROVAL_ACCESS_DENIED' : 'TENANT_SELECTION_REQUIRED',
            message: requestedTenantId
              ? 'You do not have access to these approvals.'
              : 'Select a business to view approvals.',
            requestId: context.get('requestId'),
          },
        }),
        requestedTenantId ? 403 : 409,
      )
    try {
      const response = await dependencies.loadApprovalCenter(user.userId, tenant.tenantId, context.env)
      context.header('Cache-Control', 'private, no-store')
      return context.json(
        approvalCenterSchema.parse({
          ...response,
          canManage: tenant.isOwner || tenant.permissions.includes('approvals.manage'),
        }),
      )
    } catch (error) {
      if (postgresErrorCode(error) === 'HCS23')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'APPROVAL_ACCESS_DENIED',
              message: 'You do not have approval permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      throw error
    }
  })

  app.patch('/v1/approvals/policy', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before changing an approval policy.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    const tenant = requestedTenantId
      ? tenants.find((entry) => entry.tenantId === requestedTenantId)
      : tenants.length === 1
        ? tenants[0]
        : undefined
    if (!tenant)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: requestedTenantId ? 'APPROVAL_ACCESS_DENIED' : 'TENANT_SELECTION_REQUIRED',
            message: requestedTenantId
              ? 'You do not have access to this approval policy.'
              : 'Select a business before changing approval policy.',
            requestId: context.get('requestId'),
          },
        }),
        requestedTenantId ? 403 : 409,
      )
    const parsed = approvalPolicyUpdateRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_APPROVAL_POLICY',
            message: 'Enter a non-negative quantity threshold or disable the threshold.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.updateApprovalPolicy(
        user.userId,
        tenant.tenantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(approvalPolicyUpdateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for another approval policy.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS23')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'APPROVAL_ACCESS_DENIED',
              message: 'Only an authorized owner can change this approval policy.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS24')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_APPROVAL_POLICY',
              message: 'Check the inventory adjustment threshold.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      throw error
    }
  })

  app.post('/v1/approvals/:approvalRequestId/decision', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before deciding an approval.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const approvalRequestId = context.req.param('approvalRequestId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalRequestId))
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_APPROVAL_DECISION',
            message: 'The approval request reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    const tenant = requestedTenantId
      ? tenants.find((entry) => entry.tenantId === requestedTenantId)
      : tenants.length === 1
        ? tenants[0]
        : undefined
    if (!tenant)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: requestedTenantId ? 'APPROVAL_ACCESS_DENIED' : 'TENANT_SELECTION_REQUIRED',
            message: requestedTenantId
              ? 'You do not have access to this approval request.'
              : 'Select a business before deciding an approval.',
            requestId: context.get('requestId'),
          },
        }),
        requestedTenantId ? 403 : 409,
      )
    const parsed = approvalDecisionRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success)
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_APPROVAL_DECISION',
            message: 'Choose approve or reject and keep the note within 240 characters.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    try {
      const response = await dependencies.decideApprovalRequest(
        user.userId,
        tenant.tenantId,
        approvalRequestId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(approvalDecisionResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS26')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS08' ? 'IDEMPOTENCY_KEY_CONFLICT' : 'APPROVAL_ALREADY_DECIDED',
              message:
                code === 'HCS08'
                  ? 'This request key was already used for another approval decision.'
                  : 'This approval request was already decided.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      if (code === 'HCS23')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'APPROVAL_ACCESS_DENIED',
              message: 'You do not have permission to decide approvals.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      if (code === 'HCS25')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'APPROVAL_NOT_FOUND',
              message: 'The approval request was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      if (code === 'HCS22')
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVENTORY_STATE_CONFLICT',
              message: 'The approved adjustment would make available stock negative.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      throw error
    }
  })

  app.get('/v1/inventory/stock', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view inventory stock.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to view inventory stock.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const locationId = context.req.query('locationId') ?? null
    if (
      locationId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(locationId)
    ) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_LOCATION',
            message: 'The inventory location reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.loadInventoryStock(user.userId, tenant.tenantId, locationId, context.env)
      return context.json(inventoryStockContextSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'LOCATION_NOT_FOUND',
              message: 'The inventory location was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      throw error
    }
  })

  app.get('/v1/inventory/movements', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view inventory movements.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to view inventory movements.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const locationId = context.req.query('locationId')
    const variantId = context.req.query('variantId') ?? null
    const limitText = context.req.query('limit') ?? '100'
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    const limit = Number(limitText)
    if (!locationId || !uuidPattern.test(locationId) || (variantId !== null && !uuidPattern.test(variantId))) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_INVENTORY_FILTER',
            message: 'Choose a valid inventory location and variant.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_INVENTORY_FILTER',
            message: 'Movement limit must be between 1 and 200.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.loadInventoryMovements(
        user.userId,
        tenant.tenantId,
        locationId,
        variantId,
        limit,
        context.env,
      )
      return context.json(inventoryMovementContextSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19' || code === 'HCS21') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS19' ? 'LOCATION_NOT_FOUND' : 'VARIANT_NOT_FOUND',
              message:
                code === 'HCS19' ? 'The inventory location was not found.' : 'The inventory variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      throw error
    }
  })

  app.get('/v1/inventory/opening-balances', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view opening inventory.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to view opening inventory.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const locationId = context.req.query('locationId') ?? null
    if (
      locationId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(locationId)
    ) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_LOCATION',
            message: 'The inventory location reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.loadOpeningInventory(user.userId, tenant.tenantId, locationId, context.env)
      return context.json(openingInventoryContextSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'LOCATION_NOT_FOUND',
              message: 'The inventory location was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      throw error
    }
  })

  app.post('/v1/inventory/adjustments', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before adjusting inventory.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before adjusting inventory.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const body: unknown = await context.req.json().catch(() => null)
    const parsed = inventoryAdjustmentCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_INVENTORY_ADJUSTMENT',
            message: 'Enter a non-zero quantity and a reason at least three characters long.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.recordInventoryAdjustment(
        user.userId,
        tenant.tenantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(inventoryAdjustmentCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for a different adjustment.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19' || code === 'HCS21') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS19' ? 'LOCATION_NOT_FOUND' : 'VARIANT_NOT_FOUND',
              message:
                code === 'HCS19' ? 'The inventory location was not found.' : 'The inventory variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      if (code === 'HCS20' || code === '22P02' || code === '22003') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_INVENTORY_ADJUSTMENT',
              message: 'Check the adjustment quantity, unit cost, and reason.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      }
      if (code === 'HCS22') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVENTORY_STATE_CONFLICT',
              message:
                'Record opening inventory first, or reduce the adjustment so available stock does not go negative.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      throw error
    }
  })

  app.post('/v1/inventory/opening-balances', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before recording opening inventory.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before recording opening inventory.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const body: unknown = await context.req.json().catch(() => null)
    const parsed = openingInventoryCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_OPENING_INVENTORY',
            message: 'Add at least one positive quantity and a valid unit cost.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.recordOpeningInventory(
        user.userId,
        tenant.tenantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(openingInventoryCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS16' || code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS08' ? 'IDEMPOTENCY_KEY_CONFLICT' : 'OPENING_INVENTORY_EXISTS',
              message:
                code === 'HCS08'
                  ? 'This request key was already used for different opening inventory.'
                  : 'Opening inventory already exists, or stock has already moved for one of these variants.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19' || code === 'HCS21') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS19' ? 'LOCATION_NOT_FOUND' : 'VARIANT_NOT_FOUND',
              message:
                code === 'HCS19' ? 'The inventory location was not found.' : 'An inventory variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      if (code === 'HCS20' || code === '22P02' || code === '22003') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_OPENING_INVENTORY',
              message: 'Check the opening quantities and unit costs.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      }
      throw error
    }
  })

  app.get('/v1/onboarding', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view business setup.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to continue setup.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }

    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]

    if (!tenant || !tenant.isOwner) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'ONBOARDING_ACCESS_DENIED',
            message: 'Business setup is available to its owner.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const setup = await dependencies.loadOnboarding(tenant.tenantId, context.env)
    return context.json(
      onboardingResponseSchema.parse({
        tenantId: tenant.tenantId,
        readyToSell: false,
        businessProfile: setup.businessProfile,
        featureOptions: setup.featureOptions,
        steps: [
          { code: 'business', status: 'complete' },
          { code: 'main_location', status: setup.hasMainLocation ? 'complete' : 'pending' },
          { code: 'business_questions', status: setup.businessQuestionsComplete ? 'complete' : 'pending' },
          { code: 'feature_selection', status: setup.featureSelectionComplete ? 'complete' : 'pending' },
          { code: 'products', status: setup.hasProducts ? 'complete' : 'pending' },
          { code: 'opening_inventory', status: setup.hasOpeningInventory ? 'complete' : 'pending' },
          { code: 'payment_methods', status: 'pending' },
          { code: 'basic_fund_setup', status: 'pending' },
          { code: 'employees', status: 'pending' },
          { code: 'register', status: 'pending' },
          { code: 'pos_activation', status: 'pending' },
          { code: 'test_sale', status: 'pending' },
        ],
      }),
    )
  })

  app.patch('/v1/onboarding', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to continue business setup.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to continue setup.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }

    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant || !tenant.isOwner) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'ONBOARDING_ACCESS_DENIED',
            message: 'Business setup is available to its owner.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = onboardingUpdateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ONBOARDING_DETAILS',
            message: 'Check the setup answers and try again.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.updateOnboarding(
        user.userId,
        tenant.tenantId,
        parsed.data,
        context.get('requestId'),
        context.env,
      )
      return context.json(onboardingUpdateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS04') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'ONBOARDING_ACCESS_DENIED',
              message: 'Business setup is available to its active owner.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS06') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'ONBOARDING_STEP_OUT_OF_ORDER',
              message: 'Complete the business setup questions first.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS05' || code === 'HCS07') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_ONBOARDING_DETAILS',
              message: 'Check the setup answers and try again.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      }
      throw error
    }
  })

  app.onError((error, context) => {
    console.error('Unhandled API error', {
      error,
      requestId: context.get('requestId'),
    })

    return context.json(
      apiErrorResponseSchema.parse({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred.',
          requestId: context.get('requestId'),
        },
      }),
      500,
    )
  })

  app.notFound((context) =>
    context.json(
      apiErrorResponseSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource does not exist.',
          requestId: context.get('requestId'),
        },
      }),
      404,
    ),
  )

  return app
}

export const app = createApp()
