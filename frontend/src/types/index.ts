export interface Farmer {
  id: string
  name: string
  phone: string
  cooperative: string
  created_at: string
}

export interface Payment {
  id: string
  farmer_id: string
  amount_sats: number
  amount_kes: number
  btc_kes_rate: number
  status: 'pending' | 'lightning_received' | 'disbursing' | 'completed' | 'failed'
  bolt12_offer: string | null
  lightning_payment_hash: string | null
  mpesa_ref: string | null
  mpesa_request_id: string | null
  crop_type: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PaymentWithFarmer extends Payment {
  farmer_name: string
  farmer_phone: string
}

export interface DashboardStats {
  total_farmers: number
  total_payments: number
  total_paid_kes: number
  total_paid_sats: number
  pending_disbursements: number
  recent_rate: number | null
}

export interface ExchangeRate {
  btc_kes: number
  btc_usd: number
  source: string
  live: boolean
  fetched_at?: string
}

export interface CreateFarmerPayload {
  name: string
  phone: string
  cooperative: string
}

export interface CreatePaymentPayload {
  farmer_id: string
  amount_kes: number
  crop_type?: string
  notes?: string
}

export interface CreatePaymentResponse {
  payment: Payment
  bolt12_offer: string
  amount_sats: number
  btc_kes_rate: number
}

export interface DisburseResponse {
  success: boolean
  mpesa_request_id: string
  description: string
}

export type PaymentStatus = Payment['status']

export const CROP_TYPES = ['Tea', 'Coffee', 'Flowers', 'Avocado', 'Other'] as const
export type CropType = (typeof CROP_TYPES)[number]
