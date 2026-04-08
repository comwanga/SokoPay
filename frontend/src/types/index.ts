// ─── Auth ─────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'operator' | 'farmer'

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  role: Role
  user_id: string
  farmer_id?: string
}

// ─── User / Farmer ────────────────────────────────────────────────────────────

export interface Farmer {
  id: string
  name: string
  phone: string | null
  nostr_pubkey: string | null
  ln_address: string | null
  location_name: string | null
  created_at: string
}

export interface UpdateFarmerPayload {
  name?: string
  pin?: string
  ln_address?: string
  location_name?: string
  location_lat?: number
  location_lng?: number
}

// ─── Product ──────────────────────────────────────────────────────────────────

export interface ProductImage {
  id: string
  product_id: string
  url: string
  is_primary: boolean
  sort_order: number
  created_at: string
}

export interface Product {
  id: string
  seller_id: string
  seller_name: string
  title: string
  description: string
  price_kes: string   // Decimal as string
  unit: string
  quantity_avail: string  // Decimal as string
  category: string
  status: ProductStatus
  location_name: string
  images: ProductImage[]
  avg_rating?: number
  rating_count?: number
  created_at: string
  updated_at: string
}

export type ProductStatus = 'active' | 'paused' | 'sold_out' | 'deleted'

export interface CreateProductPayload {
  title: string
  description?: string
  price_kes: string
  unit?: string
  quantity_avail: string
  category?: string
  location_name?: string
  location_lat?: number
  location_lng?: number
}

export interface UpdateProductPayload {
  title?: string
  description?: string
  price_kes?: string
  unit?: string
  quantity_avail?: string
  category?: string
  status?: ProductStatus
  location_name?: string
  location_lat?: number
  location_lng?: number
}

export const PRODUCT_UNITS = ['kg', 'piece', 'bag', 'litre', 'dozen', 'bunch', 'crate'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

export const PRODUCT_CATEGORIES = [
  'Vegetables', 'Fruits', 'Grains', 'Livestock', 'Dairy',
  'Poultry', 'Fish', 'Crafts', 'Other',
] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

// ─── Order ────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'in_transit'
  | 'delivered'
  | 'confirmed'
  | 'disputed'
  | 'cancelled'

export interface Order {
  id: string
  product_id: string
  product_title: string
  seller_id: string
  seller_name: string
  buyer_id: string
  buyer_name: string
  quantity: string          // Decimal as string
  unit: string
  unit_price_kes: string    // Decimal as string
  total_kes: string         // Decimal as string
  total_sats: number | null
  buyer_location_name: string
  distance_km: number | null
  estimated_delivery_date: string | null  // "YYYY-MM-DD"
  seller_delivery_date: string | null
  delivery_notes: string | null
  status: OrderStatus
  created_at: string
  updated_at: string
}

export interface CreateOrderPayload {
  product_id: string
  quantity: string
  buyer_lat?: number
  buyer_lng?: number
  buyer_location_name?: string
}

export interface UpdateOrderStatusPayload {
  status: OrderStatus
  delivery_date?: string   // "YYYY-MM-DD"
  notes?: string
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export interface PaymentRecord {
  id: string
  order_id: string
  bolt11: string
  amount_sats: number
  amount_kes: string
  status: 'pending' | 'settled' | 'expired'
  settled_at: string | null
  created_at: string
}

export interface CreateInvoiceResponse {
  payment_id: string
  bolt11: string
  amount_sats: number
  amount_kes: string
}

// ─── Exchange Rate ────────────────────────────────────────────────────────────

export interface ExchangeRate {
  btc_kes: string
  btc_usd: string
  fetched_at: string
  live: boolean
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

export interface RatingRequest {
  order_id: string
  rating: number
  review?: string
}

export interface RatingResponse {
  id: string
  rating: number
  review: string | null
  buyer_name: string
  created_at: string
}

export interface RatingSummary {
  avg_rating: number
  rating_count: number
  ratings: RatingResponse[]
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface ProductStat {
  product_id: string
  title: string
  units_sold: string
  revenue_kes: string
  order_count: number
}

export interface MonthlyRevenue {
  month: string
  revenue_kes: string
  order_count: number
}

export interface OrderSummary {
  id: string
  product_title: string
  buyer_name: string
  quantity: string
  unit: string
  total_kes: string
  status: string
  created_at: string
}

export interface AnalyticsResponse {
  total_orders: number
  completed_orders: number
  pending_orders: number
  total_revenue_kes: string
  total_revenue_sats: number
  avg_order_value_kes: string
  top_products: ProductStat[]
  recent_orders: OrderSummary[]
  monthly_revenue: MonthlyRevenue[]
}
