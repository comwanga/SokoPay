import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const KEY = 'sokopay_wishlist'
const MAX = 100

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function save(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* quota */ }
}

interface WishlistContextValue {
  ids: string[]
  has(id: string): boolean
  toggle(id: string): boolean
  remove(id: string): void
  count: number
}

const WishlistContext = createContext<WishlistContextValue | null>(null)

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>(load)

  const has = useCallback((id: string) => ids.includes(id), [ids])

  const toggle = useCallback((id: string): boolean => {
    let added = false
    setIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id)
        save(next)
        return next
      }
      added = true
      const next = [id, ...prev].slice(0, MAX)
      save(next)
      return next
    })
    return added
  }, [])

  const remove = useCallback((id: string) => {
    setIds(prev => {
      const next = prev.filter(x => x !== id)
      save(next)
      return next
    })
  }, [])

  const count = useMemo(() => ids.length, [ids])

  return (
    <WishlistContext.Provider value={{ ids, has, toggle, remove, count }}>
      {children}
    </WishlistContext.Provider>
  )
}

export function useWishlist() {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error('useWishlist must be used inside WishlistProvider')
  return ctx
}
