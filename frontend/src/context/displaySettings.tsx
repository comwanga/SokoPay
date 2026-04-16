import {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react'
import type { ReactNode } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BtcUnit  = 'sats' | 'btc'
export type AppTheme = 'system' | 'dark' | 'light'

export interface DisplaySettings {
  btcUnit:      BtcUnit
  fiatCurrency: string   // ISO-4217 code, e.g. 'KES', 'USD', 'NGN'
  theme:        AppTheme
  language:     string   // e.g. 'English', 'Swahili', 'French'
}

interface DisplaySettingsContextValue extends DisplaySettings {
  update: (patch: Partial<DisplaySettings>) => void
  formatSats: (sats: number) => string
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: DisplaySettings = {
  btcUnit:      'sats',
  fiatCurrency: 'KES',
  theme:        'system',
  language:     'English',
}

const LS_KEY = 'sokopay_display_settings'

function load(): DisplaySettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DisplaySettings>) }
  } catch {
    return DEFAULTS
  }
}

function save(s: DisplaySettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

// ── Theme application ─────────────────────────────────────────────────────────

function applyTheme(theme: AppTheme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    // system: mirror prefers-color-scheme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatSats(sats: number, unit: BtcUnit): string {
  if (unit === 'btc') {
    const btc = sats / 1e8
    if (btc === 0)       return '0 BTC'
    if (btc < 0.0001)    return btc.toPrecision(4) + ' BTC'
    return btc.toFixed(8).replace(/\.?0+$/, '') + ' BTC'
  }
  return sats.toLocaleString() + ' sats'
}

// ── Context ───────────────────────────────────────────────────────────────────

const Ctx = createContext<DisplaySettingsContextValue | null>(null)

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(load)

  // Apply theme on mount and whenever it changes
  useEffect(() => {
    applyTheme(settings.theme)

    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme('system')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [settings.theme])

  const update = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }, [])

  const fmt = useCallback(
    (sats: number) => formatSats(sats, settings.btcUnit),
    [settings.btcUnit],
  )

  return (
    <Ctx.Provider value={{ ...settings, update, formatSats: fmt }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDisplaySettings(): DisplaySettingsContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDisplaySettings must be used inside DisplaySettingsProvider')
  return ctx
}
