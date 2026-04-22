import clsx from 'clsx'

function Base({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-gray-800 rounded', className)} />
}

export function ProductCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <Base className="w-full aspect-[4/3] rounded-none" />
      <div className="p-3 space-y-2">
        <Base className="h-3 w-1/3 rounded-full" />
        <Base className="h-4 w-3/4" />
        <Base className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-1">
          <Base className="h-5 w-16" />
          <Base className="h-3 w-12 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function OrderRowSkeleton() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <Base className="h-4 w-1/2" />
          <Base className="h-3 w-1/3 rounded-full" />
        </div>
        <Base className="h-6 w-20 rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <Base className="h-3 w-24 rounded-full" />
        <Base className="h-5 w-16" />
      </div>
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card p-6 flex items-center gap-4">
        <Base className="w-16 h-16 rounded-full shrink-0" />
        <div className="space-y-2 flex-1">
          <Base className="h-5 w-32" />
          <Base className="h-3 w-24 rounded-full" />
        </div>
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} className="card p-4 space-y-2">
          <Base className="h-3 w-20 rounded-full" />
          <Base className="h-10 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

export function SellerCardSkeleton() {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Base className="w-12 h-12 rounded-full shrink-0" />
        <div className="space-y-1.5 flex-1">
          <Base className="h-4 w-28" />
          <Base className="h-3 w-20 rounded-full" />
        </div>
      </div>
      <Base className="h-3 w-full rounded-full" />
      <Base className="h-3 w-3/4 rounded-full" />
    </div>
  )
}
