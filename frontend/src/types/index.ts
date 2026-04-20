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
  mpesa_phone: string | null
  location_name: string | null
  created_at: string
}

export interface UpdateFarmerPayload {
  name?: string
  pin?: string
  ln_address?: string
  mpesa_phone?: string
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
  seller_verified: boolean
  title: string
  description: string
  price_kes: string   // Decimal as string
  unit: string
  quantity_avail: string  // Decimal as string
  low_stock_threshold: string | null
  escrow_mode: boolean
  category: string
  status: ProductStatus
  location_name: string
  country_code: string | null
  currency_code: string | null
  ships_to: string[] | null
  is_global: boolean
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
  country_code?: string
  is_global?: boolean
}

export interface UpdateProductPayload {
  title?: string
  description?: string
  price_kes?: string
  unit?: string
  quantity_avail?: string
  low_stock_threshold?: string | null
  escrow_mode?: boolean
  category?: string
  status?: ProductStatus
  location_name?: string
  location_lat?: number
  location_lng?: number
  country_code?: string
  is_global?: boolean
}

export const PRODUCT_UNITS = ['kg', 'piece', 'bag', 'litre', 'dozen', 'bunch', 'crate'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

export const COUNTRIES = [
  // Africa
  { code: 'DZ', name: 'Algeria' },
  { code: 'AO', name: 'Angola' },
  { code: 'BJ', name: 'Benin' },
  { code: 'BW', name: 'Botswana' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CV', name: 'Cape Verde' },
  { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' },
  { code: 'KM', name: 'Comoros' },
  { code: 'CG', name: 'Congo' },
  { code: 'CD', name: 'DR Congo' },
  { code: 'CI', name: "Côte d'Ivoire" },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'EG', name: 'Egypt' },
  { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' },
  { code: 'SZ', name: 'Eswatini' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GN', name: 'Guinea' },
  { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'KE', name: 'Kenya' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya' },
  { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' },
  { code: 'ML', name: 'Mali' },
  { code: 'MR', name: 'Mauritania' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'MA', name: 'Morocco' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'NA', name: 'Namibia' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ST', name: 'São Tomé and Príncipe' },
  { code: 'SN', name: 'Senegal' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SO', name: 'Somalia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'SS', name: 'South Sudan' },
  { code: 'SD', name: 'Sudan' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'TG', name: 'Togo' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'UG', name: 'Uganda' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
  // Americas
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BB', name: 'Barbados' },
  { code: 'BZ', name: 'Belize' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CU', name: 'Cuba' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'GD', name: 'Grenada' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti' },
  { code: 'HN', name: 'Honduras' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'PA', name: 'Panama' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Peru' },
  { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'SR', name: 'Suriname' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'VE', name: 'Venezuela' },
  // Asia
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'BN', name: 'Brunei' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'CN', name: 'China' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'GE', name: 'Georgia' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'IL', name: 'Israel' },
  { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'LA', name: 'Laos' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MV', name: 'Maldives' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'NP', name: 'Nepal' },
  { code: 'KP', name: 'North Korea' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PS', name: 'Palestine' },
  { code: 'PH', name: 'Philippines' },
  { code: 'QA', name: 'Qatar' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'KR', name: 'South Korea' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SY', name: 'Syria' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' },
  { code: 'TR', name: 'Turkey' },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'YE', name: 'Yemen' },
  // Europe
  { code: 'AL', name: 'Albania' },
  { code: 'AD', name: 'Andorra' },
  { code: 'AT', name: 'Austria' },
  { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'XK', name: 'Kosovo' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MT', name: 'Malta' },
  { code: 'MD', name: 'Moldova' },
  { code: 'MC', name: 'Monaco' },
  { code: 'ME', name: 'Montenegro' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'SM', name: 'San Marino' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'VA', name: 'Vatican City' },
  // Oceania
  { code: 'AU', name: 'Australia' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'MH', name: 'Marshall Islands' },
  { code: 'FM', name: 'Micronesia' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PW', name: 'Palau' },
  { code: 'PG', name: 'Papua New Guinea' },
  { code: 'WS', name: 'Samoa' },
  { code: 'SB', name: 'Solomon Islands' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'VU', name: 'Vanuatu' },
] as const

export function countryName(code: string): string {
  return COUNTRIES.find(c => c.code === code)?.name ?? code
}

export const PRODUCT_CATEGORIES = [
  'Food & Groceries',
  'Electronics',
  'Fashion & Clothing',
  'Home & Living',
  'Health & Beauty',
  'Services',
  'Vehicles & Parts',
  'Property',
  'Agriculture',
  'Crafts & Art',
  'Other',
] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

export const CATEGORY_ICONS: Record<string, string> = {
  'Food & Groceries': '🛒',
  'Electronics': '📱',
  'Fashion & Clothing': '👗',
  'Home & Living': '🏠',
  'Health & Beauty': '💊',
  'Services': '🔧',
  'Vehicles & Parts': '🚗',
  'Property': '🏘️',
  'Agriculture': '🌾',
  'Crafts & Art': '🎨',
  'Other': '📦',
}

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
  delivery_photo_url: string | null
  escrow_mode: boolean
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
  delivery_photo_url?: string
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
  expires_at: string   // ISO-8601 UTC — 60 seconds after creation
  reused: boolean
}

// ─── Exchange Rate ────────────────────────────────────────────────────────────

export interface ExchangeRate {
  btc_usd: string
  btc_local: string
  local_currency: string
  sats_usd: string
  sats_local: string
  denominations: number[]
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

// ─── M-Pesa ───────────────────────────────────────────────────────────────────

export interface MpesaStkPushResponse {
  mpesa_payment_id: string
  checkout_request_id: string
  message: string
}

export interface MpesaStatusResponse {
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired'
  mpesa_receipt_number: string | null
  amount_kes: string
}

// ─── Lightning Address Verification ──────────────────────────────────────────

export interface LnVerifyResponse {
  address: string
  min_sendable_sats: number
  max_sendable_sats: number
  description: string
  callback: string
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

export type EvidenceKind = 'text' | 'image' | 'url'

export interface DisputeEvidence {
  id: string
  order_id: string
  submitter_id: string
  kind: EvidenceKind
  content: string
  created_at: string
}

export interface OpenDisputeRow {
  order_id: string
  dispute_reason: string | null
  dispute_opened_at: string | null
  total_kes: string
  total_sats: number | null
  seller_name: string
  buyer_name: string
  product_title: string
  evidence_count: number
}

export interface ResolveDisputePayload {
  resolution: 'refund_buyer' | 'release_seller' | 'split'
  admin_notes?: string
}

export interface StuckRefund {
  order_id: string
  product_title: string
  buyer_name: string
  seller_name: string
  total_kes: string
  total_sats: number | null
  payment_method: string | null
  refund_status: 'manual_required' | 'failed'
  refund_notes: string | null
  dispute_resolved_at: string | null
}

// ─── Admin user management ────────────────────────────────────────────────────

export interface CreateUserRequest {
  username: string
  password: string
  role: 'admin' | 'operator' | 'farmer'
  farmer_id?: string
}

export interface CreateUserResponse {
  id: string
  username: string
  role: string
}

// ─── Payment History ──────────────────────────────────────────────────────────

export type PaymentMethod = 'lightning' | 'mpesa' | 'pos' | 'unknown'
export type PaymentRole   = 'buyer' | 'seller'

export interface PaymentHistoryItem {
  order_id: string
  product_title: string
  counterparty_name: string
  role: PaymentRole
  quantity: string
  unit: string
  total_kes: string
  total_sats: number | null
  order_status: string
  payment_method: PaymentMethod
  payment_status: string | null
  payment_ref: string | null
  order_created_at: string
  payment_settled_at: string | null
}

export interface PaymentHistoryResponse {
  items: PaymentHistoryItem[]
  total_count: number
  page: number
  page_size: number
  all_time_kes: string
  all_time_count: number
}

// ─── Analytics ────────────────────────────────────────────────────────────────

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


// Shared checkout types used by CartPage and CartDrawer
export type ItemStatus = 'idle' | 'pending' | 'done' | 'error'
export interface OrderResult {
  productId: string
  status: ItemStatus
  error?: string
}
