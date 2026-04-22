import clsx from 'clsx'

export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

export interface TierInfo {
  tier: Tier
  emoji: string
  color: string
  bg: string
  border: string
  nextTier: Tier | null
  ordersNeeded: number | null
  ratingNeeded: number | null
  label: string
}

const TIERS: { tier: Tier; minOrders: number; minRating: number; emoji: string }[] = [
  { tier: 'Platinum', minOrders: 100, minRating: 4.5, emoji: '💎' },
  { tier: 'Gold',     minOrders: 25,  minRating: 4.0, emoji: '🥇' },
  { tier: 'Silver',   minOrders: 5,   minRating: 3.5, emoji: '🥈' },
  { tier: 'Bronze',   minOrders: 0,   minRating: 0,   emoji: '🥉' },
]

const TIER_STYLES: Record<Tier, { color: string; bg: string; border: string; label: string }> = {
  Platinum: { color: 'text-cyan-300',   bg: 'bg-cyan-900/30',   border: 'border-cyan-700/40', label: 'Platinum Seller' },
  Gold:     { color: 'text-yellow-300', bg: 'bg-yellow-900/30', border: 'border-yellow-700/40', label: 'Gold Seller' },
  Silver:   { color: 'text-gray-300',   bg: 'bg-gray-700/40',   border: 'border-gray-600/40', label: 'Silver Seller' },
  Bronze:   { color: 'text-orange-300', bg: 'bg-orange-900/20', border: 'border-orange-700/30', label: 'Bronze Seller' },
}

export function computeTier(completedOrders: number, avgRating: number): TierInfo {
  const matched = TIERS.find(t => completedOrders >= t.minOrders && avgRating >= t.minRating)
    ?? TIERS[TIERS.length - 1]

  const idx = TIERS.indexOf(matched)
  const next = idx > 0 ? TIERS[idx - 1] : null

  const styles = TIER_STYLES[matched.tier]

  return {
    tier: matched.tier,
    emoji: matched.emoji,
    ...styles,
    nextTier: next?.tier ?? null,
    ordersNeeded: next ? Math.max(0, next.minOrders - completedOrders) : null,
    ratingNeeded: next && avgRating < next.minRating ? next.minRating : null,
  }
}

interface Props {
  completedOrders: number
  avgRating: number
  size?: 'sm' | 'md' | 'lg'
  showProgress?: boolean
}

export default function SellerTierBadge({ completedOrders, avgRating, size = 'md', showProgress = false }: Props) {
  const info = computeTier(completedOrders, avgRating)

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-1 gap-1.5',
    lg: 'text-sm px-3 py-1.5 gap-2',
  }[size]

  const emojiSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }[size]

  return (
    <div className="space-y-2">
      <span className={clsx(
        'inline-flex items-center font-semibold rounded-full border',
        sizeClasses, info.color, info.bg, info.border,
      )}>
        <span className={emojiSize}>{info.emoji}</span>
        {info.label}
      </span>

      {showProgress && info.nextTier && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>Progress to {info.nextTier}</span>
            <span>{completedOrders} orders · {avgRating.toFixed(1)}★</span>
          </div>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            {(() => {
              const curr = TIERS.find(t => t.tier === info.tier)!
              const next = TIERS.find(t => t.tier === info.nextTier)!
              const pct = Math.min(100, Math.round(
                (completedOrders - curr.minOrders) / Math.max(1, next.minOrders - curr.minOrders) * 100,
              ))
              return (
                <div
                  className={clsx('h-full rounded-full transition-all', info.bg.replace('/30', '').replace('/20', '').replace('bg-', 'bg-').replace('900', '500').replace('700', '500'))}
                  style={{ width: `${pct}%` }}
                />
              )
            })()}
          </div>
          {info.ordersNeeded !== null && info.ordersNeeded > 0 && (
            <p className="text-[10px] text-gray-600">
              {info.ordersNeeded} more completed orders needed
              {info.ratingNeeded ? ` + maintain ${info.ratingNeeded}★ rating` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
