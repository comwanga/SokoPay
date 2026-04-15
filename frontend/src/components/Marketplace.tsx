import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, MapPin, Package, Globe, ChevronDown } from 'lucide-react'
import { listProducts, formatKes } from '../api/client.ts'
import { PRODUCT_CATEGORIES, CATEGORY_ICONS } from '../types'
import clsx from 'clsx'
import type { Product } from '../types'
import StarRating from './StarRating.tsx'

// ── Country list (ISO alpha-2 + display name) ─────────────────────────────────

const COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'GH', name: 'Ghana' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
  { code: 'SN', name: 'Senegal' },
  { code: 'CI', name: "Côte d'Ivoire" },
]

// ── Product card ──────────────────────────────────────────────────────────────

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
            {CATEGORY_ICONS[product.category] ?? '📦'} {product.category}
          </span>
        )}
        {product.is_global && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold bg-brand-500/80 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Globe className="w-2.5 h-2.5" /> Ships globally
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

// ── Country selector ──────────────────────────────────────────────────────────

function CountrySelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = COUNTRIES.find(c => c.code === value)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500 transition-colors"
      >
        <Globe className="w-3.5 h-3.5 text-gray-400" />
        {selected ? selected.name : 'All countries'}
        <ChevronDown className="w-3 h-3 text-gray-500 ml-0.5" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl min-w-[160px] py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => { onChange(''); setOpen(false) }}
            className={clsx(
              'w-full text-left px-3 py-2 text-xs transition-colors',
              !value ? 'text-brand-400 font-medium' : 'text-gray-300 hover:bg-gray-700',
            )}
          >
            All countries
          </button>
          {COUNTRIES.map(c => (
            <button
              key={c.code}
              onClick={() => { onChange(c.code); setOpen(false) }}
              className={clsx(
                'w-full text-left px-3 py-2 text-xs transition-colors',
                value === c.code ? 'text-brand-400 font-medium' : 'text-gray-300 hover:bg-gray-700',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main marketplace page ──────────────────────────────────────────────────────

export default function Marketplace() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState<string>('')
  const [country, setCountry] = useState<string>('')
  const [scope, setScope] = useState<'country' | 'global'>('global')

  // Debounce search so we don't fire on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])

  const { data: products = [], isLoading, isError } = useQuery({
    queryKey: ['products', category, country, scope, debouncedSearch],
    queryFn: () => listProducts({
      category: category || undefined,
      country: country || undefined,
      scope: country ? scope : undefined,
      q: debouncedSearch || undefined,
      per_page: 60,
      sort: 'newest',
    }),
    staleTime: 30_000,
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-100">Marketplace</h1>
        <p className="text-sm text-gray-400 mt-0.5">Buy and sell anything, pay with Lightning</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search products, sellers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-base pl-9"
          />
        </div>
        <CountrySelector value={country} onChange={c => { setCountry(c); setScope('country') }} />
      </div>

      {/* Scope toggle — only meaningful when a country is selected */}
      {country && (
        <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1 w-fit">
          <button
            onClick={() => setScope('country')}
            className={clsx(
              'px-4 py-1.5 rounded-lg text-xs font-medium transition-colors',
              scope === 'country' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
            )}
          >
            {COUNTRIES.find(c => c.code === country)?.name ?? 'Local'}
          </button>
          <button
            onClick={() => setScope('global')}
            className={clsx(
              'flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors',
              scope === 'global' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
            )}
          >
            <Globe className="w-3 h-3" />
            + Ships here
          </button>
        </div>
      )}

      {/* Category icon grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-11 gap-2">
        <button
          onClick={() => setCategory('')}
          className={clsx(
            'flex flex-col items-center gap-1 p-2 rounded-xl text-[10px] font-medium border transition-all',
            !category
              ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
              : 'bg-gray-800/60 text-gray-400 border-gray-700/60 hover:border-gray-500',
          )}
        >
          <span className="text-xl">🏪</span>
          <span>All</span>
        </button>
        {PRODUCT_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat === category ? '' : cat)}
            className={clsx(
              'flex flex-col items-center gap-1 p-2 rounded-xl text-[10px] font-medium border transition-all',
              category === cat
                ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                : 'bg-gray-800/60 text-gray-400 border-gray-700/60 hover:border-gray-500',
            )}
          >
            <span className="text-xl">{CATEGORY_ICONS[cat]}</span>
            <span className="leading-tight text-center line-clamp-2">{cat.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Results count */}
      {!isLoading && !isError && (
        <p className="text-xs text-gray-600">
          {products.length} listing{products.length !== 1 ? 's' : ''}
          {category ? ` in ${category}` : ''}
          {country ? ` · ${COUNTRIES.find(c => c.code === country)?.name}` : ''}
          {debouncedSearch ? ` matching "${debouncedSearch}"` : ''}
        </p>
      )}

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
          <p>Failed to load listings. Please refresh.</p>
        </div>
      )}

      {!isLoading && !isError && products.length === 0 && (
        <div className="text-center py-20 space-y-2">
          <Package className="w-12 h-12 text-gray-700 mx-auto" />
          <p className="text-gray-400 font-medium">No listings found</p>
          <p className="text-sm text-gray-600">
            {debouncedSearch ? 'Try a different search term' : 'Be the first to list something!'}
          </p>
        </div>
      )}

      {!isLoading && !isError && products.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
