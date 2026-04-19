import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart, Trash2, Plus, Minus, ArrowLeft,
  Package, Zap, Smartphone, ShieldCheck, ShoppingBag,
  MapPin, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { formatKes, createOrder } from '../api/client.ts'
import { useCart } from '../context/cart.tsx'
import { useAuth } from '../context/auth.tsx'
import clsx from 'clsx'

type ItemStatus = 'idle' | 'pending' | 'done' | 'error'
interface OrderResult { productId: string; status: ItemStatus; error?: string }

export default function CartPage() {
  const navigate = useNavigate()
  const { authed, connect } = useAuth()
  const { items, totalKes, setQuantity, removeItem } = useCart()

  const [locationName, setLocationName] = useState('')
  const [locating,     setLocating]     = useState(false)
  const [coords,       setCoords]       = useState<{ lat: number; lng: number } | null>(null)
  const [results,      setResults]      = useState<OrderResult[]>([])
  const [checking,     setChecking]     = useState(false)
  const [allDone,      setAllDone]      = useState(false)

  async function handleGps() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false) },
      ()  => setLocating(false),
    )
  }

  async function handleCheckout() {
    if (!authed) { connect(); return }
    if (items.length === 0) return

    const initial: OrderResult[] = items.map(i => ({ productId: i.product.id, status: 'pending' }))
    setResults(initial)
    setChecking(true)
    setAllDone(false)

    const updated = [...initial]
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]
      try {
        await createOrder({
          product_id: item.product.id,
          quantity: String(item.quantity),
          buyer_lat:  coords?.lat,
          buyer_lng:  coords?.lng,
          buyer_location_name: locationName.trim() || undefined,
        })
        updated[idx] = { ...updated[idx], status: 'done' }
      } catch (e) {
        updated[idx] = { ...updated[idx], status: 'error', error: e instanceof Error ? e.message : 'Failed' }
      }
      setResults([...updated])
    }

    setChecking(false)
    const anyDone = updated.some(r => r.status === 'done')
    if (anyDone) {
      setAllDone(true)
      updated.filter(r => r.status === 'done').forEach(r => removeItem(r.productId))
    }
  }

  const isOrdering  = checking || results.length > 0
  const itemCount   = items.reduce((s, i) => s + i.quantity, 0)
  const hasErrors   = results.some(r => r.status === 'error')

  // ── Empty cart ──────────────────────────────────────────────────────────────

  if (items.length === 0 && !allDone) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 gap-5">
        <div className="w-20 h-20 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
          <ShoppingCart className="w-9 h-9 text-gray-500" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-100">Your cart is empty</h2>
          <p className="text-sm text-gray-500 mt-1">Nothing in here. Only possibilities.</p>
        </div>
        <button
          onClick={() => navigate('/browse')}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-sm transition-colors"
        >
          <ShoppingBag className="w-4 h-4" /> Shop today's deals
        </button>
      </div>
    )
  }

  // ── All orders placed successfully ─────────────────────────────────────────

  if (allDone && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 gap-5">
        <CheckCircle2 className="w-16 h-16 text-green-400" />
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-100">Orders placed!</h2>
          <p className="text-sm text-gray-400 mt-1">Pay via Lightning or M-Pesa in My Orders.</p>
        </div>
        <button
          onClick={() => navigate('/orders')}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-sm transition-colors"
        >
          View My Orders
        </button>
      </div>
    )
  }

  // ── Main cart page ─────────────────────────────────────────────────────────

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/browse')} className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-100">Shopping Cart</h1>
          <p className="text-xs text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Items list ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          {items.map(({ product, quantity }) => {
            const result      = results.find(r => r.productId === product.id)
            const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]
            const lineTotal   = parseFloat(product.price_kes) * quantity
            const maxQty      = parseFloat(product.quantity_avail)

            return (
              <div
                key={product.id}
                className={clsx(
                  'flex gap-4 rounded-2xl border p-4 transition-colors',
                  result?.status === 'done'    ? 'border-green-700/40 bg-green-900/10' :
                  result?.status === 'error'   ? 'border-red-700/40 bg-red-900/10' :
                  result?.status === 'pending' ? 'border-brand-700/40 bg-brand-900/10' :
                  'bg-gray-900 border-gray-800 hover:border-gray-700',
                )}
              >
                {/* Image */}
                <button
                  onClick={() => navigate(`/products/${product.id}`)}
                  className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-gray-800"
                >
                  {primaryImage ? (
                    <img src={primaryImage.url} alt={product.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-8 h-8 text-gray-600" />
                    </div>
                  )}
                </button>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => navigate(`/products/${product.id}`)}
                    className="text-sm font-medium text-gray-200 hover:text-brand-400 transition-colors line-clamp-2 text-left"
                  >
                    {product.title}
                  </button>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Sold by{' '}
                    <button onClick={() => navigate(`/sellers/${product.seller_id}`)} className="text-brand-400 hover:underline">
                      {product.seller_name}
                    </button>
                    {product.escrow_mode && (
                      <span className="ml-2 inline-flex items-center gap-1 text-green-400">
                        <ShieldCheck className="w-3 h-3" /> Escrow
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatKes(product.price_kes)}/{product.unit}</p>

                  {/* Qty stepper — hidden while ordering */}
                  {!result && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                        <button onClick={() => setQuantity(product.id, quantity - 1)} className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-3 text-sm font-semibold text-gray-200 min-w-[2ch] text-center">{quantity}</span>
                        <button
                          onClick={() => quantity < maxQty && setQuantity(product.id, quantity + 1)}
                          disabled={quantity >= maxQty}
                          className={clsx('p-1.5 transition-colors', quantity >= maxQty ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700')}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button onClick={() => removeItem(product.id)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  )}

                  {result?.status === 'error' && result.error && (
                    <p className="text-xs text-red-400 mt-1">{result.error}</p>
                  )}
                </div>

                {/* Line total + status */}
                <div className="shrink-0 text-right flex flex-col items-end gap-2">
                  <p className="text-base font-bold text-gray-100">
                    KES {lineTotal.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
                  </p>
                  {result?.status === 'done'    && <CheckCircle2 className="w-5 h-5 text-green-400" />}
                  {result?.status === 'error'   && <AlertCircle  className="w-5 h-5 text-red-400" />}
                  {result?.status === 'pending' && <Loader2      className="w-5 h-5 text-brand-400 animate-spin" />}
                </div>
              </div>
            )
          })}

          <button onClick={() => navigate('/browse')} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 font-medium transition-colors">
            <ArrowLeft className="w-4 h-4" /> Continue Shopping
          </button>
        </div>

        {/* ── Order summary ────────────────────────────────────────────────── */}
        <div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sticky top-20 space-y-4">
            <h2 className="text-base font-bold text-gray-100">Order Summary</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Items ({itemCount})</span>
                <span>KES {totalKes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Delivery</span>
                <span className="text-green-400">Negotiated with seller</span>
              </div>
              <div className="h-px bg-gray-800" />
              <div className="flex justify-between font-bold text-gray-100 text-base">
                <span>Total</span>
                <span>KES {totalKes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Delivery location */}
            {!isOrdering && (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-400 font-medium">
                  Delivery location <span className="text-gray-600">(optional)</span>
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                    <input
                      type="text"
                      value={locationName}
                      onChange={e => setLocationName(e.target.value)}
                      placeholder="e.g. Nairobi, Westlands"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                  <button
                    onClick={handleGps}
                    disabled={locating}
                    title="Use GPS"
                    className="px-2.5 py-2 bg-gray-800 border border-gray-700 hover:border-gray-500 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                  </button>
                </div>
                {coords && <p className="text-xs text-green-400">GPS location captured</p>}
              </div>
            )}

            {/* Place orders CTA */}
            <button
              onClick={handleCheckout}
              disabled={checking}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:opacity-60 text-white font-semibold text-sm transition-colors"
            >
              {checking && <Loader2 className="w-4 h-4 animate-spin" />}
              {!authed   ? 'Connect to checkout' :
               checking  ? 'Placing orders…' :
               hasErrors ? 'Retry failed items' :
               `Place ${items.length} order${items.length !== 1 ? 's' : ''}`}
            </button>

            <p className="text-[11px] text-gray-600 text-center">
              Each item creates a separate order. Pay via Lightning or M-Pesa on the Orders page.
            </p>

            {/* Payment badges */}
            <div className="pt-2 border-t border-gray-800">
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">We accept</p>
              <div className="flex gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-[11px] font-medium text-bitcoin bg-bitcoin/10 border border-bitcoin/20 px-2 py-1 rounded-lg">
                  <Zap className="w-3 h-3" /> Lightning
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-mpesa bg-mpesa/10 border border-mpesa/20 px-2 py-1 rounded-lg">
                  <Smartphone className="w-3 h-3" /> M-Pesa
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-green-400 bg-green-900/20 border border-green-700/30 px-2 py-1 rounded-lg">
                  <ShieldCheck className="w-3 h-3" /> Escrow
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
