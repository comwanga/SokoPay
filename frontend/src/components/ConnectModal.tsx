import { useState, useEffect } from 'react'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import {
  AlertCircle, RefreshCw, Eye, EyeOff, X, Zap, Puzzle,
  ExternalLink, Sparkles, Shield, ChevronRight,
} from 'lucide-react'
import { nostrLogin, setLocalSecretKey } from '../api/client.ts'
import clsx from 'clsx'

interface Props {
  onSuccess: () => void
  onCancel: () => void
}

type Screen = 'welcome' | 'extension' | 'generate'

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

const EXTENSION_LINKS = [
  { name: 'Alby', url: 'https://getalby.com', desc: 'Desktop browser — also manages Lightning' },
  { name: 'nos2x', url: 'https://chrome.google.com/webstore/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp', desc: 'Lightweight Chrome extension' },
  { name: 'Flamingo', url: 'https://www.flamingo.social', desc: 'Firefox extension' },
]

export default function ConnectModal({ onSuccess, onCancel }: Props) {
  const hasExtension = typeof window !== 'undefined' && !!window.nostr
  const [screen, setScreen] = useState<Screen>('welcome')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  // Extension flow
  const [extError, setExtError] = useState<string | null>(null)
  const [extLoading, setExtLoading] = useState(false)

  // Generate flow
  const [genKey, setGenKey] = useState(() => makeKey())
  const [showNsec, setShowNsec] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [savedConfirmed, setSavedConfirmed] = useState(false)

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  async function handleExtensionLogin() {
    setExtError(null)
    setExtLoading(true)
    try {
      await nostrLogin()
      onSuccess()
    } catch (e) {
      setExtError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setExtLoading(false)
    }
  }

  async function handleGenerateLogin() {
    setGenError(null)
    setGenLoading(true)
    try {
      setLocalSecretKey(genKey.sk)
      await nostrLogin()
      onSuccess()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setGenLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Sign in to SokoPay" className="bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-brand-400" />
            </div>
            <h2 className="text-sm font-bold text-gray-100">
              {screen === 'welcome' ? 'Sign in to SokoPay' : screen === 'extension' ? 'Use Nostr wallet' : 'Create your identity'}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">

          {/* ── Welcome screen ──────────────────────────────────────── */}
          {screen === 'welcome' && (
            <>
              {/* Fedi banner */}
              <div className="flex items-start gap-2.5 bg-brand-500/10 border border-brand-500/20 rounded-xl px-3.5 py-3">
                <Zap className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-brand-300">Using Fedi?</p>
                  <p className="text-[11px] text-brand-400/80 mt-0.5 leading-snug">
                    Open this page inside the Fedi app for instant sign-in — no extra steps.
                  </p>
                </div>
              </div>

              {/* Sign-in options */}
              <div className="space-y-2">
                {hasExtension && (
                  <button
                    onClick={() => setScreen('extension')}
                    className="flex items-center gap-3 w-full bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-xl px-4 py-3 transition-all text-left group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-green-900/30 border border-green-700/30 flex items-center justify-center shrink-0">
                      <Puzzle className="w-4.5 h-4.5 text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-100">Nostr wallet detected</p>
                      <p className="text-[11px] text-gray-500">Sign in with your existing wallet</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 shrink-0" />
                  </button>
                )}

                <button
                  onClick={() => setScreen('extension')}
                  className={clsx(
                    'flex items-center gap-3 w-full bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-xl px-4 py-3 transition-all text-left group',
                    hasExtension && 'hidden',
                  )}
                >
                  <div className="w-9 h-9 rounded-lg bg-gray-700 border border-gray-600 flex items-center justify-center shrink-0">
                    <Puzzle className="w-4.5 h-4.5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-100">I have a Nostr wallet</p>
                    <p className="text-[11px] text-gray-500">Alby, nos2x, Flamingo, or similar</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 shrink-0" />
                </button>

                <button
                  onClick={() => setScreen('generate')}
                  className="flex items-center gap-3 w-full bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 hover:border-brand-500/30 rounded-xl px-4 py-3 transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-lg bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4.5 h-4.5 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-brand-300">Create new identity</p>
                    <p className="text-[11px] text-brand-400/70">Takes 5 seconds — no email needed</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-brand-600 group-hover:text-brand-400 shrink-0" />
                </button>
              </div>

              {/* Trust line */}
              <div className="flex items-center gap-1.5 justify-center pt-1">
                <Shield className="w-3 h-3 text-gray-600" />
                <p className="text-[10px] text-gray-600">No email · No KYC · Your key, your account</p>
              </div>
            </>
          )}

          {/* ── Extension screen ────────────────────────────────────── */}
          {screen === 'extension' && (
            <>
              <button
                onClick={() => setScreen('welcome')}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors -mt-1 mb-1"
              >
                ← Back
              </button>

              {hasExtension ? (
                <>
                  <div className="flex items-start gap-2 bg-green-900/20 border border-green-700/30 rounded-xl px-3 py-2.5">
                    <Puzzle className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-green-300 leading-snug">
                      Extension detected. Your private key stays in the wallet — SokoPay never sees it.
                    </p>
                  </div>

                  {extError && (
                    <div className="flex gap-2 bg-red-900/20 border border-red-700/30 rounded-xl px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-400">{extError}</p>
                    </div>
                  )}

                  <button
                    onClick={handleExtensionLogin}
                    disabled={extLoading}
                    className="btn-primary w-full justify-center"
                  >
                    <Puzzle className="w-4 h-4" />
                    {extLoading ? 'Waiting for wallet…' : 'Sign in with wallet'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400 leading-snug">
                    Install a Nostr browser extension to sign in securely. Your private key never leaves your device.
                  </p>
                  <div className="space-y-1.5">
                    {EXTENSION_LINKS.map(ext => (
                      <a
                        key={ext.name}
                        href={ext.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-xl px-3 py-2.5 transition-colors group"
                      >
                        <div>
                          <p className="text-xs font-semibold text-gray-200">{ext.name}</p>
                          <p className="text-[10px] text-gray-500">{ext.desc}</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 shrink-0" />
                      </a>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-600 text-center">
                    No extension?{' '}
                    <button onClick={() => setScreen('generate')} className="text-brand-400 hover:text-brand-300">
                      Create a new identity →
                    </button>
                  </p>
                </>
              )}
            </>
          )}

          {/* ── Generate identity screen ────────────────────────────── */}
          {screen === 'generate' && (
            <>
              <button
                onClick={() => setScreen('welcome')}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors -mt-1 mb-1"
              >
                ← Back
              </button>

              <p className="text-[11px] text-gray-400 leading-snug">
                A unique keypair is generated for you in your browser. Save your
                {' '}<strong className="text-red-400">private key (nsec)</strong>{' '}
                — it's your password and cannot be reset.
              </p>

              <div className="bg-gray-800 rounded-xl p-4 space-y-3 text-xs">
                {/* npub */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Public key — share freely
                    </span>
                    <button onClick={() => copy(genKey.npub, 'npub')} className="text-[10px] text-brand-400 hover:text-brand-300">
                      {copied === 'npub' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="font-mono text-gray-300 break-all leading-relaxed text-[10px]">{genKey.npub}</p>
                </div>

                {/* nsec */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-red-400/80 uppercase tracking-wider">
                      Private key — keep secret
                    </span>
                    <div className="flex gap-2.5">
                      <button onClick={() => setShowNsec(v => !v)} className="text-[10px] text-gray-400 hover:text-gray-200 flex items-center gap-1">
                        {showNsec ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {showNsec ? 'Hide' : 'Reveal'}
                      </button>
                      <button onClick={() => copy(genKey.nsec, 'nsec')} className="text-[10px] text-brand-400 hover:text-brand-300">
                        {copied === 'nsec' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <p className="font-mono text-gray-300 break-all leading-relaxed text-[10px]">
                    {showNsec ? genKey.nsec : '•'.repeat(50)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/30 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-300 leading-snug">
                  Copy and save your <strong>nsec</strong> in a password manager or written note before continuing. You cannot recover it later.
                </p>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={savedConfirmed}
                  onChange={e => setSavedConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 accent-brand-500"
                />
                <span className="text-xs text-gray-400 leading-snug">
                  I have saved my private key somewhere safe
                </span>
              </label>

              <button
                onClick={() => { setGenKey(makeKey()); setShowNsec(false); setSavedConfirmed(false) }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Generate a different key
              </button>

              {genError && (
                <div className="flex gap-2 bg-red-900/20 border border-red-700/30 rounded-xl px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{genError}</p>
                </div>
              )}

              <button
                onClick={handleGenerateLogin}
                disabled={genLoading || !savedConfirmed}
                className="btn-primary w-full justify-center"
              >
                {genLoading ? 'Creating account…' : 'Continue to SokoPay'}
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
