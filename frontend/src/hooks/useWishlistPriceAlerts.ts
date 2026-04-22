import { useEffect, useRef } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getProduct } from '../api/client.ts'
import { useWishlist } from '../context/wishlist.tsx'
import { useToast } from '../context/toast.tsx'

const CACHE_KEY   = 'sokopay_price_cache'
const DROP_THRESH = 0.05 // 5% drop triggers alert

function loadCache(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') } catch { return {} }
}

function saveCache(cache: Record<string, number>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* quota */ }
}

/** Checks wishlist items on mount; fires toasts for significant price drops. */
export function useWishlistPriceAlerts() {
  const { ids }   = useWishlist()
  const { toast } = useToast()
  const alerted   = useRef(new Set<string>())

  const results = useQueries({
    queries: ids.slice(0, 10).map(id => ({
      queryKey: ['product', id],
      queryFn:  () => getProduct(id),
      staleTime: 300_000,
    })),
  })

  useEffect(() => {
    const cache = loadCache()
    const updated = { ...cache }
    let changed = false

    for (const r of results) {
      if (!r.data) continue
      const { id, price_kes, title } = r.data
      const current = parseFloat(price_kes)
      const prev    = cache[id]

      if (prev && current < prev * (1 - DROP_THRESH) && !alerted.current.has(id)) {
        alerted.current.add(id)
        const drop = Math.round((1 - current / prev) * 100)
        toast(
          `Price drop! ${title.slice(0, 30)}… is now ${drop}% cheaper`,
          'success',
          6000,
        )
      }

      updated[id] = current
      changed = true
    }

    if (changed) saveCache(updated)
  // only run when product data resolves
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map(r => r.data?.price_kes).join(',')])
}
