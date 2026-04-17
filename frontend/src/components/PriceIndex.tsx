import { useQuery } from '@tanstack/react-query'
import { getPriceIndex, formatKes, type CategoryPriceStats } from '../api/client'

export default function PriceIndex() {
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['price-index'],
    queryFn: getPriceIndex,
    staleTime: 5 * 60 * 1000, // 5 min — updates are infrequent
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Market Price Index</h2>
        <p className="text-sm text-gray-400 mt-1">
          Live price statistics across active listings. Categories with fewer than 2 listings are excluded.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-400 text-sm">Failed to load price index.</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-400 text-sm">No data yet — check back once listings are active.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/60">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Listings</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Min</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Median</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Avg</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((row: CategoryPriceStats) => (
                <tr key={row.category} className="hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3 text-white font-medium capitalize">{row.category}</td>
                  <td className="px-4 py-3 text-gray-300 text-right">{row.product_count}</td>
                  <td className="px-4 py-3 text-gray-300 text-right">{formatKes(row.min_price_kes)}</td>
                  <td className="px-4 py-3 text-green-400 text-right font-semibold">{formatKes(row.median_price_kes)}</td>
                  <td className="px-4 py-3 text-gray-300 text-right">{formatKes(row.avg_price_kes)}</td>
                  <td className="px-4 py-3 text-gray-300 text-right">{formatKes(row.max_price_kes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">Prices shown per unit as listed. Updated on each request.</p>
    </div>
  )
}
