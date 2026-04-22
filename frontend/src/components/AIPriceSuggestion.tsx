import { useQuery } from '@tanstack/react-query'
import { listProducts, formatKes } from '../api/client.ts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  category: string
  currentPrice: string
  unit: string
  onApply(price: string): void
}

export default function AIPriceSuggestion({ category, currentPrice, unit, onApply }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['price-suggestion', category],
    queryFn: () => listProducts({ category, sort: 'newest', in_stock: true, per_page: 50 }),
    enabled: !!category,
    staleTime: 120_000,
  })

  if (!category || isLoading || !data || data.length < 3) return null

  const prices = data.map(p => parseFloat(p.price_kes)).filter(p => p > 0).sort((a, b) => a - b)
  if (prices.length < 3) return null

  const min    = prices[0]
  const max    = prices[prices.length - 1]
  const median = prices[Math.floor(prices.length / 2)]
  const q1     = prices[Math.floor(prices.length * 0.25)]
  const q3     = prices[Math.floor(prices.length * 0.75)]
  const current = parseFloat(currentPrice) || 0

  let position: 'low' | 'fair' | 'high' | null = null
  if (current > 0) {
    if (current < q1)      position = 'low'
    else if (current > q3) position = 'high'
    else                   position = 'fair'
  }

  const barPct = max > min
    ? Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100))
    : 50

  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-400 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
          Market prices for {category}
          <span className="text-gray-600 font-normal">({data.length} listings)</span>
        </p>
        {position && (
          <span className={clsx(
            'text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1',
            position === 'low'  && 'bg-blue-900/30 text-blue-400 border border-blue-700/30',
            position === 'fair' && 'bg-green-900/30 text-green-400 border border-green-700/30',
            position === 'high' && 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/30',
          )}>
            {position === 'low'  && <TrendingDown className="w-3 h-3" />}
            {position === 'fair' && <Minus className="w-3 h-3" />}
            {position === 'high' && <TrendingUp className="w-3 h-3" />}
            {position === 'low' ? 'Below market' : position === 'fair' ? 'Fair price' : 'Above market'}
          </span>
        )}
      </div>

      {/* Price range bar */}
      <div className="space-y-1.5">
        <div className="relative h-2 bg-gray-700 rounded-full">
          {/* IQR zone (green) */}
          <div
            className="absolute h-full bg-green-500/30 rounded-full"
            style={{
              left:  `${max > min ? ((q1 - min) / (max - min)) * 100 : 25}%`,
              width: `${max > min ? ((q3 - q1) / (max - min)) * 100 : 50}%`,
            }}
          />
          {/* Median tick */}
          <div
            className="absolute top-0 h-full w-0.5 bg-green-400 rounded-full"
            style={{ left: `${max > min ? ((median - min) / (max - min)) * 100 : 50}%` }}
          />
          {/* Current price cursor */}
          {current > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-brand-400 border-2 border-gray-900 shadow"
              style={{ left: `calc(${barPct}% - 6px)` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-gray-600">
          <span>{formatKes(String(min))}</span>
          <span className="text-green-500">Median {formatKes(String(median))}</span>
          <span>{formatKes(String(max))}</span>
        </div>
      </div>

      {/* Quick-apply suggestions */}
      <div className="flex gap-2 flex-wrap">
        {[
          { label: 'Low', value: Math.round(q1), color: 'text-blue-400 bg-blue-900/20 border-blue-700/30' },
          { label: 'Market', value: Math.round(median), color: 'text-green-400 bg-green-900/20 border-green-700/30' },
          { label: 'Premium', value: Math.round(q3), color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
        ].map(s => (
          <button
            key={s.label}
            type="button"
            onClick={() => onApply(String(s.value))}
            className={clsx(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all hover:opacity-80',
              s.color,
            )}
          >
            {s.label}: {formatKes(String(s.value))}/{unit}
          </button>
        ))}
      </div>
    </div>
  )
}
