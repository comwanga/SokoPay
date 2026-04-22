import { useState, useCallback } from 'react'

const KEY = 'sokopay_search_history'
const MAX = 8

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(load)

  const push = useCallback((term: string) => {
    const trimmed = term.trim()
    if (!trimmed || trimmed.length < 2) return
    setHistory(prev => {
      const next = [trimmed, ...prev.filter(h => h !== trimmed)].slice(0, MAX)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  const remove = useCallback((term: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h !== term)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    localStorage.removeItem(KEY)
    setHistory([])
  }, [])

  return { history, push, remove, clear }
}
