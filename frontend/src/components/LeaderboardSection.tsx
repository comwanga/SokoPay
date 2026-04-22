import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listProducts } from '../api/client.ts'
import { BadgeCheck, Star, TrendingUp, ArrowRight } from 'lucide-react'
import SellerTierBadge from './SellerTierBadge.tsx'
import FollowButton from './FollowButton.tsx'

interface SellerEntry {
  id: string
  name: string
  verified: boolean
  avgRating: number
  ratingCount: number
  listingCount: number
  minPrice: number
  category: string
}

export default function LeaderboardSection() {
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ['leaderboard-products'],
    queryFn: () => listProducts({ sort: 'rating', in_stock: true, per_page: 100 }),
    staleTime: 300_000,
  })

  if (!data || data.length === 0) return null

  // Aggregate sellers from product listings
  const sellerMap = new Map<string, SellerEntry>()
  for (const p of data) {
    const existing = sellerMap.get(p.seller_id)
    if (existing) {
      existing.listingCount++
      if (p.price_kes && parseFloat(p.price_kes) < existing.minPrice) {
        existing.minPrice = parseFloat(p.price_kes)
      }
      // weighted avg rating
      if ((p.avg_rating ?? 0) > 0) {
        existing.avgRating = Math.max(existing.avgRating, p.avg_rating ?? 0)
        existing.ratingCount += p.rating_count ?? 0
      }
    } else {
      sellerMap.set(p.seller_id, {
        id: p.seller_id,
        name: p.seller_name,
        verified: p.seller_verified,
        avgRating: p.avg_rating ?? 0,
        ratingCount: p.rating_count ?? 0,
        listingCount: 1,
        minPrice: parseFloat(p.price_kes),
        category: p.category,
      })
    }
  }

  // Score = rating * listing count, sort descending
  const ranked = Array.from(sellerMap.values())
    .filter(s => s.avgRating > 0 && s.ratingCount > 0)
    .sort((a, b) => (b.avgRating * b.listingCount) - (a.avgRating * a.listingCount))
    .slice(0, 10)

  if (ranked.length < 3) return null

  const medals = ['🥇', '🥈', '🥉']

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand-400" />
          Top Sellers
        </h2>
        <button onClick={() => navigate('/browse')} className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium">
          All sellers <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="grid gap-2">
        {ranked.map((seller, i) => (
          <div
            key={seller.id}
            className="card flex items-center gap-4 p-3 hover:border-gray-700 transition-colors"
          >
            {/* Rank */}
            <div className="w-8 shrink-0 text-center">
              {i < 3
                ? <span className="text-lg">{medals[i]}</span>
                : <span className="text-sm font-bold text-gray-600">#{i + 1}</span>}
            </div>

            {/* Avatar */}
            <button
              onClick={() => navigate(`/sellers/${seller.id}`)}
              className="w-10 h-10 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-base font-bold text-brand-400 shrink-0 hover:opacity-80 transition-opacity"
            >
              {seller.name.charAt(0).toUpperCase()}
            </button>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <button onClick={() => navigate(`/sellers/${seller.id}`)} className="text-left hover:opacity-80 transition-opacity">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-gray-100 truncate">{seller.name}</p>
                  {seller.verified && <BadgeCheck className="w-3.5 h-3.5 text-brand-400 shrink-0" />}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-0.5 text-xs text-yellow-400">
                    <Star className="w-3 h-3 fill-yellow-400" />
                    {seller.avgRating.toFixed(1)}
                    <span className="text-gray-600 ml-0.5">({seller.ratingCount})</span>
                  </span>
                  <span className="text-[10px] text-gray-600">{seller.listingCount} listings</span>
                </div>
              </button>
              <div className="mt-1">
                <SellerTierBadge completedOrders={seller.ratingCount * 2} avgRating={seller.avgRating} size="sm" />
              </div>
            </div>

            {/* Follow */}
            <FollowButton sellerId={seller.id} sellerName={seller.name} size="sm" />
          </div>
        ))}
      </div>
    </section>
  )
}
