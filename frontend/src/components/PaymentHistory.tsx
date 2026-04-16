import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Zap, Smartphone, Store, HelpCircle,
  ChevronLeft, ChevronRight, Download, ArrowUpRight, ArrowDownLeft,
  Clock, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { listPaymentHistory } from '../api/client.ts'
import { useDisplaySettings } from '../context/displaySettings.tsx'
import type { PaymentHistoryItem, PaymentMethod, PaymentRole } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatKes(v: string | number) {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return 'KES —'
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatSatsLocal(v: number | null, fmt: (n: number) => string) {
  if (v == null) return null
  return fmt(v)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Method badge ──────────────────────────────────────────────────────────────

const METHOD_LABEL: Record<PaymentMethod, string> = {
  lightning: 'Lightning',
  mpesa:     'M-Pesa',
  pos:       'In-Person',
  unknown:   'Unknown',
}

function MethodBadge({ method }: { method: PaymentMethod }) {
  const icons: Record<PaymentMethod, React.ReactNode> = {
    lightning: <Zap className="w-3 h-3" />,
    mpesa:     <Smartphone className="w-3 h-3" />,
    pos:       <Store className="w-3 h-3" />,
    unknown:   <HelpCircle className="w-3 h-3" />,
  }
  const styles: Record<PaymentMethod, string> = {
    lightning: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30',
    mpesa:     'bg-green-900/30 text-green-400 border-green-700/30',
    pos:       'bg-blue-900/30 text-blue-400 border-blue-700/30',
    unknown:   'bg-gray-800 text-gray-500 border-gray-700',
  }
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border',
      styles[method],
    )}>
      {icons[method]}
      {METHOD_LABEL[method]}
    </span>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, orderStatus }: { status: string | null, orderStatus: string }) {
  const resolved = status ?? orderStatus
  const cfg = (() => {
    switch (resolved) {
      case 'settled':
      case 'paid':
      case 'confirmed':
        return { icon: <CheckCircle2 className="w-3 h-3" />, label: 'Completed', cls: 'bg-green-900/30 text-green-400' }
      case 'pending':
      case 'pending_payment':
      case 'processing':
      case 'in_transit':
      case 'delivered':
        return { icon: <Clock className="w-3 h-3" />, label: 'Pending', cls: 'bg-gray-700 text-gray-400' }
      case 'failed':
      case 'cancelled':
        return { icon: <XCircle className="w-3 h-3" />, label: 'Failed', cls: 'bg-red-900/30 text-red-400' }
      case 'expired':
        return { icon: <AlertCircle className="w-3 h-3" />, label: 'Expired', cls: 'bg-orange-900/30 text-orange-400' }
      case 'disputed':
        return { icon: <AlertCircle className="w-3 h-3" />, label: 'Disputed', cls: 'bg-yellow-900/30 text-yellow-400' }
      default:
        return { icon: null, label: resolved, cls: 'bg-gray-800 text-gray-400' }
    }
  })()

  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded',
      cfg.cls,
    )}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(items: PaymentHistoryItem[], role: PaymentRole) {
  const headers = [
    'Date', 'Product', role === 'buyer' ? 'Seller' : 'Buyer',
    'Quantity', 'KES', 'Sats', 'Method', 'Payment Status', 'Order Status', 'Ref',
  ]
  const rows = items.map(r => [
    formatDate(r.order_created_at),
    `"${r.product_title}"`,
    `"${r.counterparty_name}"`,
    `${r.quantity} ${r.unit}`,
    r.total_kes,
    r.total_sats ?? '',
    r.payment_method,
    r.payment_status ?? '',
    r.order_status,
    r.payment_ref ?? '',
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `sokopay-payments-${role}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Filter types ──────────────────────────────────────────────────────────────

type MethodFilter = 'all' | PaymentMethod
type StatusFilter = 'all' | 'completed' | 'pending' | 'failed'

function matchesMethod(item: PaymentHistoryItem, f: MethodFilter): boolean {
  return f === 'all' || item.payment_method === f
}

function matchesStatus(item: PaymentHistoryItem, f: StatusFilter): boolean {
  if (f === 'all') return true
  const s = item.payment_status ?? item.order_status
  if (f === 'completed') return ['settled', 'paid', 'confirmed'].includes(s)
  if (f === 'pending')   return ['pending', 'pending_payment', 'processing', 'in_transit', 'delivered'].includes(s)
  if (f === 'failed')    return ['failed', 'cancelled', 'expired'].includes(s)
  return true
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TxRow({ item }: { item: PaymentHistoryItem }) {
  const [expanded, setExpanded] = useState(false)
  const { formatSats } = useDisplaySettings()
  const isSent = item.role === 'buyer'

  return (
    <div
      className="border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/30 transition-colors"
      onClick={() => setExpanded(v => !v)}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Direction icon */}
        <div className={clsx(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isSent ? 'bg-red-900/30' : 'bg-green-900/30',
        )}>
          {isSent
            ? <ArrowUpRight className="w-4 h-4 text-red-400" />
            : <ArrowDownLeft className="w-4 h-4 text-green-400" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-gray-100 truncate">{item.product_title}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">{item.counterparty_name}</span>
            <span className="text-gray-700">·</span>
            <span className="text-xs text-gray-500">{formatDate(item.order_created_at)}</span>
          </div>
        </div>

        {/* Amount + badges */}
        <div className="text-right shrink-0 space-y-1">
          <p className={clsx(
            'text-sm font-semibold',
            isSent ? 'text-red-400' : 'text-green-400',
          )}>
            {isSent ? '−' : '+'}{formatKes(item.total_kes)}
          </p>
          <div className="flex items-center gap-1 justify-end">
            <MethodBadge method={item.payment_method} />
            <StatusBadge status={item.payment_status} orderStatus={item.order_status} />
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-2 text-xs text-gray-400 bg-gray-900/40">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 border-t border-gray-800/60">
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Order ID</p>
              <p className="font-mono text-gray-300">{item.order_id.slice(0, 8).toUpperCase()}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Quantity</p>
              <p className="text-gray-300">{item.quantity} {item.unit}</p>
            </div>
            {item.total_sats != null && (
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Bitcoin</p>
                <p className="text-gray-300">{formatSatsLocal(item.total_sats, formatSats)}</p>
              </div>
            )}
            {item.payment_ref && (
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Reference</p>
                <p className="font-mono text-gray-300">{item.payment_ref}</p>
              </div>
            )}
            {item.payment_settled_at && (
              <div className="col-span-2">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Settled at</p>
                <p className="text-gray-300">{formatDateTime(item.payment_settled_at)}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Order status</p>
              <p className="text-gray-300 capitalize">{item.order_status.replace(/_/g, ' ')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaymentHistory() {
  const [role, setRole]           = useState<PaymentRole>('buyer')
  const [page, setPage]           = useState(0)
  const [methodFilter, setMethod] = useState<MethodFilter>('all')
  const [statusFilter, setStatus] = useState<StatusFilter>('all')

  // Reset to page 0 when role changes
  function switchRole(r: PaymentRole) {
    setRole(r)
    setPage(0)
    setMethod('all')
    setStatus('all')
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payment-history', role, page],
    queryFn: () => listPaymentHistory(role, page),
    staleTime: 30_000,
  })

  const filtered = (data?.items ?? []).filter(
    item => matchesMethod(item, methodFilter) && matchesStatus(item, statusFilter),
  )

  const totalPages = data ? Math.ceil(data.total_count / data.page_size) : 0

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Payment History</h1>
          <p className="text-sm text-gray-500 mt-0.5">All your transactions on SokoPay</p>
        </div>
        {data && data.items.length > 0 && (
          <button
            onClick={() => exportCsv(data.items, role)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        )}
      </div>

      {/* Role tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-xl w-fit">
        <button
          onClick={() => switchRole('buyer')}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
            role === 'buyer' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          Sent
        </button>
        <button
          onClick={() => switchRole('seller')}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
            role === 'seller' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          <ArrowDownLeft className="w-3.5 h-3.5" />
          Received
        </button>
      </div>

      {/* Stats strip */}
      {data && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4 space-y-1">
            <p className="text-xs font-medium text-gray-500">
              {role === 'buyer' ? 'Total Spent' : 'Total Earned'}
            </p>
            <p className="text-lg font-bold text-gray-100">
              {formatKes(data.all_time_kes)}
            </p>
          </div>
          <div className="card p-4 space-y-1">
            <p className="text-xs font-medium text-gray-500">Total Orders</p>
            <p className="text-lg font-bold text-gray-100">{data.all_time_count}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Method filter */}
        <div className="flex gap-1 bg-gray-800/60 p-0.5 rounded-lg text-xs font-medium">
          {(['all', 'lightning', 'mpesa', 'pos'] as MethodFilter[]).map(m => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={clsx(
                'px-2.5 py-1 rounded-md transition-colors capitalize',
                methodFilter === m
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {m === 'all' ? 'All Methods' : m === 'pos' ? 'In-Person' : m === 'lightning' ? '⚡ Lightning' : '📱 M-Pesa'}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 bg-gray-800/60 p-0.5 rounded-lg text-xs font-medium">
          {(['all', 'completed', 'pending', 'failed'] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                'px-2.5 py-1 rounded-md transition-colors capitalize',
                statusFilter === s
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {s === 'all' ? 'All Status' : s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        {isLoading && (
          <div className="divide-y divide-gray-800/60">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="skeleton w-8 h-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-3 w-40 rounded" />
                  <div className="skeleton h-2.5 w-24 rounded" />
                </div>
                <div className="space-y-1.5 text-right">
                  <div className="skeleton h-3 w-20 rounded ml-auto" />
                  <div className="skeleton h-4 w-28 rounded ml-auto" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-3 px-4 py-8 text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">Failed to load payment history. Please refresh.</p>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-16 space-y-2">
            {role === 'buyer'
              ? <ArrowUpRight className="w-10 h-10 text-gray-700 mx-auto" />
              : <ArrowDownLeft className="w-10 h-10 text-gray-700 mx-auto" />}
            <p className="text-gray-400 font-medium">
              {data?.total_count === 0
                ? `No ${role === 'buyer' ? 'payments sent' : 'payments received'} yet`
                : 'No transactions match your filters'}
            </p>
            {data?.total_count === 0 && role === 'buyer' && (
              <p className="text-sm text-gray-600">
                Browse the marketplace to make your first purchase.
              </p>
            )}
          </div>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div>
            {filtered.map(item => (
              <TxRow key={item.order_id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page === 0}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-xs text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
