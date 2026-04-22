import { useState, useEffect } from 'react'
import { Zap, Shield, Smartphone, ChevronRight, X, Store } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  onClose(): void
}

const STEPS = [
  {
    icon: Store,
    iconBg: 'bg-brand-500/20 border-brand-500/30',
    iconColor: 'text-brand-400',
    title: 'Welcome to SokoPay',
    subtitle: 'Africa\'s marketplace with no bank account needed',
    body: 'Buy and sell anything across Africa. Pay with M-Pesa or Bitcoin Lightning — your identity is your Nostr key, not your ID.',
    visual: (
      <div className="flex gap-2 justify-center flex-wrap">
        {['🌽 Maize', '📱 Phones', '👗 Fashion', '🏠 Property', '🌿 Herbs', '🚗 Vehicles'].map(tag => (
          <span key={tag} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-300 font-medium">
            {tag}
          </span>
        ))}
      </div>
    ),
  },
  {
    icon: Smartphone,
    iconBg: 'bg-mpesa/20 border-mpesa/30',
    iconColor: 'text-mpesa',
    title: 'Pay your way',
    subtitle: 'M-Pesa or Bitcoin Lightning',
    body: 'Use M-Pesa STK Push for local mobile money payments. Or pay instantly worldwide with Bitcoin Lightning — settle in seconds, not days.',
    visual: (
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-mpesa/10 border border-mpesa/20 rounded-xl p-3 text-center">
          <p className="text-2xl mb-1">📱</p>
          <p className="text-xs font-bold text-mpesa">M-Pesa</p>
          <p className="text-[10px] text-gray-500 mt-0.5">STK Push</p>
        </div>
        <div className="bg-bitcoin/10 border border-bitcoin/20 rounded-xl p-3 text-center">
          <p className="text-2xl mb-1">⚡</p>
          <p className="text-xs font-bold text-bitcoin">Lightning</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Instant global</p>
        </div>
      </div>
    ),
  },
  {
    icon: Zap,
    iconBg: 'bg-bitcoin/20 border-bitcoin/30',
    iconColor: 'text-bitcoin',
    title: 'Your identity, your keys',
    subtitle: 'No passwords. No bank. No KYC.',
    body: 'Sign in with Fedi wallet for instant access. Or create a Nostr identity in seconds — one key unlocks your account everywhere.',
    visual: (
      <div className="space-y-2">
        {[
          { icon: '🔐', label: 'Fedi wallet', detail: 'Instant sign-in' },
          { icon: '🧩', label: 'Nostr extension', detail: 'Alby, nos2x, Flamingo' },
          { icon: '✨', label: 'New identity', detail: 'Generate in 5 seconds' },
        ].map(opt => (
          <div key={opt.label} className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5">
            <span className="text-lg">{opt.icon}</span>
            <div>
              <p className="text-xs font-semibold text-gray-200">{opt.label}</p>
              <p className="text-[10px] text-gray-500">{opt.detail}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Shield,
    iconBg: 'bg-green-900/30 border-green-700/30',
    iconColor: 'text-green-400',
    title: 'Buyer protection built in',
    subtitle: 'Escrow, disputes, and confirmed delivery',
    body: 'Funds are held safely until you confirm receipt. If something goes wrong, file a dispute — our admin team resolves it within 7 days.',
    visual: (
      <div className="space-y-2">
        {[
          { step: '1', label: 'Pay into escrow', color: 'bg-brand-500/10 border-brand-500/20 text-brand-400' },
          { step: '2', label: 'Seller ships your order', color: 'bg-bitcoin/10 border-bitcoin/20 text-bitcoin' },
          { step: '3', label: 'You confirm receipt', color: 'bg-mpesa/10 border-mpesa/20 text-mpesa' },
          { step: '4', label: 'Seller gets paid', color: 'bg-green-900/20 border-green-700/30 text-green-400' },
        ].map(s => (
          <div key={s.step} className={clsx('flex items-center gap-2.5 border rounded-lg px-3 py-2', s.color)}>
            <span className="w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 border-current">
              {s.step}
            </span>
            <p className="text-xs font-medium">{s.label}</p>
          </div>
        ))}
      </div>
    ),
  },
]

export default function OnboardingModal({ onClose }: Props) {
  const [step, setStep] = useState(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  function next() {
    if (isLast) {
      handleClose()
    } else {
      setStep(s => s + 1)
    }
  }

  function handleClose() {
    setExiting(true)
    setTimeout(onClose, 250)
  }

  return (
    <div className={clsx(
      'fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4',
      'transition-opacity duration-250',
      exiting ? 'opacity-0' : 'opacity-100',
    )}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to SokoPay"
        className={clsx(
        'relative bg-gray-900 border border-gray-800 shadow-2xl z-10 w-full',
        'sm:rounded-2xl sm:max-w-sm rounded-t-2xl',
        'transition-transform duration-300 ease-out',
        exiting ? 'translate-y-4 sm:translate-y-0 sm:scale-95' : 'translate-y-0 sm:scale-100',
      )}>

        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors z-10"
          aria-label="Skip"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-6 pb-4">

          {/* Step icon + heading */}
          <div className="flex items-center gap-3 mb-4">
            <div className={clsx(
              'w-10 h-10 rounded-xl border flex items-center justify-center shrink-0',
              current.iconBg,
            )}>
              <Icon className={clsx('w-5 h-5', current.iconColor)} />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{current.subtitle}</p>
              <h2 className="text-base font-bold text-gray-100 leading-tight">{current.title}</h2>
            </div>
          </div>

          {/* Body text */}
          <p className="text-sm text-gray-400 leading-relaxed mb-4">{current.body}</p>

          {/* Visual */}
          <div className="mb-5">{current.visual}</div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={clsx(
                  'rounded-full transition-all duration-300',
                  i === step
                    ? 'w-5 h-1.5 bg-brand-500'
                    : 'w-1.5 h-1.5 bg-gray-700 hover:bg-gray-600',
                )}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={next}
            className="btn-primary w-full justify-center"
          >
            {isLast ? 'Start exploring' : (
              <>Next <ChevronRight className="w-4 h-4" /></>
            )}
          </button>

          {/* Skip */}
          {!isLast && (
            <button
              onClick={handleClose}
              className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors mt-2 py-1"
            >
              Skip intro
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
