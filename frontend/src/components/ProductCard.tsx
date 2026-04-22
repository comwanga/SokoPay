import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Globe, ShieldCheck, BadgeCheck, MapPin, Check, ShoppingCart, Star, Zap, Heart } from 'lucide-react'
import { formatKes, getRate } from '../api/client.ts'
import { CATEGORY_ICONS } from '../types'
import { useTranslation } from '../i18n/index.tsx'
import { useCart } from '../context/cart.tsx'
import { useWishlist } from '../context/wishlist.tsx'
import { useToast } from '../context/toast.tsx'
import clsx from 'clsx'
import type { Product } from '../types'

// Deterministic color per seller so the avatar is consistent across sessions
const AVATAR_COLORS = [
  'bg-brand-500', 'bg-green-600', 'bg-blue-600',
  'bg-purple-600', 'bg-orange-600', 'bg-rose-600', 'bg-cyan-600',
]
function sellerAvatarColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function sellerInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatSatsShort(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}k`
  return String(sats)
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export default function ProductCard({ product }: { product: Product }) {
  const navigate              = useNavigate()
  const { t }                 = useTranslation()
  const { addItem, items }    = useCart()
  const { has, toggle }       = useWishlist()
  const { toast }             = useToast()
  const [added, setAdded]     = useState(false)
  const wishlisted            = has(product.id)

  // Rate is fetched once and shared across all cards via React Query deduplication
  const { data: rate } = useQuery({
    queryKey: ['rate', 'KES'],
    queryFn: () => getRate('KES'),
    staleTime: 60_000,
  })

  const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]
  const qty          = parseFloat(product.quantity_avail)
  const inCart       = items.some(i => i.product.id === product.id)
  const isLowStock   = qty <= 10 && qty > 0
  const isNew        = Date.now() - new Date(product.created_at).getTime() < SEVEN_DAYS

  // Sat equivalent — only shown when rate is available
  const priceKes = parseFloat(product.price_kes)
  const sats = rate && rate.btc_local
    ? Math.ceil((priceKes / parseFloat(rate.btc_local)) * 1e8)
    : null

  function handleAddToCart(e: React.MouseEvent) {
    e.stopPropagation()
    addItem(product, 1)
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  function handleWishlist(e: React.MouseEvent) {
    e.stopPropagation()
    const added = toggle(product.id)
    toast(
      added ? `Saved to wishlist` : `Removed from wishlist`,
      added ? 'success' : 'info',
      2500,
    )
  }

  return (
    <article
      onClick={() => navigate(`/products/${product.id}`)}
      aria-label={`${product.title}, ${formatKes(product.price_kes)} per ${product.unit}`}
      className="group cursor-pointer bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 hover:shadow-xl hover:shadow-black/30 transition-all duration-200 flex flex-col"
    >
      {/* Product image — 4:3 aspect for more visual impact */}
      <div className="aspect-[4/3] bg-gray-800 relative overflow-hidden">
        {primaryImage ? (
          <img
            src={primaryImage.url}
            alt={product.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <span className="text-4xl">{CATEGORY_ICONS[product.category] ?? '📦'}</span>
            <span className="text-[11px] text-gray-600 font-medium px-3 text-center line-clamp-2">
              {product.title}
            </span>
          </div>
        )}

        {/* Category badge — top left */}
        {product.category && (
          <span className="absolute top-2 left-2 text-[10px] font-semibold bg-gray-900/85 text-gray-300 px-2 py-0.5 rounded-full backdrop-blur-sm">
            {CATEGORY_ICONS[product.category] ?? '📦'} {product.category.split(' ')[0]}
          </span>
        )}

        {/* Status badges — top right, stacked */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {/* Wishlist heart */}
          <button
            onClick={handleWishlist}
            aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
            className={clsx(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all backdrop-blur-sm',
              wishlisted
                ? 'bg-red-500/90 text-white'
                : 'bg-gray-900/80 text-gray-400 hover:text-red-400 hover:bg-gray-800/90',
            )}
          >
            <Heart className={clsx('w-3.5 h-3.5', wishlisted && 'fill-current')} />
          </button>
          {product.escrow_mode && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-green-900/90 text-green-300 px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              <ShieldCheck className="w-2.5 h-2.5" /> Escrow
            </span>
          )}
          {!product.escrow_mode && product.is_global && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-brand-500/85 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              <Globe className="w-2.5 h-2.5" /> Global
            </span>
          )}
          {isNew && (
            <span className="text-[10px] font-semibold bg-bitcoin/85 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              New
            </span>
          )}
        </div>

        {/* Low stock bar */}
        {isLowStock && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-gray-900/90 to-transparent px-2 pb-1.5 pt-4">
            <p className="text-[10px] font-semibold text-yellow-400">
              {t('market.only_x_left', { qty, unit: product.unit })}
            </p>
          </div>
        )}
      </div>

      {/* Product info */}
      <div className="flex flex-col gap-1.5 p-3 flex-1">
        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-200 line-clamp-2 leading-snug group-hover:text-white transition-colors">
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

        {/* Price — KES bold + sat equivalent */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-base font-bold text-gray-100">
            {formatKes(product.price_kes)}
          </span>
          <span className="text-xs text-gray-500">/{product.unit}</span>
          {sats !== null && (
            <span className="flex items-center gap-0.5 text-[11px] text-bitcoin/80 font-medium">
              <Zap className="w-2.5 h-2.5" />
              {formatSatsShort(sats)} sats
            </span>
          )}
        </div>

        {/* Seller avatar + name + location */}
        <div className="flex items-center justify-between mt-auto pt-0.5">
          <button
            onClick={e => { e.stopPropagation(); navigate(`/sellers/${product.seller_id}`) }}
            className="flex items-center gap-1.5 min-w-0 hover:opacity-80 transition-opacity"
          >
            {/* Seller initials avatar */}
            <span className={clsx(
              'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0',
              sellerAvatarColor(product.seller_name),
            )}>
              {sellerInitials(product.seller_name)}
            </span>
            <span className="text-xs text-gray-400 truncate max-w-[80px] font-medium">
              {product.seller_name}
            </span>
            {product.seller_verified && (
              <BadgeCheck className="w-3.5 h-3.5 text-brand-400 shrink-0" />
            )}
          </button>

          {product.location_name && (
            <span className="flex items-center gap-0.5 text-[10px] text-gray-600 shrink-0">
              <MapPin className="w-3 h-3" />
              {product.location_name.split(',')[0]}
            </span>
          )}
        </div>

        {/* Add to cart CTA */}
        <button
          onClick={handleAddToCart}
          className={clsx(
            'mt-1.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all',
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
    </article>
  )
}
