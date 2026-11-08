import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const Card = ({ className, ...props }: ComponentProps<'section'>) => (
  <section
    className={cn(
      'relative overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm transition-colors',
      className,
    )}
    {...props}
  />
)
