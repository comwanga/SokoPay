import { Zap, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import clsx from 'clsx'
import type { PaymentStatus } from '../types'

interface StatusBadgeProps {
  status: PaymentStatus
  size?: 'sm' | 'md'
}

const STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  pending: {
    label: 'Pending',
    icon: <Clock className="w-3 h-3" />,
    className: 'bg-gray-700/60 text-gray-300 border-gray-600',
  },
  lightning_received: {
    label: 'Lightning Received',
    icon: <Zap className="w-3 h-3" />,
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  disbursing: {
    label: 'Disbursing',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
    className: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  },
  completed: {
    label: 'Completed',
    icon: <CheckCircle2 className="w-3 h-3" />,
    className: 'bg-mpesa/20 text-green-300 border-green-500/40',
  },
  failed: {
    label: 'Failed',
    icon: <XCircle className="w-3 h-3" />,
    className: 'bg-red-500/20 text-red-300 border-red-500/40',
  },
}

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded-full border',
        config.className,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
      )}
    >
      {config.icon}
      {config.label}
    </span>
  )
}
