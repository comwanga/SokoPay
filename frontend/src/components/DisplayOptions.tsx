import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bitcoin, Globe, Moon, Languages, Check, ChevronDown, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { useDisplaySettings } from '../context/displaySettings.tsx'
import type { AppTheme, BtcUnit } from '../context/displaySettings.tsx'
import { WORLD_CURRENCIES, getCurrencyMeta } from '../data/currencies.ts'

const LANGUAGES = [
  { code: 'English', label: 'English',      flag: '🇬🇧' },
  { code: 'Swahili', label: 'Swahili (KE)', flag: '🇰🇪' },
  { code: 'French',  label: 'French',       flag: '🇫🇷' },
]

const THEME_LABELS: Record<AppTheme, string> = {
  system: 'Follow system',
  dark:   'Dark',
  light:  'Light',
}

type ExpandedRow = 'btcUnit' | 'fiatCurrency' | 'theme' | 'language' | null

// ── Accordion row ─────────────────────────────────────────────────────────────

interface RowProps {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  expanded: boolean
  onToggle: () => void
  last?: boolean
  children: React.ReactNode
}

function SettingRow({ icon, label, value, expanded, onToggle, last, children }: RowProps) {
  return (
    <div className={clsx(!last && 'border-b border-gray-800/60')}>
      {/* Header button */}
      <button
        onClick={onToggle}
        className={clsx(
          'w-full flex items-center gap-4 px-4 py-4 text-left transition-colors',
          expanded ? 'bg-gray-800/60' : 'hover:bg-white/[0.03] active:bg-white/[0.06]',
        )}
      >
        <span className={clsx('shrink-0 transition-colors', expanded ? 'text-brand-400' : 'text-gray-400')}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className={clsx('text-sm font-semibold transition-colors', expanded ? 'text-brand-300' : 'text-gray-100')}>
            {label}
          </p>
          {!expanded && (
            <p className="text-sm text-gray-500 mt-0.5">{value}</p>
          )}
        </div>
        <ChevronDown className={clsx(
          'w-4 h-4 shrink-0 transition-transform duration-200',
          expanded ? 'rotate-180 text-brand-400' : 'text-gray-600',
        )} />
      </button>

      {/* Inline options panel */}
      {expanded && (
        <div className="border-t border-gray-800/60 bg-gray-950/60">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Option items ──────────────────────────────────────────────────────────────

interface SimpleOptionProps {
  label: React.ReactNode
  hint?: string
  selected: boolean
  onSelect: () => void
}

function OptionItem({ label, hint, selected, onSelect }: SimpleOptionProps) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full flex items-center justify-between px-5 py-3 text-left transition-colors',
        'border-b border-gray-800/40 last:border-0',
        selected ? 'bg-brand-500/10' : 'hover:bg-white/[0.03]',
      )}
    >
      <div>
        <p className={clsx('text-sm', selected ? 'text-gray-100 font-medium' : 'text-gray-400')}>
          {label}
        </p>
        {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
      </div>
      {selected && <Check className="w-4 h-4 text-brand-400 shrink-0 ml-3" />}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DisplayOptions() {
  const navigate = useNavigate()
  const { btcUnit, fiatCurrency, theme, language, update } = useDisplaySettings()
  const [expanded, setExpanded]         = useState<ExpandedRow>(null)
  const [currencySearch, setCurrencySearch] = useState('')

  function toggle(row: ExpandedRow) {
    setExpanded(prev => {
      if (prev === row) return null
      if (row !== 'fiatCurrency') setCurrencySearch('')
      return row
    })
  }

  const fiatMeta = getCurrencyMeta(fiatCurrency) ?? WORLD_CURRENCIES[0]
  const langMeta = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0]

  const filteredCurrencies = currencySearch.trim()
    ? WORLD_CURRENCIES.filter(c =>
        c.name.toLowerCase().includes(currencySearch.toLowerCase()) ||
        c.code.toLowerCase().includes(currencySearch.toLowerCase()),
      )
    : WORLD_CURRENCIES

  return (
    <div className="p-4 sm:p-6 max-w-xl space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3 -ml-1">
        <button
          onClick={() => navigate(-1)}
          className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-gray-100">Display options</h1>
      </div>

      {/* Settings card */}
      <div className="rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">

        {/* ── Bitcoin unit ─────────────────────────────────────────────────── */}
        <SettingRow
          icon={<Bitcoin className="w-5 h-5" />}
          label="Bitcoin unit"
          value={
            <span className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#f7931a] shrink-0">
                <Bitcoin className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              </span>
              {btcUnit === 'sats' ? 'Satoshi' : 'Bitcoin (BTC)'}
            </span>
          }
          expanded={expanded === 'btcUnit'}
          onToggle={() => toggle('btcUnit')}
        >
          {([
            ['sats', 'Satoshi',      '1 BTC = 100,000,000 sats'],
            ['btc',  'Bitcoin (BTC)', '0.00000001 BTC = 1 sat'],
          ] as [BtcUnit, string, string][]).map(([val, lbl, hint]) => (
            <OptionItem
              key={val}
              label={lbl}
              hint={hint}
              selected={btcUnit === val}
              onSelect={() => { update({ btcUnit: val }); setExpanded(null) }}
            />
          ))}
        </SettingRow>

        {/* ── Fiat currency ─────────────────────────────────────────────────── */}
        <SettingRow
          icon={<Globe className="w-5 h-5" />}
          label="Fiat currency"
          value={
            <span className="flex items-center gap-1.5">
              <span>{fiatMeta.flag}</span>
              <span>{fiatCurrency} — {fiatMeta.name}</span>
            </span>
          }
          expanded={expanded === 'fiatCurrency'}
          onToggle={() => toggle('fiatCurrency')}
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800/60 bg-gray-900">
            <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Search currency or country…"
              value={currencySearch}
              onChange={e => setCurrencySearch(e.target.value)}
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
            />
            {currencySearch && (
              <button onClick={() => setCurrencySearch('')} className="text-gray-600 hover:text-gray-400">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredCurrencies.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-5">No currencies match</p>
            ) : (
              filteredCurrencies.map(cur => (
                <button
                  key={cur.code}
                  onClick={() => { update({ fiatCurrency: cur.code }); setExpanded(null); setCurrencySearch('') }}
                  className={clsx(
                    'w-full flex items-center justify-between px-5 py-3 text-left transition-colors',
                    'border-b border-gray-800/40 last:border-0',
                    fiatCurrency === cur.code ? 'bg-brand-500/10' : 'hover:bg-white/[0.03]',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="text-lg">{cur.flag}</span>
                    <span>
                      <span className={clsx(
                        'text-sm block',
                        fiatCurrency === cur.code ? 'text-gray-100 font-medium' : 'text-gray-300',
                      )}>
                        {cur.name}
                      </span>
                      <span className="text-xs text-gray-500">{cur.code}</span>
                    </span>
                  </span>
                  {fiatCurrency === cur.code && <Check className="w-4 h-4 text-brand-400 shrink-0 ml-2" />}
                </button>
              ))
            )}
          </div>
        </SettingRow>

        {/* ── Application theme ─────────────────────────────────────────────── */}
        <SettingRow
          icon={<Moon className="w-5 h-5" />}
          label="Application theme"
          value={THEME_LABELS[theme]}
          expanded={expanded === 'theme'}
          onToggle={() => toggle('theme')}
        >
          {(['system', 'dark', 'light'] as AppTheme[]).map(t => (
            <OptionItem
              key={t}
              label={THEME_LABELS[t]}
              selected={theme === t}
              onSelect={() => { update({ theme: t }); setExpanded(null) }}
            />
          ))}
        </SettingRow>

        {/* ── Application language ──────────────────────────────────────────── */}
        <SettingRow
          icon={<Languages className="w-5 h-5" />}
          label="Application language"
          value={
            <span className="flex items-center gap-1.5">
              <span>{langMeta.flag}</span>
              <span>{langMeta.label}</span>
            </span>
          }
          expanded={expanded === 'language'}
          onToggle={() => toggle('language')}
          last
        >
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { update({ language: lang.code }); setExpanded(null) }}
              className={clsx(
                'w-full flex items-center justify-between px-5 py-3 text-left transition-colors',
                'border-b border-gray-800/40 last:border-0',
                language === lang.code ? 'bg-brand-500/10' : 'hover:bg-white/[0.03]',
              )}
            >
              <span className="flex items-center gap-3">
                <span className="text-lg">{lang.flag}</span>
                <span className={clsx(
                  'text-sm',
                  language === lang.code ? 'text-gray-100 font-medium' : 'text-gray-400',
                )}>
                  {lang.label}
                </span>
              </span>
              {language === lang.code && <Check className="w-4 h-4 text-brand-400 shrink-0" />}
            </button>
          ))}
          <p className="text-xs text-gray-600 text-center py-2.5 px-5 border-t border-gray-800/40">
            Full translations coming soon
          </p>
        </SettingRow>

      </div>
    </div>
  )
}
