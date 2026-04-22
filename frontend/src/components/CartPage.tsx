import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart, Trash2, Plus, Minus, ArrowLeft,
  Package, Zap, Smartphone, ShieldCheck, ShoppingBag,
  MapPin, Loader2, CheckCircle2, AlertCircle, Tag, X,
} from 'lucide-react'
import { formatKes } from '../api/client.ts'
import { useCart } from '../context/cart.tsx'
import { useCheckout } from '../hooks/useCheckout.ts'
import { validatePromoCode, applyDiscount } from '../hooks/usePromoCode.ts'
import type { PromoCode } from '../hooks/usePromoCode.ts'
import clsx from 'clsx'

export default function CartPage() {
  const navigate = useNavigate()
  const { items, totalKes, setQuantity, removeItem } = useCart()
  const {
    locationName, setLocationName, locating, coords,
    results, checking, allDone, inFlight, hasErrors,
    handleGps, handleCheckout,
  } = useCheckout()

  const [promoInput, setPromoInput] = useState('')
  const [appliedPromo, setAppliedPromo] = useState<PromoCode | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)

  function handleApplyPromo() {
    const result = validatePromoCode(promoInput)
    if (result.valid && result.promo) {
      setAppliedPromo(result.promo)
      setPromoError(null)
    } else {
      setPromoError('Invalid or expired promo code')
    }
  }

  const { discounted, saving } = appliedPromo
    ? applyDiscount(totalKes, appliedPromo)
    : { discounted: totalKes, saving: 0 }

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)

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

  if (allDone) {
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

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-6 space-y-6">

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

        <div className="lg:col-span-2 space-y-3">
          {items.map(({ product, quantity }) => {
            const result       = results.find(r => r.productId === product.id)
            const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]
            const lineTotal    = parseFloat(product.price_kes) * quantity
            const maxQty       = parseFloat(product.quantity_avail)

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

                  {!inFlight && !result && (
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

        <div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sticky top-20 space-y-4">
            <h2 className="text-base font-bold text-gray-100">Order Summary</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Items ({itemCount})</span>
                <span>KES {totalKes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</span>
              </div>
              {saving > 0 && (
                <div className="flex justify-between text-green-400">
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {appliedPromo!.code} ({appliedPromo!.type === 'percent' ? `${appliedPromo!.value}% off` : `KES ${appliedPromo!.value} off`})
                  </span>
                  <span>- KES {saving.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-400">
                <span>Delivery</span>
                <span className="text-green-400">Negotiated with seller</span>
              </div>
              <div className="h-px bg-gray-800" />
              <div className="flex justify-between font-bold text-gray-100 text-base">
                <span>Total</span>
                <div className="text-right">
                  {saving > 0 && (
                    <p className="text-xs text-gray-500 line-through font-normal">
                      KES {totalKes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
                    </p>
                  )}
                  <span className={saving > 0 ? 'text-green-400' : ''}>
                    KES {discounted.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Promo code */}
            {!inFlight && (
              <div className="space-y-2">
                {appliedPromo ? (
                  <div className="flex items-center justify-between bg-green-900/20 border border-green-700/30 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-green-400" />
                      <div>
                        <p className="text-xs font-bold text-green-300">{appliedPromo.code}</p>
                        {appliedPromo.description && <p className="text-[10px] text-green-500">{appliedPromo.description}</p>}
                      </div>
                    </div>
                    <button onClick={() => { setAppliedPromo(null); setPromoInput('') }} className="text-green-600 hover:text-green-300 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                        <input
                          type="text"
                          value={promoInput}
                          onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null) }}
                          placeholder="Promo code"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 outline-none font-mono uppercase"
                          maxLength={12}
                        />
                      </div>
                      <button
                        onClick={handleApplyPromo}
                        disabled={!promoInput.trim()}
                        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 text-xs font-semibold rounded-lg transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                    {promoError && (
                      <p className="text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {promoError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {!inFlight && (
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

            <button
              onClick={handleCheckout}
              disabled={checking}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:opacity-60 text-white font-semibold text-sm transition-colors"
            >
              {checking && <Loader2 className="w-4 h-4 animate-spin" />}
              {checking  ? 'Placing orders…' :
               hasErrors ? 'Retry failed items' :
               `Place ${items.length} order${items.length !== 1 ? 's' : ''}`}
            </button>

            <p className="text-[11px] text-gray-600 text-center">
              Each item creates a separate order. Pay via Lightning or M-Pesa on the Orders page.
            </p>

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
