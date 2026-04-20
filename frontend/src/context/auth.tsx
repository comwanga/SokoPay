import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { getToken, nostrLogin, getProfile, getLocalSecretKey, refreshAuthToken } from '../api/client.ts'
import { getTokenPayload } from '../hooks/useCurrentFarmer.ts'
import { useNavigate } from 'react-router-dom'
import ConnectModal from '../components/ConnectModal.tsx'

// Refresh the token when less than this many seconds remain on it.
const REFRESH_THRESHOLD_SECS = 2 * 60 * 60 // 2 hours
// Check token expiry every 15 minutes.
const REFRESH_CHECK_INTERVAL_MS = 15 * 60 * 1000

interface AuthCtx {
  authed: boolean
  connecting: boolean
  error: string | null
  role: string | null
  isAdmin: boolean
  connect: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthCtx>({
  authed: false,
  connecting: false,
  error: null,
  role: null,
  isAdmin: false,
  connect: async () => {},
  clearError: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function getRole(): string | null {
  return getTokenPayload()?.role ?? null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [role, setRole] = useState<string | null>(() => getRole())
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const onSuccess = useCallback(async () => {
    const wasAuthed = authed
    setAuthed(true)
    setRole(getRole())
    setConnecting(false)
    setShowModal(false)
    // Only check Lightning Address on first login — not on every modal re-auth
    if (!wasAuthed) {
      try {
        const payload = getTokenPayload()
        if (payload?.farmer_id) {
          const farmer = await getProfile(payload.farmer_id)
          if (!farmer.ln_address) navigate('/profile?setup=1', { replace: true })
        }
      } catch { /* non-fatal */ }
    }
  }, [navigate, authed])

  // Proactive token refresh: keep sessions alive without forcing re-login.
  useEffect(() => {
    function checkAndRefresh() {
      const payload = getTokenPayload() as { exp?: number } | null
      if (!payload?.exp) return
      const secsLeft = payload.exp - Math.floor(Date.now() / 1000)
      if (secsLeft < REFRESH_THRESHOLD_SECS && secsLeft > 0) {
        refreshAuthToken().catch(() => {
          // If refresh fails (e.g. server restarted with new secret) the user
          // will be logged out on the next authenticated request via the 401 handler.
        })
      }
    }

    if (authed) {
      checkAndRefresh() // check immediately on login
      refreshTimer.current = setInterval(checkAndRefresh, REFRESH_CHECK_INTERVAL_MS)
    }

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
  }, [authed])

  // Polls up to ~1s for window.nostr (Fedi injects it slightly after mount).
  // getLocalSecretKey is read once before the interval — it won't change during this window.
  useEffect(() => {
    if (authed) return
    let attempts = 0
    let mounted  = true
    const MAX        = 5
    const storedKey  = getLocalSecretKey()
    const iv = setInterval(() => {
      attempts++
      const hasSigner = !!window.nostr || !!storedKey
      if (hasSigner) {
        clearInterval(iv)
        setConnecting(true)
        nostrLogin()
          .then(() => { if (mounted) onSuccess() })
          .catch(e => {
            if (!mounted) return
            setConnecting(false)
            const msg = e instanceof Error ? e.message : ''
            if (msg && msg !== 'NO_SIGNER') setError(msg)
          })
      } else if (attempts >= MAX) {
        clearInterval(iv)
      }
    }, 200)
    return () => { mounted = false; clearInterval(iv) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      await nostrLogin()
      await onSuccess()
    } catch {
      // Any failure — broken extension, no signer, network error — opens the
      // modal so the user can paste their npub or generate a new identity.
      setConnecting(false)
      setShowModal(true)
    }
  }, [onSuccess])

  return (
    <AuthContext.Provider value={{
      authed, connecting, error, role, isAdmin: role === 'admin',
      connect, clearError: () => setError(null),
    }}>
      {children}
      {showModal && (
        <ConnectModal
          onSuccess={onSuccess}
          onCancel={() => setShowModal(false)}
        />
      )}
    </AuthContext.Provider>
  )
}
