import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  User, Zap, MapPin, Smartphone, Check, AlertCircle, ExternalLink,
  Loader2, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Settings, ChevronRight,
} from 'lucide-react'
import { updateProfile, verifyLnAddress, isFediContext } from '../api/client.ts'
import { useCurrentFarmer } from '../hooks/useCurrentFarmer.ts'
import type { LnVerifyResponse } from '../types'
import clsx from 'clsx'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

// ── Lightning Address field with live verification ────────────────────────────

interface LightningFieldProps {
  value: string
  savedAddress: string | null   // what's currently persisted in DB
  onChange: (v: string) => void
  onVerified: (info: LnVerifyResponse | null) => void
}

function LightningAddressField({ value, savedAddress, onChange, onVerified }: LightningFieldProps) {
  const [status, setStatus] = useState<'idle' | 'verifying' | 'ok' | 'error'>('idle')
  const [info, setInfo] = useState<LnVerifyResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // If the current input matches what's already saved in the DB,
  // treat it as implicitly verified so the user doesn't have to re-verify on every save.
  const isUnchanged = value.trim() !== '' && value.trim() === (savedAddress ?? '').trim()
  const showVerifiedBadge = status === 'ok' || isUnchanged

  async function handleVerify() {
    const addr = value.trim()
    if (!addr) return
    setStatus('verifying')
    setErrMsg(null)
    setInfo(null)
    onVerified(null)
    try {
      const result = await verifyLnAddress(addr)
      setInfo(result)
      setStatus('ok')
      onVerified(result)
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Verification failed')
      setStatus('error')
    }
  }

  function handleChange(v: string) {
    onChange(v)
    // Clear verification result when the user edits the field
    if (v.trim() !== value.trim()) {
      setStatus('idle')
      setInfo(null)
      setErrMsg(null)
      onVerified(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={value}
            onChange={e => handleChange(e.target.value)}
            placeholder="you@domain.com or lnurl1dp68…"
            inputMode="email"
            autoComplete="off"
            className={clsx(
              'input-base pl-9 pr-9',
              showVerifiedBadge && 'border-mpesa/40 focus:border-mpesa/70',
            )}
          />
          {showVerifiedBadge && (
            <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mpesa pointer-events-none" />
          )}
        </div>
        <button
          type="button"
          onClick={handleVerify}
          disabled={!value.trim() || status === 'verifying'}
          className="btn-secondary px-3 shrink-0 gap-1.5"
          title="Verify this address is reachable"
        >
          {status === 'verifying'
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          <span className="text-xs">{status === 'verifying' ? 'Checking…' : 'Verify'}</span>
        </button>
      </div>

      {/* Implicitly verified (unchanged from DB) */}
      {isUnchanged && status === 'idle' && (
        <p className="text-xs text-mpesa flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Previously verified and saved
        </p>
      )}

      {/* Verification success panel */}
      {status === 'ok' && info && (
        <div className="bg-mpesa/5 border border-mpesa/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-mpesa shrink-0" />
            <p className="text-xs font-semibold text-mpesa">Wallet reachable</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <span className="text-gray-500 w-28 shrink-0">Description</span>
              <span className="text-gray-200">{info.description}</span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="text-gray-500 w-28 shrink-0">Min receivable</span>
              <span className="text-gray-200">{info.min_sendable_sats.toLocaleString()} sats</span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="text-gray-500 w-28 shrink-0">Max receivable</span>
              <span className="text-gray-200">
                {info.max_sendable_sats >= 100_000_000
                  ? `${(info.max_sendable_sats / 100_000_000).toFixed(2)} BTC`
                  : `${info.max_sendable_sats.toLocaleString()} sats`}
              </span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="text-gray-500 w-28 shrink-0">Callback</span>
              <span className="text-gray-500 font-mono break-all text-[10px]">{info.callback}</span>
            </div>
          </div>
        </div>
      )}

      {/* Verification error panel */}
      {status === 'error' && errMsg && (
        <div className="bg-red-900/10 border border-red-700/30 rounded-xl p-3 flex gap-2 items-start">
          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-red-400">Address unreachable</p>
            <p className="text-xs text-red-500/80">{errMsg}</p>
            <p className="text-[11px] text-gray-600 mt-1">
              Check the address is correct, or try a different Lightning Address or wallet.
            </p>
          </div>
        </div>
      )}

      {/* Format hints */}
      {!value && (
        <div className="text-[11px] text-gray-600 space-y-0.5">
          <p>Accepted formats:</p>
          <p className="font-mono pl-2">you@wallet.com  — Lightning Address</p>
          <p className="font-mono pl-2">lnurl1dp68…     — bech32 LNURL string</p>
          {isFediContext && (
            <a
              href="https://www.fedi.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              Fedi: Settings → Federation → Lightning Address
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ── Profile page ──────────────────────────────────────────────────────────────

export default function Profile() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const isSetup = params.get('setup') === '1'
  const qc = useQueryClient()

  const { farmer, farmerId, isLoading } = useCurrentFarmer()

  const [name, setName] = useState('')
  const [lnAddress, setLnAddress] = useState('')
  const [lnVerifyInfo, setLnVerifyInfo] = useState<LnVerifyResponse | null>(null)
  const [mpesaPhone, setMpesaPhone] = useState('')
  const [locationName, setLocationName] = useState('')
  const [locationLat, setLocationLat] = useState<number | undefined>()
  const [locationLng, setLocationLng] = useState<number | undefined>()
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (farmer) {
      setName(farmer.name ?? '')
      setLnAddress(farmer.ln_address ?? '')
      setMpesaPhone(farmer.mpesa_phone ?? '')
      setLocationName(farmer.location_name ?? '')
    }
  }, [farmer])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!farmerId) return

    const trimmedLn = lnAddress.trim()

    // Require verification if the address changed from what's in the DB
    const addressChanged = trimmedLn !== (farmer?.ln_address ?? '').trim()
    if (trimmedLn && addressChanged && !lnVerifyInfo) {
      setError('Please verify your Lightning Address before saving.')
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      await updateProfile(farmerId, {
        name: name.trim() || undefined,
        ln_address: trimmedLn || undefined,
        mpesa_phone: mpesaPhone.trim() || undefined,
        location_name: locationName.trim() || undefined,
        location_lat: locationLat,
        location_lng: locationLng,
      })
      await qc.invalidateQueries({ queryKey: ['farmer-me', farmerId] })
      setSaved(true)
      if (isSetup) {
        setTimeout(() => navigate('/'), 800)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleGps() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocationLat(pos.coords.latitude)
        setLocationLng(pos.coords.longitude)
        setLocating(false)
      },
      () => setLocating(false),
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-3 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading profile…
      </div>
    )
  }

  if (!farmer) {
    return (
      <div className="p-6 text-gray-500 text-sm">Could not load profile.</div>
    )
  }

  const isNostrUser = !!farmer.nostr_pubkey
  const connectionLabel = isFediContext ? 'Fedi wallet' : 'Nostr browser extension'

  return (
    <div className="p-6 max-w-lg space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-100">
          {isSetup ? 'Complete your profile' : 'Profile & Settings'}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {isSetup
            ? 'Add your Lightning Address so buyers can pay you directly.'
            : 'Manage your account and payment settings.'}
        </p>
      </div>

      {/* Lightning Address required banner */}
      {!farmer.ln_address && (
        <div className="flex gap-3 items-start bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4">
          <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="text-yellow-300 font-semibold">Lightning Address required to receive payments</p>
            <p className="text-yellow-500/80 text-xs">
              Buyers pay directly to your Lightning Address — no platform custody.
              {isFediContext && (
                <> Find yours in Fedi → your federation → Lightning Address.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Nostr connection status */}
      {isNostrUser && (
        <div className="flex gap-3 items-center bg-brand-500/10 border border-brand-500/20 rounded-xl p-4">
          <ShieldCheck className="w-4 h-4 text-brand-400 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-semibold text-brand-300">
              Connected via {connectionLabel}
            </p>
            <p className="text-[10px] text-gray-500 font-mono truncate">
              npub: {farmer.nostr_pubkey}
            </p>
          </div>
        </div>
      )}

      {/* Display options link */}
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-gray-900 border border-gray-800 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Settings className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="text-left">
            <p className="text-sm font-medium text-gray-200">Display options</p>
            <p className="text-xs text-gray-500">Bitcoin unit, currency, theme, language</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
      </button>

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-5">

        <Field label="Display name">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="input-base pl-9"
            />
          </div>
        </Field>

        <Field label="Lightning Address / LNURL">
          <LightningAddressField
            value={lnAddress}
            savedAddress={farmer.ln_address}
            onChange={v => { setLnAddress(v); setSaved(false) }}
            onVerified={setLnVerifyInfo}
          />
        </Field>

        <Field
          label="M-Pesa Number (for receiving payments)"
          hint="Kenyan mobile number where you receive M-Pesa payments. E.g. 0712 345 678"
        >
          <div className="relative">
            <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="tel"
              value={mpesaPhone}
              onChange={e => { setMpesaPhone(e.target.value); setSaved(false) }}
              placeholder="0712 345 678"
              inputMode="tel"
              autoComplete="tel"
              className="input-base pl-9"
            />
          </div>
          {farmer.mpesa_phone && mpesaPhone.trim() === farmer.mpesa_phone && (
            <p className="text-xs text-mpesa flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {farmer.mpesa_phone} — saved
            </p>
          )}
        </Field>

        <Field
          label="Your location"
          hint="Helps buyers see delivery distance estimates"
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={locationName}
                onChange={e => setLocationName(e.target.value)}
                placeholder="e.g. Nairobi, Westlands"
                className="input-base pl-9"
              />
            </div>
            <button
              type="button"
              onClick={handleGps}
              disabled={locating}
              className="btn-secondary px-3 shrink-0"
              title="Use GPS"
            >
              {locating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <MapPin className="w-4 h-4" />}
            </button>
          </div>
          {(locationLat || farmer.location_name) && (
            <p className="text-xs text-mpesa">
              {locationLat ? 'GPS location captured' : `Saved: ${farmer.location_name}`}
            </p>
          )}
        </Field>

        {error && (
          <div className="flex gap-2 items-start bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          {!isSetup && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="btn-secondary flex-1 justify-center"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className={clsx(
              'flex-1 justify-center',
              saved ? 'btn-success' : 'btn-primary',
            )}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saved ? (
              <><Check className="w-4 h-4" /> {isSetup ? 'Done! Going to marketplace…' : 'Saved'}</>
            ) : (
              isSetup ? 'Save & Continue' : 'Save Changes'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
