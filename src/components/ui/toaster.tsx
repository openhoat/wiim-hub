import { Toaster as Sonner } from 'sonner'
import { useSettings } from '@/lib/settings'

export const Toaster = () => {
  const { resolvedTheme } = useSettings()
  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border border-border bg-card text-foreground shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
    />
  )
}
