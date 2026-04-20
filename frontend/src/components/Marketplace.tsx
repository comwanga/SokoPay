import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useCountry } from '../hooks/useCountry.ts'
import { Search, Package, Globe, ChevronDown, Loader2, SlidersHorizontal, X, ArrowUpDown } from 'lucide-react'
import { listProductsPage } from '../api/client.ts'
import { PRODUCT_CATEGORIES, CATEGORY_ICONS, COUNTRIES, countryName } from '../types'
import { useTranslation } from '../i18n/index.tsx'
import clsx from 'clsx'
import type { Product } from '../types'
import ProductCard from './ProductCard.tsx'

type SortOption = 'newest' | 'price_asc' | 'price_desc' | 'rating'

const SORT_I18N_KEYS: Record<SortOption, string> = {
  newest: 'market.sort.newest',
  price_asc: 'market.sort.price_asc',
  price_desc: 'market.sort.price_desc',
  rating: 'market.sort.rating',
}


function CountrySelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = COUNTRIES.find(c => c.code === value)
  const { t } = useTranslation()

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
        {selected ? selected.name : t('market.all_countries')}
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
            {t('market.all_countries')}
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


const PAGE_SIZE = 24

export default function Marketplace() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q') ?? '')
  const [category, setCategory] = useState<string>(() => searchParams.get('category') ?? '')
  const { saveCountry } = useCountry()
  const [country, setCountry] = useState<string>(
    () => localStorage.getItem('sokopay_country') ?? '',
  )
  const [scope, setScope] = useState<'country' | 'global'>('global')

  // Filter panel state
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState<SortOption>(
    () => (searchParams.get('sort') as SortOption | null) ?? 'newest',
  )
  const [minPrice, setMinPrice] = useState(() => searchParams.get('min_price') ?? '')
  const [maxPrice, setMaxPrice] = useState(() => searchParams.get('max_price') ?? '')
  const [inStockOnly, setInStockOnly] = useState(() => searchParams.get('in_stock') === 'true')

  // Cursor state for "load more" — reset when filters change
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(timer)
  }, [search])

  const syncedOnce = useRef(false)
  useEffect(() => {
    // Skip on mount — state was already initialised from the URL
    if (!syncedOnce.current) { syncedOnce.current = true; return }
    const params: Record<string, string> = {}
    if (debouncedSearch)   params.q         = debouncedSearch
    if (category)          params.category  = category
    if (country)           params.country   = country
    if (sort !== 'newest') params.sort      = sort
    if (minPrice)          params.min_price = minPrice
    if (maxPrice)          params.max_price = maxPrice
    if (inStockOnly)       params.in_stock  = 'true'
    setSearchParams(params, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, category, country, sort, minPrice, maxPrice, inStockOnly])

  const activeFilterCount = (sort !== 'newest' ? 1 : 0) + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) + (inStockOnly ? 1 : 0)

  function clearFilters() {
    setSort('newest')
    setMinPrice('')
    setMaxPrice('')
    setInStockOnly(false)
  }

  // Reset accumulated products when filters/search change
  const filterKey = `${category}|${country}|${scope}|${debouncedSearch}|${sort}|${minPrice}|${maxPrice}|${inStockOnly}`
  const prevFilterKey = useRef(filterKey)
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey
      setCursor(undefined)
      setAllProducts([])
      setNextCursor(null)
    }
  }, [filterKey])

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['products', category, country, scope, debouncedSearch, sort, minPrice, maxPrice, inStockOnly, cursor],
    queryFn: () => listProductsPage({
      category: category || undefined,
      country: country || undefined,
      scope: country ? scope : undefined,
      q: debouncedSearch || undefined,
      sort,
      min_price: minPrice ? parseFloat(minPrice) : undefined,
      max_price: maxPrice ? parseFloat(maxPrice) : undefined,
      in_stock: inStockOnly || undefined,
      per_page: PAGE_SIZE,
      cursor,
    }),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!data) return
    if (cursor === undefined) {
      // First/reset page — replace
      setAllProducts(data.items)
    } else {
      // Subsequent page — append
      setAllProducts(prev => [...prev, ...data.items])
    }
    setNextCursor(data.nextCursor)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const handleLoadMore = useCallback(() => {
    if (nextCursor) setCursor(nextCursor)
  }, [nextCursor])

  const isFirstLoad = isLoading && cursor === undefined
  const products = allProducts

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header + search row */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-100 leading-tight">{t('market.title')}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{t('market.subtitle')}</p>
        </div>
        <CountrySelector value={country} onChange={c => {
          setCountry(c)
          setScope('country')
          saveCountry(c)
        }} />
      </div>

      {/* Search bar + filter button */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder={t('market.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-base pl-9"
          />
        </div>

        {/* Filter toggle button */}
        <button
          onClick={() => setFiltersOpen(v => !v)}
          className={clsx(
            'relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors shrink-0',
            filtersOpen || activeFilterCount > 0
              ? 'bg-brand-500/20 border-brand-500/40 text-brand-400'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500',
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {t('market.filters')}
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Scope toggle — only meaningful when a country is selected */}
        {country && (
          <div className="flex gap-0.5 bg-gray-800/60 rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setScope('country')}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                scope === 'country' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
              )}
            >
              {country ? countryName(country) : t('market.local')}
            </button>
            <button
              onClick={() => setScope('global')}
              className={clsx(
                'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                scope === 'global' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
              )}
            >
              <Globe className="w-3 h-3" />
              {t('market.global')}
            </button>
          </div>
        )}
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5" /> {t('market.filters')}
            </p>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                <X className="w-3 h-3" /> {t('market.clear_filters')}
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('market.sort_by')}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(SORT_I18N_KEYS) as SortOption[]).map(key => (
                <button
                  key={key}
                  onClick={() => setSort(key)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-left',
                    sort === key
                      ? 'bg-brand-500/20 border-brand-500/40 text-brand-400'
                      : 'bg-gray-900/60 border-gray-700 text-gray-400 hover:border-gray-500',
                  )}
                >
                  {t(SORT_I18N_KEYS[key])}
                </button>
              ))}
            </div>
          </div>

          {/* Price range */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('market.min_price')} / {t('market.max_price')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder={t('market.min_price')}
                value={minPrice}
                onChange={e => setMinPrice(e.target.value)}
                min={0}
                className="input-base flex-1 text-sm"
              />
              <span className="text-gray-600 text-xs shrink-0">–</span>
              <input
                type="number"
                placeholder={t('market.max_price')}
                value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
                min={0}
                className="input-base flex-1 text-sm"
              />
            </div>
          </div>

          {/* In-stock toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setInStockOnly(v => !v)}
              className={clsx(
                'w-9 h-5 rounded-full transition-colors relative shrink-0',
                inStockOnly ? 'bg-brand-500' : 'bg-gray-700',
              )}
            >
              <span className={clsx(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                inStockOnly ? 'translate-x-4' : 'translate-x-0.5',
              )} />
            </div>
            <span className="text-xs text-gray-300">{t('market.in_stock_only')}</span>
          </label>
        </div>
      )}

      {/* Category icon grid */}
      <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-12 gap-1.5">
        <button
          onClick={() => setCategory('')}
          className={clsx(
            'flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg text-[10px] font-medium border transition-all',
            !category
              ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
              : 'bg-gray-800/60 text-gray-400 border-gray-700/60 hover:border-gray-500',
          )}
        >
          <span className="text-lg">🏪</span>
          <span>{t('market.all_categories')}</span>
        </button>
        {PRODUCT_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat === category ? '' : cat)}
            className={clsx(
              'flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg text-[10px] font-medium border transition-all',
              category === cat
                ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                : 'bg-gray-800/60 text-gray-400 border-gray-700/60 hover:border-gray-500',
            )}
          >
            <span className="text-lg">{CATEGORY_ICONS[cat]}</span>
            <span className="leading-tight text-center line-clamp-1">{cat.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Results count */}
      {!isFirstLoad && !isError && (
        <p className="text-xs text-gray-600 -mt-1">
          {products.length} listing{products.length !== 1 ? 's' : ''}
          {category ? ` · ${category}` : ''}
          {country ? ` · ${countryName(country)}` : ''}
          {debouncedSearch ? ` matching "${debouncedSearch}"` : ''}
        </p>
      )}

      {/* Skeleton grid on first load */}
      {isFirstLoad && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="aspect-video skeleton" />
              <div className="p-3 space-y-2">
                <div className="skeleton h-3.5 w-3/4 rounded" />
                <div className="skeleton h-4 w-1/2 rounded" />
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

      {!isFirstLoad && !isError && products.length === 0 && (
        <div className="text-center py-16 space-y-2">
          <Package className="w-10 h-10 text-gray-700 mx-auto" />
          <p className="text-gray-400 font-medium">{t('market.empty')}</p>
          <p className="text-sm text-gray-600">{t('market.empty_hint')}</p>
        </div>
      )}

      {!isFirstLoad && !isError && products.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Load more */}
      {nextCursor && !isFirstLoad && (
        <div className="flex justify-center pt-2">
          <button
            onClick={handleLoadMore}
            disabled={isFetching}
            className="btn-secondary gap-2"
          >
            {isFetching
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : null}
            {t('market.load_more')}
          </button>
        </div>
      )}
    </div>
  )
}
