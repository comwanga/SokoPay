import { useState, useCallback, useMemo } from 'react'

const KEY    = 'sokopay_recently_viewed'
const MAX    = 12
const TTL_MS = 30 * 24 * 60 * 60 * 1000

interface Entry { id: string; ts: number }

function load(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const now = Date.now()
    return (JSON.parse(raw) as Entry[]).filter(e => e.ts && now - e.ts < TTL_MS)
  } catch {
    return []
  }
}

export function useRecentlyViewed() {
  // State holds full entries (id + timestamp) so push never re-reads localStorage
  const [entries, setEntries] = useState<Entry[]>(load)

  const push = useCallback((id: string) => {
    setEntries(prev => {
      const existing = prev.find(e => e.id === id)
      // Preserve the original timestamp so re-viewing doesn't reset the 30-day TTL
      const next = [
        { id, ts: existing?.ts ?? Date.now() },
        ...prev.filter(e => e.id !== id),
      ].slice(0, MAX)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    localStorage.removeItem(KEY)
    setEntries([])
  }, [])

  const ids = useMemo(() => entries.map(e => e.id), [entries])

  return { ids, push, clear }
}
