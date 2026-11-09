import { Activity, Play } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useSettings } from '@/lib/settings'
import type { View } from '@/lib/types'

const options = [
  { value: 'user', icon: Play, labelKey: 'views.user' },
  { value: 'diagnostic', icon: Activity, labelKey: 'views.diagnostic' },
] as const

export const ViewSwitch = ({
  view,
  onChange,
}: Readonly<{ view: View; onChange: (view: View) => void }>) => {
  const { t } = useSettings()
  return (
    // biome-ignore lint/a11y/useSemanticElements: a segmented control groups buttons, it is not a form fieldset
    <div
      role="group"
      aria-label={t('settings')}
      className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-muted/40 p-0.5"
    >
      {options.map(option => {
        const Icon = option.icon
        const active = option.value === view
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={t(option.labelKey)}
            title={t(option.labelKey)}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2 text-xs font-medium transition-colors outline-none sm:px-2.5',
              'focus-visible:ring-2 focus-visible:ring-accent/50',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" strokeWidth={2} />
            <span className="hidden sm:inline">{t(option.labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
