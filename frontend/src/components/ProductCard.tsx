import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Globe, ShieldCheck, BadgeCheck, MapPin, Check, ShoppingCart, Star } from 'lucide-react'
import { formatKes } from '../api/client.ts'
import { CATEGORY_ICONS } from '../types'
import { useTranslation } from '../i18n/index.tsx'
import { useCart } from '../context/cart.tsx'
import clsx from 'clsx'
import type { Product } from '../types'

export default function ProductCard({ product }: { product: Product }) {
  const navigate          = useNavigate()
  const { t }             = useTranslation()
  const { addItem, items } = useCart()
  const [added, setAdded]  = useState(false)

  const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]
  const qty          = parseFloat(product.quantity_avail)
  const inCart       = items.some(i => i.product.id === product.id)
  const price        = parseFloat(product.price_kes)
  const isLowStock   = qty <= 10 && qty > 0

  function handleAddToCart(e: React.MouseEvent) {
    e.stopPropagation()
    addItem(product, 1)
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <div
      onClick={() => navigate(`/products/${product.id}`)}
      className="group cursor-pointer bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 hover:shadow-xl hover:shadow-black/30 transition-all duration-200 flex flex-col"
    >
      {/* Product image — square aspect */}
      <div className="aspect-square bg-gray-800 relative overflow-hidden">
        {primaryImage ? (
          <img
            src={primaryImage.url}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-12 h-12 text-gray-700" />
          </div>
        )}

        {/* Category badge */}
        {product.category && (
          <span className="absolute top-2 left-2 text-[10px] font-semibold bg-gray-900/85 text-gray-300 px-2 py-0.5 rounded-full backdrop-blur-sm">
            {CATEGORY_ICONS[product.category] ?? '📦'} {product.category.split(' ')[0]}
          </span>
        )}

        {/* Trust badges top-right */}
        {product.escrow_mode && (
          <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-semibold bg-green-900/90 text-green-300 px-1.5 py-0.5 rounded-full backdrop-blur-sm">
            <ShieldCheck className="w-2.5 h-2.5" /> Escrow
          </span>
        )}
        {!product.escrow_mode && product.is_global && (
          <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-semibold bg-brand-500/85 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
            <Globe className="w-2.5 h-2.5" /> {t('market.ships_globally')}
          </span>
        )}

        {/* Low stock overlay */}
        {isLowStock && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-gray-900/90 to-transparent px-2 pb-1.5 pt-4">
            <p className="text-[10px] font-semibold text-yellow-400">
              {t('market.only_x_left', { qty, unit: product.unit })}
            </p>
          </div>
        )}
      </div>

      {/* Product info */}
      <div className="flex flex-col gap-2 p-3 flex-1">
        {/* Title */}
        <h3 className="text-sm font-medium text-gray-200 line-clamp-2 leading-snug group-hover:text-gray-100 transition-colors">
          {product.title}
        </h3>

        {/* Rating */}
        {(product.rating_count ?? 0) > 0 && (
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={clsx(
                  'w-3 h-3',
                  i < Math.floor(product.avg_rating ?? 0)
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-gray-700',
                )}
              />
            ))}
            <span className="text-[11px] text-gray-500 ml-0.5">({product.rating_count})</span>
          </div>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1">
          <span className="text-base font-bold text-gray-100">
            {formatKes(product.price_kes)}
          </span>
          <span className="text-xs text-gray-500">/{product.unit}</span>
        </div>

        {/* Seller + location */}
        <div className="flex items-center justify-between text-xs text-gray-500 mt-auto">
          <button
            onClick={e => { e.stopPropagation(); navigate(`/sellers/${product.seller_id}`) }}
            className="flex items-center gap-1 hover:text-brand-400 transition-colors truncate max-w-[60%]"
          >
            <span className="truncate font-medium text-gray-400 hover:text-brand-400">{product.seller_name}</span>
            {product.seller_verified && (
              <BadgeCheck className="w-3.5 h-3.5 text-brand-400 shrink-0" />
            )}
          </button>
          {product.location_name && (
            <span className="flex items-center gap-0.5 shrink-0">
              <MapPin className="w-3 h-3" />
              {product.location_name}
            </span>
          )}
        </div>

        {/* Add to cart CTA */}
        <button
          onClick={handleAddToCart}
          className={clsx(
            'mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all',
            added || inCart
              ? 'bg-brand-500/20 text-brand-400 border border-brand-500/40'
              : 'bg-brand-500 hover:bg-brand-400 text-white shadow-sm hover:shadow-brand-500/30 hover:shadow-md',
          )}
        >
          {added ? (
            <><Check className="w-4 h-4" /> Added</>
          ) : inCart ? (
            <><ShoppingCart className="w-4 h-4" /> In cart</>
          ) : (
            <><ShoppingCart className="w-4 h-4" /> Add to cart</>
          )}
        </button>
      </div>
    </div>
  )
}
