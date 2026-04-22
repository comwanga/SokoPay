import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserCheck, ArrowRight, ChevronLeft, ChevronRight, Store } from 'lucide-react'
import { getStorefront, listProducts } from '../api/client.ts'
import { useSellerFollow } from '../hooks/useSellerFollow.ts'
import FollowButton from './FollowButton.tsx'
import EmptyState from './EmptyState.tsx'
import ProductCard from './ProductCard.tsx'
import type { Product } from '../types'

function FollowedSellerCard({ id, name }: { id: string; name: string }) {
  const navigate   = useNavigate()
  const rowRef     = useRef<HTMLDivElement>(null)

  const { data: storefront } = useQuery({ queryKey: ['storefront', id], queryFn: () => getStorefront(id), staleTime: 120_000 })
  const { data: products }   = useQuery({ queryKey: ['seller-products', id], queryFn: () => listProducts({ seller_id: id, sort: 'newest', per_page: 6, in_stock: true }), staleTime: 60_000 })

  function scroll(dir: 'left' | 'right') {
    rowRef.current?.scrollBy({ left: dir === 'left' ? -240 : 240, behavior: 'smooth' })
  }

  return (
    <div className="space-y-3">
      {/* Seller header row */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(`/sellers/${id}`)}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-sm font-bold text-brand-400 shrink-0">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-100">{name}</p>
            {storefront && (
              <p className="text-[10px] text-gray-500">
                {storefront.seller.product_count} listing{storefront.seller.product_count !== 1 ? 's' : ''} · {storefront.seller.confirmed_order_count} orders
              </p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <FollowButton sellerId={id} sellerName={name} size="sm" />
          <button onClick={() => navigate(`/sellers/${id}`)} className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium">
            View <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Products row */}
      {products && products.length > 0 ? (
        <div className="relative group/row">
          <button onClick={() => scroll('left')} className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 w-7 h-7 rounded-full bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 opacity-0 group-hover/row:opacity-100 transition-all hidden sm:flex items-center justify-center">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <div ref={rowRef} className="flex gap-3 overflow-x-auto scrollbar-none pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" style={{ scrollSnapType: 'x mandatory' }}>
            {products.map((p: Product) => (
              <div key={p.id} className="shrink-0 w-40 sm:w-44" style={{ scrollSnapAlign: 'start' }}>
                <ProductCard product={p} />
              </div>
            ))}
          </div>
          <button onClick={() => scroll('right')} className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 w-7 h-7 rounded-full bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 opacity-0 group-hover/row:opacity-100 transition-all hidden sm:flex items-center justify-center">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-600 pl-1">No listings at the moment</p>
      )}
    </div>
  )
}

// Inline useQuery for the component above
import { useQuery } from '@tanstack/react-query'

export default function FollowingPage() {
  const navigate = useNavigate()
  const { following, count } = useSellerFollow()

  return (
    <div className="px-4 sm:px-6 py-5 max-w-screen-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-brand-400" />
            Following
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">{count} seller{count !== 1 ? 's' : ''} you follow</p>
        </div>
        <button onClick={() => navigate('/browse')} className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium">
          Discover sellers <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {following.length === 0 ? (
        <EmptyState
          icon={<Store className="w-6 h-6" />}
          title="Not following anyone yet"
          description="Visit a seller's page and tap Follow to see their new listings here."
          action={<button onClick={() => navigate('/browse')} className="btn-primary">Browse marketplace</button>}
        />
      ) : (
        <div className="space-y-8 divide-y divide-gray-800">
          {following.map((f, i) => (
            <div key={f.id} className={i > 0 ? 'pt-6' : ''}>
              <FollowedSellerCard id={f.id} name={f.name} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
