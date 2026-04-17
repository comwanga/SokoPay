import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Star, MapPin, ShoppingBag, CheckCircle, ArrowLeft, Package, Loader2,
} from 'lucide-react'
import { getStorefront, formatKes } from '../api/client.ts'
import type { StorefrontProduct } from '../api/client.ts'
import clsx from 'clsx'

// ── Star rating display ───────────────────────────────────────────────────────

function Stars({ rating, count }: { rating: number; count: number }) {
  if (count === 0) return <span className="text-xs text-gray-600">No reviews yet</span>
  return (
    <span className="flex items-center gap-1 text-xs">
      <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
      <span className="font-semibold text-gray-200">{rating.toFixed(1)}</span>
      <span className="text-gray-500">({count})</span>
    </span>
  )
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: StorefrontProduct }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/products/${product.id}`)}
      className="card overflow-hidden text-left hover:border-gray-600 transition-colors group"
    >
      {product.primary_image_url ? (
        <img
          src={product.primary_image_url}
          alt={product.title}
          className="w-full aspect-square object-cover group-hover:scale-105 transition-transform duration-300"
        />
      ) : (
        <div className="w-full aspect-square bg-gray-800 flex items-center justify-center">
          <Package className="w-8 h-8 text-gray-600" />
        </div>
      )}
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-gray-100 line-clamp-2 leading-snug">
          {product.title}
        </p>
        <p className="text-xs font-bold text-brand-400">{formatKes(product.price_kes)}</p>
        <p className="text-[11px] text-gray-500">{product.unit}</p>
        {product.rating_count > 0 && (
          <Stars rating={product.avg_rating ?? 0} count={product.rating_count} />
        )}
      </div>
    </button>
  )
}

// ── Main storefront ───────────────────────────────────────────────────────────

export default function SellerStorefront() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['storefront', id],
    queryFn: () => getStorefront(id!),
    enabled: !!id,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-red-400 text-sm">Seller not found.</p>
        <button onClick={() => navigate(-1)} className="btn-secondary text-sm">
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    )
  }

  const { seller, products, rating_summary } = data

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Seller header */}
      <div className="card p-5 space-y-3">
        <div className="flex items-start gap-4">
          {/* Avatar placeholder */}
          <div className="w-14 h-14 rounded-2xl bg-gray-700 flex items-center justify-center shrink-0 text-xl font-bold text-gray-300">
            {seller.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-100">{seller.name}</h1>
            {seller.location_name && (
              <p className="flex items-center gap-1 text-sm text-gray-400 mt-0.5">
                <MapPin className="w-3.5 h-3.5" />
                {seller.location_name}
              </p>
            )}
            <div className="flex items-center gap-4 mt-2">
              <Stars rating={rating_summary.avg_rating} count={rating_summary.rating_count} />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-800">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-100">{seller.product_count}</p>
            <p className="text-[11px] text-gray-500 flex items-center justify-center gap-1">
              <ShoppingBag className="w-3 h-3" /> Active listings
            </p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-gray-100">{seller.confirmed_order_count}</p>
            <p className="text-[11px] text-gray-500 flex items-center justify-center gap-1">
              <CheckCircle className="w-3 h-3" /> Completed orders
            </p>
          </div>
          <div className="text-center col-span-2 sm:col-span-1">
            <p className="text-lg font-bold text-gray-100">
              {new Date(seller.member_since).getFullYear()}
            </p>
            <p className="text-[11px] text-gray-500">Member since</p>
          </div>
        </div>
      </div>

      {/* Products */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Listings ({products.length})
        </h2>
        {products.length === 0 ? (
          <div className="card p-8 text-center">
            <Package className="w-10 h-10 text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No active listings</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {products.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* Recent reviews */}
      {rating_summary.rating_count > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Reviews ({rating_summary.rating_count})
          </h2>
          <div className="space-y-2">
            {rating_summary.recent_reviews.map((r, i) => (
              <div key={i} className="card p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-300">{r.buyer_name}</span>
                  <span className={clsx(
                    'flex items-center gap-0.5 text-xs font-bold',
                    r.rating >= 4 ? 'text-yellow-400' : r.rating >= 3 ? 'text-gray-400' : 'text-red-400',
                  )}>
                    <Star className={clsx('w-3 h-3', r.rating >= 4 && 'fill-yellow-400')} />
                    {r.rating}
                  </span>
                </div>
                {r.review && (
                  <p className="text-xs text-gray-400 leading-relaxed">{r.review}</p>
                )}
                <p className="text-[10px] text-gray-600">
                  {new Date(r.created_at).toLocaleDateString('en-KE')}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
