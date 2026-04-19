import { useNavigate } from 'react-router-dom'
import { Store, Zap, Smartphone, ChevronUp } from 'lucide-react'
import { useDisplaySettings } from '../context/displaySettings.tsx'
import { useTranslation } from '../i18n/index.tsx'
import type { SupportedLanguage } from '../i18n/translations.ts'

// ── Back to top ────────────────────────────────────────────────────────────────

function BackToTop() {
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="w-full py-3 bg-gray-800 border-b border-gray-700 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
    >
      <ChevronUp className="w-3.5 h-3.5" />
      Back to top
    </button>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

export default function Footer() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { language, update } = useDisplaySettings()

  const col = (title: string, links: { label: string; path: string }[]) => (
    <div key={title}>
      <h3 className="text-xs font-bold text-gray-300 mb-3">{title}</h3>
      <ul className="space-y-2">
        {links.map(({ label, path }) => (
          <li key={label}>
            <button
              onClick={() => navigate(path)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-left"
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  const LANGUAGES: SupportedLanguage[] = ['English', 'Swahili', 'French']

  return (
    <footer className="hidden md:block bg-gray-900 border-t border-gray-800 mt-auto">
      <BackToTop />

      {/* Link columns */}
      <div className="max-w-screen-xl mx-auto px-6 py-10 grid grid-cols-2 sm:grid-cols-4 gap-8">
        {col('Get to Know Us', [
          { label: 'About SokoPay', path: '/' },
          { label: 'Price Index', path: '/price-index' },
          { label: 'Blog & Updates', path: '/' },
        ])}
        {col('Make Money With Us', [
          { label: 'Sell on SokoPay', path: '/sell' },
          { label: 'New Listing', path: '/sell/new' },
          { label: 'Referral Programme', path: '/profile' },
        ])}
        {col('Payment Methods', [
          { label: '⚡ Lightning Network', path: '/' },
          { label: '📱 M-Pesa (Daraja)', path: '/' },
          { label: '🔒 Escrow Protection', path: '/browse' },
        ])}
        {col('Let Us Help You', [
          { label: t('nav.orders'), path: '/orders' },
          { label: t('nav.profile'), path: '/profile' },
          { label: t('nav.settings'), path: '/settings' },
          { label: 'Disputes & Support', path: '/orders' },
        ])}
      </div>

      <div className="h-px bg-gray-800" />

      {/* Bottom bar */}
      <div className="max-w-screen-xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
            <Store className="w-4 h-4 text-brand-400" />
          </div>
          <span className="text-sm font-bold text-gray-300">SokoPay</span>
        </div>

        {/* Language selector */}
        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={e => update({ language: e.target.value as SupportedLanguage })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-brand-500 cursor-pointer"
          >
            {LANGUAGES.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400">
            <Zap className="w-3 h-3 text-bitcoin" />
            <span>Lightning</span>
            <span className="text-gray-600">+</span>
            <Smartphone className="w-3 h-3 text-mpesa" />
            <span>M-Pesa</span>
          </div>
        </div>

        {/* Copyright */}
        <p className="text-[11px] text-gray-600">
          © {new Date().getFullYear()} SokoPay. Built on Bitcoin & M-Pesa.
        </p>
      </div>
    </footer>
  )
}
