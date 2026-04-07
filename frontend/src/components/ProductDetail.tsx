import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, MapPin, Package, Truck, Zap, QrCode,
  CheckCircle, AlertCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  getProduct, createOrder, createInvoice, confirmPayment,
  payWithWebLN, formatKes, formatSats,
} from '../api/client.ts'
import { useAuth } from '../context/auth.tsx'
import clsx from 'clsx'

type BuyStep = 'details' | 'location' | 'invoice' | 'paying' | 'done'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { authed, connecting, connect } = useAuth()

  const [imgIdx, setImgIdx] = useState(0)
  const [buyStep, setBuyStep] = useState<BuyStep | null>(null)

  // Buy form state
  const [quantity, setQuantity] = useState('1')
  const [locationName, setLocationName] = useState('')
  const [locating, setLocating] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  // Invoice state
  const [_orderId, setOrderId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<{ payment_id: string; bolt11: string; amount_sats: number } | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id!),
    enabled: !!id,
  })

  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error('No product')
      const qty = parseFloat(quantity)
      if (isNaN(qty) || qty <= 0) throw new Error('Invalid quantity')

      const order = await createOrder({
        product_id: product.id,
        quantity: quantity,
        buyer_lat: coords?.lat,
        buyer_lng: coords?.lng,
        buyer_location_name: locationName || undefined,
      })
      setOrderId(order.id)

      // Immediately request invoice
      const inv = await createInvoice(order.id)
      setInvoice({ payment_id: inv.payment_id, bolt11: inv.bolt11, amount_sats: inv.amount_sats })
      setBuyStep('invoice')
    },
    onError: (e: Error) => setPayError(e.message),
  })

  const payWebLN = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('No invoice')
      setBuyStep('paying')
      setPayError(null)

      const preimage = await payWithWebLN(invoice.bolt11)
      await confirmPayment(invoice.payment_id, preimage)

      qc.invalidateQueries({ queryKey: ['orders'] })
      setBuyStep('done')
    },
    onError: (e: Error) => {
      setPayError(e.message)
      setBuyStep('invoice')
    },
  })

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
                    ? 'Buy Now · Pay in Sats'
                    : 'Connect to Buy'}
            </button>
          )}

          {/* Step: quantity + location */}
          {buyStep === 'details' || buyStep === 'location' ? (
            <div className="card p-4 space-y-4">
              <h3 className="font-semibold text-gray-100">Place Order</h3>

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
                  {placeOrder.isPending ? 'Creating invoice…' : 'Get Invoice'}
                </button>
              </div>
            </div>
          ) : null}

          {/* Step: show invoice */}
          {buyStep === 'invoice' && invoice && (
            <div className="card p-4 space-y-4">
              <h3 className="font-semibold text-gray-100">Pay Invoice</h3>
              <p className="text-sm text-gray-400">
                Amount: <span className="text-white font-semibold">{formatSats(invoice.amount_sats)}</span>
              </p>

              <div className="flex justify-center p-4 bg-white rounded-xl">
                <QRCodeSVG value={invoice.bolt11.toUpperCase()} size={180} />
              </div>

              <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-2">
                <p className="text-[10px] text-gray-400 font-mono break-all flex-1">
                  {invoice.bolt11.slice(0, 40)}…
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(invoice.bolt11)}
                  className="text-xs text-brand-400 hover:text-brand-300 shrink-0"
                >
                  Copy
                </button>
              </div>

              {payError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  {payError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-gray-500 shrink-0" />
                <p className="text-xs text-gray-500">
                  Scan with any Lightning wallet, or pay from Fedi below.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setBuyStep(null); setOrderId(null); setInvoice(null); }}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancel
                </button>
                {window.webln && (
                  <button
                    onClick={() => payWebLN.mutate()}
                    disabled={payWebLN.isPending}
                    className="btn-primary flex-1 justify-center"
                  >
                    <Zap className="w-4 h-4" />
                    {payWebLN.isPending ? 'Paying…' : 'Pay with Fedi'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step: paying */}
          {buyStep === 'paying' && (
            <div className="card p-6 text-center space-y-3">
              <Zap className="w-8 h-8 text-brand-400 animate-pulse mx-auto" />
              <p className="text-sm text-gray-300">Processing payment…</p>
            </div>
          )}

          {/* Step: done */}
          {buyStep === 'done' && (
            <div className="card p-6 text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-mpesa mx-auto" />
              <p className="font-semibold text-gray-100">Payment confirmed!</p>
              <p className="text-sm text-gray-400">
                Sats sent directly to the seller's wallet. Track your delivery below.
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
