import { UserPlus, UserCheck } from 'lucide-react'
import { useSellerFollow } from '../hooks/useSellerFollow.ts'
import { useToast } from '../context/toast.tsx'
import clsx from 'clsx'

interface Props {
  sellerId: string
  sellerName: string
  size?: 'sm' | 'md'
}

export default function FollowButton({ sellerId, sellerName, size = 'md' }: Props) {
  const { isFollowing, toggle } = useSellerFollow()
  const { toast } = useToast()
  const followed = isFollowing(sellerId)

  function handleToggle() {
    toggle(sellerId, sellerName)
    toast(
      followed ? `Unfollowed ${sellerName}` : `Following ${sellerName}`,
      followed ? 'info' : 'success',
      2500,
    )
  }

  const sizeClasses = size === 'sm'
    ? 'px-3 py-1.5 text-xs gap-1.5'
    : 'px-4 py-2 text-sm gap-2'

  return (
    <button
      onClick={handleToggle}
      className={clsx(
        'inline-flex items-center font-semibold rounded-xl border transition-all',
        sizeClasses,
        followed
          ? 'bg-brand-500/10 border-brand-500/30 text-brand-300 hover:bg-red-900/20 hover:border-red-700/30 hover:text-red-400'
          : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-brand-500/10 hover:border-brand-500/30 hover:text-brand-300',
      )}
    >
      {followed
        ? <><UserCheck className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />Following</>
        : <><UserPlus  className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />Follow</>}
    </button>
  )
}
