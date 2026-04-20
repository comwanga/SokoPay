import { useState } from 'react'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { AlertCircle, RefreshCw, Eye, EyeOff, X, Zap, Lock } from 'lucide-react'
import { nostrLoginWithKey, setLocalSecretKey, login } from '../api/client.ts'

interface Props {
  onSuccess: () => void
  onCancel: () => void
}

type Tab = 'nsec' | 'generate' | 'password'

function makeKey() {
  const sk = generateSecretKey()
  const pubkeyHex = getPublicKey(sk)
  return {
    sk,
    pubkeyHex,
    npub: nip19.npubEncode(pubkeyHex),
    nsec: nip19.nsecEncode(sk),
  }
}

export default function ConnectModal({ onSuccess, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('nsec')

  // "I have a key" — accepts nsec private key
  const [nsecInput, setNsecInput] = useState('')
  const [nsecError, setNsecError] = useState<string | null>(null)
  const [nsecLoading, setNsecLoading] = useState(false)
  const [showNsecInput, setShowNsecInput] = useState(false)

  // Username/password
  const [pwUsername, setPwUsername] = useState('')
  const [pwPassword, setPwPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  // New identity
  const [genKey, setGenKey] = useState(() => makeKey())
  const [showNsec, setShowNsec] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genLoading, setGenLoading] = useState(false)

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  async function loginWithSk(
    sk: Uint8Array,
    setError: (msg: string | null) => void,
    setLoading: (v: boolean) => void,
  ) {
    setLoading(true)
    try {
      setLocalSecretKey(sk)
      await nostrLoginWithKey(sk)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleNsecLogin() {
    setNsecError(null)
    const val = nsecInput.trim()
    if (!val) { setNsecError('Paste your nsec key first.'); return }

    let sk: Uint8Array
    try {
      if (val.startsWith('nsec1')) {
        const decoded = nip19.decode(val)
        if (decoded.type !== 'nsec') throw new Error('Not an nsec')
        sk = decoded.data as Uint8Array
      } else if (/^[0-9a-f]{64}$/i.test(val)) {
        sk = new Uint8Array(val.match(/.{2}/g)!.map(b => parseInt(b, 16)))
      } else {
        setNsecError('Paste your nsec (nsec1…) or 64-character hex private key.')
        return
      }
    } catch {
      setNsecError('Could not decode that key. Make sure you copied the full nsec.')
      return
    }

    await loginWithSk(sk, setNsecError, setNsecLoading)
  }

  async function handlePasswordLogin() {
    setPwError(null)
    if (!pwUsername.trim() || !pwPassword) {
      setPwError('Username and password are required.')
      return
    }
    setPwLoading(true)
    try {
      await login({ username: pwUsername.trim(), password: pwPassword })
      onSuccess()
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setPwLoading(false)
    }
  }

  async function handleGenerateLogin() {
    setGenError(null)
    await loginWithSk(genKey.sk, setGenError, setGenLoading)
  }


  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-0">
          <div>
            <h2 className="text-base font-bold text-gray-100">Sign in to SokoPay</h2>
            <p className="text-xs text-gray-500 mt-0.5">Your identity on SokoPay</p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-600 hover:text-gray-300 transition-colors p-1 -mt-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fedi hint */}
        <div className="mx-5 mt-4 flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-lg px-3 py-2">
          <Zap className="w-3.5 h-3.5 text-brand-400 shrink-0" />
          <p className="text-[11px] text-brand-300">
            Using <strong>Fedi</strong>? Open this link inside the Fedi app for instant sign-in.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1 mx-5 mt-4">
          {([
            ['nsec', 'I have a key'],
            ['generate', 'New identity'],
            ['password', 'Password'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">

          {tab === 'nsec' && (
            <>
              <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-300 leading-snug">
                  Your <strong>nsec</strong> is your private key. Never share it. Only paste it on a device you trust.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400">
                  Paste your private key (nsec)
                </label>
                <div className="relative">
                  <input
                    type={showNsecInput ? 'text' : 'password'}
                    placeholder="nsec1… or 64-char hex"
                    value={nsecInput}
                    onChange={e => { setNsecInput(e.target.value); setNsecError(null) }}
                    onKeyDown={e => e.key === 'Enter' && handleNsecLogin()}
                    className="input-base font-mono text-xs pr-8 w-full"
                    autoComplete="off"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowNsecInput(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showNsecInput ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-600">
                  Your private key starts with <code className="text-gray-500">nsec1</code>. You saved it when you first created your identity.
                </p>
              </div>

              {nsecError && (
                <div className="flex gap-2 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{nsecError}</p>
                </div>
              )}

              <button
                onClick={handleNsecLogin}
                disabled={nsecLoading}
                className="btn-primary w-full justify-center"
              >
                {nsecLoading ? 'Signing in…' : 'Sign in'}
              </button>

              <p className="text-[11px] text-gray-600 text-center">
                No key yet?{' '}
                <button onClick={() => setTab('generate')} className="text-brand-400 hover:text-brand-300">
                  Generate one free →
                </button>
              </p>
            </>
          )}

          {/* ── Tab: Username / Password ──────────────────────────────── */}
          {tab === 'password' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400">Username</label>
                <input
                  type="text"
                  placeholder="your-username"
                  value={pwUsername}
                  onChange={e => { setPwUsername(e.target.value); setPwError(null) }}
                  onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                  className="input-base text-xs"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={pwPassword}
                    onChange={e => { setPwPassword(e.target.value); setPwError(null) }}
                    onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    className="input-base text-xs pr-8 w-full"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {pwError && (
                <div className="flex gap-2 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{pwError}</p>
                </div>
              )}

              <button
                onClick={handlePasswordLogin}
                disabled={pwLoading}
                className="btn-primary w-full justify-center"
              >
                <Lock className="w-4 h-4" />
                {pwLoading ? 'Signing in…' : 'Sign in'}
              </button>

              <p className="text-[11px] text-gray-600 text-center">
                Credentials are assigned by an admin. Contact your co-op administrator
                if you don't have an account.
              </p>
            </>
          )}

          {/* ── Tab: New identity ──────────────────────────────────────── */}
          {tab === 'generate' && (
            <>
              <div className="bg-gray-800 rounded-xl p-4 space-y-3 text-xs">
                {/* npub */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Public key (npub) — share freely
                    </span>
                    <button
                      onClick={() => copy(genKey.npub, 'npub')}
                      className="text-[10px] text-brand-400 hover:text-brand-300"
                    >
                      {copied === 'npub' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="font-mono text-gray-300 break-all leading-relaxed">{genKey.npub}</p>
                </div>

                {/* nsec */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-red-400/80 uppercase tracking-wider">
                      Private key (nsec) — keep secret
                    </span>
                    <div className="flex gap-2.5">
                      <button
                        onClick={() => setShowNsec(v => !v)}
                        className="text-[10px] text-gray-400 hover:text-gray-200 flex items-center gap-1"
                      >
                        {showNsec ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {showNsec ? 'Hide' : 'Show'}
                      </button>
                      <button
                        onClick={() => copy(genKey.nsec, 'nsec')}
                        className="text-[10px] text-brand-400 hover:text-brand-300"
                      >
                        {copied === 'nsec' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <p className="font-mono text-gray-300 break-all leading-relaxed">
                    {showNsec ? genKey.nsec : '•'.repeat(50)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-300 leading-snug">
                  Copy and save your <strong>nsec</strong> somewhere safe — you need it to log in on a new device.
                </p>
              </div>

              <button
                onClick={() => { setGenKey(makeKey()); setShowNsec(false) }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Generate a different key
              </button>

              {genError && (
                <div className="flex gap-2 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{genError}</p>
                </div>
              )}

              <button
                onClick={handleGenerateLogin}
                disabled={genLoading}
                className="btn-primary w-full justify-center"
              >
                {genLoading ? 'Creating account…' : "I've saved my key — Continue"}
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
