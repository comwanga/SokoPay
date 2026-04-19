import { useState, useCallback } from 'react'

const KEY     = 'sokopay_recently_viewed'
const MAX     = 12

export function useRecentlyViewed() {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  })

  const push = useCallback((id: string) => {
    setIds(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, MAX)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    localStorage.removeItem(KEY)
    setIds([])
  }, [])

  return { ids, push, clear }
}
