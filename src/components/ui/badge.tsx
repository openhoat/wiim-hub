import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/60 text-muted-foreground',
        accent: 'border-accent/30 bg-accent/10 text-accent',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        plain: 'border-transparent text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
)
