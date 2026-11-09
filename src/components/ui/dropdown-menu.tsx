import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export const DropdownMenuContent = ({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-48 overflow-hidden rounded-xl border border-border bg-card p-1 text-sm shadow-xl shadow-black/10',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
)

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) => (
  <DropdownMenuPrimitive.Label
    className={cn(
      'px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase',
      className
    )}
    {...props}
  />
)

export const DropdownMenuItem = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) => (
  <DropdownMenuPrimitive.Item
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 outline-none select-none',
      'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
      className
    )}
    {...props}
  />
)

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...props} />
)

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export const DropdownMenuRadioItem = ({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) => (
  <DropdownMenuPrimitive.RadioItem
    className={cn(
      'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 outline-none select-none',
      'data-[highlighted]:bg-muted data-[state=checked]:text-foreground data-[state=unchecked]:text-muted-foreground',
      className
    )}
    {...props}
  >
    {children}
    <DropdownMenuPrimitive.ItemIndicator>
      <Check className="size-3.5 text-accent" />
    </DropdownMenuPrimitive.ItemIndicator>
  </DropdownMenuPrimitive.RadioItem>
)
