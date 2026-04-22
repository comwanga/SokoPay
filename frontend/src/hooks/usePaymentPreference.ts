import { useState, useCallback } from 'react'

const KEY = 'sokopay_pay_method'

type PayMethod = 'lightning' | 'mpesa'

function load(): PayMethod {
  const v = localStorage.getItem(KEY)
  return v === 'mpesa' ? 'mpesa' : 'lightning'
}

export function usePaymentPreference() {
  const [preference, setPreference] = useState<PayMethod>(load)

  const save = useCallback((method: PayMethod) => {
    setPreference(method)
    try { localStorage.setItem(KEY, method) } catch { /* quota */ }
  }, [])

  return { preference, save }
}
