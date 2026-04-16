import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bitcoin, Globe, Moon, Languages, Check, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useDisplaySettings } from '../context/displaySettings.tsx'
import type { AppTheme, BtcUnit } from '../context/displaySettings.tsx'

// ── Currency list (same set as CurrencyConverter) ─────────────────────────────

const CURRENCIES = [
  { code: 'KES', name: 'Kenyan Shilling',      flag: '🇰🇪' },
  { code: 'USD', name: 'US Dollar',            flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro',                 flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound',        flag: '🇬🇧' },
  { code: 'NGN', name: 'Nigerian Naira',       flag: '🇳🇬' },
  { code: 'UGX', name: 'Ugandan Shilling',     flag: '🇺🇬' },
  { code: 'TZS', name: 'Tanzanian Shilling',   flag: '🇹🇿' },
  { code: 'ZAR', name: 'South African Rand',   flag: '🇿🇦' },
  { code: 'GHS', name: 'Ghanaian Cedi',        flag: '🇬🇭' },
  { code: 'ETB', name: 'Ethiopian Birr',       flag: '🇪🇹' },
  { code: 'RWF', name: 'Rwandan Franc',        flag: '🇷🇼' },
  { code: 'JPY', name: 'Japanese Yen',         flag: '🇯🇵' },
  { code: 'CNY', name: 'Chinese Yuan',         flag: '🇨🇳' },
  { code: 'INR', name: 'Indian Rupee',         flag: '🇮🇳' },
  { code: 'AED', name: 'UAE Dirham',           flag: '🇦🇪' },
  { code: 'CAD', name: 'Canadian Dollar',      flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar',    flag: '🇦🇺' },
] as const

const LANGUAGES = [
  { code: 'English', label: 'English',      flag: '🇬🇧' },
  { code: 'Swahili', label: 'Swahili (KE)', flag: '🇰🇪' },
  { code: 'French',  label: 'French',       flag: '🇫🇷' },
]

// ── Bottom sheet picker ───────────────────────────────────────────────────────

interface SheetProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

function BottomSheet({ title, onClose, children }: SheetProps) {
  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />
      <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center">
        <div className="w-full max-w-md bg-[#111116] rounded-t-3xl border-t border-gray-800 shadow-2xl pb-10">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-gray-700" />
          </div>
          <p className="text-sm font-semibold text-gray-100 text-center py-3 border-b border-gray-800">
            {title}
          </p>
          <div className="max-h-80 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Setting row ───────────────────────────────────────────────────────────────

interface RowProps {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  onClick: () => void
  last?: boolean
}

function SettingRow({ icon, label, value, onClick, last }: RowProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-4 px-4 py-4 text-left hover:bg-white/5 active:bg-white/10 transition-colors',
        !last && 'border-b border-gray-800/60',
      )}
    >
      <span className="text-gray-400 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-100">{label}</p>
        <p className="text-sm text-gray-500 mt-0.5">{value}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
    </button>
  )
}

// ── Option item (inside sheet) ────────────────────────────────────────────────

interface OptionProps {
  label: React.ReactNode
  selected: boolean
  onSelect: () => void
}

function OptionItem({ label, selected, onSelect }: OptionProps) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/5 transition-colors"
    >
      <span className={clsx(
        'text-sm',
        selected ? 'text-gray-100 font-medium' : 'text-gray-400',
      )}>
        {label}
      </span>
      {selected && <Check className="w-4 h-4 text-brand-400 shrink-0" />}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type ActiveSheet = 'btcUnit' | 'fiatCurrency' | 'theme' | 'language' | null

export default function DisplayOptions() {
  const navigate = useNavigate()
  const { btcUnit, fiatCurrency, theme, language, update } = useDisplaySettings()
  const [sheet, setSheet] = useState<ActiveSheet>(null)

  const fiatMeta = CURRENCIES.find(c => c.code === fiatCurrency) ?? CURRENCIES[0]

  const THEME_LABELS: Record<AppTheme, string> = {
    system: 'Follow system',
    dark:   'Dark',
    light:  'Light',
  }

  const langMeta = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0]

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-4 border-b border-gray-800/60">
        <button
          onClick={() => navigate(-1)}
          className="p-1 -ml-1 text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-gray-100">Display options</h1>
      </div>

      {/* Settings card */}
      <div className="p-4 max-w-lg">
        <div className="rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">

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
            onClick={() => setSheet('btcUnit')}
          />

          <SettingRow
            icon={<Globe className="w-5 h-5" />}
            label="Fiat currency"
            value={
              <span className="flex items-center gap-1.5">
                <span>{fiatMeta.flag}</span>
                <span>{fiatCurrency}</span>
              </span>
            }
            onClick={() => setSheet('fiatCurrency')}
          />

          <SettingRow
            icon={<Moon className="w-5 h-5" />}
            label="Application theme"
            value={THEME_LABELS[theme]}
            onClick={() => setSheet('theme')}
          />

          <SettingRow
            icon={<Languages className="w-5 h-5" />}
            label="Application language"
            value={
              <span className="flex items-center gap-1.5">
                <span>{langMeta.flag}</span>
                <span>{langMeta.label}</span>
              </span>
            }
            onClick={() => setSheet('language')}
            last
          />
        </div>
      </div>

      {/* ── Bitcoin unit sheet ─────────────────────────────────────────────── */}
      {sheet === 'btcUnit' && (
        <BottomSheet title="Bitcoin unit" onClose={() => setSheet(null)}>
          {([['sats', 'Satoshi', '₿ 1 BTC = 100,000,000 sats'], ['btc', 'Bitcoin (BTC)', '₿ 0.00000001 BTC = 1 sat']] as [BtcUnit, string, string][]).map(
            ([value, label, hint]) => (
              <button
                key={value}
                onClick={() => { update({ btcUnit: value }); setSheet(null) }}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/5 transition-colors border-b border-gray-800/40 last:border-0"
              >
                <div>
                  <p className={clsx(
                    'text-sm',
                    btcUnit === value ? 'text-gray-100 font-medium' : 'text-gray-400',
                  )}>
                    {label}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">{hint}</p>
                </div>
                {btcUnit === value && <Check className="w-4 h-4 text-brand-400 shrink-0" />}
              </button>
            ),
          )}
        </BottomSheet>
      )}

      {/* ── Fiat currency sheet ────────────────────────────────────────────── */}
      {sheet === 'fiatCurrency' && (
        <BottomSheet title="Fiat currency" onClose={() => setSheet(null)}>
          {CURRENCIES.map(cur => (
            <button
              key={cur.code}
              onClick={() => { update({ fiatCurrency: cur.code }); setSheet(null) }}
              className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/5 transition-colors border-b border-gray-800/40 last:border-0"
            >
              <span className="flex items-center gap-3">
                <span className="text-xl">{cur.flag}</span>
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
              {fiatCurrency === cur.code && <Check className="w-4 h-4 text-brand-400 shrink-0" />}
            </button>
          ))}
        </BottomSheet>
      )}

      {/* ── Theme sheet ────────────────────────────────────────────────────── */}
      {sheet === 'theme' && (
        <BottomSheet title="Application theme" onClose={() => setSheet(null)}>
          {(['system', 'dark', 'light'] as AppTheme[]).map(t => (
            <OptionItem
              key={t}
              label={THEME_LABELS[t]}
              selected={theme === t}
              onSelect={() => { update({ theme: t }); setSheet(null) }}
            />
          ))}
        </BottomSheet>
      )}

      {/* ── Language sheet ─────────────────────────────────────────────────── */}
      {sheet === 'language' && (
        <BottomSheet title="Application language" onClose={() => setSheet(null)}>
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { update({ language: lang.code }); setSheet(null) }}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/5 transition-colors border-b border-gray-800/40 last:border-0"
            >
              <span className="flex items-center gap-3">
                <span className="text-xl">{lang.flag}</span>
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
          <p className="text-xs text-gray-600 text-center py-3 px-5">
            Full translations coming soon. Currently display only.
          </p>
        </BottomSheet>
      )}
    </div>
  )
}
