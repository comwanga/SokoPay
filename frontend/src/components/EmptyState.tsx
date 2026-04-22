import clsx from 'clsx'

interface Props {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export default function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-5 text-gray-500">
          {icon}
        </div>
      )}
      <p className="text-gray-100 font-semibold text-base mb-1">{title}</p>
      {description && (
        <p className="text-sm text-gray-500 leading-relaxed max-w-xs mb-5">{description}</p>
      )}
      {action && !description && <div className="mt-5">{action}</div>}
      {action && description && action}
    </div>
  )
}
