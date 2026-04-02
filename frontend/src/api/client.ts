import type {
  Farmer,
  PaymentWithFarmer,
  DashboardStats,
  ExchangeRate,
  CreateFarmerPayload,
  CreatePaymentPayload,
  CreatePaymentResponse,
  DisburseResponse,
} from '../types'

const BASE = '/api'

// Injected at build time by Vite. Set VITE_API_KEY in your .env file.
// Leave empty (or unset) to disable client-side key sending (e.g. during development
// when the backend API_KEY is also empty).
const API_KEY = import.meta.env.VITE_API_KEY ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`

  const extraHeaders: Record<string, string> = {}
  if (API_KEY) {
    extraHeaders['X-Api-Key'] = API_KEY
  }

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      ...options?.headers,
    },
    ...options,
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
      else if (body?.message) message = body.message
    } catch {
      // ignore parse error, use default message
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

// ─── Farmers ────────────────────────────────────────────────────────────────

export async function getFarmers(): Promise<Farmer[]> {
  return request<Farmer[]>('/farmers')
}

export async function createFarmer(payload: CreateFarmerPayload): Promise<Farmer> {
  return request<Farmer>('/farmers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getFarmer(id: string): Promise<Farmer> {
  return request<Farmer>(`/farmers/${id}`)
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function getPayments(page = 1, perPage = 50): Promise<PaymentWithFarmer[]> {
  return request<PaymentWithFarmer[]>(`/payments?page=${page}&per_page=${perPage}`)
}

export async function createPayment(
  payload: CreatePaymentPayload,
): Promise<CreatePaymentResponse> {
  return request<CreatePaymentResponse>('/payments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getPayment(id: string): Promise<PaymentWithFarmer> {
  return request<PaymentWithFarmer>(`/payments/${id}`)
}

export async function disbursePayment(id: string): Promise<DisburseResponse> {
  return request<DisburseResponse>(`/payments/${id}/disburse`, {
    method: 'POST',
  })
}

// ─── Oracle / Rate ────────────────────────────────────────────────────────────

export async function getRate(): Promise<ExchangeRate> {
  return request<ExchangeRate>('/oracle/rate')
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getStats(): Promise<DashboardStats> {
  return request<DashboardStats>('/dashboard/stats')
}

// ─── Health ──────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>('/health')
}
