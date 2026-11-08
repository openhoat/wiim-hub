import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const Skeleton = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('animate-pulse rounded-lg bg-muted', className)} {...props} />
)
