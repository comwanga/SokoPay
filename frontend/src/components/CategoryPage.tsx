import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Package, Loader2 } from 'lucide-react'
import { listProducts } from '../api/client.ts'
import { CATEGORY_ICONS, PRODUCT_CATEGORIES } from '../types'
import ProductCard from './ProductCard.tsx'
import clsx from 'clsx'

// ── Category gradient map ─────────────────────────────────────────────────────

const CATEGORY_GRADIENTS: Record<string, string> = {
  'Food & Groceries':   'from-green-900/60 to-gray-900',
  'Electronics':        'from-blue-900/50 to-gray-900',
  'Fashion & Clothing': 'from-purple-900/50 to-gray-900',
  'Home & Living':      'from-orange-900/40 to-gray-900',
  'Health & Beauty':    'from-pink-900/40 to-gray-900',
  'Services':           'from-cyan-900/40 to-gray-900',
  'Vehicles & Parts':   'from-red-900/40 to-gray-900',
  'Property':           'from-yellow-900/30 to-gray-900',
  'Agriculture':        'from-lime-900/40 to-gray-900',
  'Crafts & Art':       'from-violet-900/40 to-gray-900',
  'Other':              'from-gray-800 to-gray-900',
}

const CATEGORY_TAGLINES: Record<string, string> = {
  'Food & Groceries':   'Fresh produce, grains, and groceries from local farms',
  'Electronics':        'Phones, laptops, audio, and smart devices',
  'Fashion & Clothing': 'Clothing, shoes, and accessories for every style',
  'Home & Living':      'Furniture, decor, and everything for your home',
  'Health & Beauty':    'Wellness products, skincare, and personal care',
  'Services':           'Skilled professionals and freelancers across Africa',
  'Vehicles & Parts':   'Cars, motorcycles, spare parts, and accessories',
  'Property':           'Land, housing, and commercial spaces for rent or sale',
  'Agriculture':        'Seeds, fertilisers, tools, and farm equipment',
  'Crafts & Art':       'Handmade goods, artwork, and creative pieces',
  'Other':              'Everything else — if it exists, it's here',
}

// ── Related categories ────────────────────────────────────────────────────────

function RelatedCategories({ current }: { current: string }) {
  const navigate = useNavigate()
  const others   = PRODUCT_CATEGORIES.filter(c => c !== current)

  return (
    <div>
      <h2 className="text-sm font-bold text-gray-300 mb-3">Other Departments</h2>
      <div className="flex flex-wrap gap-2">
        {others.map(cat => (
          <button
            key={cat}
            onClick={() => navigate(`/category/${encodeURIComponent(cat)}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-100 hover:border-brand-500/40 hover:bg-brand-500/5 transition-all"
          >
            <span>{CATEGORY_ICONS[cat] ?? '📦'}</span>
            {cat}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Category page ─────────────────────────────────────────────────────────────

export default function CategoryPage() {
  const { cat }  = useParams<{ cat: string }>()
  const navigate = useNavigate()
  const decoded  = cat ? decodeURIComponent(cat) : ''

  const gradient = CATEGORY_GRADIENTS[decoded] ?? 'from-gray-800 to-gray-900'
  const tagline  = CATEGORY_TAGLINES[decoded] ?? ''
  const icon     = CATEGORY_ICONS[decoded] ?? '📦'

  const { data: topRated, isLoading: loadingTop } = useQuery({
    queryKey: ['category-top', decoded],
    queryFn:  () => listProducts({ category: decoded, sort: 'rating', per_page: 12 }),
    staleTime: 60_000,
    enabled:   !!decoded,
  })

  const { data: newest, isLoading: loadingNew } = useQuery({
    queryKey: ['category-new', decoded],
    queryFn:  () => listProducts({ category: decoded, sort: 'newest', per_page: 8 }),
    staleTime: 60_000,
    enabled:   !!decoded,
  })

  if (!decoded || !PRODUCT_CATEGORIES.includes(decoded as never)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <p className="text-gray-400">Category not found.</p>
        <button
          onClick={() => navigate('/browse')}
          className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Browse all products
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 py-5 space-y-6 max-w-screen-2xl mx-auto">

      {/* Category hero banner */}
      <div className={clsx('relative rounded-2xl overflow-hidden bg-gradient-to-br px-6 py-10', gradient)}>
        <div className="absolute right-6 top-1/2 -translate-y-1/2 text-7xl select-none pointer-events-none opacity-20">
          {icon}
        </div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-100">
          {icon} {decoded}
        </h1>
        <p className="text-sm text-gray-400 mt-1.5 max-w-md">{tagline}</p>
        <button
          onClick={() => navigate('/browse?category=' + encodeURIComponent(decoded))}
          className="mt-4 flex items-center gap-2 px-5 py-2 rounded-xl bg-gray-800/80 border border-gray-700 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors self-start"
        >
          Browse all in {decoded.split(' ')[0]} <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Top rated in this category */}
      <section>
        <h2 className="text-base font-bold text-gray-100 mb-4">
          Top rated in {decoded}
        </h2>
        {loadingTop ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden bg-gray-900 border border-gray-800">
                <div className="aspect-square skeleton" />
                <div className="p-3 space-y-2">
                  <div className="skeleton h-3 w-3/4 rounded" />
                  <div className="skeleton h-4 w-1/2 rounded" />
                  <div className="skeleton h-8 w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : topRated && topRated.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {topRated.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="flex flex-col items-center py-16 gap-3 text-gray-600">
            <Package className="w-10 h-10" />
            <p className="text-sm">No products yet in this category.</p>
            <button
              onClick={() => navigate('/sell/new')}
              className="text-sm text-brand-400 hover:text-brand-300 font-medium"
            >
              Be the first to list here →
            </button>
          </div>
        )}
      </section>

      {/* New arrivals in this category */}
      {newest && newest.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-100">New arrivals</h2>
            <button
              onClick={() => navigate('/browse?category=' + encodeURIComponent(decoded) + '&sort=newest')}
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium"
            >
              See all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {newest.slice(0, 4).map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* Other categories */}
      <RelatedCategories current={decoded} />
    </div>
  )
}
