import { useState, useCallback } from 'react'
import { createOrder } from '../api/client.ts'
import { useCart } from '../context/cart.tsx'
import { useAuth } from '../context/auth.tsx'
import type { OrderResult } from '../types'

export interface CheckoutState {
  locationName: string
  setLocationName: (v: string) => void
  locating: boolean
  coords: { lat: number; lng: number } | null
  results: OrderResult[]
  checking: boolean
  allDone: boolean
  inFlight: boolean
  hasErrors: boolean
  handleGps: () => void
  handleCheckout: () => Promise<void>
}

export function useCheckout(): CheckoutState {
  const { authed, connect }             = useAuth()
  const { items, removeItem }           = useCart()
  const [locationName, setLocationName] = useState('')
  const [locating,     setLocating]     = useState(false)
  const [coords,       setCoords]       = useState<{ lat: number; lng: number } | null>(null)
  const [results,      setResults]      = useState<OrderResult[]>([])
  const [checking,     setChecking]     = useState(false)

  const handleGps = useCallback(() => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false) },
      ()  => setLocating(false),
    )
  }, [])

  const handleCheckout = useCallback(async () => {
    if (!authed) { connect(); return }
    if (items.length === 0) return

    const initial: OrderResult[] = items.map(i => ({ productId: i.product.id, status: 'pending' }))
    setResults(initial)
    setChecking(true)

    // Fire all orders in parallel — much faster than sequential awaits
    const settled = await Promise.allSettled(
      items.map(item =>
        createOrder({
          product_id: item.product.id,
          quantity:   String(item.quantity),
          buyer_lat:  coords?.lat,
          buyer_lng:  coords?.lng,
          buyer_location_name: locationName.trim() || undefined,
        }),
      ),
    )

    const updated: OrderResult[] = items.map((item, idx) => {
      const result = settled[idx]
      if (result.status === 'fulfilled') return { productId: item.product.id, status: 'done' }
      const err = result.reason
      return {
        productId: item.product.id,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed',
      }
    })

    setResults(updated)
    setChecking(false)

    updated
      .filter(r => r.status === 'done')
      .forEach(r => removeItem(r.productId))
  }, [authed, connect, items, coords, locationName, removeItem])

  const inFlight  = checking
  // Settled means checkout ran and at least one result exists; still in-flight while checking
  const hasErrors = !checking && results.some(r => r.status === 'error')
  // allDone: checkout completed and every attempted item succeeded (cart emptied those items)
  const allDone   = !checking && results.length > 0 && results.every(r => r.status === 'done')

  return {
    locationName, setLocationName,
    locating, coords,
    results, checking,
    allDone, inFlight, hasErrors,
    handleGps, handleCheckout,
  }
}
