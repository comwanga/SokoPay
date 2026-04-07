import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Package, ChevronDown, ChevronUp, ThumbsUp, AlertTriangle,
  XCircle, Zap, QrCode, Copy, Check,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  listOrders, updateOrderStatus, cancelOrder, createInvoice, confirmPayment,
  payWithWebLN, hasWebLN, formatKes, formatSats, ORDER_STATUS_LABELS,
} from '../api/client.ts'
import OrderStatusSteps from './OrderStatusSteps.tsx'
import clsx from 'clsx'
import type { Order } from '../types'

// ── Inline payment panel ──────────────────────────────────────────────────────

function PayPanel({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const [bolt11, setBolt11] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [preimage, setPreimage] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const getInvoice = useMutation({
    mutationFn: () => createInvoice(order.id),
    onSuccess: inv => { setBolt11(inv.bolt11); setPaymentId(inv.payment_id); setError(null) },
    onError: (e: Error) => setError(e.message),
  })

  const payFedi = useMutation({
    mutationFn: async () => {
      if (!bolt11 || !paymentId) throw new Error('No invoice')
      const pre = await payWithWebLN(bolt11)
      await confirmPayment(paymentId, pre)
    },
    onSuccess: onPaid,
    onError: (e: Error) => setError(e.message),
  })

  async function handleManualConfirm() {
    if (!paymentId || preimage.length !== 64) {
      setError('Paste the 64-character hex preimage from your Lightning wallet.')
      return
    }
    setConfirming(true)
    setError(null)
    try {
      await confirmPayment(paymentId, preimage)
      onPaid()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  function copyBolt11() {
    if (bolt11) { navigator.clipboard.writeText(bolt11); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  if (!bolt11) {
    return (
      <div className="space-y-2">
        {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>}
        <button
          onClick={() => getInvoice.mutate()}
          disabled={getInvoice.isPending}
          className="btn-primary text-sm w-full justify-center"
        >
          <Zap className="w-4 h-4" />
          {getInvoice.isPending ? 'Generating invoice…' : 'Get Payment Invoice'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 bg-gray-800/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-gray-300">Pay with Lightning</p>

      <div className="flex justify-center p-3 bg-white rounded-xl">
        <QRCodeSVG value={bolt11.toUpperCase()} size={160} />
      </div>

      <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-2">
        <p className="text-[10px] font-mono text-gray-400 break-all flex-1 leading-relaxed">
          {bolt11.slice(0, 44)}…
        </p>
        <button onClick={copyBolt11} className="shrink-0 text-brand-400 hover:text-brand-300">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <QrCode className="w-3.5 h-3.5 shrink-0" />
        Scan with any Lightning wallet, then paste the preimage below.
      </div>

      {hasWebLN && (
        <button
          onClick={() => payFedi.mutate()}
          disabled={payFedi.isPending}
          className="btn-primary w-full justify-center text-sm"
        >
          <Zap className="w-4 h-4" />
          {payFedi.isPending ? 'Paying…' : 'Pay with Fedi / WebLN'}
        </button>
      )}

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-gray-500">
          Paid externally? Paste payment preimage (hex) to confirm:
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="64-char hex preimage from your wallet…"
            value={preimage}
            onChange={e => setPreimage(e.target.value.trim().toLowerCase())}
            className="input-base font-mono text-xs flex-1"
          />
          <button
            onClick={handleManualConfirm}
            disabled={confirming || preimage.length !== 64}
            className="btn-primary px-3 shrink-0 text-sm"
          >
            {confirming ? '…' : 'Confirm'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>}
    </div>
  )
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false)
  const [showPay, setShowPay] = useState(false)
  const qc = useQueryClient()

  const advanceStatus = useMutation({
    mutationFn: (status: string) =>
      updateOrderStatus(order.id, { status: status as Order['status'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'buyer'] }),
  })

  const cancel = useMutation({
    mutationFn: () => cancelOrder(order.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'buyer'] }),
  })

  const canConfirm = order.status === 'delivered'
  const canDispute = order.status === 'delivered'
  const canCancel = order.status === 'pending_payment'

  return (
    <div className="card overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-gray-100 truncate">{order.product_title}</p>
          <p className="text-xs text-gray-400">
            {order.quantity} {order.unit} · {formatKes(order.total_kes)}
            {order.total_sats ? ` · ${formatSats(order.total_sats)}` : ''}
          </p>
          <p className="text-xs text-gray-500">Seller: {order.seller_name}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className={clsx(
            'text-xs font-semibold px-2 py-1 rounded-full',
            order.status === 'confirmed'     && 'bg-mpesa/20 text-mpesa',
            order.status === 'cancelled'     && 'bg-red-900/20 text-red-400',
            order.status === 'disputed'      && 'bg-yellow-900/20 text-yellow-400',
            order.status === 'pending_payment' && 'bg-gray-700 text-gray-400',
            !['confirmed','cancelled','disputed','pending_payment'].includes(order.status) && 'bg-brand-500/20 text-brand-400',
          )}>
            {ORDER_STATUS_LABELS[order.status] ?? order.status}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          <OrderStatusSteps
            status={order.status}
            estimatedDate={order.estimated_delivery_date}
            sellerDate={order.seller_delivery_date}
          />

          {order.delivery_notes && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 text-xs text-gray-300">
              <span className="font-medium text-gray-400">Seller note: </span>
              {order.delivery_notes}
            </div>
          )}

          {order.buyer_location_name && (
            <p className="text-xs text-gray-500">
              Delivery to: <span className="text-gray-300">{order.buyer_location_name}</span>
              {order.distance_km != null && (
                <> · {order.distance_km.toFixed(0)} km</>
              )}
            </p>
          )}

          {/* Pay panel for pending_payment orders */}
          {order.status === 'pending_payment' && (
            <div className="space-y-2">
              {!showPay ? (
                <button
                  onClick={() => setShowPay(true)}
                  className="btn-primary text-sm w-full justify-center"
                >
                  <Zap className="w-4 h-4" />
                  Pay Now
                </button>
              ) : (
                <PayPanel
                  order={order}
                  onPaid={() => {
                    setShowPay(false)
                    qc.invalidateQueries({ queryKey: ['orders', 'buyer'] })
                  }}
                />
              )}
            </div>
          )}

          {/* Buyer actions */}
          <div className="flex gap-2 flex-wrap">
            {canConfirm && (
              <button
                onClick={() => advanceStatus.mutate('confirmed')}
                disabled={advanceStatus.isPending}
                className="btn-success text-sm"
              >
                <ThumbsUp className="w-4 h-4" />
                Confirm Delivery
              </button>
            )}
            {canDispute && (
              <button
                onClick={() => advanceStatus.mutate('disputed')}
                disabled={advanceStatus.isPending}
                className="btn-secondary text-sm"
              >
                <AlertTriangle className="w-4 h-4" />
                Raise Dispute
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
                className="btn-danger text-sm"
              >
                <XCircle className="w-4 h-4" />
                Cancel Order
              </button>
            )}
          </div>

          <p className="text-[11px] text-gray-600">
            Order ID: {order.id} · {new Date(order.created_at).toLocaleString('en-KE')}
          </p>
        </div>
      )}
    </div>
  )
}

export default function BuyerOrders() {
  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: ['orders', 'buyer'],
    queryFn: () => listOrders('buyer'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const active = orders.filter(o => !['confirmed', 'cancelled'].includes(o.status))
  const past = orders.filter(o => ['confirmed', 'cancelled'].includes(o.status))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-100">My Orders</h1>
        <p className="text-sm text-gray-400 mt-0.5">Track your purchases and deliveries</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-16 skeleton" />)}
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-400">Failed to load orders. Please refresh.</p>
      )}

      {!isLoading && !isError && orders.length === 0 && (
        <div className="text-center py-20 space-y-2">
          <Package className="w-12 h-12 text-gray-700 mx-auto" />
          <p className="text-gray-400 font-medium">No orders yet</p>
          <p className="text-sm text-gray-600">Browse the marketplace to get started</p>
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active</h2>
          {active.map(o => <OrderCard key={o.id} order={o} />)}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">History</h2>
          {past.map(o => <OrderCard key={o.id} order={o} />)}
        </section>
      )}
    </div>
  )
}
