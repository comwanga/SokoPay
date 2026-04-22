import { useEffect, useState } from 'react'
import { CheckCircle, Loader2, XCircle, Zap, Smartphone } from 'lucide-react'
import clsx from 'clsx'

export type PaymentMethod = 'lightning' | 'mpesa'
export type PaymentStatus = 'waiting' | 'processing' | 'confirmed' | 'failed'

interface Props {
  method: PaymentMethod
  status: PaymentStatus
  amountKes?: number
  amountSats?: number
  onDone?(): void
  onRetry?(): void
}

const METHOD_META = {
  lightning: { icon: Zap, label: 'Lightning', color: 'text-bitcoin', bg: 'bg-bitcoin/10 border-bitcoin/20' },
  mpesa:     { icon: Smartphone, label: 'M-Pesa', color: 'text-mpesa', bg: 'bg-mpesa/10 border-mpesa/20' },
}

const STEPS: Record<PaymentMethod, { label: string; waiting: string }[]> = {
  lightning: [
    { label: 'Invoice created', waiting: 'Generating invoice…' },
    { label: 'Awaiting payment', waiting: 'Waiting for wallet confirmation…' },
    { label: 'Payment confirmed', waiting: 'Verifying on network…' },
  ],
  mpesa: [
    { label: 'STK Push sent', waiting: 'Sending prompt to your phone…' },
    { label: 'Awaiting approval', waiting: 'Check your phone and enter M-Pesa PIN…' },
    { label: 'Payment confirmed', waiting: 'Verifying with Safaricom…' },
  ],
}

const STATUS_STEP: Record<PaymentStatus, number> = {
  waiting: 1,
  processing: 2,
  confirmed: 3,
  failed: -1,
}

export default function PaymentProgress({
  method, status, amountKes, amountSats, onDone, onRetry,
}: Props) {
  const [visible, setVisible] = useState(false)
  const meta = METHOD_META[method]
  const Icon = meta.icon
  const steps = STEPS[method]
  const currentStep = STATUS_STEP[status]

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (status === 'confirmed' && onDone) {
      const t = setTimeout(onDone, 2000)
      return () => clearTimeout(t)
    }
  }, [status, onDone])

  return (
    <div className={clsx(
      'fixed inset-0 z-[70] flex items-center justify-center p-4',
      'bg-black/85 backdrop-blur-md',
      'transition-opacity duration-300',
      visible ? 'opacity-100' : 'opacity-0',
    )}>
      <div className={clsx(
        'bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-5',
        'transition-transform duration-300 ease-out',
        visible ? 'scale-100' : 'scale-95',
      )}>

        {/* Method badge */}
        <div className="flex justify-center">
          <div className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold', meta.bg, meta.color)}>
            <Icon className="w-3.5 h-3.5" />
            {meta.label} Payment
          </div>
        </div>

        {/* Status icon */}
        <div className="flex flex-col items-center gap-2">
          {status === 'confirmed' ? (
            <div className="w-16 h-16 rounded-full bg-green-900/30 border border-green-700/30 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
          ) : status === 'failed' ? (
            <div className="w-16 h-16 rounded-full bg-red-900/30 border border-red-700/30 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
            </div>
          )}

          <p className="text-base font-bold text-gray-100">
            {status === 'confirmed' ? 'Payment confirmed!' : status === 'failed' ? 'Payment failed' : 'Processing payment…'}
          </p>

          {(amountKes || amountSats) && (
            <div className="text-center">
              {amountKes && (
                <p className="text-2xl font-bold text-gray-100">
                  KES {amountKes.toLocaleString()}
                </p>
              )}
              {amountSats && (
                <p className="text-sm text-bitcoin font-medium">
                  ⚡ {amountSats.toLocaleString()} sats
                </p>
              )}
            </div>
          )}
        </div>

        {/* Step indicators */}
        {status !== 'failed' && (
          <div className="space-y-2">
            {steps.map((s, i) => {
              const stepNum = i + 1
              const done = currentStep > stepNum
              const active = currentStep === stepNum
              return (
                <div key={i} className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                  done ? 'bg-green-900/10 border border-green-800/30' :
                  active ? 'bg-brand-500/10 border border-brand-500/20' :
                           'bg-gray-800/50 border border-transparent',
                )}>
                  <div className={clsx(
                    'w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold border',
                    done ? 'bg-green-900/30 border-green-700/40 text-green-400' :
                    active ? 'bg-brand-500/20 border-brand-500/30 text-brand-400' :
                             'bg-gray-800 border-gray-700 text-gray-600',
                  )}>
                    {done ? '✓' : stepNum}
                  </div>
                  <p className={clsx(
                    'text-xs font-medium',
                    done ? 'text-green-400' : active ? 'text-brand-300' : 'text-gray-600',
                  )}>
                    {active ? s.waiting : s.label}
                  </p>
                  {active && <Loader2 className="w-3 h-3 text-brand-400 animate-spin ml-auto shrink-0" />}
                  {done && <span className="text-green-400 text-[10px] ml-auto shrink-0">✓</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* Error state actions */}
        {status === 'failed' && (
          <div className="space-y-2">
            <p className="text-xs text-red-400 text-center">
              The payment did not go through. Your order has not been placed.
            </p>
            {onRetry && (
              <button onClick={onRetry} className="btn-primary w-full justify-center">
                Try again
              </button>
            )}
          </div>
        )}

        {/* Success note */}
        {status === 'confirmed' && (
          <p className="text-xs text-green-400 text-center">
            Your order is confirmed. Redirecting…
          </p>
        )}
      </div>
    </div>
  )
}
