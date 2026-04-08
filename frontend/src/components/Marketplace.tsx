import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, MapPin, Package } from 'lucide-react'
import { listProducts, formatKes } from '../api/client.ts'
import { PRODUCT_CATEGORIES } from '../types'
import clsx from 'clsx'
import type { Product } from '../types'
import StarRating from './StarRating.tsx'

function ProductCard({ product }: { product: Product }) {
  const navigate = useNavigate()
  const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]
  const qty = parseFloat(product.quantity_avail)

  return (
    <button
      onClick={() => navigate(`/products/${product.id}`)}
      className="card text-left hover:border-brand-500/40 transition-all hover:shadow-lg hover:shadow-brand-500/5 flex flex-col overflow-hidden"
    >
      {/* Image */}
      <div className="aspect-video bg-gray-800 relative overflow-hidden">
        {primaryImage ? (
          <img
            src={primaryImage.url}
            alt={product.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-gray-600" />
          </div>
        )}
        {product.category && (
          <span className="absolute top-2 left-2 text-[10px] font-semibold bg-gray-900/80 text-gray-300 px-2 py-0.5 rounded-full">
            {product.category}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <h3 className="text-sm font-semibold text-gray-100 line-clamp-2 leading-snug">
          {product.title}
        </h3>

        <div className="flex items-baseline gap-1">
          <span className="text-base font-bold text-brand-400">
            {formatKes(product.price_kes)}
          </span>
          <span className="text-xs text-gray-500">/{product.unit}</span>
        </div>

        {(product.rating_count ?? 0) > 0 && (
          <div className="flex items-center gap-1">
            <StarRating rating={product.avg_rating ?? 0} size="sm" />
            <span className="text-[11px] text-gray-500">({product.rating_count})</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-gray-500 mt-auto pt-2">
          <span className="font-medium text-gray-400">{product.seller_name}</span>
          {product.location_name && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {product.location_name}
            </span>
          )}
        </div>

        {qty <= 10 && qty > 0 && (
          <p className="text-[11px] text-yellow-400">
            Only {qty} {product.unit} left
          </p>
        )}
      </div>
    </button>
  )
}

export default function Marketplace() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('')

  const { data: products = [], isLoading, isError } = useQuery({
    queryKey: ['products', category],
    queryFn: () => listProducts({ category: category || undefined, per_page: 60 }),
    staleTime: 30_000,
  })

  const filtered = search.trim()
    ? products.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.seller_name.toLowerCase().includes(search.toLowerCase()) ||
        p.location_name.toLowerCase().includes(search.toLowerCase()),
      )
    : products

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-100">Marketplace</h1>
        <p className="text-sm text-gray-400 mt-0.5">Browse products and pay directly in sats</p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search products, sellers, locations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-base pl-9"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCategory('')}
            className={clsx(
              'px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
              !category
                ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500',
            )}
          >
            All
          </button>
          {PRODUCT_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat === category ? '' : cat)}
              className={clsx(
                'px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                category === cat
                  ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="aspect-video skeleton" />
              <div className="p-4 space-y-2">
                <div className="skeleton h-4 w-3/4 rounded" />
                <div className="skeleton h-5 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="text-center py-12 text-gray-500">
          <p>Failed to load products. Please refresh.</p>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="text-center py-20 space-y-2">
          <Package className="w-12 h-12 text-gray-700 mx-auto" />
          <p className="text-gray-400 font-medium">No products found</p>
          <p className="text-sm text-gray-600">
            {search ? 'Try a different search term' : 'Be the first to list something!'}
          </p>
        </div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
