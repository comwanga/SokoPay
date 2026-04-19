import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, ArrowRight, Zap, ShieldCheck,
  Globe, Star, BadgeCheck, Clock,
} from 'lucide-react'
import { listProducts, getProduct, formatKes } from '../api/client.ts'
import { PRODUCT_CATEGORIES, CATEGORY_ICONS } from '../types'
import { useTranslation } from '../i18n/index.tsx'
import { useRecentlyViewed } from '../hooks/useRecentlyViewed.ts'
import ProductCard from './ProductCard.tsx'
import clsx from 'clsx'
import type { Product } from '../types'

// ── Country name map ───────────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  KE: 'Kenya', UG: 'Uganda', TZ: 'Tanzania', RW: 'Rwanda',
  ET: 'Ethiopia', GH: 'Ghana', NG: 'Nigeria', ZA: 'South Africa',
  ZM: 'Zambia', ZW: 'Zimbabwe', SN: 'Senegal', CI: "Côte d'Ivoire",
}

// ── Hero carousel ─────────────────────────────────────────────────────────────

const HERO_SLIDES = [
  {
    headline: 'Pay with Lightning ⚡',
    sub: 'Instant payments across Africa. No banks, no delays.',
    cta: 'Shop Now',
    link: '/browse',
    gradient: 'from-brand-500/30 via-gray-900 to-gray-900',
    accent: 'text-brand-400',
    icon: <Zap className="w-24 h-24 text-brand-500/20" />,
  },
  {
    headline: 'Escrow Protection 🔒',
    sub: 'Buy with confidence — funds held until you confirm delivery.',
    cta: 'Browse Escrow Listings',
    link: '/browse',
    gradient: 'from-green-900/40 via-gray-900 to-gray-900',
    accent: 'text-green-400',
    icon: <ShieldCheck className="w-24 h-24 text-green-500/20" />,
  },
  {
    headline: 'Sell to Africa 🌍',
    sub: 'List your products and reach buyers across 12 countries.',
    cta: 'Start Selling',
    link: '/sell/new',
    gradient: 'from-bitcoin/20 via-gray-900 to-gray-900',
    accent: 'text-bitcoin',
    icon: <Globe className="w-24 h-24 text-bitcoin/20" />,
  },
]

function HeroCarousel() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startTimer() {
    timerRef.current = setInterval(() => {
      setCurrent(c => (c + 1) % HERO_SLIDES.length)
    }, 4500)
  }

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function goTo(idx: number) {
    if (timerRef.current) clearInterval(timerRef.current)
    setCurrent(idx)
    startTimer()
  }

  function prev() { goTo((current - 1 + HERO_SLIDES.length) % HERO_SLIDES.length) }
  function next() { goTo((current + 1) % HERO_SLIDES.length) }

  const slide = HERO_SLIDES[current]

  return (
    <div className={clsx('relative overflow-hidden rounded-2xl bg-gradient-to-r min-h-[180px] sm:min-h-[220px]', slide.gradient)}>
      {/* Background icon */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none select-none">
        {slide.icon}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-center h-full px-6 py-8 gap-3 max-w-lg">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-100 leading-tight">
          {slide.headline}
        </h2>
        <p className="text-sm text-gray-400 leading-relaxed">{slide.sub}</p>
        <button
          onClick={() => navigate(slide.link)}
          className={clsx(
            'self-start flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors',
            slide.accent,
          )}
        >
          {slide.cta} <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Nav arrows */}
      <button
        onClick={prev}
        className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-gray-900/70 text-gray-300 hover:bg-gray-800 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={next}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-gray-900/70 text-gray-300 hover:bg-gray-800 transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        {HERO_SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={clsx(
              'rounded-full transition-all',
              i === current ? 'w-5 h-1.5 bg-brand-400' : 'w-1.5 h-1.5 bg-gray-600',
            )}
          />
        ))}
      </div>
    </div>
  )
}

// ── Category tile grid ────────────────────────────────────────────────────────

function CategoryGrid() {
  const navigate = useNavigate()

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-gray-100">Shop by Department</h2>
        <button
          onClick={() => navigate('/browse')}
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium"
        >
          See all <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-11 gap-2">
        {PRODUCT_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => navigate(`/category/${encodeURIComponent(cat)}`)}
            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl bg-gray-900 border border-gray-800 hover:border-brand-500/40 hover:bg-brand-500/5 transition-all group"
          >
            <span className="text-2xl group-hover:scale-110 transition-transform">
              {CATEGORY_ICONS[cat] ?? '📦'}
            </span>
            <span className="text-[10px] text-gray-400 font-medium text-center leading-tight line-clamp-2 group-hover:text-brand-400 transition-colors">
              {cat.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ── Horizontal product row ────────────────────────────────────────────────────

function ProductRow({ title, products, viewAllLink }: { title: string; products: Product[]; viewAllLink: string }) {
  const navigate = useNavigate()
  const rowRef = useRef<HTMLDivElement>(null)

  function scroll(dir: 'left' | 'right') {
    if (!rowRef.current) return
    rowRef.current.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' })
  }

  if (!products.length) return null

  return (
    <section className="relative">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-gray-100">{title}</h2>
        <button
          onClick={() => navigate(viewAllLink)}
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium"
        >
          See all <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="relative group/row">
        {/* Left scroll button */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 w-8 h-8 rounded-full bg-gray-900 border border-gray-700 shadow-lg text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-all opacity-0 group-hover/row:opacity-100 hidden sm:flex items-center justify-center"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div
          ref={rowRef}
          className="flex gap-3 overflow-x-auto scrollbar-none pb-1 -mx-4 px-4 sm:mx-0 sm:px-0"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {products.map(product => (
            <div
              key={product.id}
              className="shrink-0 w-44 sm:w-48"
              style={{ scrollSnapAlign: 'start' }}
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>

        {/* Right scroll button */}
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 w-8 h-8 rounded-full bg-gray-900 border border-gray-700 shadow-lg text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-all opacity-0 group-hover/row:opacity-100 hidden sm:flex items-center justify-center"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </section>
  )
}

// ── Editorial spotlight (category feature) ────────────────────────────────────

function EditorialSpotlight({ category, gradient, tagline }: { category: string; gradient: string; tagline: string }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['home-spotlight', category],
    queryFn: () => listProducts({ category, sort: 'rating', per_page: 4 }),
    staleTime: 60_000,
  })

  if (!data?.length) return null

  return (
    <section className={clsx('rounded-2xl overflow-hidden bg-gradient-to-br p-4 sm:p-6', gradient)}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">{tagline}</p>
          <h2 className="text-base font-bold text-gray-100">{category}</h2>
        </div>
        <button
          onClick={() => navigate(`/category/${encodeURIComponent(category)}`)}
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium shrink-0"
        >
          See more <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {data.slice(0, 4).map(product => (
          <button
            key={product.id}
            onClick={() => navigate(`/products/${product.id}`)}
            className="group bg-gray-900/60 border border-gray-800/80 rounded-xl overflow-hidden hover:border-gray-700 transition-all text-left"
          >
            <div className="aspect-square bg-gray-800 overflow-hidden">
              {product.images[0] ? (
                <img
                  src={product.images.find(i => i.is_primary)?.url ?? product.images[0].url}
                  alt={product.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl">
                  {CATEGORY_ICONS[product.category] ?? '📦'}
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-xs text-gray-300 font-medium line-clamp-1">{product.title}</p>
              <p className="text-xs text-brand-400 font-bold mt-0.5">{formatKes(product.price_kes)}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

// ── Delivery location banner ───────────────────────────────────────────────────

function LocationBanner() {
  const navigate = useNavigate()
  const stored   = localStorage.getItem('sokopay_country')
  const label    = stored ? COUNTRY_NAMES[stored] ?? stored : null

  if (!label) return null

  return (
    <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5">
      <p className="text-xs text-gray-400">
        Showing items that ship to <span className="font-semibold text-gray-200">{label}</span>
      </p>
      <button
        onClick={() => navigate('/browse')}
        className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors"
      >
        Change
      </button>
    </div>
  )
}

// ── Trust bar ──────────────────────────────────────────────────────────────────

function TrustBar() {
  const items = [
    { icon: <Zap className="w-4 h-4 text-bitcoin" />, label: 'Lightning Fast Payments' },
    { icon: <ShieldCheck className="w-4 h-4 text-green-400" />, label: 'Escrow Protection' },
    { icon: <Globe className="w-4 h-4 text-brand-400" />, label: 'Ships Across Africa' },
    { icon: <BadgeCheck className="w-4 h-4 text-brand-400" />, label: 'Verified Sellers' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map(({ icon, label }) => (
        <div key={label} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5">
          {icon}
          <span className="text-xs font-medium text-gray-400">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main homepage ─────────────────────────────────────────────────────────────

export default function HomePage() {
  const { t } = useTranslation()
  const country = localStorage.getItem('sokopay_country') ?? undefined
  const countryName = country ? COUNTRY_NAMES[country] : undefined

  const { data: topPicks } = useQuery({
    queryKey: ['home-top-picks', country],
    queryFn: () => listProducts({ sort: 'rating', country, per_page: 12 }),
    staleTime: 60_000,
    enabled: !!country,
  })

  const { data: trending } = useQuery({
    queryKey: ['home-trending'],
    queryFn: () => listProducts({ sort: 'rating', per_page: 12 }),
    staleTime: 60_000,
  })

  const { data: newArrivals } = useQuery({
    queryKey: ['home-new-arrivals'],
    queryFn: () => listProducts({ sort: 'newest', per_page: 12 }),
    staleTime: 60_000,
  })

  return (
    <div className="px-4 sm:px-6 py-5 space-y-6 max-w-screen-2xl mx-auto">

      {/* Location banner (only if country is set) */}
      <LocationBanner />

      {/* Hero carousel */}
      <HeroCarousel />

      {/* Trust bar */}
      <TrustBar />

      {/* Category department grid */}
      <CategoryGrid />

      {/* Top picks for your country */}
      {country && topPicks && topPicks.length > 0 && (
        <ProductRow
          title={`Top Picks for ${countryName}`}
          products={topPicks}
          viewAllLink={`/browse?country=${country}&sort=rating`}
        />
      )}

      {/* Trending / What's selling fast */}
      {trending && (
        <ProductRow
          title="What's Selling Fast 🔥"
          products={trending}
          viewAllLink="/browse?sort=rating"
        />
      )}

      {/* Editorial: Food & Agriculture spotlight */}
      <EditorialSpotlight
        category="Food & Groceries"
        gradient="from-green-950/60 to-gray-950"
        tagline="Fresh from the farm"
      />

      {/* New arrivals */}
      {newArrivals && (
        <ProductRow
          title="New on SokoPay ✨"
          products={newArrivals}
          viewAllLink="/browse?sort=newest"
        />
      )}

      {/* Electronics spotlight */}
      <EditorialSpotlight
        category="Electronics"
        gradient="from-blue-950/50 to-gray-950"
        tagline="Gear up"
      />

      {/* Agriculture spotlight */}
      <EditorialSpotlight
        category="Agriculture"
        gradient="from-yellow-950/40 to-gray-950"
        tagline="Tools & inputs for farmers"
      />

      {/* Fashion spotlight */}
      <EditorialSpotlight
        category="Fashion & Clothing"
        gradient="from-purple-950/50 to-gray-950"
        tagline="Look your best"
      />

      {/* Recently viewed */}
      <RecentlyViewedRow />

      {/* CTA banner: sell on SokoPay */}
      <SellCTABanner />
    </div>
  )
}

// ── Recently viewed row ───────────────────────────────────────────────────────

function RecentlyViewedRow() {
  const { ids, clear } = useRecentlyViewed()

  const results = useQueries({
    queries: ids.slice(0, 8).map(id => ({
      queryKey: ['product', id],
      queryFn:  () => getProduct(id),
      staleTime: 120_000,
    })),
  })

  const products = results
    .filter(r => r.data)
    .map(r => r.data as Product)

  if (products.length === 0) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          Recently Viewed
        </h2>
        <button
          onClick={clear}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  )
}

// ── Sell CTA banner ───────────────────────────────────────────────────────────

function SellCTABanner() {
  const navigate = useNavigate()
  return (
    <div className="rounded-2xl bg-gradient-to-r from-brand-500/20 to-brand-500/5 border border-brand-500/20 px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-lg font-bold text-gray-100">Sell on SokoPay</h3>
        <p className="text-sm text-gray-400 mt-0.5">
          List your products and get paid instantly with M-Pesa or Lightning.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => navigate('/sell/new')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold transition-colors shadow-sm"
        >
          Start Selling <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
