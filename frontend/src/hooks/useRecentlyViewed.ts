import { useState, useCallback } from 'react'

const KEY     = 'sokopay_recently_viewed'
const MAX     = 12
const TTL_MS  = 30 * 24 * 60 * 60 * 1000 // 30 days

interface Entry { id: string; ts: number }

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const entries = JSON.parse(raw) as Entry[]
    const now = Date.now()
    return entries
      .filter(e => e.ts && now - e.ts < TTL_MS)
      .map(e => e.id)
  } catch {
    return []
  }
}

function saveEntries(ids: string[]) {
  const now = Date.now()
  // Preserve existing timestamps, only set new ones for new IDs
  const existing: Entry[] = (() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[] } catch { return [] }
  })()
  const tsMap = new Map(existing.map(e => [e.id, e.ts]))
  const entries: Entry[] = ids.map(id => ({ id, ts: tsMap.get(id) ?? now }))
  try { localStorage.setItem(KEY, JSON.stringify(entries)) } catch { /* quota */ }
}

export function useRecentlyViewed() {
  const [ids, setIds] = useState<string[]>(loadIds)

  const push = useCallback((id: string) => {
    setIds(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, MAX)
      saveEntries(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    localStorage.removeItem(KEY)
    setIds([])
  }, [])

  return { ids, push, clear }
}
