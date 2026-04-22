import { useQueries } from '@tanstack/react-query'
import { Heart, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getProduct } from '../api/client.ts'
import { useWishlist } from '../context/wishlist.tsx'
import ProductCard from './ProductCard.tsx'
import EmptyState from './EmptyState.tsx'
import { ProductGridSkeleton } from './Skeleton.tsx'
import type { Product } from '../types'

export default function WishlistPage() {
  const navigate = useNavigate()
  const { ids, count } = useWishlist()

  const results = useQueries({
    queries: ids.map(id => ({
      queryKey: ['product', id],
      queryFn: () => getProduct(id),
      staleTime: 120_000,
    })),
  })

  const loading = results.some(r => r.isLoading)
  const products = results.filter(r => r.data).map(r => r.data as Product)

  return (
    <div className="px-4 sm:px-6 py-5 max-w-screen-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-400 fill-red-400" />
            Wishlist
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">{count} saved item{count !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => navigate('/browse')}
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium"
        >
          Browse more <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {loading && ids.length > 0 && <ProductGridSkeleton count={ids.length} />}

      {!loading && products.length === 0 && (
        <EmptyState
          icon={<Heart className="w-6 h-6" />}
          title="Your wishlist is empty"
          description="Tap the heart on any product to save it here for later."
          action={
            <button onClick={() => navigate('/browse')} className="btn-primary">
              Start browsing
            </button>
          }
        />
      )}

      {products.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {products.map(p => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  )
}
