import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart, Trash2, Plus, Minus, ArrowLeft, ArrowRight,
  Package, Zap, Smartphone, ShieldCheck, ShoppingBag,
} from 'lucide-react'
import { formatKes } from '../api/client.ts'
import { useCart } from '../context/cart.tsx'
import clsx from 'clsx'

// ── Cart page ──────────────────────────────────────────────────────────────────

export default function CartPage() {
  const navigate = useNavigate()
  const { items, totalKes, setQuantity, removeItem } = useCart()

  if (items.length === 0) {
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
          <ShoppingBag className="w-4 h-4" />
          Shop today's deals
        </button>
      </div>
    )
  }

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/browse')}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-100">Shopping Cart</h1>
          <p className="text-xs text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Cart items list ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          {items.map(({ product, quantity }) => {
            const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]
            const lineTotal = parseFloat(product.price_kes) * quantity
            const maxQty = parseFloat(product.quantity_avail)

            return (
              <div
                key={product.id}
                className="flex gap-4 bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors"
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
                    Sold by <button
                      onClick={() => navigate(`/sellers/${product.seller_id}`)}
                      className="text-brand-400 hover:underline"
                    >{product.seller_name}</button>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatKes(product.price_kes)}/{product.unit}
                    {product.escrow_mode && (
                      <span className="ml-2 inline-flex items-center gap-1 text-green-400">
                        <ShieldCheck className="w-3 h-3" /> Escrow
                      </span>
                    )}
                  </p>

                  {/* Qty + remove */}
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setQuantity(product.id, quantity - 1)}
                        className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-3 text-sm font-semibold text-gray-200 min-w-[2ch] text-center">
                        {quantity}
                      </span>
                      <button
                        onClick={() => quantity < maxQty && setQuantity(product.id, quantity + 1)}
                        disabled={quantity >= maxQty}
                        className={clsx(
                          'p-1.5 transition-colors',
                          quantity >= maxQty
                            ? 'text-gray-700 cursor-not-allowed'
                            : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700',
                        )}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => removeItem(product.id)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                </div>

                {/* Line total */}
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-gray-100">
                    KES {lineTotal.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )
          })}

          {/* Continue shopping */}
          <button
            onClick={() => navigate('/browse')}
            className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Continue Shopping
          </button>
        </div>

        {/* ── Order summary panel ──────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sticky top-20">
            <h2 className="text-base font-bold text-gray-100 mb-4">Order Summary</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Items ({itemCount})</span>
                <span>KES {totalKes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Delivery</span>
                <span className="text-green-400">Negotiated with seller</span>
              </div>
              <div className="h-px bg-gray-800 my-3" />
              <div className="flex justify-between font-bold text-gray-100 text-base">
                <span>Total</span>
                <span>KES {totalKes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Checkout CTA */}
            <button
              onClick={() => navigate('/browse')}
              className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-sm transition-colors shadow-sm hover:shadow-brand-500/30 hover:shadow-md"
            >
              Proceed to Checkout
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-[11px] text-gray-600 text-center mt-3">
              Complete payment on each product's page
            </p>

            {/* Payment method badges */}
            <div className="mt-4 pt-4 border-t border-gray-800">
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
