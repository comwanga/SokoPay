import { useState, useCallback } from 'react'

export interface PromoCode {
  code: string
  type: 'percent' | 'fixed'
  value: number
  description: string
  createdAt: string
}

const KEY = 'sokopay_promo_codes'

function loadAll(): Record<string, PromoCode[]> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveAll(data: Record<string, PromoCode[]>) {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* quota */ }
}

/** Seller side: manage promo codes for a given farmerId */
export function useSellerPromoCodes(farmerId: string | null) {
  const [codes, setCodes] = useState<PromoCode[]>(() => {
    if (!farmerId) return []
    return loadAll()[farmerId] ?? []
  })

  const addCode = useCallback((code: Omit<PromoCode, 'createdAt'>) => {
    if (!farmerId) return
    const entry: PromoCode = { ...code, code: code.code.toUpperCase().trim(), createdAt: new Date().toISOString() }
    setCodes(prev => {
      if (prev.some(c => c.code === entry.code)) return prev
      const next = [...prev, entry]
      const all = loadAll()
      all[farmerId] = next
      saveAll(all)
      return next
    })
  }, [farmerId])

  const removeCode = useCallback((code: string) => {
    if (!farmerId) return
    setCodes(prev => {
      const next = prev.filter(c => c.code !== code.toUpperCase())
      const all = loadAll()
      all[farmerId] = next
      saveAll(all)
      return next
    })
  }, [farmerId])

  return { codes, addCode, removeCode }
}

/** Buyer side: validate a code against any registered seller's codes */
export function validatePromoCode(inputCode: string): { valid: boolean; promo: PromoCode | null; farmerId: string | null } {
  const upper = inputCode.toUpperCase().trim()
  const all = loadAll()
  for (const [farmerId, codes] of Object.entries(all)) {
    const found = codes.find(c => c.code === upper)
    if (found) return { valid: true, promo: found, farmerId }
  }
  return { valid: false, promo: null, farmerId: null }
}

/** Apply a promo code to a total and return discounted amount */
export function applyDiscount(total: number, promo: PromoCode): { discounted: number; saving: number } {
  if (promo.type === 'percent') {
    const saving = Math.min(total, (total * promo.value) / 100)
    return { discounted: total - saving, saving }
  }
  const saving = Math.min(total, promo.value)
  return { discounted: total - saving, saving }
}
