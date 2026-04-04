import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  Zap,
  Plus,
  X,
  Copy,
  CheckCircle2,
  AlertCircle,
  Eye,
  Filter,
  ExternalLink,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getPayments } from '../api/client.ts'
import StatusBadge from './StatusBadge.tsx'
import NewPaymentModal from './NewPaymentModal.tsx'
import type { PaymentWithFarmer, PaymentStatus } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(n: number) {
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 })
}

function fmtSats(n: number) {
  return n.toLocaleString('en-US')
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number
  type: 'success' | 'error'
  message: string
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium pointer-events-auto ${
            t.type === 'success'
              ? 'bg-gray-900 border-green-600/40 text-green-300'
              : 'bg-gray-900 border-red-600/40 text-red-300'
          }`}
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{t.message}</span>
          <button
            onClick={() => onRemove(t.id)}
            className="ml-2 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Filter Tab ───────────────────────────────────────────────────────────────

type FilterValue = 'all' | PaymentStatus

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: 'All', value: 'all' },
  { label: 'Created', value: 'created' },
  { label: 'Invoice Created', value: 'invoice_created' },
  { label: 'Bitcoin Received', value: 'bitcoin_received' },
  { label: 'Credited', value: 'credited_to_farmer' },
  { label: 'Failed', value: 'failed' },
]

// ─── BTCPay Invoice Modal ─────────────────────────────────────────────────────

interface InvoiceModalProps {
  payment: PaymentWithFarmer
  onClose: () => void
}

function InvoiceModal({ payment, onClose }: InvoiceModalProps) {
  const [copied, setCopied] = useState(false)
  const payUrl = payment.btcpay_payment_url

  function copyUrl() {
    if (!payUrl) return
    navigator.clipboard.writeText(payUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">BTCPay Invoice</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {payment.farmer_name} · {fmtKes(parseFloat(payment.amount_kes))} KES
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Payment details */}
          <div className="bg-gray-800/60 rounded-xl border border-gray-700 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Farmer</span>
              <span className="text-gray-200 font-medium">{payment.farmer_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount (KES)</span>
              <span className="text-gray-200">KES {fmtKes(parseFloat(payment.amount_kes))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount (sats)</span>
              <span className="text-amber-400 font-mono font-semibold">
                {fmtSats(payment.amount_sats)} sats
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Status</span>
              <StatusBadge status={payment.status} />
            </div>
            {payment.crop_type && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Crop</span>
                <span className="text-gray-300">{payment.crop_type}</span>
              </div>
            )}
          </div>

          {/* QR Code */}
          {payUrl ? (
            <>
              <div className="flex flex-col items-center">
                <p className="text-xs text-gray-500 mb-3">Scan to pay via Bitcoin</p>
                <div className="bg-white p-4 rounded-xl shadow-lg">
                  <QRCodeSVG
                    value={payUrl}
                    size={240}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <p className="text-[11px] text-gray-600 mt-2 text-center">
                  Compatible with any Bitcoin wallet
                </p>
              </div>

              {/* Payment URL */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Payment Link
                  </span>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={payUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </a>
                    <button
                      onClick={copyUrl}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                        copied
                          ? 'bg-mpesa/20 text-mpesa border border-green-600/30'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'
                      }`}
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 font-mono break-all leading-relaxed">
                  {payUrl}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-500">
              <AlertCircle className="w-4 h-4 shrink-0" />
              No payment URL available for this invoice.
            </div>
          )}

          <button onClick={onClose} className="btn-secondary w-full justify-center">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Payments Page ────────────────────────────────────────────────────────────

export default function Payments() {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [showNewPayment, setShowNewPayment] = useState(false)
  const [invoicePayment, setInvoicePayment] = useState<PaymentWithFarmer | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toastIdRef = useRef(0)
  const qc = useQueryClient()

  const { data: payments = [], isLoading } = useQuery<PaymentWithFarmer[]>({
    queryKey: ['payments'],
    queryFn: () => getPayments(),
    refetchInterval: 15_000,
  })

  function addToast(type: Toast['type'], message: string) {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000)
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  // Close modals on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInvoicePayment(null)
        setShowNewPayment(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Refresh payments list when new payment modal closes successfully
  function handleNewPaymentSuccess() {
    qc.invalidateQueries({ queryKey: ['payments'] })
    addToast('success', 'Payment created successfully!')
  }

  const filtered = filter === 'all' ? payments : payments.filter((p) => p.status === filter)

  const counts = payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    acc['all'] = (acc['all'] ?? 0) + 1
    return acc
  }, { all: 0 })

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-100">Payments</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isLoading ? '…' : `${payments.length} total payment${payments.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={() => setShowNewPayment(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            New Payment
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 mb-5 overflow-x-auto scrollbar-none pb-1">
          <Filter className="w-4 h-4 text-gray-600 shrink-0 mr-1" />
          {FILTERS.map((f) => {
            const count = counts[f.value] ?? 0
            const active = filter === f.value
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                      active ? 'bg-brand-500/30 text-brand-300' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Payments Table */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-14 rounded" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Zap className="w-10 h-10 text-gray-700 mb-3" />
              {filter === 'all' ? (
                <>
                  <p className="text-sm font-medium text-gray-400">No payments yet</p>
                  <p className="text-xs text-gray-600 mt-1 mb-4">
                    Create a payment to generate a BTCPay invoice
                  </p>
                  <button
                    onClick={() => setShowNewPayment(true)}
                    className="btn-primary text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Create First Payment
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-400">
                    No {filter.replace(/_/g, ' ')} payments
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Try selecting a different filter
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Farmer</th>
                    <th>Crop</th>
                    <th>Amount (KES)</th>
                    <th>Amount (Sats)</th>
                    <th>Rate</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id}>
                      {/* Farmer */}
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-brand-400">
                              {p.farmer_name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-200 text-xs">{p.farmer_name}</p>
                            <p className="text-[11px] text-gray-600">{p.farmer_phone}</p>
                          </div>
                        </div>
                      </td>

                      {/* Crop */}
                      <td>
                        {p.crop_type ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-800 text-gray-300 text-xs border border-gray-700">
                            {p.crop_type}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>

                      {/* KES */}
                      <td>
                        <span className="font-mono text-sm font-semibold text-gray-200">
                          {fmtKes(parseFloat(p.amount_kes))}
                        </span>
                      </td>

                      {/* Sats */}
                      <td>
                        <span className="font-mono text-sm font-semibold text-amber-400">
                          {fmtSats(p.amount_sats)}
                        </span>
                      </td>

                      {/* Rate */}
                      <td>
                        <span className="text-xs text-gray-500 font-mono">
                          {parseFloat(p.rate_used).toLocaleString('en-KE', { maximumFractionDigits: 0 })}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        <StatusBadge status={p.status} />
                      </td>

                      {/* Date */}
                      <td className="text-gray-500 text-xs whitespace-nowrap">
                        {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="flex items-center gap-1.5">
                          {p.status === 'invoice_created' && p.btcpay_payment_url && (
                            <button
                              onClick={() => setInvoicePayment(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/20 transition-colors"
                            >
                              <Eye className="w-3 h-3" />
                              Invoice
                            </button>
                          )}

                          {p.status !== 'invoice_created' && (
                            <span className="text-gray-700 text-xs">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Notes panel */}
        {filtered.some((p) => p.notes) && (
          <div className="mt-4 card p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Payment Notes
            </p>
            <div className="space-y-2">
              {filtered
                .filter((p) => p.notes)
                .map((p) => (
                  <div key={p.id} className="flex items-start gap-3 text-sm">
                    <span className="text-gray-500 shrink-0 font-medium">{p.farmer_name}:</span>
                    <span className="text-gray-400">{p.notes}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewPayment && (
        <NewPaymentModal
          onClose={() => setShowNewPayment(false)}
          onSuccess={handleNewPaymentSuccess}
        />
      )}

      {invoicePayment && (
        <InvoiceModal payment={invoicePayment} onClose={() => setInvoicePayment(null)} />
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  )
}
