import { finalizeEvent, getPublicKey as nostrGetPublicKey, verifyEvent } from 'nostr-tools/pure'
import type {
  AnalyticsResponse,
  CreateInvoiceResponse,
  CreateOrderPayload,
  CreateProductPayload,
  CreateUserRequest,
  CreateUserResponse,
  DisputeEvidence,
  ExchangeRate,
  Farmer,
  LoginRequest,
  LoginResponse,
  LnVerifyResponse,
  MpesaStkPushResponse,
  MpesaStatusResponse,
  OpenDisputeRow,
  Order,
  OrderStatus,
  PaymentHistoryResponse,
  PaymentRecord,
  PaymentRole,
  Product,
  ProductImage,
  RatingRequest,
  RatingResponse,
  RatingSummary,
  ResolveDisputePayload,
  StuckRefund,
  UpdateFarmerPayload,
  UpdateOrderStatusPayload,
  UpdateProductPayload,
} from '../types'

const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

// ─── Nostr / WebLN window extensions ─────────────────────────────────────────

interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent>
    }
    webln?: {
      enable(): Promise<void>
      sendPayment(paymentRequest: string): Promise<{ preimage: string }>
    }
  }
}

// ─── Token management ────────────────────────────────────────────────────────

const TOKEN_KEY = 'agri_pay_jwt'
const NSEC_KEY  = 'agri_pay_nsec'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// ─── Local Nostr key (stored for users without a browser extension) ───────────

export function getLocalSecretKey(): Uint8Array | null {
  const hex = localStorage.getItem(NSEC_KEY)
  if (!hex || hex.length !== 64) return null
  try {
    return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  } catch { return null }
}

export function setLocalSecretKey(sk: Uint8Array): void {
  localStorage.setItem(NSEC_KEY, Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join(''))
}

export function clearLocalSecretKey(): void {
  localStorage.removeItem(NSEC_KEY)
}

/** Log in with just a public key (npub decoded to hex by caller). No signature required. */
export async function pubkeyAuth(pubkeyHex: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/pubkey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey: pubkeyHex }),
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch { /* ignore */ }
    throw new Error(message)
  }

  const resp: LoginResponse = await res.json()
  setToken(resp.token)
  return resp
}

/** Sign a NIP-98 event locally (no browser extension required) and exchange for JWT. */
export async function nostrLoginWithKey(secretKey: Uint8Array): Promise<LoginResponse> {
  const url = `${window.location.origin}/api/auth/nostr`

  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', 'POST']],
    content: '',
  }, secretKey)

  // Self-verify: catch signing bugs before hitting the network
  nostrGetPublicKey(secretKey) // throws if sk is invalid
  if (!verifyEvent(event)) {
    throw new Error('Event signature self-verification failed — key may be corrupt')
  }

  const res = await fetch(`${BASE}/auth/nostr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch { /* ignore */ }
    throw new Error(message)
  }

  const resp: LoginResponse = await res.json()
  setToken(resp.token)
  return resp
}

// ─── Core request helpers ─────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('Session expired')
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
      else if (body?.message) message = body.message
    } catch { /* ignore */ }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

/** Like `request`, but also returns the raw response headers. */
async function requestWithHeaders<T>(
  path: string,
  options?: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  const token = getToken()
  const reqHeaders: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  }
  if (!(options?.body instanceof FormData)) {
    reqHeaders['Content-Type'] = 'application/json'
  }
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers: reqHeaders })

  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('Session expired')
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
      else if (body?.message) message = body.message
    } catch { /* ignore */ }
    throw new Error(message)
  }

  const data = await res.json() as T
  return { data, headers: res.headers }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const resp = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  setToken(resp.token)
  return resp
}

export function logout(): void {
  clearToken()
}

export async function nostrLogin(): Promise<LoginResponse> {
  // 1. NIP-07 browser extension or Fedi mini-app
  if (window.nostr) {
    const url = `${window.location.origin}/api/auth/nostr`
    const signedEvent = await window.nostr.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: '',
    })

    const res = await fetch(`${BASE}/auth/nostr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: signedEvent }),
    })

    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body?.error) message = body.error
      } catch { /* ignore */ }
      throw new Error(message)
    }

    const resp: LoginResponse = await res.json()
    setToken(resp.token)
    return resp
  }

  // 2. Locally stored key (user pasted nsec or generated one previously)
  const sk = getLocalSecretKey()
  if (sk) return nostrLoginWithKey(sk)

  // 3. No signer — caller should show the connect modal
  throw new Error('NO_SIGNER')
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(id: string): Promise<Farmer> {
  return request<Farmer>(`/farmers/${id}`)
}

export async function updateProfile(id: string, payload: UpdateFarmerPayload): Promise<Farmer> {
  return request<Farmer>(`/farmers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

// ─── Products ────────────────────────────────────────────────────────────────

export async function listProducts(params?: {
  category?: string
  seller_id?: string
  page?: number
  per_page?: number
  q?: string
  scope?: 'local' | 'country' | 'global'
  country?: string
  ships_to?: string
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating'
}): Promise<Product[]> {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (params?.seller_id) qs.set('seller_id', params.seller_id)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.per_page) qs.set('per_page', String(params.per_page))
  if (params?.q) qs.set('q', params.q)
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.country) qs.set('country', params.country)
  if (params?.ships_to) qs.set('ships_to', params.ships_to)
  if (params?.sort) qs.set('sort', params.sort)
  const str = qs.toString()
  return request<Product[]>(`/products${str ? `?${str}` : ''}`)
}

/** Cursor-paginated product listing.  Returns items + the next-page cursor. */
export async function listProductsPage(params?: {
  category?: string
  seller_id?: string
  per_page?: number
  q?: string
  scope?: 'local' | 'country' | 'global'
  country?: string
  ships_to?: string
  cursor?: string
}): Promise<{ items: Product[]; nextCursor: string | null }> {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (params?.seller_id) qs.set('seller_id', params.seller_id)
  if (params?.per_page) qs.set('per_page', String(params.per_page))
  if (params?.q) qs.set('q', params.q)
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.country) qs.set('country', params.country)
  if (params?.ships_to) qs.set('ships_to', params.ships_to)
  if (params?.cursor) qs.set('cursor', params.cursor)
  const str = qs.toString()
  const { data, headers } = await requestWithHeaders<Product[]>(
    `/products${str ? `?${str}` : ''}`,
  )
  return {
    items: data,
    nextCursor: headers.get('x-next-cursor'),
  }
}

export async function getProduct(id: string): Promise<Product> {
  return request<Product>(`/products/${id}`)
}

export async function createProduct(payload: CreateProductPayload): Promise<Product> {
  return request<Product>('/products', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateProduct(id: string, payload: UpdateProductPayload): Promise<Product> {
  return request<Product>(`/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteProduct(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/products/${id}`, { method: 'DELETE' })
}

export async function uploadProductImage(productId: string, file: File): Promise<ProductImage> {
  const form = new FormData()
  form.append('image', file)
  return request<ProductImage>(`/products/${productId}/images`, {
    method: 'POST',
    body: form,
  })
}

export async function deleteProductImage(
  productId: string,
  imageId: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/products/${productId}/images/${imageId}`, {
    method: 'DELETE',
  })
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function listOrders(role?: 'buyer' | 'seller'): Promise<Order[]> {
  const q = role ? `?role=${role}` : ''
  return request<Order[]>(`/orders${q}`)
}

export async function getOrder(id: string): Promise<Order> {
  return request<Order>(`/orders/${id}`)
}

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  return request<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateOrderStatus(
  id: string,
  payload: UpdateOrderStatusPayload,
): Promise<Order> {
  return request<Order>(`/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function cancelOrder(id: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(`/orders/${id}`, { method: 'DELETE' })
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function createInvoice(orderId: string): Promise<CreateInvoiceResponse> {
  return request<CreateInvoiceResponse>('/payments/invoice', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId }),
  })
}

export async function confirmPayment(
  paymentId: string,
  preimage: string,
): Promise<{ confirmed: boolean; payment_hash: string }> {
  return request('/payments/confirm', {
    method: 'POST',
    body: JSON.stringify({ payment_id: paymentId, preimage }),
  })
}

export async function getPaymentForOrder(orderId: string): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/payments/order/${orderId}`)
}

// ─── M-Pesa ───────────────────────────────────────────────────────────────────

export async function initiateMpesaPay(
  orderId: string,
  phone: string,
): Promise<MpesaStkPushResponse> {
  return request<MpesaStkPushResponse>('/payments/mpesa/stk-push', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, phone }),
  })
}

export async function getMpesaPaymentStatus(
  checkoutRequestId: string,
): Promise<MpesaStatusResponse> {
  return request<MpesaStatusResponse>(
    `/payments/mpesa/${encodeURIComponent(checkoutRequestId)}/status`,
  )
}

// ─── Oracle ───────────────────────────────────────────────────────────────────

export async function getRate(currency = 'KES'): Promise<ExchangeRate> {
  return request<ExchangeRate>(`/oracle/rate?currency=${currency}`)
}

// ─── Lightning Address verification ──────────────────────────────────────────

export async function verifyLnAddress(address: string): Promise<LnVerifyResponse> {
  return request<LnVerifyResponse>(
    `/payments/verify-ln?address=${encodeURIComponent(address)}`,
  )
}

// ─── WebLN payment helper ─────────────────────────────────────────────────────

export const isFediContext = typeof window !== 'undefined' && !!window.nostr
export const hasWebLN = typeof window !== 'undefined' && 'webln' in window

/** Pay a bolt11 invoice via WebLN. Returns the preimage. */
export async function payWithWebLN(bolt11: string): Promise<string> {
  if (!window.webln) throw new Error('WebLN not available')
  await window.webln.enable()
  const result = await window.webln.sendPayment(bolt11)
  return result.preimage
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string; version: string }> {
  return request('/health')
}

// ─── Ratings ─────────────────────────────────────────────────────────────────

export async function getProductRatings(productId: string): Promise<RatingSummary> {
  return request<RatingSummary>(`/products/${productId}/ratings`)
}

export async function rateProduct(productId: string, payload: RatingRequest): Promise<RatingResponse> {
  return request<RatingResponse>(`/products/${productId}/ratings`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getSellerRatings(farmerId: string): Promise<RatingSummary> {
  return request<RatingSummary>(`/farmers/${farmerId}/ratings`)
}

export async function rateSellerFromBuyer(farmerId: string, payload: RatingRequest): Promise<RatingResponse> {
  return request<RatingResponse>(`/farmers/${farmerId}/ratings`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getFarmerAnalytics(farmerId: string): Promise<AnalyticsResponse> {
  return request<AnalyticsResponse>(`/farmers/${farmerId}/analytics`)
}

// ─── Disputes ────────────────────────────────────────────────────────────────

export async function openDispute(
  orderId: string,
  reason: string,
): Promise<{ order_id: string; status: string }> {
  return request(`/orders/${orderId}/dispute`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function getDisputeEvidence(orderId: string): Promise<DisputeEvidence[]> {
  return request<DisputeEvidence[]>(`/orders/${orderId}/dispute/evidence`)
}

export async function addDisputeEvidence(
  orderId: string,
  payload: { kind: string; content: string },
): Promise<DisputeEvidence> {
  return request<DisputeEvidence>(`/orders/${orderId}/dispute/evidence`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function listAdminDisputes(): Promise<OpenDisputeRow[]> {
  return request<OpenDisputeRow[]>('/admin/disputes')
}

export async function resolveDispute(
  orderId: string,
  payload: ResolveDisputePayload,
): Promise<{ resolved: boolean; refund_initiated: boolean }> {
  return request(`/admin/disputes/${orderId}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function listStuckRefunds(): Promise<StuckRefund[]> {
  return request<StuckRefund[]>('/admin/refunds')
}

export async function listPaymentHistory(
  role: PaymentRole,
  page = 0,
): Promise<PaymentHistoryResponse> {
  return request<PaymentHistoryResponse>(
    `/payments/history?role=${role}&page=${page}`,
  )
}

export async function createUser(payload: CreateUserRequest): Promise<CreateUserResponse> {
  return request<CreateUserResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshAuthToken(): Promise<LoginResponse> {
  const resp = await request<LoginResponse>('/auth/refresh', { method: 'POST' })
  setToken(resp.token)
  return resp
}

// ─── Order messages ───────────────────────────────────────────────────────────

export interface OrderMessage {
  id: string
  order_id: string
  sender_id: string
  sender_name: string
  sender_role: 'buyer' | 'seller'
  body: string
  sent_at: string
}

export async function getOrderMessages(orderId: string): Promise<OrderMessage[]> {
  return request<OrderMessage[]>(`/orders/${orderId}/messages`)
}

export async function sendOrderMessage(
  orderId: string,
  body: string,
): Promise<OrderMessage> {
  return request<OrderMessage>(`/orders/${orderId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

// ─── Storefront ───────────────────────────────────────────────────────────────

export interface StorefrontProduct {
  id: string
  title: string
  price_kes: string
  unit: string
  quantity_avail: string
  category: string
  location_name: string
  avg_rating: number | null
  rating_count: number
  primary_image_url: string | null
  created_at: string
}

export interface StorefrontReview {
  rating: number
  review: string | null
  buyer_name: string
  created_at: string
}

export interface StorefrontResponse {
  seller: {
    id: string
    name: string
    location_name: string | null
    member_since: string
    product_count: number
    confirmed_order_count: number
  }
  products: StorefrontProduct[]
  rating_summary: {
    avg_rating: number
    rating_count: number
    recent_reviews: StorefrontReview[]
  }
}

export async function getStorefront(sellerId: string): Promise<StorefrontResponse> {
  return request<StorefrontResponse>(`/storefront/${sellerId}`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatKes(value: string | number): string {
  return `KES ${parseFloat(String(value)).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M sats`
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}k sats`
  return `${sats} sats`
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Awaiting Payment',
  paid: 'Payment Received',
  processing: 'Preparing',
  in_transit: 'On the Way',
  delivered: 'Delivered',
  confirmed: 'Completed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
}

export function sellerNextStatus(current: string): OrderStatus | null {
  const map: Record<string, OrderStatus> = {
    pending_payment: 'paid',
    paid: 'processing',
    processing: 'in_transit',
    in_transit: 'delivered',
  }
  return map[current] ?? null
}

export function buyerNextStatus(current: string): OrderStatus | null {
  if (current === 'delivered') return 'confirmed'
  return null
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  last_used_at: string | null
  created_at: string
}

export interface CreateApiKeyResponse {
  id: string
  name: string
  raw_key: string
  key_prefix: string
  scopes: string[]
  created_at: string
}

export interface CreateApiKeyPayload {
  name: string
  scopes: string[]
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return request<ApiKey[]>('/api-keys')
}

export async function createApiKey(payload: CreateApiKeyPayload): Promise<CreateApiKeyResponse> {
  return request<CreateApiKeyResponse>('/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function revokeApiKey(id: string): Promise<void> {
  await request<void>(`/api-keys/${id}`, { method: 'DELETE' })
}

// ─── Referrals ────────────────────────────────────────────────────────────────

export interface ReferralCodeResponse {
  referral_code: string
  referral_link: string
}

export interface ReferralStats {
  referral_code: string
  total_referrals: number
}

export async function getMyReferralCode(): Promise<ReferralCodeResponse> {
  return request<ReferralCodeResponse>('/referrals/my-code')
}

export async function getReferralStats(): Promise<ReferralStats> {
  return request<ReferralStats>('/referrals/stats')
}

export async function applyReferral(referral_code: string): Promise<{ applied: boolean }> {
  return request<{ applied: boolean }>('/referrals/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referral_code }),
  })
}

// ─── Price Index ──────────────────────────────────────────────────────────────

export interface CategoryPriceStats {
  category: string
  product_count: number
  avg_price_kes: number
  min_price_kes: number
  max_price_kes: number
  median_price_kes: number
}

export async function getPriceIndex(): Promise<CategoryPriceStats[]> {
  return request<CategoryPriceStats[]>('/price-index')
}
