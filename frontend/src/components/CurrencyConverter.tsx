import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Plus, Trash2, Bitcoin, Check } from 'lucide-react'

// ── Supported currencies ──────────────────────────────────────────────────────

const SUPPORTED = [
  { code: 'EUR', name: 'Euro',                   flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound',           flag: '🇬🇧' },
  { code: 'KES', name: 'Kenyan Shilling',         flag: '🇰🇪' },
  { code: 'NGN', name: 'Nigerian Naira',           flag: '🇳🇬' },
  { code: 'UGX', name: 'Ugandan Shilling',        flag: '🇺🇬' },
  { code: 'TZS', name: 'Tanzanian Shilling',      flag: '🇹🇿' },
  { code: 'ZAR', name: 'South African Rand',      flag: '🇿🇦' },
  { code: 'GHS', name: 'Ghanaian Cedi',           flag: '🇬🇭' },
  { code: 'ETB', name: 'Ethiopian Birr',          flag: '🇪🇹' },
  { code: 'RWF', name: 'Rwandan Franc',           flag: '🇷🇼' },
  { code: 'JPY', name: 'Japanese Yen',            flag: '🇯🇵' },
  { code: 'CNY', name: 'Chinese Yuan',            flag: '🇨🇳' },
  { code: 'INR', name: 'Indian Rupee',            flag: '🇮🇳' },
  { code: 'AED', name: 'UAE Dirham',              flag: '🇦🇪' },
  { code: 'CAD', name: 'Canadian Dollar',         flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar',       flag: '🇦🇺' },
] as const

type CurrencyCode = typeof SUPPORTED[number]['code']

const LS_KEY = 'sokopay_converter_currencies'

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

// ── Conversion helpers ────────────────────────────────────────────────────────

// btcRates[code] = price of 1 BTC in that currency
// e.g. { USD: 65000, KES: 8450000, EUR: 60000 }

function satsToFiat(sats: number, btcInCurrency: number): string {
  const amount = (sats / 1e8) * btcInCurrency
  if (!isFinite(amount)) return ''
  if (amount < 0.001) return amount.toPrecision(3)
  if (amount < 10)    return amount.toFixed(4)
  if (amount < 10000) return amount.toFixed(2)
  return Math.round(amount).toString()
}

function fiatToSats(amount: number, btcInCurrency: number): number {
  return (amount / btcInCurrency) * 1e8
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export default function CurrencyConverter({ onClose }: Props) {
  const [userCurrencies, setUserCurrencies] = useState<string[]>(loadSaved)
  // btcRates[code] = 1 BTC in that currency
  const [btcRates, setBtcRates]       = useState<Record<string, number>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading]         = useState(true)
  const [amounts, setAmounts]         = useState<Record<string, string>>({})
  const [focused, setFocused]         = useState<string | null>(null)
  const [showPicker, setShowPicker]   = useState(false)

  // ── Persist user currency list ──────────────────────────────────────────────

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(userCurrencies))
  }, [userCurrencies])

  // ── Fetch rates from CoinGecko ──────────────────────────────────────────────

  const fetchRates = useCallback(async () => {
    const codes = ['usd', ...userCurrencies.map(c => c.toLowerCase())].join(',')
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${codes}`,
      )
      if (!res.ok) return
      const data = await res.json() as { bitcoin: Record<string, number> }
      const prices: Record<string, number> = {}
      for (const [k, v] of Object.entries(data.bitcoin)) {
        prices[k.toUpperCase()] = v
      }
      setBtcRates(prices)
      setLastUpdated(new Date())
    } catch {
      // best-effort — show stale rates
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCurrencies.join(',')])

  useEffect(() => {
    fetchRates()
    const timer = setInterval(fetchRates, 60_000)
    return () => clearInterval(timer)
  }, [fetchRates])

  // ── Bidirectional conversion ────────────────────────────────────────────────

  const allFiatCodes = ['USD', ...userCurrencies]

  function handleChange(code: string, raw: string) {
    const stripped = raw.replace(/,/g, '')
    const num = stripped === '' ? NaN : parseFloat(stripped)

    if (stripped === '' || isNaN(num) || num < 0) {
      const cleared: Record<string, string> = { [code]: raw }
      for (const c of ['SAT', ...allFiatCodes]) {
        if (c !== code) cleared[c] = ''
      }
      setAmounts(cleared)
      return
    }

    const next: Record<string, string> = { [code]: raw }

    let sats: number
    if (code === 'SAT') {
      sats = num
    } else {
      const rate = btcRates[code]
      if (!rate) return
      sats = fiatToSats(num, rate)
    }

    if (code !== 'SAT') {
      next['SAT'] = isFinite(sats) ? Math.round(sats).toString() : ''
    }

    for (const cur of allFiatCodes) {
      if (cur === code) continue
      const rate = btcRates[cur]
      next[cur] = rate ? satsToFiat(sats, rate) : ''
    }

    setAmounts(next)
  }

  // ── Currency management ─────────────────────────────────────────────────────

  function addCurrency(code: string) {
    setUserCurrencies(prev => [...prev, code])
    setShowPicker(false)
  }

  function removeCurrency(code: string) {
    setUserCurrencies(prev => prev.filter(c => c !== code))
    setAmounts(prev => {
      const next = { ...prev }
      delete next[code]
      return next
    })
  }

  const available = SUPPORTED.filter(c => !userCurrencies.includes(c.code))

  function getMeta(code: string) {
    return SUPPORTED.find(c => c.code === code)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Dimmed backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center">
        <div className="w-full max-w-md bg-[#0d0d0d] rounded-t-3xl border-t border-gray-800 shadow-2xl px-4 pt-2 pb-10">

          {/* Header */}
          <div className="flex items-center justify-between py-3 mb-3">
            <button
              onClick={() => { setLoading(true); fetchRates() }}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              title="Refresh rates"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <div className="text-center">
              <p className="text-sm font-bold text-gray-100">Currency Converter</p>
              {lastUpdated && (
                <p className="text-[10px] text-gray-600 mt-0.5">
                  Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>

            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm font-semibold text-mpesa hover:text-mpesa/80 transition-colors px-2 py-1"
            >
              <Check className="w-3.5 h-3.5" />
              Done
            </button>
          </div>

          {/* Rows */}
          {loading ? (
            <div className="space-y-2.5 py-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-[54px] rounded-2xl bg-gray-800/60 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">

              {/* SAT row — fixed, no delete */}
              <CurrencyRow
                code="SAT"
                label="sat"
                icon={
                  <div className="w-7 h-7 rounded-full bg-[#f7931a] flex items-center justify-center shrink-0">
                    <Bitcoin className="w-4 h-4 text-white" strokeWidth={2.5} />
                  </div>
                }
                value={amounts['SAT'] ?? ''}
                focused={focused === 'SAT'}
                onChange={v => handleChange('SAT', v)}
                onFocus={() => setFocused('SAT')}
                onBlur={() => setFocused(null)}
              />

              {/* USD row — fixed, no delete */}
              <CurrencyRow
                code="USD"
                label="USD"
                icon={<span className="text-xl">🇺🇸</span>}
                value={amounts['USD'] ?? ''}
                focused={focused === 'USD'}
                onChange={v => handleChange('USD', v)}
                onFocus={() => setFocused('USD')}
                onBlur={() => setFocused(null)}
              />

              {/* User-added currency rows */}
              {userCurrencies.map(code => {
                const meta = getMeta(code as CurrencyCode)
                return (
                  <CurrencyRow
                    key={code}
                    code={code}
                    label={code}
                    icon={<span className="text-xl">{meta?.flag ?? '🌍'}</span>}
                    value={amounts[code] ?? ''}
                    focused={focused === code}
                    onChange={v => handleChange(code, v)}
                    onFocus={() => setFocused(code)}
                    onBlur={() => setFocused(null)}
                    onDelete={() => removeCurrency(code)}
                  />
                )
              })}

              {/* Add currency */}
              {available.length > 0 && (
                showPicker ? (
                  <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-700/60">
                    <div className="max-h-52 overflow-y-auto">
                      {available.map(cur => (
                        <button
                          key={cur.code}
                          onClick={() => addCurrency(cur.code)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800 transition-colors"
                        >
                          <span className="text-xl">{cur.flag}</span>
                          <span className="text-sm text-gray-200">{cur.name}</span>
                          <span className="ml-auto text-xs font-semibold text-gray-500">{cur.code}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowPicker(false)}
                      className="w-full py-2.5 text-xs text-gray-500 hover:text-gray-300 border-t border-gray-700/60 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowPicker(true)}
                    className="w-full py-3 flex items-center justify-center gap-2 text-sm font-medium text-mpesa hover:text-mpesa/70 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add new currency...
                  </button>
                )
              )}

            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Currency input row ────────────────────────────────────────────────────────

interface RowProps {
  code: string
  label: string
  icon: React.ReactNode
  value: string
  focused: boolean
  onChange: (v: string) => void
  onFocus: () => void
  onBlur: () => void
  onDelete?: () => void
}

function CurrencyRow({ label, icon, value, focused, onChange, onFocus, onBlur, onDelete }: RowProps) {
  return (
    <div
      className={[
        'flex items-center gap-3 bg-gray-800/70 rounded-2xl px-4 py-3 transition-all',
        focused ? 'ring-1 ring-gray-600' : '',
      ].join(' ')}
    >
      <div className="shrink-0 flex items-center justify-center w-8 h-8">
        {icon}
      </div>

      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={`Enter amount in ${label}`}
        className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none min-w-0"
      />

      <span className="text-sm font-semibold text-gray-400 shrink-0">{label}</span>

      {onDelete && (
        <button
          onClick={onDelete}
          className="ml-1 shrink-0 p-1 text-gray-600 hover:text-red-400 transition-colors"
          aria-label={`Remove ${label}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
