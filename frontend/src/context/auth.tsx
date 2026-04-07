import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getToken, nostrLogin, getProfile } from '../api/client.ts'
import { getTokenPayload } from '../hooks/useCurrentFarmer.ts'
import { useNavigate } from 'react-router-dom'

interface AuthCtx {
  authed: boolean
  connecting: boolean
  error: string | null
  connect: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthCtx>({
  authed: false,
  connecting: false,
  error: null,
  connect: async () => {},
  clearError: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const onSuccess = useCallback(async () => {
    setAuthed(true)
    setConnecting(false)
    // Redirect to profile setup if Lightning Address not yet set
    try {
      const payload = getTokenPayload()
      if (payload?.farmer_id) {
        const farmer = await getProfile(payload.farmer_id)
        if (!farmer.ln_address) navigate('/profile?setup=1', { replace: true })
      }
    } catch { /* non-fatal */ }
  }, [navigate])

  // Silent background auth for Fedi / browser extension users
  useEffect(() => {
    if (authed) return
    const t = setTimeout(() => {
      if (!window.nostr) return
      setConnecting(true)
      nostrLogin()
        .then(onSuccess)
        .catch(() => setConnecting(false)) // silent — user can connect manually
    }, 200)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      await nostrLogin()
      await onSuccess()
    } catch (e: unknown) {
      setConnecting(false)
      setError(e instanceof Error ? e.message : 'Connection failed')
    }
  }, [onSuccess])

  return (
    <AuthContext.Provider value={{ authed, connecting, error, connect, clearError: () => setError(null) }}>
      {children}
    </AuthContext.Provider>
  )
}
