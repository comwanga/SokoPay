import { useState } from 'react'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { AlertCircle, RefreshCw, Eye, EyeOff, X } from 'lucide-react'
import { nostrLoginWithKey, setLocalSecretKey } from '../api/client.ts'

interface Props {
  onSuccess: () => void
  onCancel: () => void
}

type Tab = 'paste' | 'generate'

function makeKey() {
  const sk = generateSecretKey()
  return {
    sk,
    npub: nip19.npubEncode(getPublicKey(sk)),
    nsec: nip19.nsecEncode(sk),
  }
}

export default function ConnectModal({ onSuccess, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('paste')

  // — Paste-key state
  const [input, setInput] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [pasteLoading, setPasteLoading] = useState(false)

  // — Generate-key state
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

  // ── Paste-key handler ──────────────────────────────────────────────────────

  async function handlePasteLogin() {
    setPasteError(null)
    const val = input.trim()
    if (!val) { setPasteError('Paste your private key first.'); return }

    let sk: Uint8Array

    if (val.startsWith('npub1')) {
      setPasteError(
        'That is a public key (npub) — it cannot be used to sign in. ' +
        'You need your private key (nsec). Open AgriPay in Fedi for automatic sign-in.',
      )
      return
    }

    try {
      if (val.startsWith('nsec1')) {
        const decoded = nip19.decode(val)
        if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
        sk = decoded.data as Uint8Array
      } else if (/^[0-9a-f]{64}$/i.test(val)) {
        sk = new Uint8Array(val.match(/.{2}/g)!.map(b => parseInt(b, 16)))
      } else {
        setPasteError('Paste a valid nsec (nsec1…) or 64-character hex private key.')
        return
      }
    } catch {
      setPasteError('Could not decode that key. Make sure you copied the full nsec.')
      return
    }

    setPasteLoading(true)
    try {
      setLocalSecretKey(sk)
      await nostrLoginWithKey(sk)
      onSuccess()
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setPasteLoading(false)
    }
  }

  // ── Generate-key handler ───────────────────────────────────────────────────

  async function handleGenerateLogin() {
    setGenError(null)
    setGenLoading(true)
    try {
      setLocalSecretKey(genKey.sk)
      await nostrLoginWithKey(genKey.sk)
      onSuccess()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setGenLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-0">
          <div>
            <h2 className="text-base font-bold text-gray-100">Connect with Nostr</h2>
            <p className="text-xs text-gray-500 mt-0.5">Your identity on AgriPay</p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-600 hover:text-gray-300 transition-colors p-1 -mt-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1 mx-5 mt-4">
          {(['paste', 'generate'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t === 'paste' ? 'I have a key' : 'New identity'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">

          {/* ── Tab: Paste key ─────────────────────────────────────── */}
          {tab === 'paste' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400">
                  Paste your Nostr private key
                </label>
                <input
                  type="password"
                  placeholder="nsec1… or 64-char hex"
                  value={input}
                  onChange={e => { setInput(e.target.value); setPasteError(null) }}
                  onKeyDown={e => e.key === 'Enter' && handlePasteLogin()}
                  className="input-base font-mono text-xs"
                  autoComplete="off"
                  autoFocus
                />
                <p className="text-[11px] text-gray-600">
                  Your key is stored in your browser only — never sent to our servers.
                </p>
              </div>

              {pasteError && (
                <div className="flex gap-2 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{pasteError}</p>
                </div>
              )}

              <button
                onClick={handlePasteLogin}
                disabled={pasteLoading}
                className="btn-primary w-full justify-center"
              >
                {pasteLoading ? 'Signing in…' : 'Sign in'}
              </button>

              <p className="text-[11px] text-gray-600 text-center">
                Don't have a key?{' '}
                <button
                  onClick={() => setTab('generate')}
                  className="text-brand-400 hover:text-brand-300"
                >
                  Generate one →
                </button>
              </p>
            </>
          )}

          {/* ── Tab: Generate key ──────────────────────────────────── */}
          {tab === 'generate' && (
            <>
              <div className="bg-gray-800 rounded-xl p-4 space-y-3 text-xs">
                {/* npub */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Public key (npub)
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
                      Private key (nsec) — keep secret!
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
                  Copy and save your <strong>private key (nsec)</strong> somewhere safe before continuing.
                  You cannot recover it if you lose it.
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
                {genLoading ? 'Connecting…' : "I've saved my key — Continue"}
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
