import { useState, useCallback, useMemo } from 'react'

export interface FollowEntry {
  id: string
  name: string
  ts: number
}

const KEY = 'sokopay_following'
const MAX = 100

function load(): FollowEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

function persist(entries: FollowEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(entries)) } catch { /* quota */ }
}

export function useSellerFollow() {
  const [following, setFollowing] = useState<FollowEntry[]>(load)

  const isFollowing = useCallback(
    (id: string) => following.some(f => f.id === id),
    [following],
  )

  const follow = useCallback((id: string, name: string) => {
    setFollowing(prev => {
      if (prev.some(f => f.id === id)) return prev
      const next = [{ id, name, ts: Date.now() }, ...prev].slice(0, MAX)
      persist(next)
      return next
    })
  }, [])

  const unfollow = useCallback((id: string) => {
    setFollowing(prev => {
      const next = prev.filter(f => f.id !== id)
      persist(next)
      return next
    })
  }, [])

  const toggle = useCallback((id: string, name: string) => {
    setFollowing(prev => {
      const exists = prev.some(f => f.id === id)
      const next = exists
        ? prev.filter(f => f.id !== id)
        : [{ id, name, ts: Date.now() }, ...prev].slice(0, MAX)
      persist(next)
      return next
    })
  }, [])

  const count = useMemo(() => following.length, [following])
  const ids   = useMemo(() => following.map(f => f.id), [following])

  return { following, isFollowing, follow, unfollow, toggle, count, ids }
}
