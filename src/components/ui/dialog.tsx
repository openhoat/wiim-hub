import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export const DialogContent = ({
  className,
  children,
  closeLabel = 'Close',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
    <DialogPrimitive.Content
      className={cn(
        // On a phone the sheet is pinned above the on-screen keyboard and never
        // taller than what is left: a form the keyboard covers is a form that
        // cannot be filled. The two variables are measured by src/lib/viewport.ts.
        'fixed bottom-[var(--keyboard-inset)] left-1/2 z-50 max-h-[calc(var(--visible-height)-1rem)] w-full max-w-lg -translate-x-1/2 overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-card p-5 shadow-2xl shadow-black/20 outline-none sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-4rem)] sm:-translate-y-1/2 sm:rounded-2xl',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
)
