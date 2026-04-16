import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, MapPin, Package, Truck, Zap, QrCode,
  CheckCircle, AlertCircle, ChevronLeft, ChevronRight, Copy, Check,
  Smartphone, Loader2,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  getProduct, getOrder, createOrder, createInvoice, confirmPayment,
  updateOrderStatus, payWithWebLN, hasWebLN, formatKes, formatSats,
  rateProduct, initiateMpesaPay, getMpesaPaymentStatus,
} from '../api/client.ts'
import { useAuth } from '../context/auth.tsx'
import StarRating from './StarRating.tsx'
import clsx from 'clsx'

type BuyStep = 'details' | 'location' | 'method' | 'invoice' | 'paying' | 'mpesa-pending' | 'done'
type PayMethod = 'lightning' | 'mpesa'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { authed, connecting, connect } = useAuth()

  const [imgIdx, setImgIdx] = useState(0)
  const [buyStep, setBuyStep] = useState<BuyStep | null>(null)
  const [payMethod, setPayMethod] = useState<PayMethod>('lightning')

  // Buy form state
  const [quantity, setQuantity] = useState('1')
  const [locationName, setLocationName] = useState('')
  const [locating, setLocating] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  // Lightning state
  const [orderId, setOrderId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<{
    payment_id: string; bolt11: string; amount_sats: number; expires_at: string
  } | null>(null)
  const [invoiceSecsLeft, setInvoiceSecsLeft] = useState(60)
  const [invoiceExpired, setInvoiceExpired] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [preimage, setPreimage] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // M-Pesa state
  const [mpesaPhone, setMpesaPhone] = useState('')
  const [mpesaCheckoutId, setMpesaCheckoutId] = useState<string | null>(null)
  const [mpesaStatus, setMpesaStatus] = useState<'pending' | 'paid' | 'failed' | 'cancelled' | 'expired'>('pending')
  const [mpesaReceipt, setMpesaReceipt] = useState<string | null>(null)
  const [mpesaMessage, setMpesaMessage] = useState('')

  // Rating state
  const [ratingValue, setRatingValue] = useState(0)
  const [ratingReview, setRatingReview] = useState('')
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [ratingError, setRatingError] = useState<string | null>(null)

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id!),
    enabled: !!id,
  })

  // ── Poll M-Pesa status while waiting for Daraja callback ─────────────────────
  useEffect(() => {
    if (buyStep !== 'mpesa-pending' || !mpesaCheckoutId) return

    const interval = setInterval(async () => {
      try {
        const result = await getMpesaPaymentStatus(mpesaCheckoutId)
        if (result.status !== 'pending') {
          clearInterval(interval)
          setMpesaStatus(result.status)
          setMpesaReceipt(result.mpesa_receipt_number ?? null)
          if (result.status === 'paid') {
            qc.invalidateQueries({ queryKey: ['orders'] })
            setBuyStep('done')
          }
          // On failed/cancelled: stay on 'mpesa-pending' so we can show the error
        }
      } catch { /* ignore transient poll errors */ }
    }, 3000)

    return () => clearInterval(interval)
  }, [buyStep, mpesaCheckoutId, qc])

  // ── Countdown timer while Lightning invoice is showing ───────────────────────
  useEffect(() => {
    if (buyStep !== 'invoice' || !invoice) return
    const expiresAt = new Date(invoice.expires_at).getTime()

    const tick = () => {
      const secs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
      setInvoiceSecsLeft(secs)
      if (secs === 0) setInvoiceExpired(true)
    }
    tick()
    const timerId = setInterval(tick, 1000)
    return () => clearInterval(timerId)
  }, [buyStep, invoice])

  // ── Poll order status while Lightning invoice is active (BTCPay auto-settle) ─
  // When the buyer scans and pays, BTCPay fires a webhook that advances the order
  // to 'paid'. Polling detects this without requiring a manual preimage paste.
  useEffect(() => {
    if ((buyStep !== 'invoice' && buyStep !== 'paying') || !orderId || invoiceExpired) return

    const interval = setInterval(async () => {
      try {
        const order = await getOrder(orderId)
        if (order.status === 'paid') {
          clearInterval(interval)
          qc.invalidateQueries({ queryKey: ['orders'] })
          setBuyStep('done')
        }
      } catch { /* ignore transient errors */ }
    }, 3000)

    return () => clearInterval(interval)
  }, [buyStep, orderId, invoiceExpired, qc])

  // ── Step 1: create order, then go to method selection ────────────────────────
  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error('No product')
      const qty = parseFloat(quantity)
      if (isNaN(qty) || qty <= 0) throw new Error('Invalid quantity')

      const order = await createOrder({
        product_id: product.id,
        quantity,
        buyer_lat: coords?.lat,
        buyer_lng: coords?.lng,
        buyer_location_name: locationName || undefined,
      })
      setOrderId(order.id)
      setBuyStep('method')
    },
    onError: (e: Error) => setPayError(e.message),
  })

  // ── Lightning: create (or refresh) invoice ───────────────────────────────────
  const getLightningInvoice = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error('No order')
      const inv = await createInvoice(orderId)
      setInvoice({
        payment_id: inv.payment_id,
        bolt11: inv.bolt11,
        amount_sats: inv.amount_sats,
        expires_at: inv.expires_at,
      })
      setInvoiceExpired(false)
      setInvoiceSecsLeft(60)
      setBuyStep('invoice')
    },
    onError: (e: Error) => setPayError(e.message),
  })

  const refreshInvoice = useCallback(() => {
    setPayError(null)
    setInvoiceExpired(false)
    getLightningInvoice.mutate()
  }, [getLightningInvoice])

  // ── M-Pesa: initiate STK Push ─────────────────────────────────────────────────
  const startMpesa = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error('No order')
      if (!mpesaPhone.trim()) throw new Error('Enter your M-Pesa phone number')
      const result = await initiateMpesaPay(orderId, mpesaPhone)
      setMpesaCheckoutId(result.checkout_request_id)
      setMpesaMessage(result.message)
      setMpesaStatus('pending')
      setBuyStep('mpesa-pending')
    },
    onError: (e: Error) => setPayError(e.message),
  })

  // ── WebLN payment ────────────────────────────────────────────────────────────
  const payWebLN = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('No invoice')
      setBuyStep('paying')
      setPayError(null)
      const paymentPreimage = await payWithWebLN(invoice.bolt11)
      await confirmPayment(invoice.payment_id, paymentPreimage)
      qc.invalidateQueries({ queryKey: ['orders'] })
      setBuyStep('done')
    },
    onError: (e: Error) => {
      setPayError(e.message)
      setBuyStep('invoice')
    },
  })

  async function handleManualConfirm() {
    const cleaned = preimage.replace(/\s+/g, '').toLowerCase()
    if (!invoice || cleaned.length !== 64 || !/^[0-9a-f]{64}$/.test(cleaned)) {
      setPayError('Paste the 64-character hex preimage from your Lightning wallet.')
      return
    }
    setConfirming(true)
    setPayError(null)
    try {
      await confirmPayment(invoice.payment_id, cleaned)
      qc.invalidateQueries({ queryKey: ['orders'] })
      setBuyStep('done')
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  function copyBolt11() {
    if (invoice) { navigator.clipboard.writeText(invoice.bolt11); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  async function handleInPersonConfirm() {
    if (!orderId) return
    setConfirming(true)
    setPayError(null)
    try {
      await updateOrderStatus(orderId, { status: 'confirmed', notes: 'In-person pickup confirmed by buyer' })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setBuyStep('done')
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  async function handleRatingSubmit() {
    if (!product || !orderId || ratingValue === 0) return
    setRatingSubmitting(true)
    setRatingError(null)
    try {
      await rateProduct(product.id, {
        order_id: orderId,
        rating: ratingValue,
        review: ratingReview.trim() || undefined,
      })
      setRatingSubmitted(true)
    } catch (e) {
      setRatingError(e instanceof Error ? e.message : 'Failed to submit rating')
    } finally {
      setRatingSubmitting(false)
    }
  }

  async function handleGetLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
      },
      () => setLocating(false),
    )
  }

  function resetBuy() {
    setBuyStep(null)
    setOrderId(null)
    setInvoice(null)
    setInvoiceExpired(false)
    setInvoiceSecsLeft(60)
    setPreimage('')
    setPayError(null)
    setMpesaCheckoutId(null)
    setMpesaStatus('pending')
    setMpesaReceipt(null)
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl">
        <div className="skeleton h-6 w-32 rounded" />
        <div className="skeleton aspect-video rounded-xl" />
        <div className="skeleton h-8 w-2/3 rounded" />
      </div>
    )
  }

  if (isError || !product) {
    return (
      <div className="p-6 text-center py-20 text-gray-500">
        <AlertCircle className="w-10 h-10 mx-auto mb-3" />
        <p>Product not found.</p>
      </div>
    )
  }

  const images = product.images
  const qty = parseFloat(product.quantity_avail)

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to marketplace
      </button>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Images */}
        <div className="space-y-3">
          <div className="aspect-video bg-gray-800 rounded-xl overflow-hidden relative">
            {images.length > 0 ? (
              <img
                src={images[imgIdx]?.url}
                alt={product.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="w-16 h-16 text-gray-600" />
              </div>
            )}
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setImgIdx(i => Math.max(0, i - 1))}
                  disabled={imgIdx === 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-900/70 flex items-center justify-center disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setImgIdx(i => Math.min(images.length - 1, i + 1))}
                  disabled={imgIdx === images.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-900/70 flex items-center justify-center disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setImgIdx(i)}
                  className={clsx(
                    'w-14 h-14 rounded-lg overflow-hidden shrink-0 border-2',
                    i === imgIdx ? 'border-brand-500' : 'border-transparent',
                  )}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info + Buy */}
        <div className="space-y-4">
          {product.category && (
            <span className="text-xs font-semibold bg-gray-800 text-gray-400 px-2 py-1 rounded-full">
              {product.category}
            </span>
          )}

          <h1 className="text-xl font-bold text-gray-100">{product.title}</h1>

          {(product.rating_count ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <StarRating rating={product.avg_rating ?? 0} size="sm" />
              <span className="text-xs text-gray-500">
                {(product.avg_rating ?? 0).toFixed(1)} ({product.rating_count} review{product.rating_count !== 1 ? 's' : ''})
              </span>
            </div>
          )}

          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-brand-400">{formatKes(product.price_kes)}</span>
            <span className="text-sm text-gray-500">/{product.unit}</span>
          </div>

          <div className="space-y-1 text-sm text-gray-400">
            <p>Sold by <span className="text-gray-200 font-medium">{product.seller_name}</span></p>
            {product.location_name && (
              <p className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {product.location_name}
              </p>
            )}
            <p>Available: <span className="text-gray-200">{qty} {product.unit}</span></p>
          </div>

          {product.description && (
            <p className="text-sm text-gray-400 leading-relaxed">{product.description}</p>
          )}

          {/* Buy flow */}
          {buyStep === null && (
            <button
              disabled={qty <= 0 || connecting}
              onClick={() => {
                if (!authed) { connect(); return }
                setBuyStep('details')
                setPayError(null)
              }}
              className="btn-primary w-full justify-center"
            >
              <Zap className="w-4 h-4" />
              {qty <= 0
                ? 'Out of Stock'
                : connecting
                  ? 'Connecting…'
                  : authed
                    ? 'Buy Now'
                    : 'Connect to Buy'}
            </button>
          )}

          {/* Step: quantity + location */}
          {(buyStep === 'details' || buyStep === 'location') && (
            <div className="card p-4 space-y-4">
              <h3 className="font-semibold text-gray-100">Order Details</h3>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400">
                  Quantity ({product.unit})
                </label>
                <input
                  type="number"
                  min="0.01"
                  max={product.quantity_avail}
                  step="0.01"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  className="input-base"
                />
                <p className="text-xs text-gray-500">
                  Total: {formatKes(
                    String(parseFloat(quantity || '0') * parseFloat(product.price_kes))
                  )}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400">Your location (for delivery estimate)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Nairobi, Westlands"
                    value={locationName}
                    onChange={e => setLocationName(e.target.value)}
                    className="input-base"
                  />
                  <button
                    type="button"
                    onClick={handleGetLocation}
                    disabled={locating}
                    className="btn-secondary px-3 shrink-0"
                    title="Use GPS location"
                  >
                    <MapPin className="w-4 h-4" />
                  </button>
                </div>
                {coords && (
                  <p className="text-xs text-mpesa">GPS location captured</p>
                )}
              </div>

              {payError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  {payError}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setBuyStep(null); setPayError(null) }}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => placeOrder.mutate()}
                  disabled={placeOrder.isPending}
                  className="btn-primary flex-1 justify-center"
                >
                  {placeOrder.isPending ? 'Creating order…' : 'Choose Payment'}
                </button>
              </div>
            </div>
          )}

          {/* Step: choose payment method */}
          {buyStep === 'method' && (
            <div className="card p-4 space-y-4">
              <h3 className="font-semibold text-gray-100">How would you like to pay?</h3>
              <p className="text-xs text-gray-500">
                Total: <span className="font-semibold text-gray-300">
                  {formatKes(String(parseFloat(quantity || '0') * parseFloat(product.price_kes)))}
                </span>
              </p>

              {/* Method toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayMethod('lightning')}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
                    payMethod === 'lightning'
                      ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                      : 'border-gray-700 text-gray-500 hover:border-gray-600',
                  )}
                >
                  <Zap className="w-6 h-6" />
                  <span className="text-xs font-semibold">Lightning</span>
                  <span className="text-[10px] text-center opacity-70">Any Lightning wallet</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPayMethod('mpesa')}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
                    payMethod === 'mpesa'
                      ? 'border-mpesa bg-mpesa/10 text-mpesa'
                      : 'border-gray-700 text-gray-500 hover:border-gray-600',
                  )}
                >
                  <Smartphone className="w-6 h-6" />
                  <span className="text-xs font-semibold">M-Pesa</span>
                  <span className="text-[10px] text-center opacity-70">STK Push to your phone</span>
                </button>
              </div>

              {/* M-Pesa phone input */}
              {payMethod === 'mpesa' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">
                    Your M-Pesa phone number
                  </label>
                  <div className="relative">
                    <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                    <input
                      type="tel"
                      value={mpesaPhone}
                      onChange={e => { setMpesaPhone(e.target.value); setPayError(null) }}
                      placeholder="0712 345 678"
                      inputMode="tel"
                      className="input-base pl-9"
                    />
                  </div>
                  <p className="text-[11px] text-gray-600">
                    You'll receive a payment prompt on this number. Complete it within 60 seconds.
                  </p>
                </div>
              )}

              {payError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  {payError}
                </p>
              )}

              <div className="flex gap-2">
                <button onClick={resetBuy} className="btn-secondary flex-1 justify-center">
                  Cancel
                </button>
                {payMethod === 'lightning' ? (
                  <button
                    onClick={() => getLightningInvoice.mutate()}
                    disabled={getLightningInvoice.isPending}
                    className="btn-primary flex-1 justify-center"
                  >
                    <Zap className="w-4 h-4" />
                    {getLightningInvoice.isPending ? 'Getting invoice…' : 'Get Invoice'}
                  </button>
                ) : (
                  <button
                    onClick={() => startMpesa.mutate()}
                    disabled={startMpesa.isPending || !mpesaPhone.trim()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-mpesa/20 border border-mpesa/30 text-mpesa hover:bg-mpesa/30 transition-colors disabled:opacity-50"
                  >
                    <Smartphone className="w-4 h-4" />
                    {startMpesa.isPending ? 'Sending prompt…' : 'Send M-Pesa Prompt'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step: M-Pesa pending — waiting for Daraja callback */}
          {buyStep === 'mpesa-pending' && (
            <div className="card p-4 space-y-4">
              {(mpesaStatus === 'pending') ? (
                <>
                  <div className="text-center space-y-3 py-2">
                    <Loader2 className="w-10 h-10 text-mpesa animate-spin mx-auto" />
                    <p className="font-semibold text-gray-100">Check your phone</p>
                    <p className="text-sm text-gray-400">
                      {mpesaMessage || 'An M-Pesa STK Push prompt has been sent to your phone. Enter your PIN to complete the payment.'}
                    </p>
                    <p className="text-xs text-gray-600">Waiting for confirmation…</p>
                  </div>
                  <button onClick={resetBuy} className="btn-secondary w-full justify-center text-sm">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="text-center space-y-2">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
                    <p className="font-semibold text-gray-100">
                      {mpesaStatus === 'cancelled' ? 'Payment cancelled' : 'Payment failed'}
                    </p>
                    <p className="text-sm text-gray-400">
                      {mpesaStatus === 'cancelled'
                        ? 'You cancelled the M-Pesa prompt. Try again when ready.'
                        : 'The payment could not be completed. Please try again.'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={resetBuy} className="btn-secondary flex-1 justify-center">
                      Cancel order
                    </button>
                    <button
                      onClick={() => {
                        setMpesaCheckoutId(null)
                        setMpesaStatus('pending')
                        setBuyStep('method')
                        setPayError(null)
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-mpesa/20 border border-mpesa/30 text-mpesa hover:bg-mpesa/30 transition-colors"
                    >
                      <Smartphone className="w-4 h-4" />
                      Try again
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step: show Lightning invoice */}
          {buyStep === 'invoice' && invoice && (
            <div className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-100">Pay Invoice</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-brand-400">{formatSats(invoice.amount_sats)}</span>
                  {/* Countdown badge */}
                  {!invoiceExpired ? (
                    <span className={clsx(
                      'text-xs font-mono px-2 py-0.5 rounded-full',
                      invoiceSecsLeft > 20
                        ? 'bg-green-900/30 text-green-400'
                        : invoiceSecsLeft > 10
                          ? 'bg-yellow-900/30 text-yellow-400'
                          : 'bg-red-900/30 text-red-400 animate-pulse',
                    )}>
                      {invoiceSecsLeft}s
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400">
                      Expired
                    </span>
                  )}
                </div>
              </div>

              {/* Expired overlay */}
              {invoiceExpired && (
                <div className="bg-gray-800/80 rounded-xl p-4 text-center space-y-3">
                  <p className="text-sm text-gray-300 font-medium">Invoice expired</p>
                  <p className="text-xs text-gray-500">
                    The rate was locked for 60 seconds. Get a fresh invoice at the current rate.
                  </p>
                  <button
                    onClick={refreshInvoice}
                    disabled={getLightningInvoice.isPending}
                    className="btn-primary mx-auto"
                  >
                    {getLightningInvoice.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Getting new invoice…</>
                      : <><Zap className="w-4 h-4" /> Get New Invoice</>}
                  </button>
                </div>
              )}

              {/* QR + controls — hidden while expired */}
              {!invoiceExpired && (<>

              <div className="flex justify-center p-4 bg-white rounded-xl">
                <QRCodeSVG
                  value={invoice.bolt11.toUpperCase()}
                  size={200}
                  level="H"
                  imageSettings={{
                    src: '/logo.svg',
                    width: 44,
                    height: 44,
                    excavate: true,
                  }}
                />
              </div>

              <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-2">
                <p className="text-[10px] text-gray-400 font-mono break-all flex-1 leading-relaxed">
                  {invoice.bolt11.slice(0, 44)}…
                </p>
                <button onClick={copyBolt11} className="text-brand-400 hover:text-brand-300 shrink-0">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <QrCode className="w-3.5 h-3.5 shrink-0" />
                Scan with any Lightning wallet, then paste the preimage below to confirm.
              </div>

              {hasWebLN && (
                <button
                  onClick={() => payWebLN.mutate()}
                  disabled={payWebLN.isPending}
                  className="btn-primary w-full justify-center"
                >
                  <Zap className="w-4 h-4" />
                  {payWebLN.isPending ? 'Paying…' : 'Pay with Fedi / WebLN'}
                </button>
              )}

              {/* Manual preimage confirmation for external wallets */}
              <div className="space-y-1.5 border-t border-gray-700 pt-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Paid with another wallet?
                </p>
                <label className="text-[11px] text-gray-500">
                  Paste the payment preimage (hex) from your wallet's payment details:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="64-char hex preimage…"
                    value={preimage}
                    onChange={e => setPreimage(e.target.value)}
                    className="input-base font-mono text-xs flex-1"
                  />
                  <button
                    onClick={handleManualConfirm}
                    disabled={confirming || !/^[0-9a-f]{64}$/i.test(preimage.replace(/\s+/g, ''))}
                    className="btn-primary px-3 shrink-0"
                  >
                    {confirming ? '…' : 'Confirm'}
                  </button>
                </div>
                {preimage.length > 0 && !/^[0-9a-f]{64}$/i.test(preimage.replace(/\s+/g, '')) && (
                  <p className="text-[11px] text-yellow-500">
                    {preimage.replace(/\s+/g, '').length}/64 hex chars
                  </p>
                )}
              </div>

              {/* In-person / cash pickup */}
              <div className="space-y-2 border-t border-gray-700 pt-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Collecting in person?
                </p>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  If you're meeting the seller directly and have received your goods, confirm receipt here. No preimage needed.
                </p>
                <button
                  onClick={handleInPersonConfirm}
                  disabled={confirming}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-mpesa/20 border border-mpesa/30 text-mpesa hover:bg-mpesa/30 transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  {confirming ? 'Confirming…' : 'I received my goods'}
                </button>
              </div>

              {payError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  {payError}
                </p>
              )}
              </>)}

              <button
                onClick={resetBuy}
                className="btn-secondary w-full justify-center text-sm"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step: WebLN paying */}
          {buyStep === 'paying' && (
            <div className="card p-6 text-center space-y-3">
              <Zap className="w-8 h-8 text-brand-400 animate-pulse mx-auto" />
              <p className="text-sm text-gray-300">Processing payment…</p>
            </div>
          )}

          {/* Step: done */}
          {buyStep === 'done' && (
            <div className="card p-6 space-y-4">
              <div className="text-center space-y-2">
                <CheckCircle className="w-10 h-10 text-mpesa mx-auto" />
                <p className="font-semibold text-gray-100">Payment confirmed!</p>
                {mpesaReceipt && (
                  <p className="text-xs text-gray-500 font-mono">Receipt: {mpesaReceipt}</p>
                )}
                <p className="text-sm text-gray-400">
                  Payment sent to the seller. Track your delivery below.
                </p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => navigate('/orders')}
                    className="btn-primary"
                  >
                    <Truck className="w-4 h-4" />
                    Track Order
                  </button>
                </div>
                <p className="text-xs text-gray-600">
                  Once marked delivered, you can confirm receipt or raise a dispute from My Orders.
                </p>
              </div>

              {/* Rating form */}
              {!ratingSubmitted ? (
                <div className="border-t border-gray-700 pt-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-200">Rate this product</p>
                  <StarRating
                    rating={ratingValue}
                    size="md"
                    interactive
                    onChange={setRatingValue}
                  />
                  <textarea
                    rows={2}
                    placeholder="Leave a review (optional)"
                    value={ratingReview}
                    onChange={e => setRatingReview(e.target.value)}
                    className="input-base text-sm w-full resize-none"
                  />
                  {ratingError && (
                    <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                      {ratingError}
                    </p>
                  )}
                  <button
                    onClick={handleRatingSubmit}
                    disabled={ratingValue === 0 || ratingSubmitting}
                    className="btn-secondary text-sm w-full justify-center"
                  >
                    {ratingSubmitting ? 'Submitting…' : 'Submit Rating'}
                  </button>
                </div>
              ) : (
                <div className="border-t border-gray-700 pt-4 text-center">
                  <p className="text-sm text-mpesa font-medium">Thanks for your rating!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
