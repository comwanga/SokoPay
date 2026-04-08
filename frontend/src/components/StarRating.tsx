import { useState } from 'react'
import { Star } from 'lucide-react'
import clsx from 'clsx'

interface StarRatingProps {
  rating: number
  size?: 'sm' | 'md'
  interactive?: boolean
  onChange?: (rating: number) => void
}

export default function StarRating({
  rating,
  size = 'md',
  interactive = false,
  onChange,
}: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'
  const display = hovered ?? rating

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => {
        const filled = star <= Math.round(display)
        const half = !filled && star - 0.5 <= display

        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onChange?.(star)}
            onMouseEnter={() => interactive && setHovered(star)}
            onMouseLeave={() => interactive && setHovered(null)}
            className={clsx(
              'relative transition-transform',
              interactive && 'cursor-pointer hover:scale-110',
              !interactive && 'cursor-default',
            )}
            aria-label={`${star} star${star !== 1 ? 's' : ''}`}
          >
            {/* Background star (empty) */}
            <Star
              className={clsx(iconSize, 'text-gray-600')}
              strokeWidth={1.5}
            />
            {/* Filled overlay */}
            {(filled || half) && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: half ? '50%' : '100%' }}
              >
                <Star
                  className={clsx(
                    iconSize,
                    interactive ? 'text-yellow-400' : 'text-yellow-400',
                    'fill-yellow-400',
                  )}
                  strokeWidth={1.5}
                />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
