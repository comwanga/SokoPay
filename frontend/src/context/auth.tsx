import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getToken, nostrLogin, getProfile, getLocalSecretKey } from '../api/client.ts'
import { getTokenPayload } from '../hooks/useCurrentFarmer.ts'
import { useNavigate } from 'react-router-dom'
import ConnectModal from '../components/ConnectModal.tsx'

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

  const onSuccess = useCallback(async () => {
    setAuthed(true)
    setRole(getRole())
    setConnecting(false)
    setShowModal(false)
    // Redirect to profile setup if Lightning Address not yet set
    try {
      const payload = getTokenPayload()
      if (payload?.farmer_id) {
        const farmer = await getProfile(payload.farmer_id)
        if (!farmer.ln_address) navigate('/profile?setup=1', { replace: true })
      }
    } catch { /* non-fatal */ }
  }, [navigate])

  // Silent background auth — Fedi (window.nostr) or returning users with a stored key
  useEffect(() => {
    if (authed) return
    const t = setTimeout(() => {
      // Only attempt if there's actually a signer available
      if (!window.nostr && !getLocalSecretKey()) return
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
