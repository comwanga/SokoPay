import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, ShoppingCart, Trash2, Plus, Minus, MapPin, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { useCart } from '../context/cart.tsx'
import { createOrder, formatKes } from '../api/client.ts'
import { useAuth } from '../context/auth.tsx'
import clsx from 'clsx'

// ── Per-item checkout status ──────────────────────────────────────────────────

type ItemStatus = 'idle' | 'pending' | 'done' | 'error'

interface OrderResult {
  productId: string
  status: ItemStatus
  error?: string
}

// ── Cart drawer ───────────────────────────────────────────────────────────────

interface CartDrawerProps {
  open: boolean
  onClose(): void
}

export default function CartDrawer({ open, onClose }: CartDrawerProps) {
  const navigate   = useNavigate()
  const { authed, connect } = useAuth()
  const { items, totalKes, removeItem, setQuantity, clear } = useCart()

  const [locationName, setLocationName] = useState('')
  const [locating,     setLocating]     = useState(false)
  const [coords,       setCoords]       = useState<{ lat: number; lng: number } | null>(null)
  const [results,      setResults]      = useState<OrderResult[]>([])
  const [checking,     setChecking]     = useState(false)
  const [allDone,      setAllDone]      = useState(false)

  function resetCheckout() {
    setResults([])
    setChecking(false)
    setAllDone(false)
  }

  async function handleGps() {
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

  async function handleCheckout() {
    if (!authed) { connect(); return }
    if (items.length === 0) return

    // Initialise per-item status
    const initial: OrderResult[] = items.map(i => ({
      productId: i.product.id,
      status: 'pending',
    }))
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
        updated[idx] = {
          ...updated[idx],
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed',
        }
      }
      setResults([...updated])
    }

    setChecking(false)
    const anyDone = updated.some(r => r.status === 'done')
    if (anyDone) {
      setAllDone(true)
      // Remove successfully ordered items from cart
      updated.filter(r => r.status === 'done').forEach(r => removeItem(r.productId))
    }
  }

  function handleViewOrders() {
    onClose()
    navigate('/orders')
    resetCheckout()
  }

  const isOrdering = checking || results.length > 0

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:block"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={clsx(
          'fixed top-0 right-0 h-full w-full sm:w-96 bg-gray-900 border-l border-gray-800 z-50',
          'flex flex-col transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-gray-100">Cart</h2>
            {items.length > 0 && (
              <span className="text-xs bg-brand-500/20 text-brand-400 rounded-full px-2 py-0.5 font-semibold">
                {items.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && !allDone ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16 px-6 text-center">
              <ShoppingCart className="w-10 h-10 text-gray-700" />
              <p className="text-gray-400 font-medium">Your cart is empty</p>
              <p className="text-sm text-gray-600">
                Browse the marketplace and add items to get started.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg transition-colors"
              >
                Browse products
              </button>
            </div>
          ) : allDone && items.length === 0 ? (
            /* All items ordered successfully */
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <p className="text-gray-100 font-semibold text-lg">Orders placed!</p>
              <p className="text-sm text-gray-400">
                Go to My Orders to complete payment for each item.
              </p>
              <button
                onClick={handleViewOrders}
                className="mt-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg transition-colors font-medium"
              >
                View My Orders
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {items.map(item => {
                const result = results.find(r => r.productId === item.product.id)
                const maxQty = parseFloat(item.product.quantity_avail)
                const lineTotal = parseFloat(item.product.price_kes) * item.quantity

                return (
                  <div
                    key={item.product.id}
                    className={clsx(
                      'rounded-xl border p-3 space-y-2 transition-colors',
                      result?.status === 'done'  ? 'border-green-700/40 bg-green-900/10' :
                      result?.status === 'error' ? 'border-red-700/40 bg-red-900/10' :
                      result?.status === 'pending' ? 'border-brand-700/40 bg-brand-900/10' :
                      'border-gray-700 bg-gray-800/50'
                    )}
                  >
                    <div className="flex gap-3 items-start">
                      {/* Thumbnail */}
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 shrink-0">
                        {item.product.images[0] ? (
                          <img
                            src={item.product.images.find(i => i.is_primary)?.url ?? item.product.images[0].url}
                            alt={item.product.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <ShoppingCart className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-100 line-clamp-2 leading-snug">
                          {item.product.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatKes(item.product.price_kes)} / {item.product.unit}
                        </p>
                        <p className="text-xs font-semibold text-brand-400 mt-0.5">
                          {formatKes(String(lineTotal))}
                        </p>
                      </div>

                      {/* Status icon or remove */}
                      {result?.status === 'done' ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                      ) : result?.status === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      ) : result?.status === 'pending' ? (
                        <Loader2 className="w-5 h-5 text-brand-400 shrink-0 mt-0.5 animate-spin" />
                      ) : (
                        <button
                          onClick={() => removeItem(item.product.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors shrink-0 mt-0.5 p-0.5"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Quantity stepper */}
                    {!result && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuantity(item.product.id, item.quantity - 1)}
                          className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm text-gray-200 w-8 text-center font-medium">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => setQuantity(item.product.id, item.quantity + 1)}
                          disabled={item.quantity >= maxQty}
                          className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <span className="text-xs text-gray-500 ml-1">{item.product.unit}</span>
                      </div>
                    )}

                    {/* Error message */}
                    {result?.status === 'error' && result.error && (
                      <p className="text-xs text-red-400">{result.error}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer — location + checkout */}
        {items.length > 0 && !allDone && (
          <div className="border-t border-gray-800 p-4 space-y-3 shrink-0">
            {/* Delivery location */}
            {!isOrdering && (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-400 font-medium">Delivery location <span className="text-gray-600">(optional)</span></p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                    <input
                      type="text"
                      value={locationName}
                      onChange={e => setLocationName(e.target.value)}
                      placeholder="e.g. Nairobi, Westlands"
                      className="w-full bg-gray-800 text-white rounded-lg pl-8 pr-3 py-2 text-sm border border-gray-700 focus:border-brand-500 outline-none"
                    />
                  </div>
                  <button
                    onClick={handleGps}
                    disabled={locating}
                    title="Use GPS"
                    className="px-2.5 py-2 bg-gray-800 border border-gray-700 hover:border-gray-500 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {locating
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <MapPin className="w-4 h-4" />}
                  </button>
                </div>
                {coords && (
                  <p className="text-xs text-green-400">GPS location captured</p>
                )}
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Total</span>
              <span className="text-base font-bold text-white">{formatKes(String(totalKes))}</span>
            </div>

            {/* Checkout button */}
            <button
              onClick={handleCheckout}
              disabled={checking}
              className="w-full py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {checking && <Loader2 className="w-4 h-4 animate-spin" />}
              {!authed ? 'Connect to checkout' :
               checking ? 'Placing orders…' :
               `Place ${items.length} order${items.length > 1 ? 's' : ''}`}
            </button>

            <p className="text-xs text-gray-600 text-center">
              Each item creates a separate order. Pay via Lightning or M-Pesa on the Orders page.
            </p>
          </div>
        )}

        {/* Footer when there are errors */}
        {!checking && results.some(r => r.status === 'error') && items.length > 0 && (
          <div className="border-t border-gray-800 p-4 shrink-0">
            <button
              onClick={handleCheckout}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Retry failed items
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
