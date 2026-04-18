import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Package, ChevronDown, ChevronUp, ThumbsUp, AlertTriangle,
  XCircle, Zap, CheckCircle, FileText, Send,
  Smartphone, Loader2, RotateCcw,
} from 'lucide-react'
import LightningInvoiceCard from './LightningInvoiceCard.tsx'
import {
  listOrders, updateOrderStatus, cancelOrder, createInvoice, confirmPayment,
  payWithWebLN, hasWebLN, formatKes, formatSats, ORDER_STATUS_LABELS,
  openDispute, getDisputeEvidence, addDisputeEvidence,
  initiateMpesaPay, getMpesaPaymentStatus,
} from '../api/client.ts'

import OrderStatusSteps from './OrderStatusSteps.tsx'
import MessageThread from './MessageThread.tsx'
import clsx from 'clsx'
import type { Order } from '../types'

// ── M-Pesa payment panel ──────────────────────────────────────────────────────

function MpesaPayPanel({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const [phone, setPhone] = useState('')
  const [checkoutId, setCheckoutId] = useState<string | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('pending')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const initiate = useMutation({
    mutationFn: () => initiateMpesaPay(order.id, phone.trim()),
    onSuccess: res => {
      setCheckoutId(res.checkout_request_id)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  // Poll for payment status once STK Push is sent
  useEffect(() => {
    if (!checkoutId) return
    setPollStatus('pending')

    pollRef.current = setInterval(async () => {
      try {
        const s = await getMpesaPaymentStatus(checkoutId)
        setPollStatus(s.status)
        if (s.status === 'paid') {
          clearInterval(pollRef.current!)
          onPaid()
        } else if (s.status === 'failed' || s.status === 'cancelled') {
          clearInterval(pollRef.current!)
          setError(
            s.status === 'cancelled'
              ? 'You cancelled the M-Pesa request. Try again.'
              : 'Payment failed. Please try again or use Lightning.',
          )
          setCheckoutId(null)
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 3000)

    return () => clearInterval(pollRef.current!)
  }, [checkoutId, onPaid])

  // Waiting for PIN entry screen
  if (checkoutId) {
    return (
      <div className="space-y-3 bg-gray-800/60 rounded-xl p-4 text-center">
        <div className="flex items-center justify-center gap-2 text-mpesa">
          <Smartphone className="w-5 h-5" />
          <span className="text-sm font-semibold">M-Pesa PIN Prompt Sent</span>
        </div>
        <Loader2 className="w-8 h-8 text-mpesa mx-auto animate-spin" />
        <p className="text-xs text-gray-400 leading-relaxed">
          Check your phone for the M-Pesa PIN prompt and enter your PIN to complete payment.
          This page will update automatically.
        </p>
        <p className="text-[11px] text-gray-600">
          Status: <span className="text-gray-400 font-medium">{pollStatus}</span>
        </p>
        <button
          onClick={() => { clearInterval(pollRef.current!); setCheckoutId(null) }}
          className="text-xs text-gray-500 underline"
        >
          Cancel / try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 bg-gray-800/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
        <Smartphone className="w-3.5 h-3.5 text-mpesa" />
        Pay with M-Pesa
      </p>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Enter your Safaricom number. You'll receive a PIN prompt on your phone within seconds.
      </p>
      <div className="flex gap-2">
        <input
          type="tel"
          placeholder="e.g. 0712 345 678"
          value={phone}
          onChange={e => { setPhone(e.target.value); setError(null) }}
          className="input-base flex-1 text-sm"
        />
        <button
          onClick={() => initiate.mutate()}
          disabled={initiate.isPending || phone.trim().length < 9}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-mpesa text-white hover:bg-mpesa/80 transition-colors disabled:opacity-50"
        >
          {initiate.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Smartphone className="w-4 h-4" />}
          {initiate.isPending ? 'Sending…' : 'Pay'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}

// ── Lightning payment panel ───────────────────────────────────────────────────

interface InvoiceData {
  payment_id: string
  bolt11: string
  amount_sats: number
  expires_at: string
}

function LightningPayPanel({
  order, onPaid, onInPersonConfirm,
}: {
  order: Order
  onPaid: () => void
  onInPersonConfirm: () => void
}) {
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [preimage, setPreimage] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const getInvoice = useMutation({
    mutationFn: () => createInvoice(order.id),
    onSuccess: inv => {
      setInvoice({
        payment_id: inv.payment_id,
        bolt11: inv.bolt11,
        amount_sats: inv.amount_sats,
        expires_at: inv.expires_at,
      })
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const payFedi = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('No invoice')
      const pre = await payWithWebLN(invoice.bolt11)
      await confirmPayment(invoice.payment_id, pre)
    },
    onSuccess: onPaid,
    onError: (e: Error) => setError(e.message),
  })

  async function handleManualConfirm() {
    const cleaned = preimage.replace(/\s+/g, '').toLowerCase()
    if (!invoice || cleaned.length !== 64 || !/^[0-9a-f]{64}$/.test(cleaned)) {
      setError('Paste the 64-character hex preimage from your Lightning wallet.')
      return
    }
    setConfirming(true)
    setError(null)
    try {
      await confirmPayment(invoice.payment_id, cleaned)
      onPaid()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  function copyBolt11() {
    if (invoice) {
      navigator.clipboard.writeText(invoice.bolt11)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!invoice) {
    return (
      <div className="space-y-2">
        {error && (
          <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <button
          onClick={() => getInvoice.mutate()}
          disabled={getInvoice.isPending}
          className="btn-primary text-sm w-full justify-center"
        >
          <Zap className="w-4 h-4" />
          {getInvoice.isPending ? 'Generating invoice…' : 'Get Lightning Invoice'}
        </button>
      </div>
    )
  }

  return (
    <LightningInvoiceCard
      invoice={invoice}
      onExpired={() => {/* expiry handled inside the card; parent doesn't need to act */}}
      onCopy={copyBolt11}
      onWebLN={() => payFedi.mutate()}
      onManualConfirm={handleManualConfirm}
      onInPersonConfirm={onInPersonConfirm}
      onRefresh={() => getInvoice.mutate()}
      onCancel={() => setInvoice(null)}
      setPreimage={setPreimage}
      copied={copied}
      confirming={confirming}
      preimage={preimage}
      payError={error}
      hasWebLN={hasWebLN}
      isWebLNPaying={payFedi.isPending}
      isRefreshing={getInvoice.isPending}
    />
  )
}

// ── Combined payment method selector ─────────────────────────────────────────

type PayMethod = 'mpesa' | 'lightning'

function PayPanel({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const [method, setMethod] = useState<PayMethod>('mpesa')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleInPerson() {
    setConfirming(true)
    setError(null)
    try {
      await updateOrderStatus(order.id, { status: 'confirmed', notes: 'In-person pickup confirmed by buyer' })
      onPaid()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Method tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1">
        {([['mpesa', 'M-Pesa', Smartphone], ['lightning', 'Lightning', Zap]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMethod(key)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors',
                method === key
                  ? key === 'mpesa'
                    ? 'bg-mpesa/20 text-mpesa'
                    : 'bg-brand-500/20 text-brand-400'
                  : 'text-gray-500 hover:text-gray-300',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ),
        )}
      </div>

      {method === 'mpesa'
        ? <MpesaPayPanel order={order} onPaid={onPaid} />
        : <LightningPayPanel order={order} onPaid={onPaid} onInPersonConfirm={handleInPerson} />}

      {/* In-person pickup — shown on M-Pesa tab only; Lightning card has its own section */}
      {method === 'mpesa' && (
        <div className="space-y-2 border-t border-gray-700 pt-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Collecting in person?</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Already received your goods directly from the seller? Confirm here — no payment needed.
          </p>
          <button
            onClick={handleInPerson}
            disabled={confirming}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-mpesa/20 border border-mpesa/30 text-mpesa hover:bg-mpesa/30 transition-colors disabled:opacity-50"
          >
            <CheckCircle className="w-4 h-4" />
            {confirming ? 'Confirming…' : 'I received my goods'}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── Order card ────────────────────────────────────────────────────────────────

// ── Dispute panel ─────────────────────────────────────────────────────────────

function DisputePanel({ order, onDone }: { order: Order; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const dispute = useMutation({
    mutationFn: () => openDispute(order.id, reason.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders', 'buyer'] })
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-3 bg-yellow-900/10 border border-yellow-700/30 rounded-xl p-4">
      <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" />
        Open a Dispute
      </p>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Describe what went wrong. An admin will review your case and the seller's response
        within 24 hours.
      </p>
      <textarea
        value={reason}
        onChange={e => { setReason(e.target.value); setError(null) }}
        placeholder="e.g. Goods arrived damaged, quantity was short by 5 kg…"
        rows={3}
        className="input-base text-xs w-full resize-none"
        maxLength={1000}
      />
      <p className="text-[10px] text-gray-600 text-right">{reason.length}/1000</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onDone} className="btn-secondary text-xs flex-1 justify-center">
          Cancel
        </button>
        <button
          onClick={() => dispute.mutate()}
          disabled={dispute.isPending || reason.trim().length < 10}
          className="btn-danger text-xs flex-1 justify-center"
        >
          {dispute.isPending ? 'Submitting…' : 'Submit Dispute'}
        </button>
      </div>
    </div>
  )
}

// ── Evidence panel (shown when order is already disputed) ─────────────────────

function EvidencePanel({ orderId }: { orderId: string }) {
  const [kind, setKind] = useState<'text' | 'url'>('text')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: evidence = [] } = useQuery({
    queryKey: ['dispute-evidence', orderId],
    queryFn: () => getDisputeEvidence(orderId),
    staleTime: 30_000,
  })

  const addEvidence = useMutation({
    mutationFn: () => addDisputeEvidence(orderId, { kind, content: content.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispute-evidence', orderId] })
      setContent('')
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-3 bg-yellow-900/10 border border-yellow-700/30 rounded-xl p-4">
      <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" />
        Dispute Evidence
      </p>

      {evidence.length === 0 ? (
        <p className="text-[11px] text-gray-500">No evidence submitted yet.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map(e => (
            <li key={e.id} className="bg-gray-800/60 rounded-lg px-3 py-2 text-xs text-gray-300">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mr-2">{e.kind}</span>
              {e.kind === 'url'
                ? <a href={e.content} target="_blank" rel="noreferrer" className="text-brand-400 underline break-all">{e.content}</a>
                : <span className="break-words">{e.content}</span>
              }
              <span className="block text-[10px] text-gray-600 mt-0.5">
                {new Date(e.created_at).toLocaleString('en-KE')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-yellow-700/20 pt-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Add Evidence</p>
        <div className="flex gap-1">
          {(['text', 'url'] as const).map(k => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                kind === k ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {k === 'text' ? 'Text note' : 'URL / Link'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {kind === 'text' ? (
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Describe what you observed…"
              rows={2}
              className="input-base text-xs flex-1 resize-none"
              maxLength={5000}
            />
          ) : (
            <input
              type="url"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="https://…"
              className="input-base text-xs flex-1 font-mono"
            />
          )}
          <button
            onClick={() => addEvidence.mutate()}
            disabled={addEvidence.isPending || content.trim().length === 0}
            className="btn-primary px-3 shrink-0 self-start"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: Order }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [showPay, setShowPay] = useState(false)
  const [showDisputeForm, setShowDisputeForm] = useState(false)
  const qc = useQueryClient()

  const confirm = useMutation({
    mutationFn: () => updateOrderStatus(order.id, { status: 'confirmed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'buyer'] }),
  })

  const cancel = useMutation({
    mutationFn: () => cancelOrder(order.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'buyer'] }),
  })

  const canConfirm = order.status === 'delivered'
  const canDispute = order.status === 'delivered'
  const canCancel = order.status === 'pending_payment'
  const canReorder = order.status === 'confirmed'

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
            order.status === 'confirmed'       && 'bg-mpesa/20 text-mpesa',
            order.status === 'cancelled'       && 'bg-red-900/20 text-red-400',
            order.status === 'disputed'        && 'bg-yellow-900/20 text-yellow-400',
            order.status === 'pending_payment' && 'bg-gray-700 text-gray-400',
            !['confirmed','cancelled','disputed','pending_payment'].includes(order.status)
              && 'bg-brand-500/20 text-brand-400',
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
              {order.distance_km != null && <> · {order.distance_km.toFixed(0)} km</>}
            </p>
          )}

          {/* Pay panel */}
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

          {/* Dispute form or evidence viewer */}
          {showDisputeForm && canDispute && (
            <DisputePanel order={order} onDone={() => setShowDisputeForm(false)} />
          )}
          {order.status === 'disputed' && (
            <EvidencePanel orderId={order.id} />
          )}

          {/* Buyer actions */}
          {!showDisputeForm && (
            <div className="flex gap-2 flex-wrap">
              {canConfirm && (
                <button
                  onClick={() => confirm.mutate()}
                  disabled={confirm.isPending}
                  className="btn-success text-sm"
                >
                  <ThumbsUp className="w-4 h-4" />
                  Confirm Delivery
                </button>
              )}
              {canDispute && (
                <button
                  onClick={() => setShowDisputeForm(true)}
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
              {canReorder && (
                <button
                  onClick={() => navigate(`/product/${order.product_id}`)}
                  className="btn-secondary text-sm"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reorder
                </button>
              )}
            </div>
          )}

          {/* Buyer ↔ seller messaging */}
          <div className="border-t border-gray-800 pt-3">
            <MessageThread orderId={order.id} />
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
