import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToast, type Toast, type ToastKind } from '../context/toast.tsx'
import clsx from 'clsx'

const ICONS: Record<ToastKind, React.ElementType> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const STYLES: Record<ToastKind, string> = {
  success: 'border-green-700/40 bg-green-900/20 text-green-300',
  error:   'border-red-700/40 bg-red-900/20 text-red-300',
  warning: 'border-yellow-700/40 bg-yellow-900/20 text-yellow-300',
  info:    'border-brand-700/40 bg-brand-900/20 text-brand-300',
}

const ICON_STYLES: Record<ToastKind, string> = {
  success: 'text-green-400',
  error:   'text-red-400',
  warning: 'text-yellow-400',
  info:    'text-brand-400',
}

function ToastItem({ toast }: { toast: Toast }) {
  const { dismiss } = useToast()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const Icon = ICONS[toast.kind]

  return (
    <div
      role="alert"
      aria-live="polite"
      className={clsx(
        'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm',
        'transition-all duration-300 ease-out w-full max-w-sm',
        STYLES[toast.kind],
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      )}
    >
      <Icon className={clsx('w-4 h-4 shrink-0 mt-0.5', ICON_STYLES[toast.kind])} />
      <p className="text-sm font-medium leading-snug flex-1 text-gray-100">{toast.message}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className="text-gray-500 hover:text-gray-300 transition-colors shrink-0 -mt-0.5 -mr-1 p-1"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const { toasts } = useToast()

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-20 right-4 z-[100] flex flex-col gap-2 items-end sm:bottom-6"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
