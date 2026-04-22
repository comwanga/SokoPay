import { useState } from 'react'
import { Zap, ExternalLink, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import clsx from 'clsx'

interface Props {
  sellerName: string
  lightningAddress?: string | null
  lnurlSlug?: string | null
}

const PRESET_AMOUNTS = [100, 500, 1000, 5000]

export default function LightningSendTip({ sellerName, lightningAddress, lnurlSlug }: Props) {
  const [open, setOpen]         = useState(false)
  const [amount, setAmount]     = useState('')
  const [copied, setCopied]     = useState(false)

  const address = lightningAddress
  if (!address && !lnurlSlug) return null

  const displayAddress = address ?? `${lnurlSlug}@sokopay.app`

  function copyAddress() {
    navigator.clipboard.writeText(displayAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Build a lightning: URI for the QR code
  const lightningUri = `lightning:${displayAddress}`

  return (
    <div className="border-t border-gray-800 pt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-bitcoin" />
          <span className="text-sm font-semibold text-gray-200">Send a Lightning tip</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-gray-500">
            Send sats directly to {sellerName}'s Lightning wallet. Open in your wallet app or scan the QR.
          </p>

          {/* Address copy row */}
          <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
            <Zap className="w-3.5 h-3.5 text-bitcoin shrink-0" />
            <span className="text-xs text-gray-300 font-mono flex-1 truncate">{displayAddress}</span>
            <button
              onClick={copyAddress}
              className={clsx(
                'flex items-center gap-1 text-[11px] font-semibold transition-colors shrink-0',
                copied ? 'text-green-400' : 'text-gray-500 hover:text-gray-200',
              )}
            >
              {copied ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
            </button>
          </div>

          {/* QR + preset amounts */}
          <div className="grid grid-cols-2 gap-4">
            {/* QR */}
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 bg-white rounded-xl">
                <QRCodeSVG value={lightningUri} size={110} level="M" />
              </div>
              <p className="text-[10px] text-gray-600 text-center">Scan to open in wallet</p>
            </div>

            {/* Preset amounts + open in wallet */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Quick amounts (sats)</p>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_AMOUNTS.map(s => (
                  <button
                    key={s}
                    onClick={() => setAmount(String(s))}
                    className={clsx(
                      'py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      amount === String(s)
                        ? 'bg-bitcoin/20 border-bitcoin/30 text-bitcoin'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500',
                    )}
                  >
                    {s >= 1000 ? `${s/1000}k` : s}
                  </button>
                ))}
              </div>
              <input
                type="number"
                placeholder="Custom sats"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="input-base text-xs"
                min={1}
              />
            </div>
          </div>

          {/* Open in wallet */}
          <a
            href={`${lightningUri}${amount ? `?amount=${parseInt(amount) * 1000}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-bitcoin/10 border border-bitcoin/20 text-bitcoin text-sm font-semibold hover:bg-bitcoin/20 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Open in Lightning wallet
            <ExternalLink className="w-3.5 h-3.5 opacity-60" />
          </a>
        </div>
      )}
    </div>
  )
}
